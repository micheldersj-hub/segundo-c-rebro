-- 0033 — Calibração do consumo: fator entre o gasto real (relatório oficial ou saldo conferido) e o gasto medido.
alter table public.ia_config add column if not exists fator numeric;
alter table public.ia_config add column if not exists fator_origem text;
alter table public.ia_config add column if not exists fator_em timestamptz;
alter table public.ia_config add column if not exists conferencias jsonb not null default '[]';

-- Gasto medido entre dois instantes (para calibrar com o relatório oficial e com o saldo conferido).
create or replace function public.ia_medido_entre(p_de timestamptz, p_ate timestamptz) returns numeric
language sql security definer set search_path = public as $$
  select coalesce(sum(custo_usd), 0) from ia_consumo where created_at >= p_de and created_at < p_ate
$$;
revoke all on function public.ia_medido_entre(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.ia_medido_entre(timestamptz, timestamptz) to service_role;

-- Quais funções já gravam consumo (para o painel dizer o que ainda não é medido).
create or replace function public.ia_funcoes_medidas() returns text[]
language sql security definer set search_path = public as $$
  select coalesce(array_agg(distinct funcao), '{}') from ia_consumo
$$;
revoke all on function public.ia_funcoes_medidas() from public, anon, authenticated;
grant execute on function public.ia_funcoes_medidas() to service_role;
