// Interface de autenticação (módulo ES). Depende de supabase-client.js e
// de auth-core.js. Se o Supabase não estiver disponível, o dashboard local
// continua funcionando e o botão de entrada fica desativado.
import { validateCredentials, friendlyAuthError, ensureOrganization } from "./auth-core.js";

const $ = selector => document.querySelector(selector);

const accountBtn = $("#accountBtn");
const accountLabel = $("#accountLabel");
const dialog = $("#authDialog");
const form = $("#authForm");
const emailInput = $("#authEmail");
const passwordInput = $("#authPassword");
const message = $("#authMessage");
const signInBtn = $("#authSignIn");
const signUpBtn = $("#authSignUp");

let started = false;
let client = null;
let currentUserId = null;

function setMessage(text, kind = "info") {
  message.textContent = text;
  message.dataset.kind = kind;
  message.hidden = !text;
}

function setBusy(busy) {
  signInBtn.disabled = busy;
  signUpBtn.disabled = busy;
}

function renderAccount(session, note = "") {
  const email = session?.user?.email;
  accountBtn.textContent = session ? "Sair" : "Entrar";
  accountBtn.dataset.mode = session ? "signout" : "signin";
  accountLabel.hidden = !session;
  accountLabel.textContent = session ? [email, note].filter(Boolean).join(" · ") : "";
}

// Prepara a organização e os diretores da conta, sem bloquear a interface.
async function prepareOrganization(session) {
  const userId = session.user.id;
  renderAccount(session, "preparando…");
  try {
    const directors = window.APEX_AGENTS ?? [];
    const result = await ensureOrganization(client, { userId, directors });
    if (currentUserId !== userId) return; // a sessão mudou entretanto
    renderAccount(session, result.created ? "organização criada" : "organização pronta");
    window.apexOrganizationId = result.organizationId;
    window.dispatchEvent(new CustomEvent("apex:organization-ready", { detail: result }));
  } catch (error) {
    console.error("Apex: não foi possível preparar a organização.", error);
    if (currentUserId === userId) renderAccount(session, "erro ao preparar a organização");
  }
}

function onSession(session) {
  currentUserId = session?.user?.id ?? null;
  if (!session) {
    window.apexOrganizationId = null;
    renderAccount(null);
    return;
  }
  renderAccount(session);
  // Não chamar o Supabase dentro do callback de autenticação (pode bloquear).
  setTimeout(() => prepareOrganization(session), 0);
}

async function submit(mode) {
  const checked = validateCredentials(emailInput.value, passwordInput.value, mode);
  if (!checked.ok) {
    setMessage(checked.error, "error");
    return;
  }
  setBusy(true);
  setMessage(mode === "signup" ? "Criando conta…" : "Entrando…");
  try {
    const credentials = { email: checked.email, password: passwordInput.value };
    const { data, error } = mode === "signup"
      ? await client.auth.signUp(credentials)
      : await client.auth.signInWithPassword(credentials);

    if (error) {
      setMessage(friendlyAuthError(error), "error");
      return;
    }
    if (mode === "signup" && !data?.session) {
      setMessage("Conta criada. Confirme o e-mail e depois use Entrar.", "info");
      return;
    }
    passwordInput.value = "";
    setMessage("");
    dialog.close();
  } catch (error) {
    console.error("Apex: falha de autenticação.", error);
    setMessage(friendlyAuthError(error), "error");
  } finally {
    setBusy(false);
  }
}

async function start() {
  if (started) return;
  const api = window.apexSupabase;
  if (!api) return;

  if (!api.client) {
    accountBtn.disabled = true;
    accountBtn.title = "Supabase indisponível";
    return;
  }
  started = true;
  client = api.client;
  accountBtn.disabled = false;
  accountBtn.removeAttribute("title");

  accountBtn.addEventListener("click", async () => {
    if (accountBtn.dataset.mode === "signout") {
      accountBtn.disabled = true;
      try {
        await client.auth.signOut();
      } catch (error) {
        console.error("Apex: falha ao sair.", error);
      } finally {
        accountBtn.disabled = false;
      }
      return;
    }
    form.reset();
    setMessage("");
    dialog.showModal();
    emailInput.focus();
  });

  form.addEventListener("submit", event => {
    event.preventDefault();
    submit("signin");
  });
  signInBtn.addEventListener("click", () => submit("signin"));
  signUpBtn.addEventListener("click", () => submit("signup"));
  $("#authCancel").addEventListener("click", () => dialog.close());

  client.auth.onAuthStateChange((_event, session) => onSession(session));
}

window.addEventListener("apex:supabase-ready", start);
start();
