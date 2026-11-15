# Apex Virtual Group

Protótipo responsivo do centro de comando da Apex Virtual Group, pensado para iPadOS e computadores. Versão atual: **0.5.0** ("Apex Core").

## O que já existe
- Dashboard responsivo com cinco vistas: Visão geral, Conselho, Projetos, Tarefas e Documentos.
- Nove diretores virtuais (CEO, CFO, COO, CTO, CLO, CMO, CCO, CSO, CRO) como perfis. **Não há IA conectada.**
- **Persistência local:** projetos, tarefas e atividade ficam salvos no `localStorage` do navegador (chave `apex.core.v02`). Os dados são validados ao carregar e, se estiverem corrompidos, o app volta ao estado inicial.
- **Projetos:** criação com validação de nome vazio e duplicado.
- **Tarefas:** criar, atribuir a um diretor, mudar o estado (Por iniciar, Em curso, Concluída), excluir com confirmação e filtrar por estado.
- **Atividade recente:** histórico local das últimas 100 ações.
- **Conta (Supabase Auth):** botão Entrar/Sair no topo, com e-mail e senha. Ao entrar pela primeira vez cria a organização "Apex Virtual Group", o membro `owner` e os 9 diretores (idempotente). **Os projetos e tarefas continuam no `localStorage`; ainda não são sincronizados com o Supabase.**
- **Supabase (conexão base):** `supabase-config.js` (URL e chave pública validadas) e `supabase-client.js` (cliente oficial numa versão fixa). O estado aparece no rodapé da barra lateral. **Ainda não há tabelas, autenticação nem leitura/escrita de dados.**
- **PWA:** manifesto com ícones e service worker que funciona offline (incluindo as fontes depois da primeira visita).
- **Controlo de qualidade:** testes automáticos e um quality gate executados no GitHub Actions em cada push e pull request.

Os dois projetos e as seis tarefas iniciais são exemplos. Os dados ficam apenas neste dispositivo e navegador, sem sincronização.

## O que ainda NÃO está conectado
Não existem agentes de IA reais, uso das tabelas de projetos e tarefas do Supabase pelo app, sincronização entre dispositivos, execução em segundo plano nem integração com APIs. A estatística "Decisões pendentes" está sempre em zero porque ainda não há módulo de decisões. Não introduza chaves secretas no frontend.

## Executar localmente
```bash
python3 -m http.server 8000 --directory .
```
Abra `http://localhost:8000`. Num Codespace, abra a porta 8000 na aba **Ports**.

Também pode publicar esta interface estática em qualquer hosting de sites estáticos. Para produção, configure domínio, HTTPS e políticas de segurança.

## Supabase
O projeto Supabase está conectado apenas no nível da configuração. Os dados do app continuam no `localStorage`.

- `supabase-config.js` salva o URL e a **publishable key** (`sb_publishable_...`), que é pública por desenho. A proteção dos dados virá das políticas RLS.
- **Nunca** colocar aqui `service_role`, `sb_secret_*`, a senha do banco de dados ou comandos de terminal. O quality gate falha se aparecerem.
- `supabase-client.js` carrega `@supabase/supabase-js` de uma versão fixa (`SUPABASE_JS_VERSION`) e expõe `window.apexSupabase` (`client`, `validation`, `testConnection()`). Se a rede falhar, o dashboard continua a funcionar.
- Antes de criar tabelas: ativar RLS em todas e validar com os avisos de segurança do Supabase. Não correr migrações sem rever o esquema.

## Autenticação
- Entrada por **e-mail e senha** (Supabase Auth). Ao criar conta, a senha precisa ter 12 ou mais caracteres. A sessão fica salva pelo cliente Supabase no navegador.
- O Supabase pode pedir confirmação de e-mail ao criar conta. Nesse caso o app avisa e só deixa entrar depois de confirmar.
- Depois de criar a conta do fundador, **desativar a criação de contas** no painel do Supabase (Authentication, Sign In / Providers) e ativar MFA. Qualquer pessoa com o URL consegue, por padrão, se registrar (só vê os seus próprios dados, mas é desnecessário).
- A lógica (`auth-core.js`) não toca no DOM e tem testes com um cliente simulado; o fluxo completo foi testado no browser com um Supabase simulado. O login real depende do projeto Supabase e da rede.

## Banco de dados
`supabase/migrations/20261115190000_core_schema.sql` define organizações, membros, diretores, projetos, tarefas e atividade, com **RLS em todas as tabelas**: cada usuário só vê os dados das organizações a que pertence, o papel anônimo não tem acesso e a atividade é só de acrescentar.

**Estado: aplicada ao projeto Supabase (15/11/2026), com 0 avisos de segurança. As tabelas estão vazias e o frontend continua usando o `localStorage`.** O app já faz login e cria a organização e os diretores; falta conectar os projetos, tarefas e atividade.

- As políticas usam funções `SECURITY DEFINER` no esquema privado `private` (com `search_path` fixo) para evitar recursão entre políticas.
- Para testar o banco de dados com um Postgres local (variáveis `PGHOST`, `PGUSER`, `PGPASSWORD`): `./scripts/test-rls.sh`. Cria um banco temporário, aplica as migrações e corre `supabase/tests/rls.test.sql` (dois usuários, escritas cruzadas, anônimo, restrições). O CI faz o mesmo num Postgres 16.
- Convites de membros não estão incluídos: hoje só o criador da organização pode ser membro. Serão uma migração à parte, com fluxo feito no servidor.
- Depois de aplicar uma nova migração ao Supabase, correr os avisos de segurança (`get_advisors`).

## Sincronização (v0.5.0)
Com a sessão iniciada, projetos, tarefas e atividade são copiados para o Supabase (organização do usuário, protegida por RLS).
- **Primeira entrada:** se a organização está vazia, os dados locais são enviados.
- **Entradas seguintes:** o estado da nuvem substitui a cópia local (alterações locais feitas sem sessão e ainda não enviadas são perdidas).
- **Depois de cada alteração:** envio automático (cerca de 0,6 s depois). Sem rede ou com erro, o app continua com os dados locais e mostra "Sem sincronização".
- **Sem sessão:** tudo funciona só em modo local, como antes.
- Código: `sync-core.js` (lógica, testada com cliente simulado) e `supabase-sync.js` (ligação à interface).
- Limitação conhecida: sem resolução de conflitos entre dispositivos (vale o último envio).

## Cargos
| Código | Cargo |
| --- | --- |
| CEO | Estratégia e administração |
| CFO | Finanças |
| COO | Operações |
| CTO | Tecnologia |
| CLO | Jurídico e conformidade |
| CMO | Marketing (marca, campanhas, aquisição) |
| CCO | Comunicação e clientes |
| CSO | Segurança (inclui riscos, auditoria e continuidade) |
| CRO | Receitas e crescimento |

## Testes e qualidade
Requer Node.js 22 ou superior, sem dependências a instalar.

```bash
node --test tests/*.test.mjs        # app, configuração Supabase e autenticação (cliente simulado)
node scripts/quality-gate.mjs    # estrutura, versões coerentes, PWA e segredos
```

Ao mudar a versão, atualize `APP_VERSION` em `app.js`, `VERSION` em `service-worker.js` e este README. O quality gate falha se ficarem desalinhados.

## Estrutura
```
index.html, styles.css, app.js   interface e lógica
supabase-config.js, supabase-client.js   conexão com o Supabase
supabase-auth.js, auth-core.js           login (interface) e lógica testável (organização, diretores)
supabase/migrations, supabase/tests      esquema SQL com RLS e testes
manifest.json, service-worker.js, icons/   PWA
tests/                           testes (DOM simulado, sem dependências)
scripts/quality-gate.mjs         verificações estáticas
.github/workflows/               CI
```

## Próximas etapas técnicas
1. Criar backend FastAPI e autenticação.
2. Criar projeto Supabase e tabelas com políticas RLS.
3. Implementar o CEO-orquestrador e os agentes especializados.
4. Implementar filas duráveis para tarefas longas.
5. Integrar fornecedores de modelos de IA através do backend.
6. Conectar o dashboard a dados reais e criar o módulo de decisões.
7. Construir a experiência 3D com React Three Fiber numa fase posterior.

## Segurança
- Nunca salvar tokens/API keys em `app.js`, HTML ou outros arquivos públicos.
- Usar variáveis de ambiente no backend/hosting.
- Ativar MFA nas contas cloud.
- Começar com repositório privado.
- Não permitir pagamentos, contratos, mensagens externas ou alterações destrutivas sem aprovação humana.
