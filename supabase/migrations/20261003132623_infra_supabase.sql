-- Migração infra_supabase (aplicada em 2026-10-03).
-- Exportada do histórico de migrações do Supabase.

set search_path = public, extensions;

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

alter table raw_events add column if not exists attempts int not null default 0;

create or replace function public.get_app_secrets()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb)
  from vault.decrypted_secrets
  where name like 'sc\_%';
$$;
revoke execute on function public.get_app_secrets() from public, anon, authenticated;
grant  execute on function public.get_app_secrets() to service_role;

create or replace function public.set_app_secret(secret_name text, secret_value text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing uuid;
begin
  select id into existing from vault.secrets where name = 'sc_' || secret_name;
  if existing is null then
    perform vault.create_secret(secret_value, 'sc_' || secret_name);
  else
    perform vault.update_secret(existing, secret_value);
  end if;
end;
$$;
revoke execute on function public.set_app_secret(text, text) from public, anon, authenticated;
grant  execute on function public.set_app_secret(text, text) to service_role;

create or replace function public.invoke_worker(task text)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'sc_PROJECT_URL') || '/functions/v1/worker?task=' || task,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sc_CRON_SECRET')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
$$;
revoke execute on function public.invoke_worker(text) from public, anon, authenticated;
