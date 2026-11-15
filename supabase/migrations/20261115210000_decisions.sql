-- Apex Virtual Group: módulo de decisões com aprovação humana.
--
-- Um diretor (ou o fundador) propõe uma decisão; só o dono (owner) da
-- organização a aprova ou rejeita. Quem decidiu e quando é preenchido pelo
-- servidor (não pelo cliente) e uma decisão já tomada não pode ser alterada
-- nem apagada. Isto é a base de governança antes de ligar agentes de IA.

create table public.decisions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  title            text not null check (char_length(title) between 1 and 140),
  rationale        text not null default '' check (char_length(rationale) <= 2000),
  proposed_by_role text not null default 'Fundador' check (proposed_by_role in
                     ('CEO','CFO','COO','CTO','CLO','CMO','CCO','CSO','CRO','Fundador')),
  status           text not null default 'Pendente'
                     check (status in ('Pendente','Aprovada','Rejeitada')),
  decision_note    text not null default '' check (char_length(decision_note) <= 1000),
  decided_by       uuid references auth.users (id),
  decided_at       timestamptz,
  created_by       uuid not null default auth.uid() references auth.users (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint decisions_decided_consistent check (
    (status = 'Pendente' and decided_by is null and decided_at is null)
    or (status <> 'Pendente' and decided_by is not null and decided_at is not null)
  )
);

create index decisions_org_status_idx
  on public.decisions (organization_id, status, created_at desc);

create trigger decisions_set_updated_at
  before update on public.decisions
  for each row execute function public.set_updated_at();

-- Regras de governança, aplicadas no servidor.
create or replace function public.decisions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'Pendente' then
      raise exception 'Uma decisão já tomada não pode ser apagada.'
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.status <> 'Pendente' then
    -- Decisão já tomada: só se aceita regravar exatamente o mesmo conteúdo
    -- (a sincronização reenvia as linhas); qualquer mudança é recusada.
    if (new.title, new.rationale, new.proposed_by_role, new.status, new.decision_note)
       is distinct from
       (old.title, old.rationale, old.proposed_by_role, old.status, old.decision_note) then
      raise exception 'Uma decisão já tomada não pode ser alterada.'
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if new.status <> 'Pendente' then
    if not private.is_org_owner(new.organization_id) then
      raise exception 'Só o dono da organização pode aprovar ou rejeitar decisões.'
        using errcode = 'insufficient_privilege';
    end if;
    new.decided_by := (select auth.uid());
    new.decided_at := now();
  else
    new.decided_by := null;
    new.decided_at := null;
  end if;
  return new;
end;
$$;

create trigger decisions_guard_write
  before insert or update or delete on public.decisions
  for each row execute function public.decisions_guard();

alter table public.decisions enable row level security;

create policy decisions_member_all on public.decisions
  for all to authenticated
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));

revoke all on public.decisions from anon;
