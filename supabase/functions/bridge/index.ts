// Edge Function "bridge": leva uma decisão aprovada ao repositório como Draft PR.
//
// Segredos (Supabase › Edge Functions › Secrets), nunca no código:
//   GITHUB_APP_ID            número da GitHub App
//   GITHUB_APP_PRIVATE_KEY   chave privada (.pem) da app, conteúdo completo
//   BRIDGE_REPO              opcional, "dono/repositório" (padrão abaixo)
//   ANTHROPIC_API_KEY        chave da Claude API (só para os planos dos diretores)
//   ANTHROPIC_MODEL          opcional, modelo do Claude (padrão em core.js)
// SUPABASE_URL e as chaves do projeto (SUPABASE_PUBLISHABLE_KEYS e
// SUPABASE_SECRET_KEYS, ou as antigas SUPABASE_ANON_KEY e
// SUPABASE_SERVICE_ROLE_KEY) já existem na Edge Function. A chave secreta só é
// usada aqui, para gravar a auditoria.
//
// Implantar com verify_jwt = false: a sessão do usuário é verificada abaixo
// (auth.getUser), como recomenda o Supabase para as chaves novas.
import { createClient } from "npm:@supabase/supabase-js@2.109.0";
import { executeDecision, executePlan, planAuthorRole, publicError } from "./core.js";

const DEFAULT_REPO = "ricardodsf03/apex-virtual-group";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

// Lê uma chave do dicionário novo (JSON por nome) ou, na falta, da variável antiga.
function projectKey(dictionaryVar: string, legacyVar: string): string {
  try {
    const keys = JSON.parse(Deno.env.get(dictionaryVar) ?? "{}");
    const key = keys.default ?? Object.values(keys)[0];
    if (typeof key === "string" && key) return key;
  } catch { /* usa a variável antiga */ }
  return Deno.env.get(legacyVar) ?? "";
}

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" }
  });
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return reply(405, { error: "Método não permitido." });

  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return reply(401, { error: "Entre na sua conta." });

  let decisionId = "";
  let kind = "record";
  try {
    const body = await request.json();
    decisionId = String(body?.decision_id ?? "");
    kind = String(body?.kind ?? "record");
  } catch {
    return reply(400, { error: "Pedido inválido." });
  }
  if (!UUID.test(decisionId)) return reply(400, { error: "Decisão inválida." });
  if (kind !== "record" && kind !== "plan") return reply(400, { error: "Tipo de pedido inválido." });

  const url = Deno.env.get("SUPABASE_URL")!;
  // Cliente com a sessão do usuário: a RLS decide o que ele pode ver.
  const asUser = createClient(url, projectKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false }
  });
  const { data: userData, error: userError } = await asUser.auth.getUser();
  if (userError || !userData?.user) return reply(401, { error: "Sessão inválida. Entre de novo." });
  const userId = userData.user.id;

  const { data: decision, error: decisionError } = await asUser
    .from("decisions")
    .select("id, organization_id, title, rationale, proposed_by_role, status, decision_note, decided_at")
    .eq("id", decisionId)
    .maybeSingle();
  if (decisionError) return reply(500, { error: "Não foi possível ler a decisão." });
  if (!decision) return reply(404, { error: "Decisão não encontrada. Espere a sincronização e tente de novo." });
  if (decision.status !== "Aprovada") return reply(409, { error: "Só decisões aprovadas podem ir para o repositório." });

  const { data: isOwner } = await asUser
    .from("organization_members")
    .select("role")
    .eq("organization_id", decision.organization_id)
    .eq("user_id", userId)
    .eq("role", "owner")
    .maybeSingle();
  if (!isOwner) return reply(403, { error: "Só o dono da organização pode usar a Bridge." });

  // Auditoria com a chave de serviço (o navegador não consegue escrever aqui).
  const asServer = createClient(url, projectKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false }
  });
  const { data: existing } = await asServer
    .from("bridge_runs")
    .select("id, status, pr_url, pr_number")
    .eq("decision_id", decisionId)
    .eq("kind", kind)
    .maybeSingle();
  if (existing?.status === "opened") {
    return reply(200, { status: "opened", kind, pr_url: existing.pr_url, pr_number: existing.pr_number, repeated: true });
  }
  if (existing?.status === "running") return reply(409, { error: "Esta decisão já está sendo enviada." });

  let runId = existing?.id;
  if (runId) {
    await asServer.from("bridge_runs").update({ status: "running", error: null, requested_by: userId }).eq("id", runId);
  } else {
    const { data: run, error: runError } = await asServer
      .from("bridge_runs")
      .insert({ organization_id: decision.organization_id, decision_id: decisionId, requested_by: userId, kind })
      .select("id")
      .single();
    if (runError) return reply(409, { error: "Esta decisão já está sendo enviada." });
    runId = run.id;
  }

  const [owner, repo] = (Deno.env.get("BRIDGE_REPO") ?? DEFAULT_REPO).split("/");
  try {
    const github = {
      decision,
      fetchFn: fetch,
      appId: (Deno.env.get("GITHUB_APP_ID") ?? "").trim(),
      privateKey: Deno.env.get("GITHUB_APP_PRIVATE_KEY") ?? "",
      owner,
      repo
    };
    let result;
    if (kind === "plan") {
      // O conselho da organização, lido com a sessão do usuário (RLS): o autor
      // do plano e a lista que o agente usa para atribuir responsáveis.
      const { data: board } = await asUser
        .from("directors")
        .select("role_code, name, description")
        .eq("organization_id", decision.organization_id);
      const director = (board ?? []).find(item => item.role_code === planAuthorRole(decision));
      result = await executePlan({
        ...github,
        director,
        board: board ?? [],
        apiKey: (Deno.env.get("ANTHROPIC_API_KEY") ?? "").trim(),
        model: (Deno.env.get("ANTHROPIC_MODEL") ?? "").trim() || undefined
      });
    } else {
      result = await executeDecision(github);
    }
    await asServer.from("bridge_runs").update({
      status: "opened",
      branch: result.branch,
      commit_sha: result.commit,
      pr_number: result.number,
      pr_url: result.url
    }).eq("id", runId);
    return reply(200, { status: "opened", kind, pr_url: result.url, pr_number: result.number, branch: result.branch });
  } catch (error) {
    console.error("bridge:", error);
    const message = publicError(error);
    await asServer.from("bridge_runs").update({ status: "failed", error: message.slice(0, 300) }).eq("id", runId);
    return reply(502, { error: message });
  }
});
