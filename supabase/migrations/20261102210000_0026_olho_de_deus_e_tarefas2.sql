-- 0026: Tarefas 2.0 (projetos, prazo, recorrência, subtarefas, histórico, lixeira, sugestões)
--       + Olho de Deus (inteligência de mercado). Só acréscimos: nada existente é removido ou alterado de forma incompatível.

-- ===================================================================== TAREFAS 2.0
alter table public.tarefas
  add column if not exists projeto text,
  add column if not exists area text,
  add column if not exists prazo date,
  add column if not exists recorrencia text check (recorrencia in ('diaria', 'dias_uteis', 'semanal', 'mensal')),
  add column if not exists recorrencia_ate date,
  add column if not exists recorrencia_origem uuid,
  add column if not exists contato_wa text,
  add column if not exists empresa text,
  add column if not exists oportunidade text,
  add column if not exists origem text not null default 'manual',
  add column if not exists arquivada_em timestamptz;
create index if not exists tarefas_user_projeto on public.tarefas (user_id, projeto) where not arquivada;
create index if not exists tarefas_user_prazo on public.tarefas (user_id, prazo) where not arquivada and etapa <> 'feito';

create table if not exists public.tarefa_subtarefas (
  id uuid primary key default gen_random_uuid(),
  tarefa_id uuid not null references public.tarefas(id) on delete cascade,
  titulo text not null check (length(titulo) between 1 and 200),
  feita boolean not null default false,
  ordem double precision not null default extract(epoch from now()),
  created_at timestamptz not null default now()
);
create index if not exists tarefa_subtarefas_tarefa on public.tarefa_subtarefas (tarefa_id);

create table if not exists public.tarefa_historico (
  id bigint generated always as identity primary key,
  tarefa_id uuid not null references public.tarefas(id) on delete cascade,
  acao text not null,              -- criada, etapa, dia, prazo, editada, nota, subtarefa, arquivada, restaurada, recorrencia
  detalhe text,
  por text not null default 'app', -- app, voz, sugestao, olho, sistema
  created_at timestamptz not null default now()
);
create index if not exists tarefa_historico_tarefa on public.tarefa_historico (tarefa_id, created_at desc);

-- Sugestões de tarefa (vindas de conversas ou do Olho de Deus). Nunca viram tarefa sem o "aceitar" do usuário.
create table if not exists public.tarefa_sugestoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  titulo text not null,
  notas text,
  dia date,
  prazo date,
  prioridade smallint not null default 2,
  projeto text,
  empresa text,
  contato_wa text,
  origem text not null check (origem in ('conversa', 'olho')),
  origem_ref text,                 -- id do raw_event ou do movimento do Olho
  motivo text,
  criterios jsonb not null default '{}'::jsonb,
  status text not null default 'pendente' check (status in ('pendente', 'aceita', 'descartada', 'vencida')),
  tarefa_id uuid,
  chave text not null,             -- texto normalizado, para evitar duplicidade
  created_at timestamptz not null default now(),
  decidido_em timestamptz
);
create index if not exists tarefa_sugestoes_pend on public.tarefa_sugestoes (user_id, status, created_at desc);
create unique index if not exists tarefa_sugestoes_ref on public.tarefa_sugestoes (user_id, origem, origem_ref, chave);

-- Estado da rotina que lê as conversas (ponto de leitura).
create table if not exists public.tarefa_sugestor_estado (
  id int primary key default 1 check (id = 1),
  ultimo_evento timestamptz not null default now(),
  ultima_execucao timestamptz,
  ultimo_resultado text
);
insert into public.tarefa_sugestor_estado (id) values (1) on conflict do nothing;

-- ===================================================================== OLHO DE DEUS
create table if not exists public.olho_config (
  id int primary key default 1 check (id = 1),
  ativo boolean not null default true,
  meu_negocio text not null default '',
  segmentos text[] not null default array['meios de pagamento','maquininhas de cartão','subadquirência','fintech','BaaS','white label','ERP e gestão','PDV e NFC-e','TEF','split de pagamentos','gestão financeira','eventos e estabelecimentos'],
  temas_alerta text[] not null default '{}',
  nivel_minimo_alerta text not null default 'medio' check (nivel_minimo_alerta in ('critico','alto','medio','baixo')),
  nivel_push text not null default 'alto' check (nivel_push in ('critico','alto','medio','baixo')),
  max_execucoes_dia int not null default 36 check (max_execucoes_dia between 1 and 200),
  frequencia_empresa_h int not null default 72 check (frequencia_empresa_h between 12 and 720),
  updated_at timestamptz not null default now()
);
insert into public.olho_config (id, meu_negocio) values (1,
'B2B PAY Consultoria em Pagamentos (Belo Horizonte/MG), representada por Michelder. Oferece: maquininhas de cartão, split de pagamentos na origem ("split puro" — o valor de cada venda é dividido entre os recebedores no momento do pagamento), conta digital/BaaS, Pix e boleto, com foco em empresas do Simples Nacional que faturam de R$ 30 mil a R$ 120 mil por mês no cartão (padarias, restaurantes, clínicas, salões, academias, comércio). Também trabalha com white label de meios de pagamento (marca Rede Payments, via DiviPay).')
on conflict do nothing;

create table if not exists public.olho_empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  slug text not null unique,
  site text,
  redes jsonb not null default '{}'::jsonb,
  categoria text not null default 'candidata' check (categoria in ('concorrente','similar','candidata','descartada')),
  segmentos text[] not null default '{}',
  ativo boolean not null default true,
  silenciada boolean not null default false,  -- monitora, mas não gera alerta
  frequencia_h int,                            -- null = padrão da config
  proxima_em timestamptz not null default now(),
  ultima_em timestamptz,
  perfil jsonb not null default '{}'::jsonb,   -- os 14 itens acompanhados
  classificacoes jsonb not null default '[]'::jsonb, -- [{rotulo, confianca, evidencias:[{afirmacao,fonte,url,data}], conclusao, a_investigar}]
  resumo text,
  nivel_ameaca text check (nivel_ameaca in ('critico','alto','medio','baixo')),
  site_hash text,
  site_verificado_em timestamptz,
  origem text not null default 'descoberta',
  motivo_inclusao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists olho_empresas_cat on public.olho_empresas (categoria, ativo);

create table if not exists public.olho_execucoes (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('empresa','setor','regulatorio','descoberta')),
  empresa_id uuid references public.olho_empresas(id) on delete set null,
  status text not null default 'fila' check (status in ('fila','rodando','ok','erro','pulada')),
  tentativas int not null default 0,
  pedido_por text not null default 'agenda',  -- agenda, usuario
  iniciado_em timestamptz,
  terminado_em timestamptz,
  fontes int not null default 0,
  novidades int not null default 0,
  resumo text,
  erro text,
  created_at timestamptz not null default now()
);
create index if not exists olho_execucoes_status on public.olho_execucoes (status, created_at);
create unique index if not exists olho_execucoes_uma_aberta on public.olho_execucoes (tipo, coalesce(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status in ('fila','rodando');

create table if not exists public.olho_snapshots (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references public.olho_empresas(id) on delete cascade,
  execucao_id uuid references public.olho_execucoes(id) on delete set null,
  perfil jsonb not null,
  mudancas jsonb not null default '[]'::jsonb, -- [{campo, antes, depois}]
  created_at timestamptz not null default now()
);
create index if not exists olho_snapshots_emp on public.olho_snapshots (empresa_id, created_at desc);

create table if not exists public.olho_movimentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.olho_empresas(id) on delete set null,
  execucao_id uuid references public.olho_execucoes(id) on delete set null,
  tipo text not null,          -- produto, preco_taxa, parceria, expansao, campanha, estrategia, regulatorio, mercado, infraestrutura, oportunidade
  titulo text not null,
  resumo text,
  data_evento date,
  fonte text,
  url text,
  segmentos text[] not null default '{}',
  relevancia text not null default 'baixo' check (relevancia in ('critico','alto','medio','baixo')),
  ameaca boolean not null default false,
  oportunidade boolean not null default false,
  analise jsonb not null default '{}'::jsonb,
  hash text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists olho_movimentos_data on public.olho_movimentos (created_at desc);
create index if not exists olho_movimentos_emp on public.olho_movimentos (empresa_id, created_at desc);

create table if not exists public.olho_alertas (
  id uuid primary key default gen_random_uuid(),
  movimento_id uuid not null unique references public.olho_movimentos(id) on delete cascade,
  nivel text not null check (nivel in ('critico','alto','medio','baixo')),
  titulo text not null,
  empresa text,
  quando date,
  fonte text,
  url text,
  porque text,
  impacto text,
  acao text,
  lido_em timestamptz,
  notificado boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists olho_alertas_nivel on public.olho_alertas (nivel, created_at desc);

-- RLS ligado e sem políticas: só as funções (service_role) acessam.
alter table public.tarefa_subtarefas enable row level security;
alter table public.tarefa_historico enable row level security;
alter table public.tarefa_sugestoes enable row level security;
alter table public.tarefa_sugestor_estado enable row level security;
alter table public.olho_config enable row level security;
alter table public.olho_empresas enable row level security;
alter table public.olho_execucoes enable row level security;
alter table public.olho_snapshots enable row level security;
alter table public.olho_movimentos enable row level security;
alter table public.olho_alertas enable row level security;

-- Pega a próxima execução da fila sem corrida entre chamadas simultâneas.
create or replace function public.olho_pegar_execucao() returns setof public.olho_execucoes
language sql security definer set search_path = public as $$
  update olho_execucoes e set status = 'rodando', iniciado_em = now(), tentativas = e.tentativas + 1
  where e.id = (select id from olho_execucoes where status = 'fila' order by (pedido_por = 'usuario') desc, created_at limit 1 for update skip locked)
  returning e.*;
$$;
revoke all on function public.olho_pegar_execucao() from public, anon, authenticated;

-- Cron: chama o ciclo do Olho (a função decide o que agendar e roda um item da fila).
create or replace function public.olho_ciclo() returns void
language plpgsql security definer set search_path = public as $$
declare s jsonb;
begin
  if not coalesce((select ativo from olho_config where id = 1), false) then return; end if;
  s := get_app_secrets();
  perform net.http_post(
    url := (s->>'sc_PROJECT_URL') || '/functions/v1/olho/ciclo',
    body := '{}'::jsonb,
    headers := jsonb_build_object('x-cron-secret', s->>'sc_CRON_SECRET', 'Content-Type', 'application/json'),
    timeout_milliseconds := 15000);
end $$;
revoke all on function public.olho_ciclo() from public, anon, authenticated;

-- Cron: rotina que sugere tarefas a partir das conversas.
create or replace function public.tarefas_sugerir() returns void
language plpgsql security definer set search_path = public as $$
declare s jsonb;
begin
  if not exists (select 1 from raw_events where source in ('app','whatsapp_eu','gravacao')
                 and created_at > (select ultimo_evento from tarefa_sugestor_estado where id = 1)) then return; end if;
  s := get_app_secrets();
  perform net.http_post(
    url := (s->>'sc_PROJECT_URL') || '/functions/v1/tarefas/sugerir',
    body := '{}'::jsonb,
    headers := jsonb_build_object('x-cron-secret', s->>'sc_CRON_SECRET', 'Content-Type', 'application/json'),
    timeout_milliseconds := 15000);
end $$;
revoke all on function public.tarefas_sugerir() from public, anon, authenticated;

-- agendado na 0028 (depois do deploy): select cron.schedule('sc-olho', '*/10 * * * *', 'select public.olho_ciclo()');
-- agendado na 0028: select cron.schedule('sc-tarefas-sugerir', '*/20 * * * *', 'select public.tarefas_sugerir()');
