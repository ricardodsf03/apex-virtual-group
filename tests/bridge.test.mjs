import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
import {
  slugify, branchForDecision, validateBranch, validatePath, findSecrets, validateFiles,
  decisionRecord, pemToPkcs8Der, createAppJwt, openDraftPullRequest, executeDecision,
  publicError, GitHubError
} from "../supabase/functions/bridge/core.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PKCS1 = privateKey.export({ type: "pkcs1", format: "pem" });
const PKCS8 = privateKey.export({ type: "pkcs8", format: "pem" });

const DECISION = {
  id: "0b1c2d3e-aaaa-bbbb-cccc-123456789abc",
  title: "Contratar o plano pago do Supabase",
  rationale: "Mais capacidade.",
  proposed_by_role: "CFO",
  status: "Aprovada",
  decision_note: "",
  decided_at: "2026-11-17T21:00:00.000Z"
};

// GitHub simulado: responde às rotas que a Bridge usa e grava as chamadas.
function fakeGitHub({ failOn = null } = {}) {
  const calls = [];
  const fetchFn = async (url, init) => {
    const path = url.replace("https://api.github.com", "");
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method, path, body, auth: init.headers.Authorization });
    const reply = (status, json) => ({ ok: status < 300, status, json: async () => json });
    if (failOn && path.includes(failOn)) return reply(422, {});
    if (path.endsWith("/installation")) return reply(200, { id: 99 });
    if (path.endsWith("/access_tokens")) return reply(201, { token: "inst-token" });
    if (path.endsWith("/git/ref/heads/main")) return reply(200, { object: { sha: "mainsha" } });
    if (path.includes("/git/commits/")) return reply(200, { tree: { sha: "treesha" } });
    if (path.endsWith("/git/trees")) return reply(201, { sha: "newtree" });
    if (path.endsWith("/git/commits")) return reply(201, { sha: "newcommit" });
    if (path.endsWith("/git/refs")) return reply(201, {});
    if (path.endsWith("/pulls")) return reply(201, { number: 11, html_url: "https://github.com/o/r/pull/11" });
    return reply(404, {});
  };
  return { calls, fetchFn };
}

test("slug e branch seguros", () => {
  assert.equal(slugify("Ação: Contratar   Plano!"), "acao-contratar-plano");
  assert.equal(slugify("###"), "decisao");
  const branch = branchForDecision(DECISION);
  assert.equal(branch, "apex/decisao-contratar-o-plano-pago-do-supabase-0b1c2d3e");
  assert.ok(validateBranch(branch));
  assert.equal(validateBranch("main"), false);
  assert.equal(validateBranch("apex/../main"), false);
  assert.equal(validateBranch("feature/x"), false);
});

test("caminhos proibidos são recusados", () => {
  assert.ok(validatePath("docs/decisoes/2026-11-17-x.md"));
  for (const bad of ["/etc/passwd", "../x", "docs/../.github/x", ".github/workflows/ci.yml",
    "supabase/migrations/x.sql", "supabase/functions/bridge/core.js", ".env", "config/.env.local",
    "chave.pem", "docs//x.md", "docs\\x.md", ""]) {
    assert.equal(validatePath(bad), false, bad);
  }
});

test("conteúdo com chave ou token é bloqueado", () => {
  assert.ok(findSecrets("-----BEGIN RSA PRIVATE KEY-----\nabc"));
  assert.ok(findSecrets("token ghp_abcdefghijklmnopqrstuvwxyz123456"));
  assert.ok(findSecrets("sb_secret_abcdefghijklmnop"));
  assert.equal(findSecrets("sb_publishable_coisa pública"), false);
  assert.match(validateFiles([{ path: "docs/a.md", content: PKCS1 }]), /chave ou senha/);
  assert.match(validateFiles([]), /Nenhum/);
  assert.equal(validateFiles([{ path: "docs/a.md", content: "ok" }]), null);
});

test("registro da decisão em markdown", () => {
  const record = decisionRecord(DECISION);
  assert.equal(record.path, "docs/decisoes/2026-11-17-contratar-o-plano-pago-do-supabase.md");
  assert.match(record.content, /^# Contratar o plano pago do Supabase/);
  assert.match(record.content, /Proposta por:\*\* CFO/);
  assert.equal(validateFiles([record]), null);
});

test("JWT da GitHub App é assinado corretamente (PKCS#1 e PKCS#8)", async () => {
  for (const pem of [PKCS1, PKCS8, PKCS1.replace(/\n/g, "\\n")]) {
    const jwt = await createAppJwt("123456", pem, 1_700_000_000);
    const [header, payload, signature] = jwt.split(".");
    const verify = createVerify("RSA-SHA256");
    verify.update(`${header}.${payload}`);
    assert.ok(verify.verify(publicKey, Buffer.from(signature, "base64url")));
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    assert.deepEqual(claims, { iat: 1_699_999_940, exp: 1_700_000_540, iss: "123456" });
  }
  await assert.rejects(createAppJwt("abc", PKCS1), /GITHUB_APP_ID/);
  assert.throws(() => pemToPkcs8Der("não é chave"), /formato inválido/);
});

test("decisão aprovada vira branch apex/* com um commit e um Draft PR", async () => {
  const gh = fakeGitHub();
  const result = await executeDecision({
    decision: DECISION, fetchFn: gh.fetchFn, appId: "123456", privateKey: PKCS1,
    owner: "o", repo: "r", now: 1_700_000_000
  });
  assert.deepEqual(result, {
    number: 11, url: "https://github.com/o/r/pull/11",
    branch: "apex/decisao-contratar-o-plano-pago-do-supabase-0b1c2d3e", commit: "newcommit"
  });
  const tokenCall = gh.calls.find(c => c.path.endsWith("/access_tokens"));
  assert.deepEqual(tokenCall.body.permissions, { contents: "write", pull_requests: "write" });
  assert.deepEqual(tokenCall.body.repositories, ["r"]);
  const ref = gh.calls.find(c => c.path.endsWith("/git/refs"));
  assert.equal(ref.body.ref, "refs/heads/apex/decisao-contratar-o-plano-pago-do-supabase-0b1c2d3e");
  assert.equal(ref.auth, "Bearer inst-token");
  const pull = gh.calls.find(c => c.path.endsWith("/pulls"));
  assert.equal(pull.body.draft, true);
  assert.equal(pull.body.base, "main");
  // nunca escreve no main
  assert.ok(!gh.calls.some(c => c.method !== "GET" && /heads\/main/.test(JSON.stringify(c))));
  const commit = gh.calls.find(c => c.path.endsWith("/git/commits") && c.method === "POST");
  assert.deepEqual(commit.body.parents, ["mainsha"]);
});

test("decisão pendente ou rejeitada não chega ao GitHub", async () => {
  for (const status of ["Pendente", "Rejeitada"]) {
    const gh = fakeGitHub();
    await assert.rejects(executeDecision({
      decision: { ...DECISION, status }, fetchFn: gh.fetchFn, appId: "1", privateKey: PKCS1,
      owner: "o", repo: "r"
    }), /Só decisões aprovadas/);
    assert.equal(gh.calls.length, 0);
  }
});

test("branch ou arquivos inválidos param antes de qualquer chamada", async () => {
  const gh = fakeGitHub();
  await assert.rejects(openDraftPullRequest(gh.fetchFn, "t", {
    owner: "o", repo: "r", branch: "main", files: [{ path: "docs/a.md", content: "x" }]
  }), /só apex/);
  await assert.rejects(openDraftPullRequest(gh.fetchFn, "t", {
    owner: "o", repo: "r", branch: "apex/ok-nome", files: [{ path: ".github/workflows/x.yml", content: "x" }]
  }), /Caminho não permitido/);
  assert.equal(gh.calls.length, 0);
});

test("erro do GitHub vira mensagem clara e sem detalhes internos", async () => {
  const gh = fakeGitHub({ failOn: "/git/refs" });
  const error = await executeDecision({
    decision: DECISION, fetchFn: gh.fetchFn, appId: "1", privateKey: PKCS1, owner: "o", repo: "r"
  }).catch(e => e);
  assert.ok(error instanceof GitHubError);
  assert.equal(publicError(error), "GitHub recusou: criar o branch (HTTP 422).");
  assert.equal(publicError(new Error("GITHUB_APP_ID inválido.")), "A Bridge não está configurada (segredos da GitHub App).");
  assert.equal(publicError(new Error("connection to 10.0.0.1 refused")), "A Bridge não conseguiu concluir. Veja os registros da função.");
});
