// Cliente Supabase da Apex (módulo ES).
// Carrega a biblioteca oficial de uma versão fixa e expõe window.apexSupabase.
// Se a rede ou a biblioteca falharem, o dashboard continua funcionando.

const SUPABASE_JS_VERSION = "2.109.0";
const SUPABASE_JS_URL =
  `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@${SUPABASE_JS_VERSION}/+esm`;
const TIMEOUT_MS = 8000;

function setStatus(state, text) {
  const element = document.querySelector("#supabaseStatus");
  if (!element) return;
  element.dataset.state = state;
  element.textContent = text;
}

// Pergunta ao serviço de autenticação se está vivo. Não lê nem altera dados.
async function testConnection(config) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${config.url}/auth/v1/health`, {
      headers: { apikey: config.publishableKey },
      signal: controller.signal
    });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error.name === "AbortError" ? "timeout" : "rede"
    };
  } finally {
    clearTimeout(timer);
  }
}

async function init() {
  const config = window.APEX_SUPABASE_CONFIG;
  const validation = window.apexValidateSupabaseConfig?.(config) ?? {
    url_configurada: false,
    chave_configurada: false,
    ok: false
  };

  if (!validation.ok) {
    console.error("Apex: configuração Supabase inválida.", validation);
    setStatus("error", "Supabase: configuração inválida");
    window.apexSupabase = Object.freeze({ validation, client: null, ready: false });
    return;
  }

  let client = null;
  try {
    const { createClient } = await import(SUPABASE_JS_URL);
    client = createClient(config.url, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true }
    });
  } catch (error) {
    console.error("Apex: não foi possível carregar o Supabase.", error);
  }

  const api = Object.freeze({
    validation,
    client,
    ready: client !== null,
    testConnection: () => testConnection(config)
  });
  window.apexSupabase = api;

  const result = await api.testConnection();
  if (!result.ok) {
    setStatus("warn", "Supabase: sem conexão");
  } else if (!client) {
    setStatus("warn", "Supabase: biblioteca indisponível");
  } else {
    setStatus("ok", "Supabase: conectado");
  }
  window.dispatchEvent(new CustomEvent("apex:supabase-ready", { detail: result }));
}

init();
