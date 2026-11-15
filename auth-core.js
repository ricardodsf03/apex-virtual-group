// Lógica de autenticação e arranque da organização.
// Sem acesso ao DOM, para poder ser testada em Node com um cliente simulado.

export const MIN_PASSWORD_LENGTH = 12;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// mode: "signin" | "signup". Ao criar conta, exige uma senha longa.
export function validateCredentials(email, password, mode) {
  const cleanEmail = String(email ?? "").trim();
  if (!EMAIL_RE.test(cleanEmail)) {
    return { ok: false, error: "Informe um e-mail válido." };
  }
  const secret = String(password ?? "");
  if (!secret) {
    return { ok: false, error: "Informe a senha." };
  }
  if (mode === "signup" && secret.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`
    };
  }
  return { ok: true, email: cleanEmail };
}

// Valida a senha nova (redefinição): mesma regra de tamanho da criação de conta.
export function validateNewPassword(password) {
  const secret = String(password ?? "");
  if (secret.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`
    };
  }
  return { ok: true };
}

// Traduz erros do Supabase Auth para mensagens claras, sem expor detalhes internos.
export function friendlyAuthError(error) {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "").toLowerCase();

  if (code === "invalid_credentials" || message.includes("invalid login")) {
    return "E-mail ou senha incorretos.";
  }
  if (code === "email_not_confirmed" || message.includes("not confirmed")) {
    return "Confirme primeiro o e-mail (veja a caixa de entrada) e entre de novo.";
  }
  if (code === "user_already_exists" || message.includes("already registered")) {
    return "Já existe uma conta com este e-mail. Use Entrar.";
  }
  if (code === "signup_disabled" || message.includes("signups not allowed")) {
    return "A criação de contas está desativada.";
  }
  if (code.includes("rate_limit") || message.includes("rate limit")) {
    return "Muitas tentativas. Espere um pouco e tente de novo.";
  }
  if (code === "weak_password" || message.includes("password")) {
    return "Senha fraca ou inválida. Use uma mais longa.";
  }
  if (message.includes("fetch") || message.includes("network")) {
    return "Sem conexão com o Supabase. Verifique a rede.";
  }
  return "Não foi possível concluir. Tente de novo.";
}

function fail(step, error) {
  const wrapped = new Error(`Falha ao ${step}.`);
  wrapped.cause = error;
  return wrapped;
}

// Garante que o usuário tem uma organização e que os 9 diretores existem.
// É idempotente: pode correr em cada início de sessão sem duplicar nada, e
// recupera de uma execução anterior interrompida a meio.
export async function ensureOrganization(client, { userId, directors, name = "Apex Virtual Group" }) {
  if (!userId) throw fail("identificar o usuário", null);

  let organizationId = null;
  let created = false;

  const memberships = await client
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userId)
    .limit(1);
  if (memberships.error) throw fail("ler as organizações", memberships.error);
  if (memberships.data.length) organizationId = memberships.data[0].organization_id;

  if (!organizationId) {
    // Organização criada por este usuário numa tentativa anterior incompleta.
    const own = await client
      .from("organizations")
      .select("id")
      .eq("created_by", userId)
      .limit(1);
    if (own.error) throw fail("ler as organizações", own.error);

    if (own.data.length) {
      organizationId = own.data[0].id;
    } else {
      const org = await client
        .from("organizations")
        .insert({ name })
        .select("id")
        .single();
      if (org.error) throw fail("criar a organização", org.error);
      organizationId = org.data.id;
      created = true;
    }

    const member = await client.from("organization_members").upsert(
      { organization_id: organizationId, user_id: userId, role: "owner" },
      { onConflict: "organization_id,user_id", ignoreDuplicates: true }
    );
    if (member.error) throw fail("registrar o membro", member.error);
  }

  const rows = directors.map(director => ({
    organization_id: organizationId,
    role_code: director.role,
    name: director.name,
    description: director.desc
  }));
  const seeded = await client.from("directors").upsert(rows, {
    onConflict: "organization_id,role_code",
    ignoreDuplicates: true
  });
  if (seeded.error) throw fail("criar os diretores", seeded.error);

  return { organizationId, created };
}
