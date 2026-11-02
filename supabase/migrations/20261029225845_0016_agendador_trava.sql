-- Migração 0016_agendador_trava (aplicada em 2026-10-29).
-- Exportada do histórico de migrações do Supabase.

create table if not exists public.agendador_travas (
  wa_id text primary key,
  ate   timestamptz not null
);
alter table public.agendador_travas enable row level security;

create or replace function public.agendador_travar(p_wa text, p_segundos int default 90)
returns boolean language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  insert into agendador_travas (wa_id, ate) values (p_wa, now() + make_interval(secs => p_segundos))
  on conflict (wa_id) do update set ate = excluded.ate where agendador_travas.ate < now()
  returning true into ok;
  return coalesce(ok, false);
end $$;

create or replace function public.agendador_soltar(p_wa text)
returns void language sql security definer set search_path = public as $$
  update agendador_travas set ate = now() - interval '1 second' where wa_id = p_wa;
$$;

revoke all on function public.agendador_travar(text, int) from public, anon, authenticated;
revoke all on function public.agendador_soltar(text) from public, anon, authenticated;
grant execute on function public.agendador_travar(text, int) to service_role;
grant execute on function public.agendador_soltar(text) to service_role;
