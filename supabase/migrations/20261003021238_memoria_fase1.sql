-- Migração memoria_fase1 (aplicada em 2026-10-03).
-- Exportada do histórico de migrações do Supabase.

create extension if not exists vector with schema extensions;
set search_path = public, extensions;

create table if not exists raw_events (
  id           uuid primary key default gen_random_uuid(),
  source       text not null check (source in ('whatsapp','gmail','calendar','instagram','manual')),
  external_id  text,
  content      text not null,
  is_audio     boolean not null default false,
  metadata     jsonb not null default '{}'::jsonb,
  occurred_at  timestamptz not null default now(),
  processed    boolean not null default false,
  processed_at timestamptz,
  error        text,
  created_at   timestamptz not null default now(),
  unique (source, external_id)
);
create index if not exists raw_events_pending_idx on raw_events (processed, occurred_at);

create table if not exists episodes (
  id           uuid primary key default gen_random_uuid(),
  raw_event_id uuid references raw_events(id) on delete cascade,
  summary      text not null,
  area         text not null check (area in ('trabalho','familia','saude','estudo','financas','pessoal','outro')),
  mood         text,
  people       text[] not null default '{}',
  embedding    vector(1024),
  occurred_at  timestamptz not null,
  created_at   timestamptz not null default now()
);
create index if not exists episodes_occurred_idx on episodes (occurred_at desc);
create index if not exists episodes_raw_event_idx on episodes (raw_event_id);
create index if not exists episodes_embedding_idx on episodes using hnsw (embedding vector_cosine_ops);

create table if not exists entities (
  id          uuid primary key default gen_random_uuid(),
  type        text not null check (type in ('pessoa','empresa','projeto','lugar','outro')),
  name        text not null,
  aliases     text[] not null default '{}',
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (type, name)
);

create table if not exists facts (
  id                 uuid primary key default gen_random_uuid(),
  subject_entity_id  uuid references entities(id) on delete set null,
  statement          text not null,
  category           text not null check (category in ('trabalho','familia','saude','estudo','financas','habilidade','dificuldade','meta','preferencia','rotina','outro')),
  confidence         real not null default 0.6 check (confidence between 0 and 1),
  reinforcements     int  not null default 1,
  source_episode_ids uuid[] not null default '{}',
  status             text not null default 'ativo' check (status in ('ativo','substituido','rejeitado','arquivado')),
  valid_from         timestamptz not null default now(),
  valid_to           timestamptz,
  embedding          vector(1024),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists facts_status_idx on facts (status);
create index if not exists facts_subject_idx on facts (subject_entity_id);
create index if not exists facts_embedding_idx on facts using hnsw (embedding vector_cosine_ops);

create or replace function match_episodes(query_embedding vector(1024), match_count int default 10, since timestamptz default null)
returns table (id uuid, summary text, area text, people text[], occurred_at timestamptz, similarity float)
language sql stable
set search_path = public, extensions
as $$
  select e.id, e.summary, e.area, e.people, e.occurred_at,
         1 - (e.embedding <=> query_embedding) as similarity
  from episodes e
  where e.embedding is not null
    and (since is null or e.occurred_at >= since)
  order by e.embedding <=> query_embedding
  limit match_count;
$$;

create or replace function match_facts(query_embedding vector(1024), match_count int default 20, min_confidence real default 0.3)
returns table (id uuid, statement text, category text, confidence real, similarity float)
language sql stable
set search_path = public, extensions
as $$
  select f.id, f.statement, f.category, f.confidence,
         1 - (f.embedding <=> query_embedding) as similarity
  from facts f
  where f.status = 'ativo'
    and f.embedding is not null
    and f.confidence >= min_confidence
  order by f.embedding <=> query_embedding
  limit match_count;
$$;

create or replace function reinforce_fact(fact_id uuid, episode_id uuid)
returns void language sql
set search_path = public, extensions
as $$
  update facts
     set reinforcements = reinforcements + 1,
         confidence = least(1, confidence + 0.1),
         source_episode_ids = array_append(source_episode_ids, episode_id),
         updated_at = now()
   where id = fact_id;
$$;

alter table raw_events enable row level security;
alter table episodes   enable row level security;
alter table entities   enable row level security;
alter table facts      enable row level security;

revoke execute on function match_episodes(vector, int, timestamptz) from public, anon, authenticated;
revoke execute on function match_facts(vector, int, real) from public, anon, authenticated;
revoke execute on function reinforce_fact(uuid, uuid) from public, anon, authenticated;
grant execute on function match_episodes(vector, int, timestamptz) to service_role;
grant execute on function match_facts(vector, int, real) to service_role;
grant execute on function reinforce_fact(uuid, uuid) to service_role;
