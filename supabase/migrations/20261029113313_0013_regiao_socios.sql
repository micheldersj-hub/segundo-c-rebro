-- Migração 0013_regiao_socios (aplicada em 2026-10-29).
-- Exportada do histórico de migrações do Supabase.

alter table public.dossies add column if not exists pesquisa_socios text;
create table if not exists public.localizacoes (
  id bigint generated always as identity primary key,
  lat double precision not null,
  lng double precision not null,
  precisao real,
  endereco text,
  bairro text,
  cidade text,
  uf text,
  created_at timestamptz not null default now()
);
create index if not exists localizacoes_recentes on public.localizacoes (created_at desc);
alter table public.localizacoes enable row level security;
