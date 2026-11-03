-- 0034 — Agenda a verificação de consumo (sc-consumo) e ignora linhas de diagnóstico no painel.
create or replace function public.ia_funcoes_medidas() returns text[]
language sql security definer set search_path = public as $$
  select coalesce(array_agg(distinct funcao), '{}') from ia_consumo where funcao <> 'diagnostico'
$$;
create or replace view public.ia_consumo_valido with (security_invoker = true) as
  select * from public.ia_consumo where funcao <> 'diagnostico';
revoke all on public.ia_consumo_valido from public, anon, authenticated;
create or replace function public.ia_medido_entre(p_de timestamptz, p_ate timestamptz) returns numeric
language sql security definer set search_path = public as $$
  select coalesce(sum(custo_usd), 0) from ia_consumo_valido where created_at >= p_de and created_at < p_ate
$$;
create or replace function public.ia_painel_dados() returns jsonb
language sql security definer set search_path = public as $$
  with c as (select *, (created_at at time zone 'America/Sao_Paulo')::date dia, ia_rotina(funcao, tarefa) rotina
             from ia_consumo_valido where created_at > now() - interval '31 days'),
  hoje as (select (now() at time zone 'America/Sao_Paulo')::date d),
  cfg as (select * from ia_config where id = 1)
  select jsonb_build_object(
    'primeiro', (select min(created_at) from ia_consumo_valido),
    'hoje', (select jsonb_build_object('usd', coalesce(sum(custo_usd), 0), 'chamadas', count(*), 'buscas', coalesce(sum(buscas), 0)) from c, hoje where c.dia = hoje.d),
    'd7', (select jsonb_build_object('usd', coalesce(sum(custo_usd), 0), 'chamadas', count(*), 'buscas', coalesce(sum(buscas), 0)) from c where created_at > now() - interval '7 days'),
    'd30', (select jsonb_build_object('usd', coalesce(sum(custo_usd), 0), 'chamadas', count(*), 'buscas', coalesce(sum(buscas), 0),
                                      'entrada', coalesce(sum(entrada + cache_escrita + cache_leitura), 0), 'saida', coalesce(sum(saida), 0)) from c where created_at > now() - interval '30 days'),
    'h24', (select coalesce(sum(custo_usd), 0) from c where created_at > now() - interval '24 hours'),
    'desde_saldo', (select coalesce(sum(custo_usd), 0) from ia_consumo_valido v, cfg where cfg.saldo_em is not null and v.created_at >= cfg.saldo_em),
    'por_dia', (select coalesce(jsonb_agg(jsonb_build_object('dia', g.d, 'usd', coalesce(x.usd, 0), 'chamadas', coalesce(x.n, 0), 'oficial', o.custo_usd) order by g.d), '[]')
                from hoje, generate_series(hoje.d - 29, hoje.d, interval '1 day') g0(dd)
                cross join lateral (select g0.dd::date d) g
                left join (select dia, sum(custo_usd) usd, count(*) n from c group by dia) x on x.dia = g.d
                left join ia_oficial o on o.dia = g.d),
    'por_rotina', (select coalesce(jsonb_agg(r order by r.usd7 desc nulls last), '[]') from (
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
select cron.schedule('sc-consumo', '7,37 * * * *', 'select public.ia_verificar()');
