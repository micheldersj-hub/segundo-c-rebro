-- Migração evolucao (aplicada em 2026-10-03).
-- Exportada do histórico de migrações do Supabase.

set search_path = public, extensions;

create table if not exists goals (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  area           text not null default 'outro' check (area in ('trabalho','familia','saude','estudo','financas','pessoal','outro')),
  target_date    date,
  status         text not null default 'ativa' check (status in ('ativa','concluida','pausada','abandonada')),
  progress_notes jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists goals_status_idx on goals (status);

create table if not exists skills (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null unique,
  level                int  not null default 1 check (level between 1 and 5),
  trend                text not null default 'estavel' check (trend in ('evoluindo','estavel','estagnada')),
  evidence             jsonb not null default '[]'::jsonb,
  last_assessed_at     timestamptz not null default now(),
  created_at           timestamptz not null default now()
);

create table if not exists patterns (
  id           uuid primary key default gen_random_uuid(),
  description  text not null,
  kind         text not null check (kind in ('dificuldade','habito','gatilho','conquista')),
  occurrences  int  not null default 1,
  confidence   real not null default 0.5 check (confidence between 0 and 1),
  status       text not null default 'ativo' check (status in ('ativo','superado','descartado')),
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index if not exists patterns_status_idx on patterns (status, kind);

alter table goals    enable row level security;
alter table skills   enable row level security;
alter table patterns enable row level security;
