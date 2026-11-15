import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function loadConfig() {
  const window = {};
  const context = vm.createContext({ window, Object, String });
  vm.runInContext(read("supabase-config.js"), context, { filename: "supabase-config.js" });
  return window;
}

test("configuração real é válida (url e chave configuradas)", () => {
  const window = loadConfig();
  const result = window.apexValidateSupabaseConfig(window.APEX_SUPABASE_CONFIG);
  assert.deepEqual(
    { ...result },
    { url_configurada: true, chave_configurada: true, ok: true }
  );
});

test("a configuração está congelada", () => {
  const window = loadConfig();
  assert.ok(Object.isFrozen(window.APEX_SUPABASE_CONFIG));
});

test("valida e rejeita configurações incorretas", () => {
  const { apexValidateSupabaseConfig: validate } = loadConfig();
  const goodUrl = "https://abcdefghij0123456789.supabase.co";
  const goodKey = "sb_publishable_abcdefghijklmnopqrstuv";

  assert.equal(validate({ url: goodUrl, publishableKey: goodKey }).ok, true);

  const bad = [
    {},
    undefined,
    { url: "", publishableKey: "" },
    { url: "http://abcdefghij0123456789.supabase.co", publishableKey: goodKey },
    { url: "https://abcdefghij0123456789.supabase.co/", publishableKey: goodKey },
    { url: "https://exemplo.com", publishableKey: goodKey },
    { url: goodUrl, publishableKey: "sb_secret_abcdefghijklmnopqrstuv" },
    { url: goodUrl, publishableKey: "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.assinatura" },
    { url: goodUrl, publishableKey: "sb_publishable_curta" }
  ];
  for (const candidate of bad) {
    assert.equal(validate(candidate).ok, false, JSON.stringify(candidate));
  }
});

test("ficheiros Supabase não têm comandos de terminal nem segredos", () => {
  const forbidden = [
    /read\s+-r\s+-p/,
    /\bservice_role\b/i,
    /sb_secret_/,
    /eyJ[A-Za-z0-9_-]{10,}\./,
    /postgres(ql)?:\/\//i,
    /^\s*(export\s+)?SUPABASE_[A-Z_]+=/m
  ];
  for (const file of ["supabase-config.js", "supabase-client.js"]) {
    const text = read(file);
    for (const pattern of forbidden) {
      assert.ok(!pattern.test(text), `${file} contém ${pattern}`);
    }
  }
});

test("index.html liga a configuração antes do módulo do cliente", () => {
  const html = read("index.html");
  const config = html.indexOf('<script src="supabase-config.js"></script>');
  const client = html.indexOf('<script type="module" src="supabase-client.js"></script>');
  assert.ok(config > -1, "falta supabase-config.js");
  assert.ok(client > -1, "falta supabase-client.js como módulo");
  assert.ok(config < client, "a configuração deve vir antes do cliente");
  assert.ok(html.includes('id="supabaseStatus"'));
});

test("service worker guarda os ficheiros Supabase em cache", () => {
  const sw = read("service-worker.js");
  assert.ok(sw.includes('"./supabase-config.js"'));
  assert.ok(sw.includes('"./supabase-client.js"'));
});

test("o cliente carrega uma versão fixa da biblioteca", () => {
  const client = read("supabase-client.js");
  assert.match(client, /SUPABASE_JS_VERSION = "\d+\.\d+\.\d+"/);
  assert.ok(!/supabase-js@(latest|\^|~|\d+\/)/.test(client));
});
