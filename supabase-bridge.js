// Botões da Bridge nas decisões aprovadas (módulo ES): "Registrar no
// repositório" (kind "record") e "Pedir plano ao diretor" (kind "plan", com IA).
// Chama a Edge Function "bridge", que abre um Draft PR no GitHub. Só funciona
// com sessão iniciada; no modo local os botões não aparecem.

let client = null;
let organizationId = null;
const runs = {};
window.apexBridgeRuns = runs;

function rerender() {
  if (typeof window.renderDecisions === "function") window.renderDecisions();
}

async function loadRuns() {
  for (const key of Object.keys(runs)) delete runs[key];
  if (!client || !organizationId) return rerender();
  const { data, error } = await client
    .from("bridge_runs")
    .select("decision_id, kind, status, pr_url, pr_number, error")
    .eq("organization_id", organizationId);
  if (error) {
    console.error("Apex: não foi possível ler as execuções da Bridge.", error);
  } else {
    for (const row of data) runs[`${row.decision_id}:${row.kind || "record"}`] = row;
  }
  rerender();
}

// Lê a mensagem de erro devolvida pela função, sem expor detalhes internos.
async function errorMessage(error) {
  try {
    const body = await error?.context?.json?.();
    if (body?.error) return String(body.error).slice(0, 200);
  } catch { /* resposta sem JSON */ }
  return "Não foi possível falar com a Bridge. Tente de novo.";
}

async function send(decisionId, kind) {
  const decision = window.apexGetState?.().decisions.find(item => item.id === decisionId);
  if (!decision || decision.status !== "Aprovada") return;
  const question = kind === "plan"
    ? `Pedir um plano com IA para "${decision.title}"? O diretor escreve o plano e a Bridge abre um Draft PR.`
    : `Registrar a decisão "${decision.title}" no repositório? A Bridge vai abrir um Draft PR.`;
  if (!confirm(question)) return;

  const key = `${decisionId}:${kind}`;
  runs[key] = { decision_id: decisionId, kind, status: "running" };
  rerender();
  try {
    await window.apexSyncNow?.(); // a decisão tem de estar no Supabase antes
    const { data, error } = await client.functions.invoke("bridge", {
      body: { decision_id: decisionId, kind }
    });
    if (error) {
      runs[key] = { decision_id: decisionId, kind, status: "failed", error: await errorMessage(error) };
    } else {
      runs[key] = { decision_id: decisionId, kind, status: "opened", pr_url: data.pr_url, pr_number: data.pr_number };
      if (!data.repeated) {
        const what = kind === "plan" ? "o plano" : "o registro";
        window.apexRecord?.("Bridge", `Abriu o Draft PR #${data.pr_number} com ${what} da decisão "${decision.title}".`, "bridge");
      }
    }
  } catch (error) {
    console.error("Apex: falha na Bridge.", error);
    runs[key] = { decision_id: decisionId, kind, status: "failed", error: "Não foi possível falar com a Bridge. Tente de novo." };
  }
  rerender();
}

document.querySelector("#decisionList")?.addEventListener("click", event => {
  const id = event.target?.dataset?.decisionBridge;
  const kind = event.target?.dataset?.bridgeKind === "plan" ? "plan" : "record";
  if (id && client && organizationId) send(id, kind);
});

window.addEventListener("apex:organization-ready", event => {
  client = window.apexSupabase?.client ?? null;
  organizationId = event.detail?.organizationId ?? null;
  loadRuns();
});

window.addEventListener("apex:signed-out", () => {
  organizationId = null;
  loadRuns();
});
