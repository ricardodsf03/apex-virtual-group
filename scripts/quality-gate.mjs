import fs from "node:fs";
import { spawnSync } from "node:child_process";

const checks = [];
const pass = (name, ok, detail = "") =>
  checks.push({ name, ok: Boolean(ok), detail });

const exists = file => fs.existsSync(file);
const read = file => exists(file) ? fs.readFileSync(file, "utf8") : "";

const app = read("app.js");
const html = read("index.html");
const css = read("styles.css");

pass("app.js existe e não está vazio", app.length > 0);
pass("index.html existe e não está vazio", html.length > 0);
pass("styles.css existe e não está vazio", css.length > 0);

const syntax = spawnSync("node", ["--check", "app.js"], { encoding: "utf8" });
pass("Sintaxe JavaScript válida", syntax.status === 0, syntax.stderr?.trim() || "");

pass("HTML liga ao app.js", /app\.js/.test(html));
pass("HTML liga ao styles.css", /styles\.css/.test(html));
pass("Persistência local implementada", /localStorage/.test(app));
pass("Chave de armazenamento definida", /STORAGE_KEY/.test(app));
pass("Carregamento de estado implementado", /function\s+loadState/.test(app));
pass("Gravação de estado implementada", /function\s+saveState/.test(app));
pass("Registo de atividades implementado", /function\s+logActivity/.test(app));
pass("Renderização de tarefas implementada", /renderTasks/.test(app));
pass("Lista de tarefas ligada ao HTML", /taskList/.test(html));

console.log("\n===== BACKUPS LOCAIS =====");
for (const file of [
  "app.js.backup-core-02",
  "app.js.backup-tasks-01",
  "index.html.backup-tasks-01",
  "styles.css.backup-tasks-01"
]) {
  console.log(`${exists(file) ? "OK" : "INFO"} | ${file}`);
}

console.log("\n===== APEX QUALITY GATE =====");
for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} | ${check.name}`);
  if (check.detail) console.log(check.detail);
}

const failed = checks.filter(check => !check.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} verificações passaram.`);

if (failed.length) {
  process.exitCode = 1;
} else {
  console.log("QUALITY GATE APROVADO.");
}
