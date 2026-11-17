// Ligação da interface à sincronização (módulo ES). Depende de supabase-auth.js
// (que publica a organização) e de app.js (que guarda o estado local).
// Se algo falhar, o dashboard continua a funcionar com os dados locais.
import { pullState, pushState, isEmptyState } from "./sync-core.js";

const DEBOUNCE_MS = 600;

let client = null;
let organizationId = null;
let timer = null;
let running = false;
let again = false;
let synced = new Set();

function setStatus(state, text) {
  const element = document.querySelector("#syncStatus");
  if (!element) return;
  element.dataset.state = state;
  element.textContent = text;
  element.hidden = !text;
}

async function flush() {
  if (!organizationId) return;
  if (running) { again = true; return; }
  running = true;
  const org = organizationId;
  try {
    setStatus("busy", "Sincronizando…");
    await pushState(client, org, window.apexGetState(), synced);
    if (org === organizationId) setStatus("ok", "Sincronizado");
  } catch (error) {
    console.error("Apex: falha ao sincronizar.", error);
    setStatus("warn", "Sem sincronização (dados locais mantidos)");
  } finally {
    running = false;
    if (again) { again = false; schedule(); }
  }
}

// Envia já (usado antes de chamar a Bridge). Espera um envio em curso terminar.
window.apexSyncNow = async () => {
  clearTimeout(timer);
  while (running) await new Promise(resolve => setTimeout(resolve, 100));
  await flush();
};

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(flush, DEBOUNCE_MS);
}

async function start(detail) {
  client = window.apexSupabase?.client ?? null;
  organizationId = detail?.organizationId ?? null;
  synced = new Set();
  if (!client || !organizationId) return;

  const org = organizationId;
  try {
    setStatus("busy", "Sincronizando…");
    const remote = await pullState(client, org);
    if (org !== organizationId) return;
    if (isEmptyState(remote)) {
      // Primeira vez: leva os dados locais para a organização.
      await pushState(client, org, window.apexGetState(), synced);
    } else {
      synced = new Set(remote.activities.map(item => item.id));
      window.apexReplaceState(remote);
    }
    if (org === organizationId) setStatus("ok", "Sincronizado");
  } catch (error) {
    console.error("Apex: falha ao sincronizar.", error);
    setStatus("warn", "Sem sincronização (dados locais mantidos)");
  }
}

window.addEventListener("apex:organization-ready", event => start(event.detail));
window.addEventListener("apex:state-saved", () => { if (organizationId) schedule(); });
window.addEventListener("apex:signed-out", () => {
  clearTimeout(timer);
  organizationId = null;
  synced = new Set();
  setStatus("", "");
});
