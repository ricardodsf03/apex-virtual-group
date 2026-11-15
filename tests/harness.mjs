import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const APP_SOURCE = fs.readFileSync(path.join(root, "app.js"), "utf8");

// Corre o app.js num contexto isolado com um DOM mínimo (sem dependências).
export function createApp({ storage = {}, failSave = false } = {}) {
  const store = new Map(Object.entries(storage));
  const alerts = [];
  const windowListeners = {};
  const elements = new Map();
  let uuid = 0;

  const makeElement = selector => ({
    selector,
    innerHTML: "",
    textContent: "",
    value: "",
    dataset: {},
    listeners: {},
    classList: { toggle() {}, add() {}, remove() {} },
    addEventListener(type, handler) {
      (this.listeners[type] ||= []).push(handler);
    },
    showModal() {},
    close() {},
    focus() {},
    reset() {}
  });

  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, makeElement(selector));
    return elements.get(selector);
  };

  const context = {
    document: { querySelector: element, querySelectorAll: () => [] },
    localStorage: {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => {
        if (failSave) throw new Error("QuotaExceededError");
        store.set(key, String(value));
      },
      removeItem: key => store.delete(key)
    },
    crypto: { randomUUID: () => `id-${++uuid}` },
    alert: message => alerts.push(message),
    confirm: () => true,
    console: { error() {}, log() {} },
    window: {
      addEventListener: (type, handler) => {
        (windowListeners[type] ||= []).push(handler);
      }
    }
  };

  vm.createContext(context);
  vm.runInContext(APP_SOURCE, context, { filename: "app.js" });

  return {
    store,
    alerts,
    element,
    windowListeners,
    // Avalia uma expressão dentro do contexto da app (acede a const/let).
    run: code => vm.runInContext(code, context),
    // Dispara um listener registado num elemento.
    fire(selector, type = "click", event = {}) {
      const handlers = element(selector).listeners[type] || [];
      for (const handler of handlers) {
        handler({ preventDefault() {}, target: {}, ...event });
      }
    }
  };
}
