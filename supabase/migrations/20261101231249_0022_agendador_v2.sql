-- Migração 0022_agendador_v2 (aplicada em 2026-11-01).
-- Exportada do histórico de migrações do Supabase.

alter table public.wa_messages add column if not exists por_dimy boolean not null default false;
alter table public.agendamentos add column if not exists ultima_oferta_em timestamptz;
alter table public.agendamentos drop constraint if exists agendamentos_status_check;
alter table public.agendamentos add constraint agendamentos_status_check check (status in ('aguardando', 'rascunho', 'marcado', 'cancelado', 'expirado'));
update public.agendamentos set ultima_oferta_em = updated_at where status = 'aguardando' and jsonb_array_length(opcoes) > 0;

update public.wa_messages set por_dimy = true
where direction = 'out' and not por_dimy and (
  body like 'Oi%assistente do Michelder%' or body like 'Estes horários estão livres%' or body like 'Perfeito%Reunião com o Michelder confirmada%'
  or body like 'Combinado%Remarquei a reunião%' or body like '%Para remarcar a reunião%' or body like '%A agenda do Michelder está cheia%'
  or body like '%Esse horário não está disponível na agenda dele%'
);

create table if not exists public.agendador_decisoes (
  id uuid primary key default gen_random_uuid(),
  wa_id text not null,
  msg_ids text[] not null default '{}',
  analise jsonb,
  resultado text not null,
  motivo text,
  created_at timestamptz not null default now()
);
create index if not exists agendador_decisoes_wa on public.agendador_decisoes (wa_id, created_at desc);
alter table public.agendador_decisoes enable row level security;

create table if not exists public.agendador_rascunhos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid default public.dono_id(),
  wa_id text not null,
  agendamento_id uuid references public.agendamentos(id) on delete cascade,
  texto text not null,
  opcoes jsonb not null default '[]'::jsonb,
  motivo text,
  status text not null default 'pendente' check (status in ('pendente', 'enviado', 'descartado', 'vencido')),
  created_at timestamptz not null default now(),
  decidido_em timestamptz
);
create index if not exists agendador_rascunhos_pend on public.agendador_rascunhos (wa_id) where status = 'pendente';
alter table public.agendador_rascunhos enable row level security;

create or replace function public.agendador_travar_v2(p_wa text, p_segundos integer default 90)
returns boolean language plpgsql security definer set search_path to 'public' as $$
declare ok boolean;
begin
  insert into agendador_travas (wa_id, ate) values (p_wa, now() + make_interval(secs => p_segundos))
  on conflict (wa_id) do update set ate = excluded.ate where agendador_travas.ate < now()
  returning true into ok;
  return coalesce(ok, false);
end $$;
revoke all on function public.agendador_travar_v2(text, integer) from public, anon, authenticated;

create or replace function public.agendador_travar(p_wa text, p_segundos integer default 90)
returns boolean language sql security definer set search_path to 'public' as $$ select false $$;

create or replace function public.agendador_varrer()
returns void language plpgsql security definer set search_path to 'public' as $$
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
    url := (s->>'sc_PROJECT_URL') || '/functions/v1/agendador/varrer',
    body := '{}'::jsonb,
    headers := jsonb_build_object('x-cron-secret', s->>'sc_CRON_SECRET', 'Content-Type', 'application/json'),
    timeout_milliseconds := 90000);
end $$;
