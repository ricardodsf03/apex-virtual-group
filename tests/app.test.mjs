import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./harness.mjs";

const KEY = "apex.core.v02";
const saved = app => JSON.parse(app.store.get(KEY));

test("arranque limpo cria estado inicial e grava-o", () => {
  const app = createApp();
  const state = app.run("state");
  assert.equal(state.version, 2);
  assert.equal(state.projects.length, 2);
  assert.equal(state.tasks.length, 6);
  assert.equal(state.activities.length, 1);
  assert.match(state.activities[0].message, /0\.6\.0/);
  assert.equal(saved(app).tasks.length, 6);
});

test("dados corrompidos ou de versão errada recuperam o estado inicial", () => {
  for (const raw of ["{não é json", JSON.stringify({ version: 1 })]) {
    const app = createApp({ storage: { [KEY]: raw } });
    assert.equal(app.run("state.tasks.length"), 6);
  }
});

test("estado válido salvo é carregado como está", () => {
  const custom = { version: 2, projects: [], tasks: [], activities: [] };
  const app = createApp({ storage: { [KEY]: JSON.stringify(custom) } });
  assert.equal(app.run("state.tasks.length"), 0);
});

test("falha ao gravar avisa o usuário e retorna false", () => {
  const app = createApp({ failSave: true });
  assert.equal(app.run("saveState()"), false);
  assert.ok(app.alerts.some(message => /salvar/i.test(message)));
});

test("registro de atividades salva no máximo 100 entradas", () => {
  const app = createApp();
  app.run("for (let i = 0; i < 150; i++) logActivity('Teste', 'x' + i)");
  assert.equal(app.run("state.activities.length"), 100);
});

test("escapeHtml neutraliza HTML", () => {
  const app = createApp();
  assert.equal(
    app.run(`escapeHtml('<img src=x onerror="a()">&\\'')`),
    "&lt;img src=x onerror=&quot;a()&quot;&gt;&amp;&#39;"
  );
});

test("criar tarefa grava, regista atividade e escapa o título", () => {
  const app = createApp();
  app.element("#taskTitle").value = "<b>Nova</b>";
  app.element("#taskOwner").value = "CTO";
  app.fire("#saveTaskBtn");

  assert.equal(app.run("state.tasks.length"), 7);
  assert.equal(app.run("state.tasks[0].owner"), "CTO");
  assert.equal(saved(app).tasks[0].title, "<b>Nova</b>");
  assert.ok(app.element("#taskList").innerHTML.includes("&lt;b&gt;Nova&lt;/b&gt;"));
  assert.ok(!app.element("#taskList").innerHTML.includes("<b>Nova</b>"));
});

test("tarefa sem descrição é rejeitada", () => {
  const app = createApp();
  app.element("#taskTitle").value = "   ";
  app.fire("#saveTaskBtn");
  assert.equal(app.run("state.tasks.length"), 6);
  assert.equal(app.alerts.length, 1);
});

test("mudar estado e excluir tarefa", () => {
  const app = createApp();
  const id = app.run("state.tasks[0].id");

  app.fire("#taskList", "change", {
    target: { dataset: { taskStatus: id }, value: "Concluída" }
  });
  assert.equal(app.run("state.tasks[0].status"), "Concluída");

  app.fire("#taskList", "click", { target: { dataset: { taskDelete: id } } });
  assert.equal(app.run("state.tasks.length"), 5);
  assert.equal(saved(app).tasks.length, 5);
});

test("filtro de tarefas mostra só o estado escolhido", () => {
  const app = createApp();
  const id = app.run("state.tasks[0].id");
  app.fire("#taskList", "change", {
    target: { dataset: { taskStatus: id }, value: "Em curso" }
  });
  app.run("window.apexTaskFilter = 'Em curso'; renderTasks();");
  const html = app.element("#taskList").innerHTML;
  assert.equal((html.match(/class="task-row"/g) || []).length, 1);
});

test("criar projeto valida nome vazio e duplicados", () => {
  const app = createApp();

  app.element("#projectName").value = "";
  app.fire("#saveProjectBtn");
  assert.equal(app.run("state.projects.length"), 2);

  app.element("#projectName").value = "apex virtual group";
  app.fire("#saveProjectBtn");
  assert.equal(app.run("state.projects.length"), 2);

  app.element("#projectName").value = "Plataforma de mobilidade";
  app.element("#projectDescription").value = "";
  app.fire("#saveProjectBtn");
  assert.equal(app.run("state.projects.length"), 3);
  assert.equal(app.run("state.projects[0].desc"), "Objetivo ainda não especificado.");
});

test("cabeçalho mostra o dia da semana atual e a versão", () => {
  const app = createApp();
  const weekday = new Date()
    .toLocaleDateString("pt-BR", { weekday: "long" })
    .toUpperCase();
  assert.equal(app.element("#todayLabel").textContent, `${weekday} · WORKSPACE`);
  assert.equal(app.element("#appVersion").textContent, "v0.6.0");
  assert.equal(app.element("#footerVersion").textContent, "v0.6.0");
});

test("conselho mostra 6 diretores no painel e 9 na vista completa", () => {
  const app = createApp();
  const count = selector =>
    (app.element(selector).innerHTML.match(/class="agent-card"/g) || []).length;
  assert.equal(count("#agentsGrid"), 6);
  assert.equal(count("#allAgents"), 9);
});

test("alterações em outra aba recarregam o estado", () => {
  const app = createApp();
  const other = { version: 2, projects: [], tasks: [], activities: [] };
  app.store.set(KEY, JSON.stringify(other));
  for (const handler of app.windowListeners.storage) {
    handler({ key: KEY });
  }
  assert.equal(app.run("state.tasks.length"), 0);
});

test("estado antigo sem decisões é carregado com lista vazia", () => {
  const old = { version: 2, projects: [], tasks: [], activities: [] };
  const app = createApp({ storage: { [KEY]: JSON.stringify(old) } });
  assert.equal(app.run("state.decisions.length"), 0);
});

test("propor, aprovar e rejeitar decisões; decisão tomada é definitiva", () => {
  const app = createApp();
  app.element("#decisionTitle").value = "<b>Comprar</b> plano";
  app.element("#decisionRationale").value = "Preciso";
  app.element("#decisionProposer").value = "CFO";
  app.fire("#saveDecisionBtn");

  assert.equal(app.run("state.decisions.length"), 1);
  assert.equal(app.run("state.decisions[0].status"), "Pendente");
  assert.equal(app.run("state.decisions[0].proposer"), "CFO");
  assert.ok(app.element("#decisionList").innerHTML.includes("&lt;b&gt;Comprar&lt;/b&gt;"));
  assert.equal(saved(app).decisions.length, 1);

  const id = app.run("state.decisions[0].id");
  app.fire("#decisionList", "click", { target: { dataset: { decisionApprove: id } } });
  assert.equal(app.run("state.decisions[0].status"), "Aprovada");
  assert.ok(app.run("state.decisions[0].decidedAt"));

  // já decidida: rejeitar depois não muda nada
  app.fire("#decisionList", "click", { target: { dataset: { decisionReject: id } } });
  assert.equal(app.run("state.decisions[0].status"), "Aprovada");
});

test("decisão sem título é rejeitada", () => {
  const app = createApp();
  app.element("#decisionTitle").value = "  ";
  app.fire("#saveDecisionBtn");
  assert.equal(app.run("state.decisions.length"), 0);
  assert.equal(app.alerts.length, 1);
});

test("rejeitar uma decisão pendente", () => {
  const app = createApp();
  app.element("#decisionTitle").value = "Algo";
  app.fire("#saveDecisionBtn");
  const id = app.run("state.decisions[0].id");
  app.fire("#decisionList", "click", { target: { dataset: { decisionReject: id } } });
  assert.equal(app.run("state.decisions[0].status"), "Rejeitada");
});
