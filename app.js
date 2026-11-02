const agents=[
 {role:"CEO",name:"Diretor Executivo",desc:"Coordena o conselho, prioridades, projetos e distribuição de trabalho.",icon:"♛"},
 {role:"CFO",name:"Diretor Financeiro",desc:"Avalia custos, receitas, cenários, orçamento e rentabilidade.",icon:"▥"},
 {role:"COO",name:"Diretor de Operações",desc:"Desenha processos, operações, indicadores e planos de execução.",icon:"⚙"},
 {role:"CTO",name:"Diretor de Tecnologia",desc:"Define arquitetura, desenvolvimento, integrações e qualidade técnica.",icon:"⌘"},
 {role:"CLO",name:"Diretor Jurídico",desc:"Identifica requisitos legais, contratos, conformidade e riscos jurídicos.",icon:"§"},
 {role:"CMO",name:"Diretor de Marketing",desc:"Trabalha posicionamento, marca, comunicação e aquisição de clientes.",icon:"✳"},
 {role:"CCO",name:"Diretor Comercial",desc:"Desenvolve vendas, parcerias, clientes e canais comerciais.",icon:"↗"},
 {role:"CSO",name:"Diretor de Estratégia",desc:"Investiga mercados, concorrência, oportunidades e alternativas.",icon:"◎"},
 {role:"CRO",name:"Diretor de Risco e Auditoria",desc:"Verifica evidências, pressupostos, qualidade, segurança e riscos.",icon:"⬡"}
];
let projects=[
 {name:"Apex Virtual Group",desc:"Construção da plataforma empresarial de agentes de IA.",status:"Em estruturação",owner:"CEO"},
 {name:"Portefólio de novas ideias",desc:"Espaço de triagem e avaliação de oportunidades de negócio.",status:"Planeamento",owner:"CSO"}
];
const tasks=[
 ["Definir arquitetura técnica","CTO","Por iniciar"],
 ["Preparar modelo de custos da plataforma","CFO","Por iniciar"],
 ["Definir regras de autonomia e aprovação","CRO","Por iniciar"],
 ["Desenhar fluxo de triagem de ideias","CEO","Por iniciar"],
 ["Mapear requisitos de privacidade","CLO","Por iniciar"],
 ["Preparar identidade visual","CMO","Por iniciar"]
];
const $=s=>document.querySelector(s);
function agentCard(a){return `<article class="agent-card"><div class="agent-icon">${a.icon}</div><div><h3>${a.role} · ${a.name}</h3><p>${a.desc}</p><div class="agent-meta"><b>● Perfil preparado</b> · IA não ligada</div></div></article>`}
function renderAgents(){ $("#agentsGrid").innerHTML=agents.slice(0,6).map(agentCard).join("");$("#allAgents").innerHTML=agents.map(agentCard).join("")}
function renderProjects(){const html=projects.map(p=>`<div class="project-row"><div><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.desc)} · Responsável: ${p.owner}</small></div><span class="tag">${escapeHtml(p.status)}</span></div>`).join("");$("#projectList").innerHTML=html;$("#allProjects").innerHTML=projects.map(p=>`<article class="project-card"><span class="tag">${escapeHtml(p.status)}</span><h3 style="margin-top:14px">${escapeHtml(p.name)}</h3><p>${escapeHtml(p.desc)}</p><small class="muted">Coordenação: ${p.owner}</small></article>`).join("")}
function renderTasks(){$("#taskList").innerHTML=tasks.map(t=>`<div class="task-row"><span class="tag">${t[1]}</span><div><strong>${escapeHtml(t[0])}</strong><small>${t[2]} · tarefa demonstrativa</small></div></div>`).join("")}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
const views=["overview","board","projects","tasks","documents"];
function showView(v){views.forEach(x=>$("#"+x+"View").classList.toggle("hidden",x!==v));document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===v));$("#pageTitle").textContent=({overview:"Visão geral",board:"Conselho de administração",projects:"Projetos",tasks:"Tarefas",documents:"Documentos"})[v];$("#sidebar").classList.remove("open")}
document.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));
document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.go)));
$("#menuBtn").addEventListener("click",()=>$("#sidebar").classList.toggle("open"));
const dlg=$("#projectDialog");function openDialog(){$("#projectForm").reset();dlg.showModal()}
$("#newProjectBtn").addEventListener("click",openDialog);$("#newProjectBtn2").addEventListener("click",openDialog);
$("#saveProjectBtn").addEventListener("click",e=>{e.preventDefault();const name=$("#projectName").value.trim();if(!name)return;projects.unshift({name,desc:$("#projectDescription").value.trim()||"Objetivo ainda não especificado.",status:"Novo",owner:"CEO"});renderProjects();dlg.close();showView("projects")});
renderAgents();renderProjects();renderTasks();
