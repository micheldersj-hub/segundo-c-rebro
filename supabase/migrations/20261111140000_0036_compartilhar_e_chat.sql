-- 0036: compartilhar agenda e tarefas com alguém da equipe (ex.: secretária) e chat interno privado da equipe.
-- Só acréscimos: tabelas, coluna e gatilho novos. Nada existente é alterado ou apagado.

-- 1) Quem pode agir na agenda/tarefas de quem. O dono decide; o membro só lê o que recebeu.
create table if not exists public.acessos_compartilhados (
  dono uuid not null references auth.users (id) on delete cascade,
  membro uuid not null references auth.users (id) on delete cascade,
  agenda boolean not null default true,
  tarefas boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (dono, membro),
  check (dono <> membro)
);
create index if not exists acessos_compartilhados_membro_idx on public.acessos_compartilhados (membro);
alter table public.acessos_compartilhados enable row level security;   -- só as funções (service role) leem/gravam

-- 2) Histórico das tarefas com o nome de quem mexeu quando foi outra pessoa (ex.: "Ana (secretária)").
alter table public.tarefas add column if not exists ultimo_autor text;
create or replace function public.tarefa_historico_autor() returns trigger
language plpgsql security definer set search_path = public as $$
declare a text;
begin
  if new.por = 'app' then
    select ultimo_autor into a from tarefas where id = new.tarefa_id;
    if a is not null and a <> '' then new.por := a; end if;
  end if;
  return new;
end $$;
drop trigger if exists tarefa_historico_autor on public.tarefa_historico;
create trigger tarefa_historico_autor before insert on public.tarefa_historico
  for each row execute function public.tarefa_historico_autor();

-- 3) Chat interno: conversas individuais (duas pessoas) e o grupo da equipe.
create table if not exists public.chat_conversas (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('individual', 'grupo')),
  nome text,
  chave text not null unique,              -- individual: "<id menor>:<id maior>"; grupo da equipe: "equipe"
  criado_em timestamptz not null default now(),
  ultima_em timestamptz not null default now()
);
create table if not exists public.chat_participantes (
  conversa_id uuid not null references public.chat_conversas (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  lido_em timestamptz not null default now(),
  entrou_em timestamptz not null default now(),
  primary key (conversa_id, user_id)
);
create index if not exists chat_participantes_user_idx on public.chat_participantes (user_id);
create table if not exists public.chat_mensagens (
  id uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references public.chat_conversas (id) on delete cascade,
  autor uuid references auth.users (id) on delete set null,
  texto text,
  anexo_caminho text,
  anexo_nome text,
  anexo_tipo text,
  anexo_tamanho integer,
  criado_em timestamptz not null default now(),
  apagada boolean not null default false,
  check (coalesce(length(texto), 0) > 0 or anexo_caminho is not null)
);
create index if not exists chat_mensagens_conversa_idx on public.chat_mensagens (conversa_id, criado_em desc);
alter table public.chat_conversas enable row level security;
alter table public.chat_participantes enable row level security;
alter table public.chat_mensagens enable row level security;
-- Sem políticas: ninguém lê direto pelo banco. A função "chat" confere, a cada pedido, se a pessoa participa da conversa.
-- O administrador NÃO tem acesso às conversas individuais dos outros: o servidor só entrega a quem participa.

-- Mensagens não lidas por conversa (para os contadores do app e do site).
create or replace function public.chat_nao_lidas(p_user uuid)
returns table (conversa_id uuid, n bigint)
language sql stable security definer set search_path = public as $$
  select p.conversa_id, count(m.id)
  from chat_participantes p
  join chat_mensagens m on m.conversa_id = p.conversa_id and m.criado_em > p.lido_em and m.autor is distinct from p_user and not m.apagada
  where p.user_id = p_user
  group by p.conversa_id
$$;
revoke all on function public.chat_nao_lidas(uuid) from public, anon, authenticated;

-- 4) Arquivos do chat: pasta privada; o download sai por link temporário gerado pela função.
insert into storage.buckets (id, name, public, file_size_limit)
values ('chat', 'chat', false, 26214400)
on conflict (id) do nothing;
