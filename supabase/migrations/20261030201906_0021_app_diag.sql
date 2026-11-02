-- Migração 0021_app_diag (aplicada em 2026-10-30).
-- Exportada do histórico de migrações do Supabase.

create table if not exists public.app_diag (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  versao text check (char_length(versao) <= 20),
  ua text check (char_length(ua) <= 300),
  evento text not null check (char_length(evento) <= 60),
  detalhe text check (char_length(detalhe) <= 1000)
);
alter table public.app_diag enable row level security;
create policy app_diag_insere on public.app_diag for insert to anon, authenticated with check (true);
grant insert on public.app_diag to anon, authenticated;
