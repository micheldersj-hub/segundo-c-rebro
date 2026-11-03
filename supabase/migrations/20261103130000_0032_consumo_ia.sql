-- 0032 — Consumo de IA (Anthropic), temporizadores das rotinas e alertas de crédito.
-- Aditiva: só cria tabelas/funções novas e um cron novo (sc-consumo). Os agendamentos existentes só mudam
-- quando o administrador escolhe outro temporizador no app (ia_aplicar_temporizador).

-- Preços de tabela em US$ por milhão de tokens (busca na web: US$ 10 por 1.000 = 0,01 cada).
create table if not exists public.ia_precos (
  modelo        text primary key,           -- prefixo do id do modelo; '*' = padrão para modelos desconhecidos
  entrada       numeric not null,
  saida         numeric not null,
  cache_escrita numeric not null,
  cache_leitura numeric not null,
  atualizado_em timestamptz not null default now()
);
insert into public.ia_precos (modelo, entrada, saida, cache_escrita, cache_leitura) values
  ('claude-sonnet-5-5', 2, 10, 2.5, 0.2),
  ('claude-haiku-4-5', 1, 5, 1.25, 0.1),
  ('*', 2, 10, 2.5, 0.2)
on conflict (modelo) do nothing;
alter table public.ia_precos enable row level security;

-- Uma linha por chamada bem-sucedida à API (gravada pelas próprias funções, com o "usage" que a Anthropic devolve).
create table if not exists public.ia_consumo (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  funcao        text not null,
  tarefa        text,
  modelo        text not null default '',
  entrada       integer not null default 0,
  saida         integer not null default 0,
  cache_escrita integer not null default 0,
  cache_leitura integer not null default 0,
  buscas        integer not null default 0,
  custo_usd     numeric(14,6) not null default 0
);
create index if not exists ia_consumo_quando_idx on public.ia_consumo (created_at desc);
alter table public.ia_consumo enable row level security;

create or replace function public.ia_custo_calc() returns trigger
language plpgsql set search_path = public as $$
declare p ia_precos;
begin
  select * into p from ia_precos where new.modelo like modelo || '%' and modelo <> '*' order by length(modelo) desc limit 1;
  if p is null then select * into p from ia_precos where modelo = '*'; end if;
  new.custo_usd := (new.entrada * p.entrada + new.saida * p.saida + new.cache_escrita * p.cache_escrita + new.cache_leitura * p.cache_leitura) / 1e6
                   + new.buscas * 0.01;
  return new;
end $$;
create or replace trigger ia_consumo_custo before insert on public.ia_consumo for each row execute function public.ia_custo_calc();

-- Qual rotina do app gerou o gasto (nome amigável no painel).
create or replace function public.ia_rotina(p_funcao text, p_tarefa text) returns text
language sql immutable as $$
  select case
    when p_funcao = 'extra' and p_tarefa = 'radar' then 'radar'
    when p_funcao = 'extra' and p_tarefa = 'conhecimento' then 'perfis'
    when p_funcao = 'extra' then 'radar'
    when p_funcao = 'worker' and p_tarefa = 'contacts-digest' then 'contatos'
    when p_funcao = 'worker' and p_tarefa = 'morning' then 'plano'
    when p_funcao = 'worker' and p_tarefa = 'evening' then 'resumo_dia'
    when p_funcao = 'worker' and p_tarefa in ('weekly', 'monthly') then 'resumos'
    when p_funcao = 'worker' and p_tarefa = 'agendador' then 'agendador'
    when p_funcao = 'worker' then 'memoria'
    when p_funcao = 'app' then 'conversa'
    when p_funcao = 'ycloud' then 'whatsapp'
    else p_funcao
  end
$$;

-- Configuração e estado dos alertas (linha única).
create table if not exists public.ia_config (
  id                 int primary key default 1 check (id = 1),
  saldo_usd          numeric,               -- saldo informado pelo dono (na recarga)
  saldo_em           timestamptz,           -- quando foi informado; o gasto conta a partir daqui
  alerta_saldo_usd   numeric not null default 5,
  alerta_dias        int not null default 5,
  alerta_dia_usd     numeric,               -- avisar se o gasto do dia passar disso (opcional)
  economia_auto      boolean not null default true,
  economia_auto_usd  numeric not null default 3,
  avisos             jsonb not null default '{}',   -- chaves dos avisos já mandados (não repetir)
  oficial_em         timestamptz,           -- última sincronização com o relatório oficial (chave de administrador)
  oficial_erro       text,
  updated_at         timestamptz not null default now()
);
insert into public.ia_config (id) values (1) on conflict (id) do nothing;
alter table public.ia_config enable row level security;

-- Custo oficial por dia (Admin API da Anthropic, opcional).
create table if not exists public.ia_oficial (
  dia           date primary key,
  custo_usd     numeric not null,
  atualizado_em timestamptz not null default now()
);
alter table public.ia_oficial enable row level security;

-- Catálogo de temporizadores. Cada opção diz o agendamento (UTC) de cada job; null = desligado.
-- "por_dia" = quantas vezes a rotina roda por dia naquela opção (usado só para estimar o gasto).
create table if not exists public.ia_temporizadores (
  rotina    text primary key,
  nome      text not null,
  descricao text not null,
  ordem     int not null,
  padrao    text not null,
  opcoes    jsonb not null
);
alter table public.ia_temporizadores enable row level security;
insert into public.ia_temporizadores (rotina, nome, descricao, ordem, padrao, opcoes) values
('radar', 'Radar da internet', 'Pesquisa os seus temas na web e monta a edição do dia. É a rotina que mais usa buscas pagas.', 1, 'seg_sab', '[
  {"id":"seg_sab","rotulo":"Segunda a sábado, 6h20","por_dia":0.857,"jobs":{"sc-radar":"20 9 * * 1-6"}},
  {"id":"uteis","rotulo":"Dias úteis, 6h20","por_dia":0.714,"jobs":{"sc-radar":"20 9 * * 1-5"}},
  {"id":"seg_qua_sex","rotulo":"Seg, qua e sex, 6h20","por_dia":0.429,"jobs":{"sc-radar":"20 9 * * 1,3,5"}},
  {"id":"semanal","rotulo":"Só às segundas, 6h20","por_dia":0.143,"jobs":{"sc-radar":"20 9 * * 1"}},
  {"id":"desligado","rotulo":"Desligado","por_dia":0,"jobs":{"sc-radar":null}}]'),
('olho', 'Olho de Deus', 'Monitora concorrentes e similares com pesquisa na web. O limite é o máximo de rodadas por dia.', 2, 'equilibrado', '[
  {"id":"completo","rotulo":"Até 24 rodadas/dia · empresa a cada 3 dias","por_dia":24,"olho":{"ativo":true,"max":24,"freq":72}},
  {"id":"equilibrado","rotulo":"Até 12 rodadas/dia · empresa 1x por semana","por_dia":12,"olho":{"ativo":true,"max":12,"freq":168}},
  {"id":"economico","rotulo":"Até 6 rodadas/dia · empresa 1x por semana","por_dia":6,"olho":{"ativo":true,"max":6,"freq":168}},
  {"id":"desligado","rotulo":"Desligado","por_dia":0,"olho":{"ativo":false}}]'),
('contatos', 'Resumo dos contatos', 'Junta as mensagens novas dos contatos no WhatsApp e te avisa quem escreveu e o que quer.', 3, '30min', '[
  {"id":"30min","rotulo":"A cada 30 min (8h às 21h)","por_dia":28,"jobs":{"sc-resumo-contatos":"*/30 0,11-23 * * *"}},
  {"id":"1h","rotulo":"A cada 1 hora (8h às 21h)","por_dia":14,"jobs":{"sc-resumo-contatos":"0 0,11-23 * * *"}},
  {"id":"2h","rotulo":"A cada 2 horas (8h às 20h)","por_dia":7,"jobs":{"sc-resumo-contatos":"0 11-23/2 * * *"}},
  {"id":"3x","rotulo":"3 vezes ao dia (9h, 14h, 19h)","por_dia":3,"jobs":{"sc-resumo-contatos":"0 12,17,22 * * *"}},
  {"id":"desligado","rotulo":"Desligado","por_dia":0,"jobs":{"sc-resumo-contatos":null}}]'),
('tarefas', 'Sugestão de tarefas', 'Lê as conversas novas e sugere tarefas. Intervalos maiores juntam mais mensagens numa leitura só.', 4, '20min', '[
  {"id":"20min","rotulo":"A cada 20 min","por_dia":72,"jobs":{"sc-tarefas-sugerir":"*/20 * * * *"}},
  {"id":"1h","rotulo":"A cada 1 hora","por_dia":24,"jobs":{"sc-tarefas-sugerir":"0 * * * *"}},
  {"id":"3h","rotulo":"A cada 3 horas","por_dia":8,"jobs":{"sc-tarefas-sugerir":"0 */3 * * *"}},
  {"id":"2x","rotulo":"2 vezes ao dia (8h e 18h)","por_dia":2,"jobs":{"sc-tarefas-sugerir":"0 11,21 * * *"}},
  {"id":"desligado","rotulo":"Desligado","por_dia":0,"jobs":{"sc-tarefas-sugerir":null}}]'),
('perfis', 'Perfis dos contatos', 'Atualiza o que o Dimy sabe de cada contato (usado pelo atendimento automático).', 5, '3min', '[
  {"id":"3min","rotulo":"A cada 3 min","por_dia":480,"jobs":{"sc-conhecimento":"*/3 * * * *"}},
  {"id":"15min","rotulo":"A cada 15 min","por_dia":96,"jobs":{"sc-conhecimento":"*/15 * * * *"}},
  {"id":"1h","rotulo":"A cada 1 hora","por_dia":24,"jobs":{"sc-conhecimento":"0 * * * *"}},
  {"id":"diario","rotulo":"1 vez ao dia (3h)","por_dia":1,"jobs":{"sc-conhecimento":"0 6 * * *"}},
  {"id":"desligado","rotulo":"Desligado","por_dia":0,"jobs":{"sc-conhecimento":null}}]'),
('plano', 'Plano da manhã', 'Monta o seu plano do dia às 7h.', 6, 'ligado', '[
  {"id":"ligado","rotulo":"Todo dia às 7h","por_dia":1,"jobs":{"sc-plano-manha":"0 10 * * *"}},
  {"id":"uteis","rotulo":"Dias úteis às 7h","por_dia":0.714,"jobs":{"sc-plano-manha":"0 10 * * 1-5"}},
  {"id":"desligado","rotulo":"Desligado","por_dia":0,"jobs":{"sc-plano-manha":null}}]'),
('resumo_dia', 'Resumo do fim do dia', 'Fecha o dia às 22h com o que aconteceu e o que ficou pendente.', 7, 'ligado', '[
  {"id":"ligado","rotulo":"Todo dia às 22h","por_dia":1,"jobs":{"sc-resumo-dia":"0 1 * * *"}},
  {"id":"uteis","rotulo":"Dias úteis às 22h","por_dia":0.714,"jobs":{"sc-resumo-dia":"0 1 * * 2-6"}},
  {"id":"desligado","rotulo":"Desligado","por_dia":0,"jobs":{"sc-resumo-dia":null}}]'),
('resumos', 'Resumos da semana e do mês', 'Balanço de domingo às 20h e do primeiro dia do mês.', 8, 'ligado', '[
  {"id":"ligado","rotulo":"Semana e mês","por_dia":0.176,"jobs":{"sc-semana":"0 23 * * 0","sc-mes":"0 11 1 * *"}},
  {"id":"mes","rotulo":"Só o do mês","por_dia":0.033,"jobs":{"sc-semana":null,"sc-mes":"0 11 1 * *"}},
  {"id":"desligado","rotulo":"Desligados","por_dia":0,"jobs":{"sc-semana":null,"sc-mes":null}}]')
on conflict (rotina) do nothing;

-- Opção em uso de cada rotina, lida dos agendamentos reais (cron) e do olho_config.
create or replace function public.ia_temporizadores_estado() returns jsonb
language plpgsql security definer set search_path = public, cron as $$
declare t record; o jsonb; atual text; ok boolean; j record; cfg record; res jsonb := '[]'::jsonb;
begin
  select ativo, max_execucoes_dia, frequencia_empresa_h into cfg from olho_config where id = 1;
  for t in select * from ia_temporizadores order by ordem loop
    atual := null;
    for o in select * from jsonb_array_elements(t.opcoes) loop
      ok := true;
      if o ? 'olho' then
        if (o->'olho'->>'ativo')::boolean then
          ok := coalesce(cfg.ativo, false) and cfg.max_execucoes_dia = (o->'olho'->>'max')::int and cfg.frequencia_empresa_h = (o->'olho'->>'freq')::int;
        else ok := not coalesce(cfg.ativo, false); end if;
      else
        for j in select key, value from jsonb_each(o->'jobs') loop
          if jsonb_typeof(j.value) = 'null' then
            ok := ok and not exists (select 1 from cron.job where jobname = j.key and active);
          else
            ok := ok and exists (select 1 from cron.job where jobname = j.key and active and schedule = j.value #>> '{}');
          end if;
        end loop;
      end if;
      if ok then atual := o->>'id'; exit; end if;
    end loop;
    res := res || jsonb_build_object('rotina', t.rotina, 'nome', t.nome, 'descricao', t.descricao, 'padrao', t.padrao,
                                     'opcoes', t.opcoes, 'atual', coalesce(atual, 'personalizado'));
  end loop;
  return res;
end $$;

create or replace function public.ia_aplicar_temporizador(p_rotina text, p_opcao text) returns void
language plpgsql security definer set search_path = public, cron as $$
declare o jsonb; j record; jid bigint;
begin
  select x.value into o from ia_temporizadores t, jsonb_array_elements(t.opcoes) x where t.rotina = p_rotina and x.value->>'id' = p_opcao;
  if o is null then raise exception 'opção inválida: %/%', p_rotina, p_opcao; end if;
  if o ? 'olho' then
    if (o->'olho'->>'ativo')::boolean then
      update olho_config set ativo = true, max_execucoes_dia = (o->'olho'->>'max')::int, frequencia_empresa_h = (o->'olho'->>'freq')::int, updated_at = now() where id = 1;
    else
      update olho_config set ativo = false, updated_at = now() where id = 1;
    end if;
    return;
  end if;
  for j in select key, value from jsonb_each(o->'jobs') loop
    select jobid into jid from cron.job where jobname = j.key;
    if jid is null then raise exception 'agendamento não encontrado: %', j.key; end if;
    if jsonb_typeof(j.value) = 'null' then
      perform cron.alter_job(jid, active := false);
    else
      perform cron.alter_job(jid, schedule := j.value #>> '{}', active := true);
    end if;
  end loop;
end $$;

-- Números do painel (dias no fuso de São Paulo).
create or replace function public.ia_painel_dados() returns jsonb
language sql security definer set search_path = public as $$
  with c as (select *, (created_at at time zone 'America/Sao_Paulo')::date dia, ia_rotina(funcao, tarefa) rotina
             from ia_consumo where created_at > now() - interval '31 days'),
  hoje as (select (now() at time zone 'America/Sao_Paulo')::date d),
  cfg as (select * from ia_config where id = 1)
  select jsonb_build_object(
    'primeiro', (select min(created_at) from ia_consumo),
    'hoje', (select jsonb_build_object('usd', coalesce(sum(custo_usd), 0), 'chamadas', count(*), 'buscas', coalesce(sum(buscas), 0)) from c, hoje where c.dia = hoje.d),
    'd7', (select jsonb_build_object('usd', coalesce(sum(custo_usd), 0), 'chamadas', count(*), 'buscas', coalesce(sum(buscas), 0)) from c where created_at > now() - interval '7 days'),
    'd30', (select jsonb_build_object('usd', coalesce(sum(custo_usd), 0), 'chamadas', count(*), 'buscas', coalesce(sum(buscas), 0),
                                      'entrada', coalesce(sum(entrada + cache_escrita + cache_leitura), 0), 'saida', coalesce(sum(saida), 0)) from c where created_at > now() - interval '30 days'),
    'h24', (select coalesce(sum(custo_usd), 0) from c where created_at > now() - interval '24 hours'),
    'desde_saldo', (select coalesce(sum(custo_usd), 0) from ia_consumo, cfg where cfg.saldo_em is not null and ia_consumo.created_at >= cfg.saldo_em),
    'por_dia', (select coalesce(jsonb_agg(jsonb_build_object('dia', g.d, 'usd', coalesce(x.usd, 0), 'chamadas', coalesce(x.n, 0), 'oficial', o.custo_usd) order by g.d), '[]')
                from hoje, generate_series(hoje.d - 29, hoje.d, interval '1 day') g0(dd)
                cross join lateral (select g0.dd::date d) g
                left join (select dia, sum(custo_usd) usd, count(*) n from c group by dia) x on x.dia = g.d
                left join ia_oficial o on o.dia = g.d),
    'por_rotina', (select coalesce(jsonb_agg(r order by r.usd7 desc), '[]') from (
                    select rotina, sum(custo_usd) filter (where created_at > now() - interval '7 days') usd7,
                           sum(custo_usd) usd30, count(*) filter (where created_at > now() - interval '7 days') chamadas7,
                           coalesce(sum(buscas) filter (where created_at > now() - interval '7 days'), 0) buscas7,
                           min(created_at) primeiro
                    from c group by rotina) r),
    'por_modelo', (select coalesce(jsonb_agg(m order by m.usd desc), '[]') from (
                    select case when modelo like 'claude-haiku%' then 'Haiku' when modelo like 'claude-sonnet%' then 'Sonnet' else modelo end modelo,
                           sum(custo_usd) usd, count(*) chamadas from c where created_at > now() - interval '30 days' group by 1) m),
    'oficial_30d', (select sum(custo_usd) from ia_oficial, hoje where dia > hoje.d - 30),
    'precos', (select jsonb_agg(to_jsonb(p) - 'atualizado_em') from ia_precos p where modelo <> '*')
  )
$$;

-- Sinais de crédito esgotado nas últimas horas (memória, Radar, Olho).
create or replace function public.ia_sinais_sem_credito(p_desde timestamptz) returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'memoria', (select count(*) from raw_events where error ilike '%credit balance%' and created_at > p_desde),
    'radar', (select count(*) from radar_edicoes where erro ilike '%credit balance%' and created_at > p_desde),
    'olho', (select count(*) from olho_execucoes where erro ilike '%credit balance%' and created_at > p_desde),
    'ultimo_sucesso', (select max(created_at) from ia_consumo)
  )
$$;

revoke all on function public.ia_temporizadores_estado() from public, anon, authenticated;
revoke all on function public.ia_aplicar_temporizador(text, text) from public, anon, authenticated;
revoke all on function public.ia_painel_dados() from public, anon, authenticated;
revoke all on function public.ia_sinais_sem_credito(timestamptz) from public, anon, authenticated;
grant execute on function public.ia_temporizadores_estado() to service_role;
grant execute on function public.ia_aplicar_temporizador(text, text) to service_role;
grant execute on function public.ia_painel_dados() to service_role;
grant execute on function public.ia_sinais_sem_credito(timestamptz) to service_role;

-- Verificação de consumo e alertas a cada 30 min (função "consumo", sem IA).
create or replace function public.ia_verificar() returns void
language plpgsql security definer set search_path = public as $$
declare s jsonb;
begin
  s := get_app_secrets();
  perform net.http_post(url := (s->>'sc_PROJECT_URL') || '/functions/v1/consumo/verificar',
    headers := jsonb_build_object('x-cron-secret', s->>'sc_CRON_SECRET', 'Content-Type', 'application/json'),
    body := '{}'::jsonb, timeout_milliseconds := 15000);
end $$;
revoke all on function public.ia_verificar() from public, anon, authenticated;
-- agendado depois do deploy da função (ver cron.sql): select cron.schedule('sc-consumo', '7,37 * * * *', 'select public.ia_verificar()');
