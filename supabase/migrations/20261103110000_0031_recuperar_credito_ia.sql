-- 0031: quando a IA falha por falta de crédito, nada se perde. A cada 30 min: devolve uma tentativa aos eventos de memória
-- barrados por "credit balance" (a memória desiste após 3) e refaz o Radar do dia se ele falhou por isso (7h–20h, 1×/h no máximo).
create or replace function public.recuperar_falhas_credito() returns text
language plpgsql security definer set search_path = public as $$
declare n int; s jsonb; r record;
begin
  update raw_events set attempts = 2
   where not processed and attempts >= 3 and error ilike '%credit balance%' and created_at > now() - interval '14 days';
  get diagnostics n = row_count;
  select dia, status, erro, created_at into r from radar_edicoes order by created_at desc limit 1;
  if r.status = 'erro' and r.erro ilike '%credit balance%' and r.dia = (now() at time zone 'America/Sao_Paulo')::date
     and extract(hour from now() at time zone 'America/Sao_Paulo') between 7 and 20 and r.created_at < now() - interval '50 minutes' then
    s := get_app_secrets();
    perform net.http_post(url := (s->>'sc_PROJECT_URL') || '/functions/v1/extra/tarefa?task=radar&force=1',
      headers := jsonb_build_object('x-cron-secret', s->>'sc_CRON_SECRET'), body := '{}'::jsonb, timeout_milliseconds := 10000);
    return n || ' evento(s) devolvidos; radar refeito';
  end if;
  return n || ' evento(s) devolvidos';
end $$;
revoke all on function public.recuperar_falhas_credito() from public, anon, authenticated;
select cron.schedule('sc-recuperar-credito', '*/30 * * * *', 'select public.recuperar_falhas_credito()');
