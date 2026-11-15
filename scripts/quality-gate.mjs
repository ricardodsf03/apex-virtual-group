import fs from "node:fs";
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
const manifest = json("manifest.json");

// --- Ficheiros base -------------------------------------------------------
pass("app.js existe e não está vazio", app.length > 0);
pass("index.html existe e não está vazio", html.length > 0);
pass("styles.css existe e não está vazio", css.length > 0);
pass("HTML liga ao app.js", /app\.js/.test(html));
pass("HTML liga ao styles.css", /styles\.css/.test(html));

const syntax = spawnSync("node", ["--check", "app.js"], { encoding: "utf8" });
pass("Sintaxe JavaScript válida (app.js)", syntax.status === 0, syntax.stderr?.trim());

const swSyntax = spawnSync("node", ["--check", "service-worker.js"], { encoding: "utf8" });
pass("Sintaxe JavaScript válida (service-worker.js)", swSyntax.status === 0, swSyntax.stderr?.trim());

// --- Funcionalidades ------------------------------------------------------
pass("Persistência local implementada", /localStorage/.test(app));
pass("Chave de armazenamento definida", /STORAGE_KEY/.test(app));
pass("Carregamento de estado implementado", /function\s+loadState/.test(app));
pass("Gravação de estado implementada", /function\s+saveState/.test(app));
pass("Registo de atividades implementado", /function\s+logActivity/.test(app));
pass("Renderização de tarefas implementada", /renderTasks/.test(app));
pass("Lista de tarefas ligada ao HTML", /taskList/.test(html));

// --- Consistência de versão ----------------------------------------------
const appVersion = app.match(/APP_VERSION\s*=\s*"([^"]+)"/)?.[1];
const swVersion = sw.match(/VERSION\s*=\s*"([^"]+)"/)?.[1];
pass("APP_VERSION definida em app.js", appVersion, "não encontrada");
pass(
  "Versão do service worker igual à da app",
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
  pass(`Ficheiro em cache existe: ${file}`, exists(file));
}

// --- Segurança básica -----------------------------------------------------
const secretPattern =
  /(sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
pass(
  "Sem chaves ou segredos no código público",
  ![app, html, css, sw].some(text => secretPattern.test(text))
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
