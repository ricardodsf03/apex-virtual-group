// Testa o handler da Edge Function (index.ts) em Node, com Deno, Supabase e
// GitHub simulados. O TypeScript é convertido com o removedor de tipos do Node.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import module from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generateKeyPairSync } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PEM = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs1", format: "pem" });
const ORG = "aaaaaaaa-0000-0000-0000-000000000001";
const USER = "11111111-1111-1111-1111-111111111111";
const DECISION_ID = "0b1c2d3e-aaaa-bbbb-cccc-123456789abc";

async function loadHandler() {
  const source = fs.readFileSync(path.join(root, "supabase/functions/bridge/index.ts"), "utf8");
  const coreUrl = pathToFileURL(path.join(root, "supabase/functions/bridge/core.js")).href;
  const js = module.stripTypeScriptTypes(source)
    .replace(/import \{ createClient \} from "npm:[^"]+";/, "const createClient = (...args) => globalThis.__fakeSupabase.createClient(...args);")
    .replace('from "./core.js"', `from "${coreUrl}"`);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bridge-")), `index-${Math.random()}.mjs`);
  fs.writeFileSync(file, js);
  let handler;
  globalThis.Deno = {
    env: { get: name => ({
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: "sb_publishable_x" }),
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: "sb_secret_x" }),
      GITHUB_APP_ID: " 123456\n",
      ANTHROPIC_API_KEY: globalThis.__noClaudeKey ? undefined : "chave-claude",
      GITHUB_APP_PRIVATE_KEY: PEM
    })[name] },
    serve: fn => { handler = fn; }
  };
  await import(pathToFileURL(file).href);
  return handler;
}

// Banco simulado: o cliente "usuário" respeita o que a RLS deixaria ver.
function fakeSupabase(state) {
  const clients = [];
  globalThis.__fakeSupabase = {
    createClient(_url, key, options) {
      const isServer = key.startsWith("sb_secret");
      const authHeader = options?.global?.headers?.Authorization ?? "";
      const client = {
        isServer,
        auth: { getUser: async () => authHeader === "Bearer valido"
          ? { data: { user: { id: USER } }, error: null }
          : { data: { user: null }, error: { message: "bad" } } },
        from(table) {
          const filters = []; let op = "select"; let payload = null;
          const rows = () => (state[table] ?? []).filter(r => filters.every(([k, v]) => r[k] === v));
          const b = {
            select() { return b; },
            eq(k, v) { filters.push([k, v]); return b; },
            insert(p) { op = "insert"; payload = p; return b; },
            update(p) { op = "update"; payload = p; return b; },
            async maybeSingle() { return { data: rows()[0] ?? null, error: null }; },
            async single() {
              if (op === "insert") {
                if (!isServer) return { data: null, error: { message: "rls" } };
                if ((state[table] ?? []).some(r => r.decision_id === payload.decision_id && r.kind === payload.kind)) {
                  return { data: null, error: { message: "duplicate" } };
                }
                const row = { id: `run-${(state[table] ?? []).length + 1}`, status: "running", ...payload };
                (state[table] ||= []).push(row);
                return { data: row, error: null };
              }
              return { data: rows()[0] ?? null, error: null };
            },
            then(resolve) {
              if (op === "update" && isServer) for (const r of rows()) Object.assign(r, payload);
              return Promise.resolve({ data: null, error: null }).then(resolve);
            }
          };
          return b;
        }
      };
      clients.push(client);
      return client;
    }
  };
  return clients;
}

function fakeGitHub({ failOn = null } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    if (url === "https://api.anthropic.com/v1/messages") {
      calls.push({ method: "POST", path: "claude", body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "## Objetivo\n\nPlano." }], stop_reason: "end_turn" }) };
    }
    const p = url.replace("https://api.github.com", "");
    calls.push({ method: init.method, path: p, body: init.body ? JSON.parse(init.body) : null });
    const reply = (status, json) => ({ ok: status < 300, status, json: async () => json });
    if (failOn && p.includes(failOn)) return reply(422, {});
    if (p.endsWith("/installation")) return reply(200, { id: 9 });
    if (p.endsWith("/access_tokens")) return reply(201, { token: "t" });
    if (p.endsWith("/git/ref/heads/main")) return reply(200, { object: { sha: "m" } });
    if (p.includes("/git/commits/")) return reply(200, { tree: { sha: "tr" } });
    if (p.endsWith("/git/trees")) return reply(201, { sha: "nt" });
    if (p.endsWith("/git/commits")) return reply(201, { sha: "nc" });
    if (p.endsWith("/git/refs")) return reply(201, {});
    if (p.endsWith("/pulls")) return reply(201, { number: 12, html_url: "https://github.com/o/r/pull/12" });
    return reply(404, {});
  };
  return calls;
}

const baseState = (status = "Aprovada", role = "owner") => ({
  decisions: [{ id: DECISION_ID, organization_id: ORG, title: "Contratar plano", rationale: "",
    proposed_by_role: "CFO", status, decision_note: "", decided_at: "2026-11-17T21:00:00Z" }],
  organization_members: [{ organization_id: ORG, user_id: USER, role }],
  directors: [{ organization_id: ORG, role_code: "CFO", name: "Diretor Financeiro", description: "Custos." }],
  bridge_runs: []
});

const call = (handler, { auth = "Bearer valido", body = { decision_id: DECISION_ID }, method = "POST" } = {}) =>
  handler(new Request("https://x.supabase.co/functions/v1/bridge", {
    method,
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: method === "POST" ? JSON.stringify(body) : undefined
  }));

const handler = await loadHandler();

test("sem sessão válida: 401 e nada acontece", async () => {
  const state = baseState(); fakeSupabase(state); const gh = fakeGitHub();
  assert.equal((await call(handler, { auth: "" })).status, 401);
  assert.equal((await call(handler, { auth: "Bearer falso" })).status, 401);
  assert.equal(gh.length, 0);
  assert.equal(state.bridge_runs.length, 0);
});

test("pedido inválido ou decisão inexistente", async () => {
  fakeSupabase(baseState()); fakeGitHub();
  assert.equal((await call(handler, { body: { decision_id: "x' or 1=1" } })).status, 400);
  assert.equal((await call(handler, { body: { decision_id: "00000000-0000-0000-0000-000000000000" } })).status, 404);
  assert.equal((await call(handler, { method: "GET" })).status, 405);
  assert.equal((await call(handler, { method: "OPTIONS" })).status, 200);
});

test("decisão pendente: 409; membro que não é dono: 403", async () => {
  let gh;
  fakeSupabase(baseState("Pendente")); gh = fakeGitHub();
  assert.equal((await call(handler)).status, 409);
  fakeSupabase(baseState("Aprovada", "member")); gh = fakeGitHub();
  assert.equal((await call(handler)).status, 403);
  assert.equal(gh.length, 0);
});

test("caminho feliz: Draft PR aberto e auditoria gravada pelo servidor", async () => {
  const state = baseState(); fakeSupabase(state); const gh = fakeGitHub();
  const response = await call(handler);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.pr_number, 12);
  assert.match(body.branch, /^apex\/decisao-contratar-plano-/);
  assert.equal(state.bridge_runs.length, 1);
  assert.equal(state.bridge_runs[0].status, "opened");
  assert.equal(state.bridge_runs[0].requested_by, USER);
  assert.equal(state.bridge_runs[0].pr_url, "https://github.com/o/r/pull/12");
  assert.ok(gh.some(c => c.path.endsWith("/pulls")));

  // segunda vez: devolve o mesmo PR sem chamar o GitHub de novo
  const before = gh.length;
  const again = await (await call(handler)).json();
  assert.equal(again.repeated, true);
  assert.equal(again.pr_number, 12);
  assert.equal(gh.length, before);
});

test("falha no GitHub fica registrada e pode ser repetida", async () => {
  const state = baseState(); fakeSupabase(state); fakeGitHub({ failOn: "/pulls" });
  const failed = await call(handler);
  assert.equal(failed.status, 502);
  assert.match((await failed.json()).error, /abrir o Draft PR/);
  assert.equal(state.bridge_runs[0].status, "failed");

  fakeGitHub();
  const retry = await call(handler);
  assert.equal(retry.status, 200);
  assert.equal(state.bridge_runs.length, 1);
  assert.equal(state.bridge_runs[0].status, "opened");
});

test("plano: o diretor que propôs escreve com o Claude e abre outro Draft PR", async () => {
  const state = baseState(); fakeSupabase(state); const gh = fakeGitHub();
  const record = await (await call(handler)).json();
  assert.equal(record.kind, "record");
  const response = await call(handler, { body: { decision_id: DECISION_ID, kind: "plan" } });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.kind, "plan");
  assert.match(body.branch, /^apex\/plano-contratar-plano-/);
  const claude = gh.find(c => c.path === "claude");
  assert.match(claude.body.system, /CFO \(Diretor Financeiro\)/);
  assert.deepEqual(state.bridge_runs.map(r => r.kind).sort(), ["plan", "record"]);
  assert.ok(state.bridge_runs.every(r => r.status === "opened"));
});

test("plano sem chave da Claude API: erro claro e nada no GitHub", async () => {
  const state = baseState(); fakeSupabase(state); const gh = fakeGitHub();
  globalThis.__noClaudeKey = true;
  const response = await call(handler, { body: { decision_id: DECISION_ID, kind: "plan" } });
  globalThis.__noClaudeKey = false;
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /ANTHROPIC_API_KEY/);
  assert.equal(gh.length, 0);
  assert.equal(state.bridge_runs[0].status, "failed");
});

test("tipo de pedido desconhecido é recusado", async () => {
  fakeSupabase(baseState()); fakeGitHub();
  assert.equal((await call(handler, { body: { decision_id: DECISION_ID, kind: "codigo" } })).status, 400);
});
