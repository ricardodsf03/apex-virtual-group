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

-- Usuário B não vê nem altera nada de A
select set_config('request.jwt.claim.sub', :'B', false);
select pg_temp.expect_eq((select count(*) from public.organizations), 0, 'B não vê organizações de A');
select pg_temp.expect_eq((select count(*) from public.organization_members), 0, 'B não vê membros de A');
select pg_temp.expect_eq((select count(*) from public.projects), 0, 'B não vê projetos de A');
select pg_temp.expect_eq((select count(*) from public.tasks), 0, 'B não vê tarefas de A');
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
select pg_temp.expect_fail($$select * from public.organizations$$, 'anônimo não lê organizações');
select pg_temp.expect_fail($$insert into public.tasks (organization_id, title, owner_role) values ('aaaaaaaa-0000-0000-0000-000000000001','x','CTO')$$, 'anônimo não escreve');
reset role;
\echo === TODOS OS TESTES RLS PASSARAM ===
