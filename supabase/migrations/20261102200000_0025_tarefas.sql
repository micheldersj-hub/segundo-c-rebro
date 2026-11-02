-- 0025: Tarefas em funil (A fazer → Fazendo → Feito), por dia, com adiamento para o dia seguinte.
create table if not exists public.tarefas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  titulo text not null check (length(titulo) between 1 and 300),
  notas text,
  dia date not null default (now() at time zone 'America/Sao_Paulo')::date,
  etapa text not null default 'a_fazer' check (etapa in ('a_fazer', 'fazendo', 'feito')),
  prioridade smallint not null default 2 check (prioridade between 1 and 3), -- 1 alta, 2 normal, 3 baixa
  ordem double precision not null default extract(epoch from now()),
  adiada_vezes integer not null default 0,
  dia_original date,
  arquivada boolean not null default false,
  concluida_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tarefas_user_dia on public.tarefas (user_id, dia) where not arquivada;
create index if not exists tarefas_user_pend on public.tarefas (user_id, dia) where not arquivada and etapa <> 'feito';
alter table public.tarefas enable row level security;
-- Sem políticas: só o service_role (funções) acessa.
