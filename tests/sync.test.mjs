import { test } from "node:test";
import assert from "node:assert/strict";
import { pullState, pushState, isEmptyState, toTaskRow, toProjectRow, toDecisionRow, fromRows } from "../sync-core.js";

const ORG = "22222222-2222-2222-2222-222222222222";
const T = "2026-11-15T10:00:00.000Z";

// Cliente simulado com tabelas em memória (select/eq/order/limit/upsert/delete/in).
function fakeClient(tables = {}, { failOn = null } = {}) {
  const db = { projects: [], tasks: [], activities: [], decisions: [], ...tables };
  const calls = [];
  return {
    db, calls,
    from(table) {
      const filters = []; let op = "select"; let payload; let opts = {}; let ids = null; let lim = null;
      const b = {
        select() { return b; },
        eq(k, v) { filters.push([k, v]); return b; },
        in(k, v) { ids = [k, v]; return b; },
        order() { return b; },
        limit(n) { lim = n; return b; },
        upsert(rows, o) { op = "upsert"; payload = rows; opts = o ?? {}; return b; },
        delete() { op = "delete"; return b; },
        then(resolve, reject) {
          calls.push({ table, op });
          if (failOn?.table === table && failOn.op === op) {
            return Promise.resolve({ data: null, error: { message: "boom" } }).then(resolve, reject);
          }
          const rows = db[table];
          const match = r => filters.every(([k, v]) => r[k] === v) && (!ids || ids[1].includes(r[ids[0]]));
          let data = [];
          if (op === "select") { data = rows.filter(match); if (lim) data = data.slice(0, lim); }
          if (op === "upsert") {
            for (const item of payload) {
              const i = rows.findIndex(r => r.id === item.id);
              if (i >= 0) { if (!opts.ignoreDuplicates) rows[i] = { ...rows[i], ...item }; }
              else rows.push({ ...item });
            }
          }
          if (op === "delete") db[table] = rows.filter(r => !match(r));
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        }
      };
      return b;
    }
  };
}

const local = () => ({
  version: 2,
  projects: [{ id: "p1", name: "Projeto", desc: "d", status: "Novo", owner: "CEO", createdAt: T, updatedAt: T }],
  tasks: [
    { id: "t1", title: "Tarefa 1", owner: "CTO", status: "Por iniciar", createdAt: T, updatedAt: T },
    { id: "t2", title: "Tarefa 2", owner: "Fundador", status: "Concluída", createdAt: T, updatedAt: T }
  ],
  activities: [{ id: "a1", actor: "Fundador", type: "task", message: "Criou", createdAt: T }],
  decisions: [
    { id: "d1", title: "Decisão 1", rationale: "r", proposer: "CFO", status: "Pendente", note: "", decidedAt: null, createdAt: T, updatedAt: T },
    { id: "d2", title: "Decisão 2", rationale: "", proposer: "CTO", status: "Aprovada", note: "ok", decidedAt: T, createdAt: T, updatedAt: T }
  ]
});

test("mapeia tarefas e projetos para linhas do banco e de volta", () => {
  const state = local();
  assert.equal(toTaskRow(state.tasks[0], ORG).owner_role, "CTO");
  assert.equal(toProjectRow(state.projects[0], ORG).description, "d");
  const back = fromRows({
    projects: [toProjectRow(state.projects[0], ORG)],
    tasks: state.tasks.map(t => toTaskRow(t, ORG)),
    activities: []
  });
  assert.deepEqual(back.projects, state.projects);
  assert.deepEqual(back.tasks, state.tasks);
});

test("textos longos são cortados ao limite do banco", () => {
  const row = toTaskRow({ ...local().tasks[0], title: "x".repeat(300) }, ORG);
  assert.equal(row.title.length, 140);
});

test("envia o estado local e é idempotente", async () => {
  const client = fakeClient();
  const synced = new Set();
  const first = await pushState(client, ORG, local(), synced);
  assert.deepEqual(first, { projects: 1, tasks: 2, decisions: 2, newActivities: 1 });
  assert.equal(client.db.tasks.length, 2);
  assert.ok(client.db.tasks.every(r => r.organization_id === ORG));
  const second = await pushState(client, ORG, local(), synced);
  assert.equal(second.newActivities, 0);
  assert.equal(client.db.activities.length, 1);
  assert.equal(client.db.tasks.length, 2);
});

test("tarefa apagada localmente é apagada na nuvem, só nesta organização", async () => {
  const other = { id: "tx", organization_id: "outra", title: "X", owner_role: "CEO", status: "Por iniciar" };
  const client = fakeClient({ tasks: [other] });
  const synced = new Set();
  await pushState(client, ORG, local(), synced);
  const state = local();
  state.tasks = state.tasks.filter(t => t.id !== "t1");
  await pushState(client, ORG, state, synced);
  assert.deepEqual(client.db.tasks.map(r => r.id).sort(), ["t2", "tx"]);
});

test("mudar o estado de uma tarefa atualiza a linha", async () => {
  const client = fakeClient();
  const synced = new Set();
  await pushState(client, ORG, local(), synced);
  const state = local();
  state.tasks[0].status = "Em curso";
  await pushState(client, ORG, state, synced);
  assert.equal(client.db.tasks.find(r => r.id === "t1").status, "Em curso");
});

test("ler devolve o estado no formato do app", async () => {
  const client = fakeClient();
  await pushState(client, ORG, local(), new Set());
  const state = await pullState(client, ORG);
  assert.equal(state.version, 2);
  assert.equal(state.tasks.length, 2);
  assert.equal(state.projects[0].desc, "d");
  assert.equal(isEmptyState(state), false);
  assert.equal(isEmptyState(await pullState(fakeClient(), ORG)), true);
});

test("erro do banco lança e não marca atividades como enviadas", async () => {
  const client = fakeClient({}, { failOn: { table: "activities", op: "upsert" } });
  const synced = new Set();
  await assert.rejects(pushState(client, ORG, local(), synced), /gravar a atividade/);
  assert.equal(synced.size, 0);
});

test("decisões: o cliente não envia quem decidiu nem quando", () => {
  const row = toDecisionRow(local().decisions[1], ORG);
  assert.equal("decided_by" in row, false);
  assert.equal("decided_at" in row, false);
  assert.equal(row.status, "Aprovada");
  assert.equal(row.decision_note, "ok");
});

test("decisões são enviadas, lidas de volta e nunca apagadas na nuvem", async () => {
  const client = fakeClient();
  const synced = new Set();
  await pushState(client, ORG, local(), synced);
  assert.equal(client.db.decisions.length, 2);

  const state = local();
  state.decisions = [];
  await pushState(client, ORG, state, synced);
  assert.equal(client.db.decisions.length, 2);
  assert.ok(!client.calls.some(call => call.table === "decisions" && call.op === "delete"));

  const back = await pullState(client, ORG);
  assert.equal(back.decisions.length, 2);
  assert.equal(back.decisions.find(d => d.id === "d2").proposer, "CTO");
});

test("decisão pendente local não desfaz uma já tomada na nuvem", async () => {
  const client = fakeClient({
    decisions: [{ id: "d1", organization_id: ORG, title: "Decisão 1", rationale: "r",
      proposed_by_role: "CFO", status: "Rejeitada", decision_note: "", created_at: T, updated_at: T }]
  });
  await pushState(client, ORG, local(), new Set());
  assert.equal(client.db.decisions.find(r => r.id === "d1").status, "Rejeitada");
});

test("estado só com decisões não é considerado vazio", () => {
  const state = { projects: [], tasks: [], activities: [], decisions: [{ id: "x" }] };
  assert.equal(isEmptyState(state), false);
});
