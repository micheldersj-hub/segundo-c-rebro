-- 0027: execuções do Olho de Deus em etapas (cada chamada do cron avança uma etapa; trava com prazo e recuperação).
alter table public.olho_execucoes
  add column if not exists passo text not null default 'inicio',
  add column if not exists dados jsonb not null default '{}'::jsonb,
  add column if not exists trabalhando_ate timestamptz;

create or replace function public.olho_pegar_execucao() returns setof public.olho_execucoes
language sql security definer set search_path = public as $$
  update olho_execucoes e set status = 'rodando', iniciado_em = coalesce(e.iniciado_em, now()),
         trabalhando_ate = now() + interval '5 minutes', tentativas = e.tentativas + 1
  where e.id = (select id from olho_execucoes
                where status in ('fila', 'rodando') and (trabalhando_ate is null or trabalhando_ate < now())
                order by (status = 'rodando') desc, (pedido_por = 'usuario') desc, created_at
                limit 1 for update skip locked)
  returning e.*;
$$;
revoke all on function public.olho_pegar_execucao() from public, anon, authenticated;
