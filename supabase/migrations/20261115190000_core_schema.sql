-- Apex Virtual Group: esquema base com RLS por organização.
--
-- ESTADO: proposta para revisão. NÃO foi aplicada ao projeto Supabase.
-- Aplicar só depois de rever este ficheiro e de correr os avisos de
-- segurança (get_advisors) a seguir à migração.
--
-- Modelo: um utilizador (auth.users) pertence a uma ou mais organizações.
-- Todos os dados de negócio pertencem a uma organização e só são visíveis
-- aos seus membros. Não há dados públicos nem acesso anónimo.
--
-- Fora de âmbito (fases seguintes): convites de membros, aprovações humanas,
-- memória dos agentes, auditoria detalhada.

-- ---------------------------------------------------------------------------
-- Utilitário: atualizar updated_at
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Organizações e membros
-- ---------------------------------------------------------------------------
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 120),
  created_by  uuid not null default auth.uid() references auth.users (id),
  created_at  timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  role            text not null default 'member' check (role in ('owner', 'member')),
  created_at      timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index organization_members_user_idx
  on public.organization_members (user_id);

-- ---------------------------------------------------------------------------
-- Diretores (os 9 cargos). O código do cargo é fixo; nome e descrição são
-- dados editáveis, porque o significado de CCO, CSO e CRO ainda está por decidir.
-- ---------------------------------------------------------------------------
create table public.directors (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  role_code       text not null check (role_code in
                    ('CEO','CFO','COO','CTO','CLO','CMO','CCO','CSO','CRO')),
  name            text not null check (char_length(name) between 1 and 120),
  description     text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, role_code)
);

create trigger directors_set_updated_at
  before update on public.directors
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Projetos
-- ---------------------------------------------------------------------------
create table public.projects (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 80),
  description     text not null default '',
  status          text not null default 'Novo',
  owner_role      text not null default 'CEO' check (owner_role in
                    ('CEO','CFO','COO','CTO','CLO','CMO','CCO','CSO','CRO')),
  created_by      uuid not null default auth.uid() references auth.users (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index projects_org_name_uniq
  on public.projects (organization_id, lower(name));

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Tarefas. owner_role aceita também 'Fundador', como na interface atual.
-- ---------------------------------------------------------------------------
create table public.tasks (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id      uuid references public.projects (id) on delete set null,
  title           text not null check (char_length(title) between 1 and 140),
  owner_role      text not null check (owner_role in
                    ('CEO','CFO','COO','CTO','CLO','CMO','CCO','CSO','CRO','Fundador')),
  status          text not null default 'Por iniciar'
                    check (status in ('Por iniciar','Em curso','Concluída')),
  created_by      uuid not null default auth.uid() references auth.users (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index tasks_org_status_idx on public.tasks (organization_id, status);
create index tasks_project_idx    on public.tasks (project_id);

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Atividade: registo só de acrescentar (sem update nem delete).
-- ---------------------------------------------------------------------------
create table public.activities (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  actor           text not null check (char_length(actor) between 1 and 60),
  type            text not null default 'action',
  message         text not null check (char_length(message) between 1 and 500),
  created_by      uuid not null default auth.uid() references auth.users (id),
  created_at      timestamptz not null default now()
);

create index activities_org_created_idx
  on public.activities (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Funções auxiliares das políticas. Vivem num esquema privado (não exposto
-- pela API) e são SECURITY DEFINER para consultar organization_members sem
-- passar pela RLS dessa tabela, o que evita recursão infinita entre políticas.
-- Só devolvem verdadeiro/falso sobre o utilizador autenticado.
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create function private.is_org_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org and m.user_id = (select auth.uid())
  );
$$;

create function private.is_org_owner(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org and m.user_id = (select auth.uid())
      and m.role = 'owner'
  );
$$;

create function private.is_org_creator(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organizations o
    where o.id = org and o.created_by = (select auth.uid())
  );
$$;

revoke all on function private.is_org_member(uuid)  from public;
revoke all on function private.is_org_owner(uuid)   from public;
revoke all on function private.is_org_creator(uuid) from public;
grant execute on function private.is_org_member(uuid)  to authenticated;
grant execute on function private.is_org_owner(uuid)   to authenticated;
grant execute on function private.is_org_creator(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: ativada em todas as tabelas. Sem política = sem acesso.
-- ---------------------------------------------------------------------------
alter table public.organizations        enable row level security;
alter table public.organization_members enable row level security;
alter table public.directors            enable row level security;
alter table public.projects             enable row level security;
alter table public.tasks                enable row level security;
alter table public.activities           enable row level security;

-- organization_members: cada utilizador vê apenas as suas próprias linhas.
create policy members_select_own on public.organization_members
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Arranque: quem criou a organização pode inserir-se como 'owner'.
create policy members_insert_bootstrap on public.organization_members
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and role = 'owner'
    and private.is_org_creator(organization_id)
  );

-- organizations
create policy organizations_select_member on public.organizations
  for select to authenticated
  using (created_by = (select auth.uid()) or private.is_org_member(id));

create policy organizations_insert_own on public.organizations
  for insert to authenticated
  with check (created_by = (select auth.uid()));

create policy organizations_update_owner on public.organizations
  for update to authenticated
  using (private.is_org_owner(id))
  with check (private.is_org_owner(id));

-- directors, projects, tasks: acesso total aos membros da organização.
create policy directors_member_all on public.directors
  for all to authenticated
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));

create policy projects_member_all on public.projects
  for all to authenticated
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));

create policy tasks_member_all on public.tasks
  for all to authenticated
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));

-- activities: membros leem e acrescentam; ninguém altera nem apaga.
create policy activities_select_member on public.activities
  for select to authenticated
  using (private.is_org_member(organization_id));

create policy activities_insert_member on public.activities
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and private.is_org_member(organization_id)
  );

-- ---------------------------------------------------------------------------
-- Privilégios: o papel anónimo não tem acesso a nada.
-- ---------------------------------------------------------------------------
revoke all on public.organizations        from anon;
revoke all on public.organization_members from anon;
revoke all on public.directors            from anon;
revoke all on public.projects             from anon;
revoke all on public.tasks                from anon;
revoke all on public.activities           from anon;
