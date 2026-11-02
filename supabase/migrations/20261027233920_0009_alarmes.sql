-- Migração 0009_alarmes (aplicada em 2026-10-27).
-- Exportada do histórico de migrações do Supabase.

set search_path = public, extensions;
create table if not exists event_alerts (
  event_key  text primary key,
  event_id   text not null,
  starts_at  timestamptz not null,
  title      text,
  sent_at    timestamptz not null default now()
);
create index if not exists event_alerts_sent_idx on event_alerts (sent_at);
alter table event_alerts enable row level security;
select cron.schedule('sc-alarmes', '* * * * *', $$select public.invoke_worker('event-alerts')$$);
select cron.schedule('sc-limpa-alarmes', '15 7 * * *', $$delete from public.event_alerts where sent_at < now() - interval '30 days'$$);
