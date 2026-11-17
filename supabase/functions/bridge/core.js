// Núcleo da Bridge: regras de segurança e operações no GitHub.
// JavaScript puro (sem Deno nem Node específicos): roda na Edge Function do
// Supabase e nos testes em Node. Usa apenas fetch e Web Crypto.

export const BASE_BRANCH = "main";
export const MAX_FILES = 20;
export const MAX_FILE_BYTES = 200_000;

const DENIED_PREFIXES = [".github/", ".git/", "supabase/migrations/", "supabase/functions/"];
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsb_secret_[A-Za-z0-9_-]{10,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/
];

// ---------------------------------------------------------------------------
// Regras
// ---------------------------------------------------------------------------
export function slugify(text, max = 40) {
  const slug = String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return slug || "decisao";
}

export function branchForDecision(decision) {
  const id = String(decision.id ?? "").replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase();
  return `apex/decisao-${slugify(decision.title)}-${id}`;
}

export function validateBranch(name) {
  return /^apex\/[a-z0-9][a-z0-9-]{2,79}$/.test(String(name ?? ""));
}

export function validatePath(path) {
  const value = String(path ?? "");
  if (!value || value.length > 200) return false;
  if (value.startsWith("/") || value.includes("\\") || value.includes("//")) return false;
  if (value.split("/").some(part => part === ".." || part === "." || part === "")) return false;
  if (!/^[A-Za-z0-9._\/-]+$/.test(value)) return false;
  if (DENIED_PREFIXES.some(prefix => value.startsWith(prefix))) return false;
  const name = value.split("/").pop();
  if (/^\.env/i.test(name) || /\.(pem|key|p12|pfx)$/i.test(name)) return false;
  return true;
}

export function findSecrets(text) {
  return SECRET_PATTERNS.some(pattern => pattern.test(String(text ?? "")));
}

export function validateFiles(files) {
  if (!Array.isArray(files) || !files.length) return "Nenhum arquivo para enviar.";
  if (files.length > MAX_FILES) return `No máximo ${MAX_FILES} arquivos por execução.`;
  for (const file of files) {
    if (!validatePath(file.path)) return `Caminho não permitido: ${String(file.path).slice(0, 80)}`;
    const content = String(file.content ?? "");
    if (new TextEncoder().encode(content).length > MAX_FILE_BYTES) {
      return `Arquivo grande demais: ${file.path}`;
    }
    if (findSecrets(content)) return `Conteúdo parece conter uma chave ou senha: ${file.path}`;
  }
  return null;
}

// Arquivo com o registro da decisão aprovada (o que a Bridge commita na v1).
export function decisionRecord(decision) {
  const day = String(decision.decided_at ?? "").slice(0, 10) || "sem-data";
  const path = `docs/decisoes/${day}-${slugify(decision.title)}.md`;
  const lines = [
    `# ${String(decision.title).replace(/\s+/g, " ").trim()}`,
    "",
    `- **Estado:** ${decision.status}`,
    `- **Proposta por:** ${decision.proposed_by_role}`,
    `- **Decidida em:** ${decision.decided_at ?? "—"}`,
    `- **Identificador:** \`${decision.id}\``,
    "",
    "## Justificativa",
    "",
    String(decision.rationale || "Sem justificativa registrada.").trim(),
    ""
  ];
  if (decision.decision_note) {
    lines.push("## Nota da decisão", "", String(decision.decision_note).trim(), "");
  }
  lines.push("---", "", "_Registro criado pela Bridge da Apex a partir de uma decisão aprovada pelo dono da organização._", "");
  return { path, content: lines.join("\n") };
}

// ---------------------------------------------------------------------------
// Autenticação da GitHub App (JWT RS256 com Web Crypto)
// ---------------------------------------------------------------------------
function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64url(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function derLength(length) {
  if (length < 0x80) return [length];
  const out = [];
  while (length > 0) { out.unshift(length & 0xff); length >>= 8; }
  return [0x80 | out.length, ...out];
}

function der(tag, content) {
  return new Uint8Array([tag, ...derLength(content.length), ...content]);
}

// Aceita PEM PKCS#8 ("BEGIN PRIVATE KEY") ou PKCS#1 ("BEGIN RSA PRIVATE KEY",
// o formato que o GitHub entrega) e devolve DER PKCS#8 para o Web Crypto.
export function pemToPkcs8Der(pem) {
  const text = String(pem ?? "").replace(/\\n/g, "\n").trim();
  const match = text.match(/-----BEGIN (RSA )?PRIVATE KEY-----([\s\S]+?)-----END (RSA )?PRIVATE KEY-----/);
  if (!match) throw new Error("Chave privada da GitHub App em formato inválido.");
  const body = base64ToBytes(match[2].replace(/\s+/g, ""));
  if (!match[1]) return body;
  const version = new Uint8Array([0x02, 0x01, 0x00]);
  const algorithm = new Uint8Array([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00
  ]);
  const key = der(0x04, body);
  return der(0x30, new Uint8Array([...version, ...algorithm, ...key]));
}

export async function createAppJwt(appId, privateKeyPem, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!/^\d+$/.test(String(appId ?? ""))) throw new Error("GITHUB_APP_ID inválido.");
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8Der(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iat: nowSeconds - 60,
    exp: nowSeconds + 540,
    iss: String(appId)
  }));
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${payload}`)
  );
  return `${header}.${payload}.${base64url(signature)}`;
}

// ---------------------------------------------------------------------------
// GitHub REST
// ---------------------------------------------------------------------------
export class GitHubError extends Error {
  constructor(step, status) {
    super(`GitHub recusou: ${step} (HTTP ${status}).`);
    this.status = status;
  }
}

async function gh(fetchFn, token, method, path, body, step) {
  const response = await fetchFn(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "apex-bridge",
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.ok) throw new GitHubError(step, response.status);
  return response.status === 204 ? null : response.json();
}

export async function getInstallationToken(fetchFn, appJwt, owner, repo) {
  const installation = await gh(fetchFn, appJwt, "GET", `/repos/${owner}/${repo}/installation`, null,
    "localizar a instalação da app no repositório");
  const access = await gh(fetchFn, appJwt, "POST", `/app/installations/${installation.id}/access_tokens`, {
    repositories: [repo],
    permissions: { contents: "write", pull_requests: "write" }
  }, "emitir o token de instalação");
  return access.token;
}

// Cria um branch apex/* a partir do main com um único commit e abre um Draft PR.
export async function openDraftPullRequest(fetchFn, token, { owner, repo, branch, files, title, body, message }) {
  if (!validateBranch(branch)) throw new Error("Nome de branch não permitido (só apex/*).");
  const problem = validateFiles(files);
  if (problem) throw new Error(problem);

  const base = `/repos/${owner}/${repo}`;
  const ref = await gh(fetchFn, token, "GET", `${base}/git/ref/heads/${BASE_BRANCH}`, null, "ler o main");
  const parentSha = ref.object.sha;
  const parent = await gh(fetchFn, token, "GET", `${base}/git/commits/${parentSha}`, null, "ler o último commit");
  const tree = await gh(fetchFn, token, "POST", `${base}/git/trees`, {
    base_tree: parent.tree.sha,
    tree: files.map(file => ({ path: file.path, mode: "100644", type: "blob", content: String(file.content) }))
  }, "criar a árvore de arquivos");
  const commit = await gh(fetchFn, token, "POST", `${base}/git/commits`, {
    message,
    tree: tree.sha,
    parents: [parentSha]
  }, "criar o commit");
  await gh(fetchFn, token, "POST", `${base}/git/refs`, {
    ref: `refs/heads/${branch}`,
    sha: commit.sha
  }, "criar o branch");
  const pull = await gh(fetchFn, token, "POST", `${base}/pulls`, {
    title, head: branch, base: BASE_BRANCH, body, draft: true
  }, "abrir o Draft PR");
  return { number: pull.number, url: pull.html_url, branch, commit: commit.sha };
}

// Fluxo completo para uma decisão aprovada.
export async function executeDecision({ decision, fetchFn, appId, privateKey, owner, repo, now }) {
  if (decision?.status !== "Aprovada") throw new Error("Só decisões aprovadas podem ir para o repositório.");
  const record = decisionRecord(decision);
  const appJwt = await createAppJwt(appId, privateKey, now);
  const token = await getInstallationToken(fetchFn, appJwt, owner, repo);
  const title = `Decisão: ${String(decision.title).slice(0, 100)}`;
  return openDraftPullRequest(fetchFn, token, {
    owner,
    repo,
    branch: branchForDecision(decision),
    files: [record],
    title,
    message: `docs: registrar decisão aprovada "${String(decision.title).slice(0, 60)}"`,
    body: [
      "Draft PR aberto pela **Bridge da Apex** a partir de uma decisão aprovada.",
      "",
      `- Decisão: \`${decision.id}\``,
      `- Arquivo: \`${record.path}\``,
      "",
      "Revise, espere o CI e faça o merge se estiver de acordo. A Bridge nunca escreve no `main`."
    ].join("\n")
  });
}

// Mensagem de erro segura para devolver ao navegador (sem detalhes internos).
export function publicError(error) {
  const message = String(error?.message ?? "");
  if (error instanceof GitHubError || /^(Só |Nome de branch|Caminho não permitido|Conteúdo parece|No máximo|Arquivo grande|Nenhum arquivo)/.test(message)) {
    return message;
  }
  if (/GITHUB_APP|Chave privada/.test(message)) return "A Bridge não está configurada (segredos da GitHub App).";
  return "A Bridge não conseguiu concluir. Veja os registros da função.";
}
