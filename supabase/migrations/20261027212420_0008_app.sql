-- Migração 0008_app (aplicada em 2026-10-27).
-- Exportada do histórico de migrações do Supabase.

set search_path = public, extensions;

alter table raw_events drop constraint if exists raw_events_source_check;
alter table raw_events add constraint raw_events_source_check
  check (source in ('whatsapp','whatsapp_contato','whatsapp_eu','app','gmail','calendar','instagram','manual'));

create table if not exists wa_messages (
  id           text primary key,
  wa_id        text not null,
  direction    text not null check (direction in ('in','out')),
  type         text not null,
  body         text,
  occurred_at  timestamptz not null,
  from_history boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists wa_messages_contact_idx on wa_messages (wa_id, occurred_at desc);
alter table wa_messages enable row level security;

alter table contacts add column if not exists last_in_at      timestamptz;
alter table contacts add column if not exists last_out_at     timestamptz;
alter table contacts add column if not exists awaiting_reply  boolean not null default false;
alter table contacts add column if not exists last_summary    text;
create index if not exists contacts_awaiting_idx on contacts (last_in_at desc) where awaiting_reply;

create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,
  title       text not null,
  body        text not null,
  data        jsonb not null default '{}',
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_recent_idx on notifications (created_at desc);
alter table notifications enable row level security;

create table if not exists push_subscriptions (
  endpoint    text primary key,
  keys        jsonb not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz
);
alter table push_subscriptions enable row level security;

create or replace function record_wa_message(
  p_id text, p_wa_id text, p_direction text, p_type text, p_body text,
  p_at timestamptz, p_name text default null, p_history boolean default false
) returns boolean language plpgsql
set search_path = public, extensions
as $$
declare inserted boolean;
begin
  insert into wa_messages (id, wa_id, direction, type, body, occurred_at, from_history)
  values (p_id, p_wa_id, p_direction, p_type, p_body, p_at, p_history)
  on conflict (id) do nothing;
  inserted := found;
  if not inserted then return false; end if;

  insert into contacts (wa_id, name, message_count, first_seen, last_seen)
  values (p_wa_id, nullif(p_name, ''), 0, p_at, p_at)
  on conflict (wa_id) do nothing;

  if p_direction = 'in' then
    update contacts
       set name = coalesce(nullif(p_name, ''), name),
           message_count = message_count + 1,
           last_seen = greatest(last_seen, p_at),
           last_in_at = greatest(coalesce(last_in_at, p_at), p_at),
           awaiting_reply = case when last_out_at is null or p_at > last_out_at then true else awaiting_reply end
     where wa_id = p_wa_id;
  else
    update contacts
       set last_seen = greatest(last_seen, p_at),
           last_out_at = greatest(coalesce(last_out_at, p_at), p_at),
           awaiting_reply = case when last_in_at is null or p_at >= last_in_at then false else awaiting_reply end
     where wa_id = p_wa_id;
  end if;
  return true;
end $$;
revoke execute on function record_wa_message(text,text,text,text,text,timestamptz,text,boolean) from public, anon, authenticated;
grant  execute on function record_wa_message(text,text,text,text,text,timestamptz,text,boolean) to service_role;
