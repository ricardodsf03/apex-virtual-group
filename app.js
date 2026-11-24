const APP_VERSION = "0.8.0";
const STORAGE_KEY = "apex.core.v02";
const $ =(selector) => document.querySelector(selector);

const agents = [
  {role:"CEO",name:"Diretor Executivo",desc:"Define a estratégia, administra o conselho e coordena prioridades, projetos e distribuição de trabalho.",icon:"♛"},
  {role:"CFO",name:"Diretor Financeiro",desc:"Avalia custos, receitas, cenários, orçamento e rentabilidade.",icon:"▥"},
  {role:"COO",name:"Diretor de Operações",desc:"Desenha processos, operações, indicadores e planos de execução.",icon:"⚙"},
  {role:"CTO",name:"Diretor de Tecnologia",desc:"Define arquitetura, desenvolvimento, integrações e qualidade técnica.",icon:"⌘"},
  {role:"CLO",name:"Diretor Jurídico",desc:"Identifica requisitos legais, contratos, conformidade e riscos jurídicos.",icon:"§"},
  {role:"CMO",name:"Diretor de Marketing",desc:"Trabalha posicionamento, marca, campanhas e aquisição de clientes.",icon:"✳"},
  {role:"CCO",name:"Diretor de Comunicação e Clientes",desc:"Gerencia a relação com clientes, o atendimento, o sucesso do cliente e a comunicação institucional.",icon:"✉"},
  {role:"CSO",name:"Diretor de Segurança",desc:"Protege sistemas, dados e acessos, e acompanha riscos, auditoria e continuidade do negócio.",icon:"⬡"},
  {role:"CRO",name:"Diretor de Receitas e Crescimento",desc:"Gerencia vendas, parcerias, canais e o crescimento da receita.",icon:"↗"}
];
window.APEX_AGENTS = agents;

const initialProjects = [
  {name:"Apex Virtual Group",desc:"Construção da plataforma empresarial de agentes de IA.",status:"Em estruturação",owner:"CEO"},
  {name:"Portefólio de novas ideias",desc:"Espaço de triagem e avaliação de oportunidades de negócio.",status:"Planeamento",owner:"CSO"}
];

const initialTasks = [
  ["Definir arquitetura técnica","CTO"],
  ["Preparar modelo de custos da plataforma","CFO"],
  ["Definir regras de autonomia e aprovação","CRO"],
  ["Desenhar fluxo de triagem de ideias","CEO"],
  ["Mapear requisitos de privacidade","CLO"],
  ["Preparar identidade visual","CMO"]
];

const makeId = () => crypto.randomUUID
  ? crypto.randomUUID()
  : `apex-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function createInitialState() {
  const now = new Date().toISOString();
  return {
    version: 2,
    projects: initialProjects.map(p => ({
      id: makeId(), ...p, createdAt: now, updatedAt: now
    })),
    tasks: initialTasks.map(([title,owner]) => ({
      id: makeId(), title, owner, status:"Por iniciar",
      createdAt:now, updatedAt:now
    })),
    activities: [{
      id:makeId(), type:"system", actor:"Sistema",
      message:`Apex Core ${APP_VERSION} inicializado.`,
      createdAt:now
    }],
    decisions: []
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialState();

    const data = JSON.parse(raw);
    if (
      data.version !== 2 ||
      !Array.isArray(data.projects) ||
      !Array.isArray(data.tasks) ||
      !Array.isArray(data.activities)
    ) throw new Error("Estrutura de dados inválida");

    // Dados guardados antes do módulo de decisões não têm esta lista.
    if (!Array.isArray(data.decisions)) data.decisions = [];
    return data;
  } catch (error) {
    console.error("Apex: falha ao recuperar dados.", error);
    return createInitialState();
  }
}

let state = loadState();

// Avisa os módulos de sincronização (não existe nos testes de Node).
function notify(name) {
  if (typeof CustomEvent === "function") window.dispatchEvent?.(new CustomEvent(name));
}

window.apexGetState = () => state;

// Registra uma atividade vinda de um módulo (ex.: Bridge), grava e redesenha.
window.apexRecord = (actor, message, type = "action") => {
  logActivity(actor, message, type);
  saveState();
  renderAll();
};

// Troca o estado pelo da nuvem: grava a cópia local sem voltar a sincronizar.
window.apexReplaceState = next => {
  state = next;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (error) { console.error("Apex: não foi possível guardar a cópia local.", error); }
  renderAll();
};

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    notify("apex:state-saved");
    return true;
  } catch (error) {
    console.error("Apex: não foi possível salvar os dados.", error);
    alert("Não foi possível salvar. Verifique o espaço disponível no navegador.");
    return false;
  }
}

function logActivity(actor, message, type="action") {
  state.activities.unshift({
    id:makeId(), actor, message, type,
    createdAt:new Date().toISOString()
  });
  state.activities = state.activities.slice(0,100);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;",
    '"':"&quot;", "'":"&#39;"
  }[char]));
}

function formatDate(value) {
  return new Date(value).toLocaleString("pt-BR", {
    day:"2-digit", month:"2-digit",
    hour:"2-digit", minute:"2-digit"
  });
}

const agentCard = agent => `
  <article class="agent-card">
    <div class="agent-icon">${agent.icon}</div>
    <div>
      <h3>${agent.role} · ${agent.name}</h3>
      <p>${agent.desc}</p>
      <div class="agent-meta"><b>● Perfil preparado</b> · IA não conectada</div>
    </div>
  </article>`;

function renderAgents() {
  $("#agentsGrid").innerHTML = agents.slice(0,6).map(agentCard).join("");
  $("#allAgents").innerHTML = agents.map(agentCard).join("");
}

function renderHeader() {
  const weekday = new Date()
    .toLocaleDateString("pt-BR", { weekday:"long" })
    .toUpperCase();
  $("#todayLabel").textContent = `${weekday} · WORKSPACE`;
  $("#appVersion").textContent = `v${APP_VERSION}`;
  $("#footerVersion").textContent = `v${APP_VERSION}`;
}

function renderProjects() {
  const rows = state.projects.map(project => `
    <div class="project-row">
      <div>
        <strong>${escapeHtml(project.name)}</strong>
        <small>${escapeHtml(project.desc)} · Responsável: ${escapeHtml(project.owner)}</small>
      </div>
      <span class="tag">${escapeHtml(project.status)}</span>
    </div>`).join("");

  $("#projectList").innerHTML = rows || "<p class='muted'>Ainda não existem projetos.</p>";

  $("#allProjects").innerHTML = state.projects.map(project => `
    <article class="project-card">
      <span class="tag">${escapeHtml(project.status)}</span>
      <h3 style="margin-top:14px">${escapeHtml(project.name)}</h3>
      <p>${escapeHtml(project.desc)}</p>
      <small class="muted">Coordenação: ${escapeHtml(project.owner)}</small>
    </article>`).join("") || "<p class='muted'>Ainda não existem projetos.</p>";
}

function renderTasks() {
  const filter = window.apexTaskFilter || "Todas";
  const tasks = state.tasks.filter(task =>
    filter === "Todas" || task.status === filter
  );

  $("#taskList").innerHTML = tasks.map(task => `
    <div class="task-row" data-task-id="${escapeHtml(task.id)}">
      <div class="task-main">
        <strong>${escapeHtml(task.title)}</strong>
        <small>${escapeHtml(task.owner)} · ${formatDate(task.createdAt)}</small>
      </div>
      <div class="task-actions">
        <select data-task-status="${escapeHtml(task.id)}" aria-label="Estado da tarefa">
          ${["Por iniciar","Em curso","Concluída"].map(status =>
            `<option ${task.status === status ? "selected" : ""}>${status}</option>`
          ).join("")}
        </select>
        <button class="task-delete" data-task-delete="${escapeHtml(task.id)}">Excluir</button>
      </div>
    </div>`).join("") || "<p class='muted'>Não existem tarefas nesta categoria.</p>";
}

// Estado da Bridge para uma decisão aprovada (só com sessão iniciada).
// Dois pedidos possíveis: "record" (registro da decisão) e "plan" (plano
// escrito com IA pelo diretor que propôs; se foi o Fundador, o CEO).
const DIRECTOR_ROLES = agents.map(agent => agent.role);

function planAuthor(item) {
  return DIRECTOR_ROLES.includes(item.proposer) ? item.proposer : "CEO";
}

function bridgeLine(item, kind) {
  const run = (window.apexBridgeRuns || {})[`${item.id}:${kind}`];
  const id = escapeHtml(item.id);
  const label = kind === "plan" ? `Plano do ${escapeHtml(planAuthor(item))}` : "Registro";
  if (run?.status === "opened" && run.pr_url) {
    return `<small>${label}: <a href="${escapeHtml(run.pr_url)}" target="_blank" rel="noopener noreferrer">Draft PR #${escapeHtml(run.pr_number)}</a></small>`;
  }
  if (run?.status === "running") {
    return `<small>${label}: ${kind === "plan" ? "o diretor está escrevendo (até 1 minuto)…" : "enviando para a Bridge…"}</small>`;
  }
  const failed = run?.status === "failed"
    ? `<small class="bridge-error">${label}: ${escapeHtml(run.error || "falhou")}</small>` : "";
  const text = run
    ? "Tentar de novo"
    : (kind === "plan" ? `Pedir plano ao ${escapeHtml(planAuthor(item))}` : "Registrar no repositório");
  return { failed, button: `<button class="${kind === "plan" ? "secondary" : "approve"}" data-decision-bridge="${id}" data-bridge-kind="${kind}">${text}</button>` };
}

function bridgeArea(item) {
  if (item.status !== "Aprovada" || !window.apexOrganizationId) return "";
  const parts = ["record", "plan"].map(kind => bridgeLine(item, kind));
  const lines = parts.map(part => typeof part === "string" ? part : part.failed).filter(Boolean).join("\n      ");
  const buttons = parts.filter(part => typeof part !== "string").map(part => part.button).join("");
  return `${lines}${buttons ? `
        <div class="decision-actions">${buttons}</div>` : ""}`;
}

function renderDecisions() {
  const filter = window.apexDecisionFilter || "Pendente";
  const items = state.decisions.filter(item =>
    filter === "Todas" || item.status === filter
  );
  const tagClass = { Aprovada:"approved", Rejeitada:"rejected" };

  $("#decisionList").innerHTML = items.map(item => `
    <div class="decision-row" data-decision-id="${escapeHtml(item.id)}">
      <span class="tag ${tagClass[item.status] || ""}">${escapeHtml(item.status)}</span>
      <strong style="margin-top:10px">${escapeHtml(item.title)}</strong>
      ${item.rationale ? `<p>${escapeHtml(item.rationale)}</p>` : ""}
      <small>Proposta por ${escapeHtml(item.proposer)} · ${formatDate(item.createdAt)}${
        item.status !== "Pendente" && item.decidedAt
          ? ` · ${escapeHtml(item.status)} em ${formatDate(item.decidedAt)}` : ""}</small>
      ${item.note ? `<small>Nota: ${escapeHtml(item.note)}</small>` : ""}
      ${bridgeArea(item)}
      ${item.status === "Pendente" ? `
        <div class="decision-actions">
          <button class="approve" data-decision-approve="${escapeHtml(item.id)}">Aprovar</button>
          <button class="reject" data-decision-reject="${escapeHtml(item.id)}">Rejeitar</button>
        </div>` : ""}
    </div>`).join("") || "<p class='muted'>Não há decisões nesta categoria.</p>";
}

function renderActivities() {
  const panel = $("#activityPanel");
  if (!panel) return;

  const colors = ["", "purple", "amber"];
  panel.innerHTML = `
    <div class="panel-heading">
      <div><h2>Atividade recente</h2><p class="muted">Histórico local de operações</p></div>
    </div>
    ${state.activities.slice(0,8).map((item,index) => `
      <div class="activity">
        <span class="activity-dot ${colors[index % colors.length]}"></span>
        <div>
          <strong>${escapeHtml(item.actor)}</strong>
          <p>${escapeHtml(item.message)}</p>
          <small>${formatDate(item.createdAt)}</small>
        </div>
      </div>`).join("")}`;
}

function renderStats() {
  const values = [
    agents.length,
    state.projects.length,
    state.tasks.filter(t => t.status !== "Concluída").length,
    state.decisions.filter(d => d.status === "Pendente").length
  ];
  document.querySelectorAll(".stats-grid .stat-card strong")
    .forEach((element,index) => {
      if (values[index] !== undefined) element.textContent =
        String(values[index]).padStart(2,"0");
    });
}

function renderAll() {
  renderHeader();
  renderAgents();
  renderProjects();
  renderTasks();
  renderDecisions();
  renderActivities();
  renderStats();
}

const views = ["overview","board","projects","tasks","decisions","documents"];

function showView(view) {
  if (!views.includes(view)) return;
  views.forEach(name => {
    $("#" + name + "View").classList.toggle("hidden", name !== view);
  });
  document.querySelectorAll(".nav-item").forEach(button => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  $("#pageTitle").textContent = ({
    overview:"Visão geral",
    board:"Conselho de administração",
    projects:"Projetos",
    tasks:"Tarefas",
    decisions:"Decisões",
    documents:"Documentos"
  })[view];
  $("#sidebar").classList.remove("open");
}

document.querySelectorAll(".nav-item").forEach(button =>
  button.addEventListener("click", () => showView(button.dataset.view))
);

document.querySelectorAll("[data-go]").forEach(button =>
  button.addEventListener("click", () => showView(button.dataset.go))
);

$("#menuBtn").addEventListener("click", () =>
  $("#sidebar").classList.toggle("open")
);

const dialog = $("#projectDialog");

function openProjectDialog() {
  $("#projectForm").reset();
  dialog.showModal();
  $("#projectName").focus();
}

$("#newProjectBtn").addEventListener("click", openProjectDialog);
$("#newProjectBtn2").addEventListener("click", openProjectDialog);

$("#saveProjectBtn").addEventListener("click", event => {
  event.preventDefault();

  const name = $("#projectName").value.trim();
  const description = $("#projectDescription").value.trim();

  if (!name) {
    alert("Informe o nome do projeto.");
    return;
  }

  const duplicate = state.projects.some(project =>
    project.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR")
  );

  if (duplicate) {
    alert("Já existe um projeto com esse nome.");
    return;
  }

  const now = new Date().toISOString();

  state.projects.unshift({
    id:makeId(),
    name,
    desc:description || "Objetivo ainda não especificado.",
    status:"Novo",
    owner:"CEO",
    createdAt:now,
    updatedAt:now
  });

  logActivity("Fundador", `Criou o projeto "${name}".`, "project");

  if (!saveState()) return;

  renderAll();
  dialog.close();
  showView("projects");
});


window.apexTaskFilter = "Todas";

const taskDialog = $("#taskDialog");

$("#newTaskBtn").addEventListener("click", () => {
  $("#taskForm").reset();
  taskDialog.showModal();
  $("#taskTitle").focus();
});

$("#saveTaskBtn").addEventListener("click", event => {
  event.preventDefault();
  const title = $("#taskTitle").value.trim();
  const owner = $("#taskOwner").value;

  if (!title) {
    alert("Escreva a descrição da tarefa.");
    return;
  }

  const now = new Date().toISOString();
  state.tasks.unshift({
    id:makeId(), title, owner,
    status:"Por iniciar",
    createdAt:now, updatedAt:now
  });

  logActivity("Fundador", `Criou a tarefa "${title}".`);
  if (!saveState()) return;

  renderAll();
  taskDialog.close();
});

document.querySelectorAll(".task-filter").forEach(button => {
  button.addEventListener("click", () => {
    window.apexTaskFilter = button.dataset.filter;
    document.querySelectorAll(".task-filter").forEach(item =>
      item.classList.toggle("active", item === button)
    );
    renderTasks();
  });
});

$("#taskList").addEventListener("change", event => {
  const id = event.target.dataset.taskStatus;
  if (!id) return;

  const task = state.tasks.find(item => item.id === id);
  if (!task) return;

  task.status = event.target.value;
  task.updatedAt = new Date().toISOString();
  logActivity(task.owner, `Atualizou "${task.title}" para "${task.status}".`);

  if (!saveState()) return;
  renderAll();
});

$("#taskList").addEventListener("click", event => {
  const id = event.target.dataset.taskDelete;
  if (!id) return;

  const task = state.tasks.find(item => item.id === id);
  if (!task) return;
  if (!confirm(`Excluir a tarefa "${task.title}"?`)) return;

  state.tasks = state.tasks.filter(item => item.id !== id);
  logActivity("Fundador", `Excluiu a tarefa "${task.title}".`);

  if (!saveState()) return;
  renderAll();
});

window.apexDecisionFilter = "Pendente";

const decisionDialog = $("#decisionDialog");

$("#newDecisionBtn").addEventListener("click", () => {
  $("#decisionForm").reset();
  decisionDialog.showModal();
  $("#decisionTitle").focus();
});

$("#saveDecisionBtn").addEventListener("click", event => {
  event.preventDefault();
  const title = $("#decisionTitle").value.trim();
  if (!title) {
    alert("Escreva o que precisa ser decidido.");
    return;
  }

  const now = new Date().toISOString();
  const proposer = $("#decisionProposer").value || "Fundador";
  state.decisions.unshift({
    id:makeId(), title,
    rationale:$("#decisionRationale").value.trim(),
    proposer, status:"Pendente", note:"", decidedAt:null,
    createdAt:now, updatedAt:now
  });

  logActivity(proposer, `Propôs a decisão "${title}".`, "decision");
  if (!saveState()) return;

  renderAll();
  decisionDialog.close();
});

document.querySelectorAll(".decision-filter").forEach(button => {
  button.addEventListener("click", () => {
    window.apexDecisionFilter = button.dataset.filter;
    document.querySelectorAll(".decision-filter").forEach(item =>
      item.classList.toggle("active", item === button)
    );
    renderDecisions();
  });
});

$("#decisionList").addEventListener("click", event => {
  const approveId = event.target.dataset.decisionApprove;
  const rejectId = event.target.dataset.decisionReject;
  const id = approveId || rejectId;
  if (!id) return;

  const item = state.decisions.find(entry => entry.id === id);
  if (!item || item.status !== "Pendente") return; // decisão tomada é definitiva

  const status = approveId ? "Aprovada" : "Rejeitada";
  const verb = approveId ? "Aprovar" : "Rejeitar";
  if (!confirm(`${verb} a decisão "${item.title}"? Depois de tomada, não pode ser alterada.`)) return;

  const now = new Date().toISOString();
  item.status = status;
  item.decidedAt = now;
  item.updatedAt = now;
  logActivity("Fundador", `${status === "Aprovada" ? "Aprovou" : "Rejeitou"} a decisão "${item.title}".`, "decision");

  if (!saveState()) return;
  renderAll();
});

window.addEventListener("storage", event => {
  if (event.key === STORAGE_KEY) {
    state = loadState();
    renderAll();
  }
});

renderAll();
saveState();
