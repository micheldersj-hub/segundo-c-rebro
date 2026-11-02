-- Migração 0015_agendador (aplicada em 2026-10-29).
-- Exportada do histórico de migrações do Supabase.

create table if not exists public.agendador_config (
  id            int primary key default 1 check (id = 1),
  ativo         boolean not null default true,
  dias_semana   int[]   not null default '{1,2,3,4,5}',
  hora_inicio   int     not null default 9  check (hora_inicio between 0 and 23),
  hora_fim      int     not null default 18 check (hora_fim between 1 and 24),
  almoco_inicio int              default 12,
  almoco_fim    int              default 13,
  duracao_min   int     not null default 60 check (duracao_min between 15 and 240),
  intervalo_min int     not null default 0  check (intervalo_min between 0 and 120),
  antecedencia_min int  not null default 120,
  dias_a_frente int     not null default 10 check (dias_a_frente between 1 and 30),
  updated_at    timestamptz not null default now()
);
insert into public.agendador_config (id) values (1) on conflict do nothing;
alter table public.agendador_config enable row level security;

create table if not exists public.agendamentos (
  id          uuid primary key default gen_random_uuid(),
  wa_id       text not null,
  nome        text,
  status      text not null default 'aguardando' check (status in ('aguardando','marcado','cancelado','expirado')),
  assunto     text,
  modalidade  text,
  local       text,
  opcoes      jsonb not null default '[]',
  inicio      timestamptz,
  fim         timestamptz,
  event_id    text,
  token       text unique not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists agendamentos_wa_idx on public.agendamentos (wa_id, status, updated_at desc);
alter table public.agendamentos enable row level security;

alter table public.wa_messages add column if not exists agenda_status text;
create index if not exists wa_messages_agenda_idx on public.wa_messages (created_at) where direction = 'in' and agenda_status is null;
update public.wa_messages set agenda_status = 'antigo' where agenda_status is null;

create or replace function public.agendador_varrer() returns void
language plpgsql security definer set search_path = public as $$
declare s jsonb;
begin
  if not exists (
    select 1 from wa_messages
    where direction = 'in' and agenda_status is null and not from_history
      and created_at > now() - interval '1 day' and created_at < now() - interval '5 seconds'
  ) then return; end if;
  if not (select ativo from agendador_config where id = 1) then return; end if;
  s := get_app_secrets();
  perform net.http_post(
    url := (s->>'sc_PROJECT_URL') || '/functions/v1/worker?task=agendador',
    body := '{}'::jsonb,
    headers := jsonb_build_object('x-cron-secret', s->>'sc_CRON_SECRET', 'Content-Type', 'application/json'),
    timeout_milliseconds := 60000);
end $$;
revoke all on function public.agendador_varrer() from public, anon, authenticated;

select cron.schedule('sc-agendador', '10 seconds', 'select public.agendador_varrer()');
