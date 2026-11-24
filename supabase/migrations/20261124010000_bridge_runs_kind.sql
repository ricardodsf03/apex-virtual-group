-- Apex Virtual Group: dois tipos de execução da Bridge por decisão.
--
-- 'record' = registro da decisão aprovada (v0.7.0).
-- 'plan'   = plano de execução escrito por um diretor com IA (v0.8.0).
-- Continua a haver no máximo uma execução de cada tipo por decisão.

alter table public.bridge_runs
  add column kind text not null default 'record'
    check (kind in ('record', 'plan'));

alter table public.bridge_runs
  drop constraint bridge_runs_decision_id_key;

alter table public.bridge_runs
  add constraint bridge_runs_decision_kind_key unique (decision_id, kind);
