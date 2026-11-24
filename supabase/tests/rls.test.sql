-- Testes de isolamento RLS com dois usuários (A e B).
-- Rode com scripts/test-rls.sh num banco de dados descartável.
\set ON_ERROR_STOP on
\set A '11111111-1111-1111-1111-111111111111'
\set B '22222222-2222-2222-2222-222222222222'
insert into auth.users values (:'A'), (:'B');

create or replace function pg_temp.expect_fail(sql text, label text) returns void language plpgsql as $$
begin
  begin execute sql; raise exception 'DEVIA FALHAR MAS PASSOU: %', label;
  exception when raise_exception then raise;
           when others then raise notice 'ok (falhou como esperado): %', label; end;
end $$;
create or replace function pg_temp.expect_eq(actual bigint, expected bigint, label text) returns void language plpgsql as $$
begin
  if actual is distinct from expected then raise exception 'FALHOU: % (obtido %, esperado %)', label, actual, expected; end if;
  raise notice 'ok: %', label;
end $$;
grant execute on all functions in schema pg_temp to public;

-- Usuário A cria organização e dados
set role authenticated; select set_config('request.jwt.claim.sub', :'A', false);
insert into public.organizations (id, name) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Org A');
insert into public.organization_members values ('aaaaaaaa-0000-0000-0000-000000000001', :'A', 'owner');
insert into public.projects (organization_id, name) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Projeto A');
insert into public.tasks (organization_id, title, owner_role) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Tarefa A', 'CTO');
insert into public.directors (organization_id, role_code, name) values ('aaaaaaaa-0000-0000-0000-000000000001', 'CEO', 'Diretor Executivo');
insert into public.activities (organization_id, actor, message) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Fundador', 'Criou a tarefa');
select pg_temp.expect_eq((select count(*) from public.tasks), 1, 'A vê a sua tarefa');
select pg_temp.expect_eq((select count(*) from public.organizations), 1, 'A vê a sua organização');

-- Restrições de dados
select pg_temp.expect_fail($$insert into public.tasks (organization_id, title, owner_role, status) values ('aaaaaaaa-0000-0000-0000-000000000001','x','CTO','Inválido')$$, 'estado de tarefa inválido');
select pg_temp.expect_fail($$insert into public.tasks (organization_id, title, owner_role) values ('aaaaaaaa-0000-0000-0000-000000000001','x','CXO')$$, 'cargo inválido');
select pg_temp.expect_fail($$insert into public.projects (organization_id, name) values ('aaaaaaaa-0000-0000-0000-000000000001','projeto a')$$, 'projeto duplicado (sem distinguir maiúsculas)');
select pg_temp.expect_fail($$insert into public.directors (organization_id, role_code, name) values ('aaaaaaaa-0000-0000-0000-000000000001','CEO','Outro')$$, 'cargo duplicado na organização');
select pg_temp.expect_fail($$insert into public.activities (organization_id, actor, message, created_by) values ('aaaaaaaa-0000-0000-0000-000000000001','X','y','22222222-2222-2222-2222-222222222222')$$, 'atividade em nome de outro usuário');

-- Atividade só de acrescentar
update public.activities set message = 'alterada';
select pg_temp.expect_eq((select count(*) from public.activities where message = 'alterada'), 0, 'atividade não pode ser alterada');
delete from public.activities;
select pg_temp.expect_eq((select count(*) from public.activities), 1, 'atividade não pode ser apagada');

-- Decisões: A (owner) propõe e aprova; regras de governança
select pg_temp.expect_eq((select count(*) from public.decisions), 0, 'A começa sem decisões');
insert into public.decisions (organization_id, title, proposed_by_role) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Decisão A', 'CFO');
select pg_temp.expect_eq((select count(*) from public.decisions where status = 'Pendente' and decided_by is null), 1, 'decisão nasce pendente');
update public.decisions set status = 'Aprovada', decision_note = 'ok' where title = 'Decisão A';
select pg_temp.expect_eq((select count(*) from public.decisions where status = 'Aprovada' and decided_by = :'A'::uuid and decided_at is not null), 1, 'servidor preenche quem decidiu e quando');
select pg_temp.expect_fail($$update public.decisions set title = 'Mudada' where title = 'Decisão A'$$, 'decisão tomada não pode ser alterada');
select pg_temp.expect_fail($$update public.decisions set status = 'Rejeitada' where title = 'Decisão A'$$, 'decisão tomada não pode ser revertida');
select pg_temp.expect_fail($$delete from public.decisions where title = 'Decisão A'$$, 'decisão tomada não pode ser apagada');
update public.decisions set title = title where title = 'Decisão A';
select pg_temp.expect_fail($$insert into public.decisions (organization_id, title, status) values ('aaaaaaaa-0000-0000-0000-000000000001', 'x', 'Qualquer')$$, 'estado de decisão inválido');
insert into public.decisions (organization_id, title) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Pendente A');
delete from public.decisions where title = 'Pendente A';
select pg_temp.expect_eq((select count(*) from public.decisions), 1, 'decisão pendente pode ser apagada');

-- Bridge: só o servidor escreve; membros leem
select pg_temp.expect_fail($$insert into public.bridge_runs (organization_id, decision_id, requested_by) select 'aaaaaaaa-0000-0000-0000-000000000001', id, '11111111-1111-1111-1111-111111111111' from public.decisions limit 1$$, 'navegador não cria execuções da Bridge');
reset role;
insert into public.bridge_runs (organization_id, decision_id, requested_by, status, branch, pr_number, pr_url)
  select 'aaaaaaaa-0000-0000-0000-000000000001', id, '11111111-1111-1111-1111-111111111111', 'opened', 'apex/decisao-a-12345678', 7, 'https://github.com/o/r/pull/7'
  from public.decisions where title = 'Decisão A';
select pg_temp.expect_fail($$insert into public.bridge_runs (organization_id, decision_id, requested_by, branch) select 'aaaaaaaa-0000-0000-0000-000000000001', id, '11111111-1111-1111-1111-111111111111', 'main' from public.decisions where title = 'Decisão A'$$, 'uma execução por decisão e só branches apex/*');
select pg_temp.expect_fail($$insert into public.bridge_runs (organization_id, decision_id, requested_by, kind) select 'aaaaaaaa-0000-0000-0000-000000000001', id, '11111111-1111-1111-1111-111111111111', 'record' from public.decisions where title = 'Decisão A'$$, 'um registro por decisão');
insert into public.bridge_runs (organization_id, decision_id, requested_by, kind, status) select 'aaaaaaaa-0000-0000-0000-000000000001', id, '11111111-1111-1111-1111-111111111111', 'plan', 'opened' from public.decisions where title = 'Decisão A';
select pg_temp.expect_fail($$insert into public.bridge_runs (organization_id, decision_id, requested_by, kind) select 'aaaaaaaa-0000-0000-0000-000000000001', id, '11111111-1111-1111-1111-111111111111', 'outro' from public.decisions where title = 'Decisão A'$$, 'tipo de execução inválido');
select pg_temp.expect_fail($$insert into public.bridge_runs (organization_id, decision_id, requested_by, branch) values ('aaaaaaaa-0000-0000-0000-000000000001', gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'main')$$, 'branch fora de apex/* é recusado');
set role authenticated; select set_config('request.jwt.claim.sub', :'A', false);
select pg_temp.expect_eq((select count(*) from public.bridge_runs), 2, 'A lê as execuções da sua organização (registro e plano)');
select pg_temp.expect_fail($$update public.bridge_runs set pr_number = 999$$, 'navegador não altera execuções (sem permissão)');
select pg_temp.expect_eq((select count(*) from public.bridge_runs where pr_number = 7), 1, 'navegador não altera execuções');
select pg_temp.expect_fail($$delete from public.bridge_runs$$, 'navegador não apaga execuções (sem permissão)');
select pg_temp.expect_eq((select count(*) from public.bridge_runs), 2, 'execuções intactas');

-- Membro que não é dono: propõe, mas não decide
reset role;
insert into auth.users values ('33333333-3333-3333-3333-333333333333');
insert into public.organization_members values ('aaaaaaaa-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'member');
set role authenticated; select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
insert into public.decisions (organization_id, title, proposed_by_role) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Proposta do membro', 'CTO');
select pg_temp.expect_fail($$update public.decisions set status = 'Aprovada' where title = 'Proposta do membro'$$, 'membro que não é dono não aprova');
select pg_temp.expect_fail($$insert into public.decisions (organization_id, title, status) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Já aprovada', 'Aprovada')$$, 'membro não cria decisão já aprovada');
reset role; set role authenticated; select set_config('request.jwt.claim.sub', :'A', false);
select pg_temp.expect_eq((select count(*) from public.decisions where title = 'Proposta do membro' and status = 'Pendente'), 1, 'proposta do membro continua pendente');
delete from public.decisions where title = 'Proposta do membro';

-- Usuário B não vê nem altera nada de A
select set_config('request.jwt.claim.sub', :'B', false);
select pg_temp.expect_eq((select count(*) from public.organizations), 0, 'B não vê organizações de A');
select pg_temp.expect_eq((select count(*) from public.organization_members), 0, 'B não vê membros de A');
select pg_temp.expect_eq((select count(*) from public.projects), 0, 'B não vê projetos de A');
select pg_temp.expect_eq((select count(*) from public.tasks), 0, 'B não vê tarefas de A');
select pg_temp.expect_eq((select count(*) from public.decisions), 0, 'B não vê decisões de A');
select pg_temp.expect_eq((select count(*) from public.bridge_runs), 0, 'B não vê execuções da Bridge de A');
select pg_temp.expect_fail($$insert into public.decisions (organization_id, title) values ('aaaaaaaa-0000-0000-0000-000000000001','Intrusa')$$, 'B não escreve decisões na organização de A');
select pg_temp.expect_eq((select count(*) from public.directors), 0, 'B não vê diretores de A');
select pg_temp.expect_eq((select count(*) from public.activities), 0, 'B não vê atividade de A');
select pg_temp.expect_fail($$insert into public.tasks (organization_id, title, owner_role) values ('aaaaaaaa-0000-0000-0000-000000000001','Intrusa','CTO')$$, 'B não escreve tarefas na organização de A');
select pg_temp.expect_fail($$insert into public.organization_members values ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','owner')$$, 'B não se torna owner da organização de A');
select pg_temp.expect_fail($$insert into public.organizations (name, created_by) values ('Falsa','11111111-1111-1111-1111-111111111111')$$, 'B não cria organização em nome de A');
update public.tasks set title = 'Hackeada';
delete from public.tasks;
delete from public.projects;

-- B cria a sua própria organização
insert into public.organizations (id, name) values ('bbbbbbbb-0000-0000-0000-000000000001', 'Org B');
insert into public.organization_members values ('bbbbbbbb-0000-0000-0000-000000000001', :'B', 'owner');
insert into public.tasks (organization_id, title, owner_role) values ('bbbbbbbb-0000-0000-0000-000000000001', 'Tarefa B', 'Fundador');
select pg_temp.expect_eq((select count(*) from public.tasks), 1, 'B vê só a sua tarefa');

-- A continua com os dados intactos
select set_config('request.jwt.claim.sub', :'A', false);
select pg_temp.expect_eq((select count(*) from public.tasks where title = 'Tarefa A'), 1, 'tarefa de A intacta (não alterada nem apagada por B)');
select pg_temp.expect_eq((select count(*) from public.projects), 1, 'projeto de A intacto');
select pg_temp.expect_eq((select count(*) from public.tasks where title = 'Tarefa B'), 0, 'A não vê a tarefa de B');

-- Anônimo e sem sessão
reset role; set role anon; select set_config('request.jwt.claim.sub', '', false);
select pg_temp.expect_fail($$select * from public.tasks$$, 'anônimo não lê tarefas');
select pg_temp.expect_fail($$select * from public.decisions$$, 'anônimo não lê decisões');
select pg_temp.expect_fail($$select * from public.bridge_runs$$, 'anônimo não lê execuções da Bridge');
select pg_temp.expect_fail($$select * from public.organizations$$, 'anônimo não lê organizações');
select pg_temp.expect_fail($$insert into public.tasks (organization_id, title, owner_role) values ('aaaaaaaa-0000-0000-0000-000000000001','x','CTO')$$, 'anônimo não escreve');
reset role;
\echo === TODOS OS TESTES RLS PASSARAM ===
