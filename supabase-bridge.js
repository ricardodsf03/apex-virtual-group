// Botão "Registrar no repositório" das decisões aprovadas (módulo ES).
// Chama a Edge Function "bridge", que abre um Draft PR no GitHub. Só funciona
// com sessão iniciada; no modo local o botão não aparece.

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
    .select("decision_id, status, pr_url, pr_number, error")
    .eq("organization_id", organizationId);
  if (error) {
    console.error("Apex: não foi possível ler as execuções da Bridge.", error);
  } else {
    for (const row of data) runs[row.decision_id] = row;
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

async function send(decisionId) {
  const decision = window.apexGetState?.().decisions.find(item => item.id === decisionId);
  if (!decision || decision.status !== "Aprovada") return;
  if (!confirm(`Registrar a decisão "${decision.title}" no repositório? A Bridge vai abrir um Draft PR.`)) return;

  runs[decisionId] = { decision_id: decisionId, status: "running" };
  rerender();
  try {
    await window.apexSyncNow?.(); // a decisão tem de estar no Supabase antes
    const { data, error } = await client.functions.invoke("bridge", {
      body: { decision_id: decisionId }
    });
    if (error) {
      runs[decisionId] = { decision_id: decisionId, status: "failed", error: await errorMessage(error) };
    } else {
      runs[decisionId] = { decision_id: decisionId, status: "opened", pr_url: data.pr_url, pr_number: data.pr_number };
      if (!data.repeated) {
        window.apexRecord?.("Bridge", `Abriu o Draft PR #${data.pr_number} para a decisão "${decision.title}".`, "bridge");
      }
    }
  } catch (error) {
    console.error("Apex: falha na Bridge.", error);
    runs[decisionId] = { decision_id: decisionId, status: "failed", error: "Não foi possível falar com a Bridge. Tente de novo." };
  }
  rerender();
}

document.querySelector("#decisionList")?.addEventListener("click", event => {
  const id = event.target?.dataset?.decisionBridge;
  if (id && client && organizationId) send(id);
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
