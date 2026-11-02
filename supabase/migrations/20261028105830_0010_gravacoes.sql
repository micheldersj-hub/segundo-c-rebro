-- Migração 0010_gravacoes (aplicada em 2026-10-28).
-- Exportada do histórico de migrações do Supabase.

set search_path = public, extensions;

alter table raw_events drop constraint if exists raw_events_source_check;
alter table raw_events add constraint raw_events_source_check
  check (source in ('whatsapp','whatsapp_contato','whatsapp_eu','app','gravacao','gmail','calendar','instagram','manual'));

create table if not exists recordings (
  id             uuid primary key default gen_random_uuid(),
  title          text,
  kind           text not null default 'reuniao' check (kind in ('reuniao','ligacao','nota')),
  status         text not null default 'gravando' check (status in ('gravando','processando','resumindo','pronta','erro')),
  template       text not null default 'ata',
  instruction    text,
  started_at     timestamptz not null default now(),
  ended_at       timestamptz,
  duration_s     integer,
  parts_expected integer,
  speakers       jsonb not null default '{}'::jsonb,
  transcript     jsonb,
  summary        jsonb,
  error          text,
  attempts       integer not null default 0,
  raw_event_id   uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists recordings_started_idx on recordings (started_at desc);
create index if not exists recordings_status_idx on recordings (status);

create table if not exists recording_parts (
  id            uuid primary key default gen_random_uuid(),
  recording_id  uuid not null references recordings(id) on delete cascade,
  idx           integer not null,
  path          text not null,
  mime          text,
  bytes         integer,
  offset_s      real not null default 0,
  duration_s    real,
  status        text not null default 'pendente' check (status in ('pendente','transcrevendo','transcrita','erro')),
  segments      jsonb,
  model         text,
  error         text,
  attempts      integer not null default 0,
  claimed_at    timestamptz,
  created_at    timestamptz not null default now(),
  unique (recording_id, idx)
);
create index if not exists recording_parts_status_idx on recording_parts (status);

create table if not exists recording_attachments (
  id            uuid primary key default gen_random_uuid(),
  recording_id  uuid not null references recordings(id) on delete cascade,
  kind          text not null check (kind in ('foto','nota','destaque')),
  at_s          real,
  path          text,
  mime          text,
  text          text,
  description   text,
  created_at    timestamptz not null default now()
);
create index if not exists recording_attachments_rec_idx on recording_attachments (recording_id);

create table if not exists recording_chunks (
  id            uuid primary key default gen_random_uuid(),
  recording_id  uuid not null references recordings(id) on delete cascade,
  idx           integer not null,
  start_s       real,
  content       text not null,
  embedding     vector(1024)
);
create index if not exists recording_chunks_rec_idx on recording_chunks (recording_id);
create index if not exists recording_chunks_embedding_idx on recording_chunks using hnsw (embedding vector_cosine_ops);

alter table recordings enable row level security;
alter table recording_parts enable row level security;
alter table recording_attachments enable row level security;
alter table recording_chunks enable row level security;

create or replace function match_recording_chunks(query_embedding vector(1024), match_count int default 12, only_recording uuid default null)
returns table (recording_id uuid, title text, started_at timestamptz, start_s real, content text, similarity float)
language sql stable
set search_path = public, extensions
as $$
  select c.recording_id, r.title, r.started_at, c.start_s, c.content,
         1 - (c.embedding <=> query_embedding) as similarity
  from recording_chunks c
  join recordings r on r.id = c.recording_id
  where c.embedding is not null
    and (only_recording is null or c.recording_id = only_recording)
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
revoke execute on function match_recording_chunks(vector, int, uuid) from public, anon, authenticated;
grant execute on function match_recording_chunks(vector, int, uuid) to service_role;

insert into storage.buckets (id, name, public, file_size_limit)
values ('gravacoes', 'gravacoes', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = 26214400;

select cron.schedule('sc-gravacoes', '* * * * *', $$select public.invoke_worker('recordings')$$);
