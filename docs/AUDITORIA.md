# Auditoria técnica: estado a 15/11/2026

Primeira missão do handoff: auditar o estado real antes de implementar. Esta auditoria cobre o repositório no GitHub (branches, PRs, CI e histórico completo) e o projeto Supabase (só em leitura). **Não cobre** o Codespace nem os Secrets, que não são acessíveis a partir do GitHub.

## Resumo
O `main` contém um app estático (HTML, CSS e JS sem build) com PWA e persistência em `localStorage`. **O Supabase, a Bridge e a visualização 3D descritos no handoff não existem no repositório.** Se existem, estão apenas no Codespace, sem commit.

## A. Arquitetura atual
- Frontend estático: `index.html`, `styles.css`, `app.js`.
- PWA: `manifest.json`, `service-worker.js` (cache `apex-v0.2.0`, offline) e `icons/`.
- Estado em `localStorage` (chave `apex.core.v02`), com validação e recuperação.
- Qualidade: `tests/` (14 testes, `node:test`), `scripts/quality-gate.mjs` (33 verificações) e workflow `Apex Quality Gate`.
- Histórico: 5 commits em `main` (último: merge do PR #1, v0.2.0). CI verde em todas as execuções.

## B. Componentes funcionais (testados)
- Dashboard com 5 vistas (Visão geral, Conselho, Projetos, Tarefas, Documentos).
- Criação de projetos (validação de vazio e duplicados).
- Tarefas: criar, mudar estado, excluir e filtrar.
- Registro local de atividade (últimas 100 ações).
- PWA offline e ícones.
- Testes automáticos e quality gate.

## C. Parcial ou inexistente
| Item | Estado |
| --- | --- |
| 9 diretores | Apenas perfis (sem IA) |
| `supabase-config.js`, `supabase-client.js` | **Não existem no repositório** |
| Bridge (Express, Octokit, `package.json`) | **Não existe no repositório** |
| Visualização 3D | **Não existe no repositório** |
| Módulo de decisões | Inexistente ("Decisões pendentes" fixo em 0) |
| Backend, autenticação, memória dos agentes | Inexistentes |

## D. Erros e bloqueios
- O erro `read -r -p` do `supabase-config.js` **não é verificável**: o arquivo não está no repositório.
- **Inconsistência de cargos** entre o handoff e o código:

| Cargo | Handoff | Código atual |
| --- | --- | --- |
| CCO | Comunicação e clientes | Diretor Comercial |
| CSO | Segurança | Diretor de Estratégia |
| CRO | Receitas e crescimento | Diretor de Risco e Auditoria |

  Falta decidir qual versão é a correta.

## E. Supabase
- Existe um projeto `apex-virtual-group` (região eu-west-1), ativo e saudável.
- Está vazio: **0 tabelas, 0 migrações e 0 avisos de segurança**.
- Nada está conectado ao frontend.

## F. Bridge
Sem código no repositório. Estado desconhecido.

## G. Segurança
- Histórico limpo: nenhum arquivo `.pem`, `.env` ou padrão de chave em qualquer commit.
- O repositório é **público**, embora o README recomende privado.
- O `main` **não tem proteção de branch** (PR e quality gate obrigatórios).
- A rotação de credenciais da GitHub App está **pendente** e é responsabilidade do fundador. Não é verificável a partir do repositório.

## H. Prioridades
1. Recuperar o trabalho do Codespace (`git status`, `git branch -a`, push para um branch).
2. Rodar as credenciais da GitHub App (revogar a antiga e salvar a nova só nos Secrets).
3. Decidir se o repositório passa a privado.
4. Ativar proteção do `main`.
5. Criar `supabase-config.js` e `supabase-client.js` corretos.
6. Desenhar o esquema com RLS e só depois migrar.
7. Bridge e, por fim, os agentes.

## I. Arquivos a criar ou alterar
- `supabase-config.js`, `supabase-client.js` e a conexão no `index.html`.
- `supabase/migrations/*.sql` (esquema e políticas RLS).
- `bridge/` (Express, Octokit) com `package.json`.
- Alinhar `app.js` e o README com os cargos definitivos.

## J. Testes por etapa
| Etapa | Verificação |
| --- | --- |
| Config Supabase | `url_configurada`, `chave_configurada` e `modulo_no_html` a `true` |
| Dashboard | Os 14 testes atuais continuam passando |
| Esquema | Usuário A não lê dados do usuário B (RLS) |
| Bridge | Operação num branch `apex/*` e Draft PR, sem escrever no `main` |

## Regras mantidas
Sem commits diretos no `main` (alterações por pull request), sem reconstruir o projeto, sem migrações SQL antes de validar configuração e segurança, e sem credenciais no código.

## Atualização (15/11/2026)
- Cargos decididos: CCO = Comunicação e clientes, CSO = Segurança, CRO = Receitas e crescimento (versão do handoff).
- Esquema com RLS aplicado ao Supabase (6 tabelas, 0 avisos de segurança). O app ainda não o usa.
- Pendentes: recuperar o trabalho do Codespace, rodar as credenciais da GitHub App, decidir sobre repositório privado e proteção do `main`.

## Atualização (15/11/2026, noite)
- App na v0.6.0: login, sincronização de projetos, tarefas e atividade com o Supabase, recuperação de senha e módulo de decisões com aprovação humana.
- Conta do fundador criada; cadastro aberto desativado no Supabase.
- Chave da GitHub App rodada pelo fundador (informado por ele; não verificável a partir do repositório).
- Pendentes: verificação em dois passos no GitHub e no Supabase, proteção do `main`, decidir repositório privado, recuperar o trabalho antigo do Codespace (guardado em branches de backup locais e no stash).

## Atualização (17/11/2026)
- Migração `decisions` aplicada; decisão de teste aprovada com quem e quando gravados pelo servidor.
- Verificação em dois passos ativada pelo fundador no GitHub e no Supabase.
- `main` protegido por ruleset (PR obrigatório, CI "Validate Apex" e "Testar migrações e RLS", sem apagar, sem force push). Repositório continua público por decisão do fundador: no plano gratuito, a proteção só vale em repositório público.
- v0.7.0: Bridge (Edge Function + tabela `bridge_runs`).
