// Sincronização do estado local com o Supabase.
// Sem acesso ao DOM, para poder ser testada em Node com um cliente simulado.
// O estado local (localStorage) continua a ser a fonte que a interface lê;
// o Supabase guarda uma cópia por organização, protegida por RLS.

const cut = (value, max) => String(value ?? "").slice(0, max);

export function toProjectRow(project, organizationId) {
  return {
    id: project.id,
    organization_id: organizationId,
    name: cut(project.name, 80),
    description: String(project.desc ?? ""),
    status: cut(project.status || "Novo", 60),
    owner_role: project.owner,
    created_at: project.createdAt,
    updated_at: project.updatedAt
  };
}

export function toTaskRow(task, organizationId) {
  return {
    id: task.id,
    organization_id: organizationId,
    title: cut(task.title, 140),
    owner_role: task.owner,
    status: task.status,
    created_at: task.createdAt,
    updated_at: task.updatedAt
  };
}

export function toDecisionRow(decision, organizationId) {
  // decided_by e decided_at não são enviados: o servidor preenche-os.
  return {
    id: decision.id,
    organization_id: organizationId,
    title: cut(decision.title, 140),
    rationale: cut(decision.rationale, 2000),
    proposed_by_role: decision.proposer,
    status: decision.status,
    decision_note: cut(decision.note, 1000),
    created_at: decision.createdAt,
    updated_at: decision.updatedAt
  };
}

export function toActivityRow(activity, organizationId) {
  return {
    id: activity.id,
    organization_id: organizationId,
    actor: cut(activity.actor, 60) || "Sistema",
    type: cut(activity.type || "action", 40),
    message: cut(activity.message, 500),
    created_at: activity.createdAt
  };
}

export function fromRows({ projects, tasks, activities, decisions = [] }) {
  return {
    version: 2,
    projects: projects.map(row => ({
      id: row.id,
      name: row.name,
      desc: row.description,
      status: row.status,
      owner: row.owner_role,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })),
    tasks: tasks.map(row => ({
      id: row.id,
      title: row.title,
      owner: row.owner_role,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })),
    activities: activities.map(row => ({
      id: row.id,
      actor: row.actor,
      type: row.type,
      message: row.message,
      createdAt: row.created_at
    })),
    decisions: decisions.map(row => ({
      id: row.id,
      title: row.title,
      rationale: row.rationale,
      proposer: row.proposed_by_role,
      status: row.status,
      note: row.decision_note,
      decidedAt: row.decided_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  };
}

function fail(step, error) {
  const wrapped = new Error(`Falha ao ${step}.`);
  wrapped.cause = error;
  return wrapped;
}

function check(step, result) {
  if (result.error) throw fail(step, result.error);
  return result.data ?? [];
}

// Lê o estado da organização. Só lê; nunca altera nada.
export async function pullState(client, organizationId) {
  const read = (table, order = "created_at", limit = null) => {
    let query = client
      .from(table)
      .select("*")
      .eq("organization_id", organizationId)
      .order(order, { ascending: false });
    if (limit) query = query.limit(limit);
    return query;
  };
  const [projects, tasks, activities, decisions] = await Promise.all([
    read("projects"),
    read("tasks"),
    read("activities", "created_at", 100),
    read("decisions")
  ]);
  return fromRows({
    projects: check("ler os projetos", projects),
    tasks: check("ler as tarefas", tasks),
    activities: check("ler a atividade", activities),
    decisions: check("ler as decisões", decisions)
  });
}

export function isEmptyState(state) {
  return !state.projects.length && !state.tasks.length && !state.activities.length &&
    !(state.decisions?.length);
}

// Envia o estado local: grava projetos e tarefas, apaga os que já não existem
// localmente e acrescenta só as atividades novas (o registro é só de acréscimo).
// `syncedActivityIds` é um Set que esta função atualiza.
export async function pushState(client, organizationId, state, syncedActivityIds = new Set()) {
  const orgFilter = table => client.from(table).select("id").eq("organization_id", organizationId);

  if (state.projects.length) {
    check("gravar os projetos", await client.from("projects").upsert(
      state.projects.map(item => toProjectRow(item, organizationId)),
      { onConflict: "id" }
    ));
  }
  if (state.tasks.length) {
    check("gravar as tarefas", await client.from("tasks").upsert(
      state.tasks.map(item => toTaskRow(item, organizationId)),
      { onConflict: "id" }
    ));
  }

  // Decisões: nunca se apagam na nuvem (as tomadas são definitivas). As
  // pendentes só são inseridas se ainda não existirem, para uma cópia local
  // desatualizada não desfazer uma decisão tomada noutro dispositivo.
  const decisions = state.decisions ?? [];
  const pending = decisions.filter(item => item.status === "Pendente");
  const decided = decisions.filter(item => item.status !== "Pendente");
  if (pending.length) {
    check("gravar as decisões", await client.from("decisions").upsert(
      pending.map(item => toDecisionRow(item, organizationId)),
      { onConflict: "id", ignoreDuplicates: true }
    ));
  }
  if (decided.length) {
    check("gravar as decisões", await client.from("decisions").upsert(
      decided.map(item => toDecisionRow(item, organizationId)),
      { onConflict: "id" }
    ));
  }

  for (const [table, items] of [["tasks", state.tasks], ["projects", state.projects]]) {
    const keep = new Set(items.map(item => item.id));
    const remote = check(`listar ${table}`, await orgFilter(table));
    const stale = remote.map(row => row.id).filter(id => !keep.has(id));
    if (stale.length) {
      check(`apagar ${table}`, await client
        .from(table)
        .delete()
        .eq("organization_id", organizationId)
        .in("id", stale));
    }
  }

  const fresh = state.activities.filter(item => !syncedActivityIds.has(item.id));
  if (fresh.length) {
    check("gravar a atividade", await client.from("activities").upsert(
      fresh.map(item => toActivityRow(item, organizationId)),
      { onConflict: "id", ignoreDuplicates: true }
    ));
    for (const item of fresh) syncedActivityIds.add(item.id);
  }
  return {
    projects: state.projects.length,
    tasks: state.tasks.length,
    decisions: decisions.length,
    newActivities: fresh.length
  };
}
