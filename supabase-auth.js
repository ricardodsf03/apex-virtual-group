// Interface de autenticação (módulo ES). Depende de supabase-client.js e
// de auth-core.js. Se o Supabase não estiver disponível, o dashboard local
// continua funcionando e o botão de entrada fica desativado.
import {
  validateCredentials,
  validateNewPassword,
  friendlyAuthError,
  ensureOrganization
} from "./auth-core.js";

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

const forgotBtn = $("#authForgot");
const resetDialog = $("#resetDialog");
const resetForm = $("#resetForm");
const resetPassword = $("#resetPassword");
const resetMessage = $("#resetMessage");
const resetSave = $("#resetSave");

const openedFromRecoveryLink = /[#&]type=recovery\b/.test(location.hash);

let started = false;
let client = null;
let currentUserId = null;

function setMessage(text, kind = "info") {
  message.textContent = text;
  message.dataset.kind = kind;
  message.hidden = !text;
}

function setResetMessage(text, kind = "info") {
  resetMessage.textContent = text;
  resetMessage.dataset.kind = kind;
  resetMessage.hidden = !text;
}

function openResetDialog() {
  resetForm.reset();
  setResetMessage("");
  if (!resetDialog.open) resetDialog.showModal();
  resetPassword.focus();
}

// Envia o link de redefinição. A resposta é sempre a mesma, exista ou não a conta.
async function sendReset() {
  const checked = validateCredentials(emailInput.value, "x", "signin");
  if (!checked.ok) {
    setMessage("Informe o e-mail da conta para receber o link.", "error");
    return;
  }
  setBusy(true);
  try {
    const { error } = await client.auth.resetPasswordForEmail(checked.email, {
      redirectTo: `${location.origin}${location.pathname}`
    });
    if (error) {
      setMessage(friendlyAuthError(error), "error");
      return;
    }
    setMessage("Se a conta existir, enviamos um link para o seu e-mail.", "info");
  } catch (error) {
    console.error("Apex: falha ao pedir a redefinição.", error);
    setMessage(friendlyAuthError(error), "error");
  } finally {
    setBusy(false);
  }
}

async function saveNewPassword() {
  const checked = validateNewPassword(resetPassword.value);
  if (!checked.ok) {
    setResetMessage(checked.error, "error");
    return;
  }
  resetSave.disabled = true;
  try {
    const { error } = await client.auth.updateUser({ password: resetPassword.value });
    if (error) {
      setResetMessage(friendlyAuthError(error), "error");
      return;
    }
    resetPassword.value = "";
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    resetDialog.close();
  } catch (error) {
    console.error("Apex: falha ao definir a nova senha.", error);
    setResetMessage(friendlyAuthError(error), "error");
  } finally {
    resetSave.disabled = false;
  }
}

function setBusy(busy) {
  signInBtn.disabled = busy;
  signUpBtn.disabled = busy;
  forgotBtn.disabled = busy;
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
    window.dispatchEvent(new CustomEvent("apex:signed-out"));
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
  forgotBtn.addEventListener("click", sendReset);
  resetForm.addEventListener("submit", event => {
    event.preventDefault();
    saveNewPassword();
  });
  $("#resetCancel").addEventListener("click", () => resetDialog.close());

  client.auth.onAuthStateChange((event, session) => {
    onSession(session);
    if (event === "PASSWORD_RECOVERY") setTimeout(openResetDialog, 0);
  });
  // O evento pode ter ocorrido antes de este código escutar; a leitura do
  // endereço foi feita no arranque do módulo, antes de o cliente limpar o hash.
  if (openedFromRecoveryLink) setTimeout(openResetDialog, 0);
}

window.addEventListener("apex:supabase-ready", start);
start();
