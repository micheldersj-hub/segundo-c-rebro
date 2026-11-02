-- Migração bot_contatos (aplicada em 2026-10-05).
-- Exportada do histórico de migrações do Supabase.

set search_path = public, extensions;

alter table raw_events drop constraint if exists raw_events_source_check;
alter table raw_events add constraint raw_events_source_check
  check (source in ('whatsapp','whatsapp_contato','gmail','calendar','instagram','manual'));

create table if not exists contacts (
  wa_id          text primary key,
  name           text,
  muted          boolean not null default false,
  message_count  int not null default 0,
  first_seen     timestamptz not null default now(),
  last_seen      timestamptz not null default now()
);

create index if not exists raw_events_contact_pending_idx
  on raw_events (created_at)
  where source = 'whatsapp_contato' and (metadata->>'notified') is distinct from 'true';

create table if not exists reminders (
  id          uuid primary key default gen_random_uuid(),
  text        text not null,
  due_at      timestamptz not null,
  sent_at     timestamptz,
  canceled    boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists reminders_due_idx on reminders (due_at) where sent_at is null and not canceled;

alter table contacts  enable row level security;
alter table reminders enable row level security;

create or replace function touch_contact(p_wa_id text, p_name text)
returns void language sql
set search_path = public, extensions
as $$
  insert into contacts (wa_id, name, message_count)
  values (p_wa_id, nullif(p_name, ''), 1)
  on conflict (wa_id) do update
     set name = coalesce(nullif(excluded.name, ''), contacts.name),
         message_count = contacts.message_count + 1,
         last_seen = now();
$$;
revoke execute on function touch_contact(text, text) from public, anon, authenticated;
grant  execute on function touch_contact(text, text) to service_role;
