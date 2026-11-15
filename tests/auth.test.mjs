import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateCredentials,
  friendlyAuthError,
  ensureOrganization,
  MIN_PASSWORD_LENGTH
} from "../auth-core.js";

const USER = "11111111-1111-1111-1111-111111111111";
const DIRECTORS = ["CEO", "CFO", "COO", "CTO", "CLO", "CMO", "CCO", "CSO", "CRO"].map(
  role => ({ role, name: `Diretor ${role}`, desc: `Descrição ${role}` })
);

// Cliente simulado com tabelas em memória e a mesma API encadeável do supabase-js.
function fakeClient({ failOn = null, tables = {} } = {}) {
  const db = {
    organization_members: [],
    organizations: [],
    directors: [],
    ...tables
  };
  const calls = [];
  let counter = 0;

  return {
    db,
    calls,
    from(table) {
      const filters = [];
      let op = "select";
      let payload = null;
      let options = {};
      let single = false;
      const builder = {
        select() { return builder; },
        eq(key, value) { filters.push([key, value]); return builder; },
        limit() { return builder; },
        single() { single = true; return builder; },
        insert(rows) { op = "insert"; payload = rows; return builder; },
        upsert(rows, opts) { op = "upsert"; payload = rows; options = opts ?? {}; return builder; },
        then(resolve, reject) {
          calls.push({ table, op });
          if (failOn && failOn.table === table && failOn.op === op) {
            return Promise.resolve({ data: null, error: { message: "boom" } }).then(resolve, reject);
          }
          const rows = db[table];
          let data = null;
          if (op === "select") {
            data = rows.filter(row => filters.every(([k, v]) => row[k] === v));
          } else {
            const list = Array.isArray(payload) ? payload : [payload];
            const inserted = [];
            for (const item of list) {
              const key = options.onConflict?.split(",") ?? [];
              const exists = key.length &&
                rows.some(row => key.every(k => row[k] === item[k]));
              if (exists && options.ignoreDuplicates) continue;
              const row = { id: `id-${++counter}`, created_by: USER, ...item };
              rows.push(row);
              inserted.push(row);
            }
            data = op === "insert" ? (single ? inserted[0] : inserted) : null;
          }
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        }
      };
      return builder;
    }
  };
}

test("valida e-mail e senha", () => {
  assert.equal(validateCredentials("", "x", "signin").ok, false);
  assert.equal(validateCredentials("sem-arroba", "x", "signin").ok, false);
  assert.equal(validateCredentials("a@b.pt", "", "signin").ok, false);
  const ok = validateCredentials("  a@b.pt ", "qualquer", "signin");
  assert.deepEqual({ ...ok }, { ok: true, email: "a@b.pt" });
});

test("ao criar conta exige senha longa; ao entrar não", () => {
  const short = "a".repeat(MIN_PASSWORD_LENGTH - 1);
  assert.equal(validateCredentials("a@b.pt", short, "signup").ok, false);
  assert.equal(validateCredentials("a@b.pt", short, "signin").ok, true);
  assert.equal(validateCredentials("a@b.pt", "a".repeat(MIN_PASSWORD_LENGTH), "signup").ok, true);
});

test("erros do Supabase viram mensagens em português sem detalhes internos", () => {
  assert.match(friendlyAuthError({ code: "invalid_credentials" }), /incorretos/);
  assert.match(friendlyAuthError({ message: "Invalid login credentials" }), /incorretos/);
  assert.match(friendlyAuthError({ code: "email_not_confirmed" }), /Confirme/);
  assert.match(friendlyAuthError({ code: "user_already_exists" }), /Já existe/);
  assert.match(friendlyAuthError({ code: "signup_disabled" }), /desativada/);
  assert.match(friendlyAuthError({ code: "over_email_send_rate_limit" }), /Muitas/);
  assert.match(friendlyAuthError(new TypeError("Failed to fetch")), /conexão/);
  const unknown = friendlyAuthError({ message: "SELECT * FROM secrets failed at 10.0.0.5" });
  assert.ok(!/secrets|10\.0\.0\.5/.test(unknown));
  assert.match(friendlyAuthError(null), /Tente de novo/);
});

test("primeira vez: cria organização, membro owner e os 9 diretores", async () => {
  const client = fakeClient();
  const result = await ensureOrganization(client, { userId: USER, directors: DIRECTORS });

  assert.equal(result.created, true);
  assert.equal(client.db.organizations.length, 1);
  assert.equal(client.db.organizations[0].name, "Apex Virtual Group");
  assert.equal(client.db.organization_members.length, 1);
  assert.equal(client.db.organization_members[0].role, "owner");
  assert.equal(client.db.organization_members[0].user_id, USER);
  assert.equal(client.db.directors.length, 9);
  assert.ok(client.db.directors.every(d => d.organization_id === result.organizationId));
  assert.deepEqual(
    client.db.directors.map(d => d.role_code),
    DIRECTORS.map(d => d.role)
  );
});

test("é idempotente: voltar a correr não duplica nada", async () => {
  const client = fakeClient();
  const first = await ensureOrganization(client, { userId: USER, directors: DIRECTORS });
  const second = await ensureOrganization(client, { userId: USER, directors: DIRECTORS });

  assert.equal(second.created, false);
  assert.equal(second.organizationId, first.organizationId);
  assert.equal(client.db.organizations.length, 1);
  assert.equal(client.db.organization_members.length, 1);
  assert.equal(client.db.directors.length, 9);
});

test("recupera uma organização criada sem membro (execução interrompida)", async () => {
  const client = fakeClient({
    tables: { organizations: [{ id: "org-orfa", name: "Apex Virtual Group", created_by: USER }] }
  });
  const result = await ensureOrganization(client, { userId: USER, directors: DIRECTORS });

  assert.equal(result.organizationId, "org-orfa");
  assert.equal(result.created, false);
  assert.equal(client.db.organizations.length, 1);
  assert.equal(client.db.organization_members.length, 1);
  assert.equal(client.db.directors.length, 9);
});

test("completa os diretores em falta sem tocar nos existentes", async () => {
  const client = fakeClient({
    tables: {
      organization_members: [{ organization_id: "org-1", user_id: USER, role: "owner" }],
      directors: [{ id: "d1", organization_id: "org-1", role_code: "CEO", name: "Editado", description: "x" }]
    }
  });
  await ensureOrganization(client, { userId: USER, directors: DIRECTORS });

  assert.equal(client.db.directors.length, 9);
  const ceo = client.db.directors.find(d => d.role_code === "CEO");
  assert.equal(ceo.name, "Editado");
});

test("erros em cada passo ficam com mensagem clara e causa original", async () => {
  const steps = [
    [{ table: "organization_members", op: "select" }, /ler as organizações/],
    [{ table: "organizations", op: "insert" }, /criar a organização/],
    [{ table: "organization_members", op: "upsert" }, /registrar o membro/],
    [{ table: "directors", op: "upsert" }, /criar os diretores/]
  ];
  for (const [failOn, pattern] of steps) {
    const client = fakeClient({ failOn });
    await assert.rejects(
      ensureOrganization(client, { userId: USER, directors: DIRECTORS }),
      error => pattern.test(error.message) && error.cause?.message === "boom"
    );
  }
});

test("sem usuário não faz nenhum pedido", async () => {
  const client = fakeClient();
  await assert.rejects(ensureOrganization(client, { userId: "", directors: DIRECTORS }));
  assert.equal(client.calls.length, 0);
});

test("senha nova exige o mesmo tamanho mínimo da criação de conta", async () => {
  const { validateNewPassword } = await import("../auth-core.js");
  assert.equal(validateNewPassword("curta").ok, false);
  assert.equal(validateNewPassword("").ok, false);
  assert.equal(validateNewPassword("a".repeat(MIN_PASSWORD_LENGTH)).ok, true);
});
