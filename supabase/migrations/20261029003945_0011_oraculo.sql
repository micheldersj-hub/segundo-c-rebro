-- Migração 0011_oraculo (aplicada em 2026-10-29).
-- Exportada do histórico de migrações do Supabase.

set search_path = public, extensions;

alter table raw_events drop constraint if exists raw_events_source_check;
alter table raw_events add constraint raw_events_source_check
  check (source in ('whatsapp','whatsapp_contato','whatsapp_eu','app','gravacao','oraculo','gmail','calendar','instagram','manual'));

create table if not exists dossies (
  id           uuid primary key default gen_random_uuid(),
  alvo         text not null,
  contexto     text,
  cnpj         text,
  nome         text,
  status       text not null default 'pendente' check (status in ('pendente','pesquisando','pronto','erro')),
  etapa        text,
  cadastro     jsonb,
  pesquisa     text,
  pesquisa_fin text,
  dossie       jsonb,
  fontes       jsonb not null default '[]'::jsonb,
  risco        text,
  attempts     int not null default 0,
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists dossies_status_idx on dossies (status, created_at);
alter table dossies enable row level security;

select cron.unschedule('sc-oraculo') where exists (select 1 from cron.job where jobname = 'sc-oraculo');
select cron.schedule('sc-oraculo', '*/2 * * * *', $$select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name = 'sc_PROJECT_URL') || '/functions/v1/oraculo/processar',
  headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name = 'sc_CRON_SECRET')),
  body := '{}'::jsonb, timeout_milliseconds := 5000)$$);
