import fs from "node:fs";
import vm from "node:vm";
import { spawnSync } from "node:child_process";

const checks = [];
const pass = (name, ok, detail = "") =>
  checks.push({ name, ok: Boolean(ok), detail });

const exists = file => fs.existsSync(file);
const read = file => (exists(file) ? fs.readFileSync(file, "utf8") : "");
const json = file => {
  try { return JSON.parse(read(file)); } catch { return null; }
};

const app = read("app.js");
const html = read("index.html");
const css = read("styles.css");
const sw = read("service-worker.js");
const readme = read("README.md");
const supabaseConfig = read("supabase-config.js");
const supabaseClient = read("supabase-client.js");
const supabaseAuth = read("supabase-auth.js");
const authCore = read("auth-core.js");
const syncCore = read("sync-core.js");
const supabaseSync = read("supabase-sync.js");
const supabaseBridge = read("supabase-bridge.js");
const bridgeCore = read("supabase/functions/bridge/core.js");
const bridgeFunction = read("supabase/functions/bridge/index.ts");
const manifest = json("manifest.json");

// --- Arquivos base -------------------------------------------------------
pass("app.js existe e não está vazio", app.length > 0);
pass("index.html existe e não está vazio", html.length > 0);
pass("styles.css existe e não está vazio", css.length > 0);
pass("HTML referencia o app.js", /app\.js/.test(html));
pass("HTML referencia o styles.css", /styles\.css/.test(html));

const syntax = spawnSync("node", ["--check", "app.js"], { encoding: "utf8" });
pass("Sintaxe JavaScript válida (app.js)", syntax.status === 0, syntax.stderr?.trim());

const swSyntax = spawnSync("node", ["--check", "service-worker.js"], { encoding: "utf8" });
pass("Sintaxe JavaScript válida (service-worker.js)", swSyntax.status === 0, swSyntax.stderr?.trim());

// --- Funcionalidades ------------------------------------------------------
pass("Persistência local implementada", /localStorage/.test(app));
pass("Chave de armazenamento definida", /STORAGE_KEY/.test(app));
pass("Carregamento de estado implementado", /function\s+loadState/.test(app));
pass("Gravação de estado implementada", /function\s+saveState/.test(app));
pass("Registro de atividades implementado", /function\s+logActivity/.test(app));
pass("Renderização de tarefas implementada", /renderTasks/.test(app));
pass("Lista de tarefas conectada ao HTML", /taskList/.test(html));

// --- Consistência de versão ----------------------------------------------
const appVersion = app.match(/APP_VERSION\s*=\s*"([^"]+)"/)?.[1];
const swVersion = sw.match(/VERSION\s*=\s*"([^"]+)"/)?.[1];
pass("APP_VERSION definida em app.js", appVersion, "não encontrada");
pass(
  "Versão do service worker igual à do app",
  appVersion && appVersion === swVersion,
  `app.js=${appVersion} service-worker.js=${swVersion}`
);
pass(
  "README menciona a versão atual",
  appVersion && readme.includes(appVersion),
  `procurado: ${appVersion}`
);
pass(
  "HTML não tem versões antigas fixas",
  !appVersion || [...html.matchAll(/v(\d+\.\d+\.\d+)/g)].every(m => m[1] === appVersion),
  "versão no HTML difere de APP_VERSION"
);

// --- PWA ------------------------------------------------------------------
pass("manifest.json é JSON válido", manifest !== null);
const icons = manifest?.icons ?? [];
pass("Manifesto declara ícones", icons.length > 0);
for (const icon of icons) {
  pass(`Ícone existe: ${icon.src}`, exists(icon.src));
}
pass("apple-touch-icon existe", exists("icons/apple-touch-icon.png"));

const precached = [...new Set([...sw.matchAll(/"\.\/([^"]+)"/g)].map(m => m[1]))];
for (const file of precached) {
  pass(`Arquivo em cache existe: ${file}`, exists(file));
}

// --- Supabase -------------------------------------------------------------
const supabaseWindow = {};
try {
  vm.runInNewContext(supabaseConfig, { window: supabaseWindow, Object, String });
} catch { /* a validação abaixo falha e mostra o problema */ }
const supabaseValidation =
  supabaseWindow.apexValidateSupabaseConfig?.(supabaseWindow.APEX_SUPABASE_CONFIG) ?? {};

for (const file of ["supabase-config.js", "supabase-client.js", "supabase-auth.js", "auth-core.js", "sync-core.js", "supabase-sync.js", "supabase-bridge.js", "supabase/functions/bridge/core.js"]) {
  const check = spawnSync("node", ["--check", file], { encoding: "utf8" });
  pass(`Sintaxe JavaScript válida (${file})`, check.status === 0, check.stderr?.trim());
}
pass("url_configurada", supabaseValidation.url_configurada === true);
pass("chave_configurada", supabaseValidation.chave_configurada === true);
pass(
  "modulo_no_html",
  /<script src="supabase-config\.js"><\/script>/.test(html) &&
    /<script type="module" src="supabase-client\.js"><\/script>/.test(html),
  "o HTML tem de carregar supabase-config.js e depois supabase-client.js (module)"
);
pass(
  "Arquivos Supabase sem comandos de terminal",
  !/read\s+-r\s+-p/.test(supabaseConfig + supabaseClient),
  "encontrado 'read -r -p' (comando de terminal) dentro de um arquivo JavaScript"
);

// --- Migrações SQL: RLS obrigatória ---------------------------------------
const migrationFiles = exists("supabase/migrations")
  ? fs.readdirSync("supabase/migrations").filter(f => f.endsWith(".sql")).sort()
  : [];
const migrationsSql = migrationFiles
  .map(f => read(`supabase/migrations/${f}`))
  .join("\n")
  .replace(/--.*$/gm, "");

const tables = [...migrationsSql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)/gi)]
  .map(m => m[1]);
for (const table of tables) {
  pass(
    `RLS ativada na tabela ${table}`,
    new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, "i")
      .test(migrationsSql)
  );
  pass(
    `Tabela ${table} tem pelo menos uma política`,
    new RegExp(`create\\s+policy\\s+\\w+\\s+on\\s+public\\.${table}\\b`, "i").test(migrationsSql)
  );
}
const definers = migrationsSql.split(/create\s+(?:or\s+replace\s+)?function/i).slice(1)
  .filter(body => /security\s+definer/i.test(body.split(/\$\$[\s\S]*?\$\$/)[0] + body.slice(0, 400)));
pass(
  "Funções SECURITY DEFINER fixam o search_path",
  definers.every(body => /set\s+search_path/i.test(body.slice(0, 400))),
  "uma função SECURITY DEFINER não define search_path"
);
pass(
  "Migrações não dão acesso ao papel anon",
  !/grant\s+[^;]*\bto\s+[^;]*\banon\b/i.test(migrationsSql),
  "encontrado GRANT ... TO anon"
);
pass(
  "Existem testes RLS para as migrações",
  migrationFiles.length === 0 || exists("supabase/tests/rls.test.sql")
);

// --- Segurança básica -----------------------------------------------------
const secretPattern =
  /(sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}|sb_secret_[A-Za-z0-9_-]{10,}|service_role|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
pass(
  "Sem chaves ou segredos no código público",
  ![app, html, css, sw, supabaseConfig, supabaseClient, supabaseAuth, authCore, syncCore, supabaseSync, supabaseBridge, bridgeCore, bridgeFunction].some(text => secretPattern.test(text))
);

// --- Resultado ------------------------------------------------------------
console.log("\n===== APEX QUALITY GATE =====");
for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} | ${check.name}`);
  if (!check.ok && check.detail) console.log(`       ${check.detail}`);
}

const failed = checks.filter(check => !check.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} verificações passaram.`);

if (failed.length) {
  process.exitCode = 1;
} else {
  console.log("QUALITY GATE APROVADO.");
}
