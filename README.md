# Apex Virtual Group

Protótipo responsivo do centro de comando da Apex Virtual Group, pensado para iPadOS e computadores. Versão atual: **0.3.0** ("Apex Core").

## O que já existe
- Dashboard responsivo com cinco vistas: Visão geral, Conselho, Projetos, Tarefas e Documentos.
- Nove diretores virtuais (CEO, CFO, COO, CTO, CLO, CMO, CCO, CSO, CRO) como perfis. **Não há IA ligada.**
- **Persistência local:** projetos, tarefas e atividade ficam guardados no `localStorage` do navegador (chave `apex.core.v02`). Os dados validam-se ao carregar e, se estiverem corrompidos, volta-se ao estado inicial.
- **Projetos:** criação com validação de nome vazio e duplicado.
- **Tarefas:** criar, atribuir a um diretor, mudar o estado (Por iniciar, Em curso, Concluída), eliminar com confirmação e filtrar por estado.
- **Atividade recente:** histórico local das últimas 100 ações.
- **Supabase (ligação base):** `supabase-config.js` (URL e chave pública validadas) e `supabase-client.js` (cliente oficial numa versão fixa). O estado aparece no rodapé da barra lateral. **Ainda não há tabelas, autenticação nem leitura/escrita de dados.**
- **PWA:** manifesto com ícones e service worker que funciona offline (incluindo as fontes depois da primeira visita).
- **Controlo de qualidade:** testes automáticos e um quality gate executados no GitHub Actions em cada push e pull request.

Os dois projetos e as seis tarefas iniciais são exemplos. Os dados ficam apenas neste dispositivo e navegador, sem sincronização.

## O que ainda NÃO está ligado
Não existem agentes de IA reais, autenticação, uso das tabelas do Supabase pela app, sincronização entre dispositivos, execução em segundo plano nem integração com APIs. A estatística "Decisões pendentes" está sempre a zero porque ainda não há módulo de decisões. Não introduza chaves secretas no frontend.

## Executar localmente
```bash
python3 -m http.server 8000 --directory .
```
Abra `http://localhost:8000`. Num Codespace, abra a porta 8000 no separador **Ports**.

Também pode publicar esta interface estática em qualquer hosting de sites estáticos. Para produção, configure domínio, HTTPS e políticas de segurança.

## Supabase
O projeto Supabase está ligado apenas ao nível da configuração. Os dados da app continuam no `localStorage`.

- `supabase-config.js` guarda o URL e a **publishable key** (`sb_publishable_...`), que é pública por desenho. A proteção dos dados virá das políticas RLS.
- **Nunca** colocar aqui `service_role`, `sb_secret_*`, a palavra-passe da base de dados ou comandos de terminal. O quality gate falha se aparecerem.
- `supabase-client.js` carrega `@supabase/supabase-js` de uma versão fixa (`SUPABASE_JS_VERSION`) e expõe `window.apexSupabase` (`client`, `validation`, `testConnection()`). Se a rede falhar, o dashboard continua a funcionar.
- Antes de criar tabelas: ativar RLS em todas e validar com os avisos de segurança do Supabase. Não correr migrações sem rever o esquema.

## Base de dados
`supabase/migrations/20261115190000_core_schema.sql` define organizações, membros, diretores, projetos, tarefas e atividade, com **RLS em todas as tabelas**: cada utilizador só vê os dados das organizações a que pertence, o papel anónimo não tem acesso e a atividade é só de acrescentar.

**Estado: aplicada ao projeto Supabase (15/11/2026), com 0 avisos de segurança. As tabelas estão vazias e o frontend continua a usar `localStorage`.** Ligar a app (autenticação e depois os dados) é o passo seguinte.

- As políticas usam funções `SECURITY DEFINER` no esquema privado `private` (com `search_path` fixo) para evitar recursão entre políticas.
- Para testar a base de dados com um Postgres local (variáveis `PGHOST`, `PGUSER`, `PGPASSWORD`): `./scripts/test-rls.sh`. Cria uma base temporária, aplica as migrações e corre `supabase/tests/rls.test.sql` (dois utilizadores, escritas cruzadas, anónimo, restrições). O CI faz o mesmo num Postgres 16.
- Convites de membros não estão incluídos: hoje só o criador da organização pode ser membro. Serão uma migração à parte, com fluxo feito no servidor.
- Depois de aplicar uma nova migração ao Supabase, correr os avisos de segurança (`get_advisors`).

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
node --test tests/app.test.mjs tests/supabase.test.mjs   # comportamento da app e configuração Supabase
node scripts/quality-gate.mjs    # estrutura, versões coerentes, PWA e segredos
```

Ao mudar a versão, atualize `APP_VERSION` em `app.js`, `VERSION` em `service-worker.js` e este README. O quality gate falha se ficarem desalinhados.

## Estrutura
```
index.html, styles.css, app.js   interface e lógica
supabase-config.js, supabase-client.js   ligação ao Supabase
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
6. Ligar o dashboard a dados reais e criar o módulo de decisões.
7. Construir a experiência 3D com React Three Fiber numa fase posterior.

## Segurança
- Nunca guardar tokens/API keys em `app.js`, HTML ou outros ficheiros públicos.
- Usar variáveis de ambiente no backend/hosting.
- Ativar MFA nas contas cloud.
- Começar com repositório privado.
- Não permitir pagamentos, contratos, mensagens externas ou alterações destrutivas sem aprovação humana.
