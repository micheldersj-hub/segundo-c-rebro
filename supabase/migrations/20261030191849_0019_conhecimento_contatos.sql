-- Migração 0019_conhecimento_contatos (aplicada em 2026-10-30).
-- Exportada do histórico de migrações do Supabase.

create table if not exists public.contato_perfil (
  wa_id text primary key,
  nome text, empresa text,
  relacao text,
  resumo text,
  temas text[] not null default '{}',
  pendencias text[] not null default '{}',
  tom text,
  msgs_analisadas int not null default 0,
  ultima_msg timestamptz,
  atualizado_em timestamptz not null default now()
);
alter table public.contato_perfil enable row level security;
create table if not exists public.conhecimento_geral (
  chave text primary key,
  valor text not null,
  atualizado_em timestamptz not null default now()
);
alter table public.conhecimento_geral enable row level security;

-- Contatos com conversa suficiente e perfil ausente ou desatualizado (mensagem nova depois do último perfil).
create or replace function public.contatos_para_perfil(p_limite int default 15)
returns table(wa_id text, total bigint, ultima timestamptz)
language sql security definer set search_path = public as $$
  select m.wa_id, count(*) total, max(m.occurred_at) ultima
  from wa_messages m
  left join contato_perfil p on p.wa_id = m.wa_id
  where m.occurred_at > '2005-01-01'
  group by m.wa_id, p.ultima_msg, p.atualizado_em
  having count(*) >= 3 and (max(p.ultima_msg) is null or (max(m.occurred_at) > max(p.ultima_msg) and max(p.atualizado_em) < now() - interval '30 minutes'))
  order by max(m.occurred_at) desc
  limit p_limite;
$$;
revoke all on function public.contatos_para_perfil(int) from public, anon, authenticated;
grant execute on function public.contatos_para_perfil(int) to service_role;

insert into storage.buckets (id, name, public) values ('exportes', 'exportes', false) on conflict (id) do nothing;
