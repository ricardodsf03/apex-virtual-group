-- Apex Virtual Group: auditoria da Bridge.
--
-- Cada vez que a Bridge leva uma decisão aprovada ao repositório, fica aqui
-- uma linha: quem pediu, qual decisão, branch, commit e PR. Os membros só
-- leem; quem escreve é a Edge Function "bridge" com a chave de serviço
-- (que ignora RLS e nunca sai do servidor). Uma execução por decisão.

create table public.bridge_runs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  decision_id     uuid not null unique references public.decisions (id) on delete cascade,
  requested_by    uuid not null references auth.users (id),
  status          text not null default 'running'
                    check (status in ('running', 'opened', 'failed')),
  branch          text check (branch is null or branch ~ '^apex/[a-z0-9][a-z0-9-]{2,79}$'),
  commit_sha      text,
  pr_number       integer,
  pr_url          text check (pr_url is null or pr_url ~ '^https://github\.com/'),
  error           text check (error is null or char_length(error) <= 300),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index bridge_runs_org_idx
  on public.bridge_runs (organization_id, created_at desc);

create trigger bridge_runs_set_updated_at
  before update on public.bridge_runs
  for each row execute function public.set_updated_at();

alter table public.bridge_runs enable row level security;

-- Só leitura para os membros. Sem políticas de escrita: o navegador não
-- consegue criar, alterar nem apagar execuções.
create policy bridge_runs_select_member on public.bridge_runs
  for select to authenticated
  using (private.is_org_member(organization_id));

revoke all on public.bridge_runs from anon;
revoke insert, update, delete on public.bridge_runs from authenticated;
