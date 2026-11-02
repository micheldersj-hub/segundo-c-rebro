-- Tarefas agendadas (pg_cron) como estão no ar em 01/11/2026.
-- Nenhum segredo aqui: URL do projeto e chaves vêm do Vault na hora da execução.
-- Para recriar uma tarefa: select cron.unschedule('nome'); e depois rode a linha correspondente abaixo.

-- sc-agendador  (10 seconds)
select cron.schedule('sc-agendador', '10 seconds', $cmd$select public.agendador_varrer()$cmd$);

-- sc-alarmes  (* * * * *)
select cron.schedule('sc-alarmes', '* * * * *', $cmd$select public.invoke_worker('event-alerts')$cmd$);

-- sc-conhecimento  (*/3 * * * *)
select cron.schedule('sc-conhecimento', '*/3 * * * *', $cmd$select net.http_post(url := (select decrypted_secret from vault.decrypted_secrets where name = 'sc_PROJECT_URL') || '/functions/v1/extra/tarefa?task=conhecimento', headers := jsonb_build_object('x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sc_CRON_SECRET')), body := '{}'::jsonb, timeout_milliseconds := 10000)$cmd$);

-- sc-google-sync  (*/15 * * * *)
select cron.schedule('sc-google-sync', '*/15 * * * *', $cmd$select public.invoke_worker('google-sync')$cmd$);

-- sc-gravacoes  (* * * * *)
select cron.schedule('sc-gravacoes', '* * * * *', $cmd$select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name = 'sc_PROJECT_URL') || '/functions/v1/gravador/processar',
  headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name = 'sc_CRON_SECRET')),
  body := '{}'::jsonb, timeout_milliseconds := 5000)$cmd$);

-- sc-lembretes  (* * * * *)
select cron.schedule('sc-lembretes', '* * * * *', $cmd$select public.invoke_worker('reminders')$cmd$);

-- sc-tarefas-sugerir  (*/20 * * * *)  sugestões de tarefa a partir das conversas
select cron.schedule('sc-tarefas-sugerir', '*/20 * * * *', $cmd$select public.tarefas_sugerir()$cmd$);

-- sc-limpa-alarmes  (15 7 * * *)
select cron.schedule('sc-limpa-alarmes', '15 7 * * *', $cmd$delete from public.event_alerts where sent_at < now() - interval '30 days'$cmd$);

-- sc-limpa-net  (0 7 * * *)
select cron.schedule('sc-limpa-net', '0 7 * * *', $cmd$delete from net._http_response where created < now() - interval '2 days'$cmd$);

-- sc-manutencao  (30 6 * * *)
select cron.schedule('sc-manutencao', '30 6 * * *', $cmd$select public.invoke_worker('maintenance')$cmd$);

-- sc-memoria  (*/2 * * * *)
select cron.schedule('sc-memoria', '*/2 * * * *', $cmd$select public.invoke_worker('memory')$cmd$);

-- sc-mes  (0 11 1 * *)
select cron.schedule('sc-mes', '0 11 1 * *', $cmd$select public.invoke_worker('monthly')$cmd$);

-- sc-olho  (*/2 * * * *)  Olho de Deus: uma etapa da fila por chamada
select cron.schedule('sc-olho', '*/2 * * * *', $cmd$select public.olho_ciclo()$cmd$);

-- sc-oraculo  (*/2 * * * *)
select cron.schedule('sc-oraculo', '*/2 * * * *', $cmd$select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name = 'sc_PROJECT_URL') || '/functions/v1/oraculo/processar',
  headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name = 'sc_CRON_SECRET')),
  body := '{}'::jsonb, timeout_milliseconds := 5000)$cmd$);

-- sc-plano-manha  (0 10 * * *)
select cron.schedule('sc-plano-manha', '0 10 * * *', $cmd$select public.invoke_worker('morning')$cmd$);

-- sc-radar  (20 9 * * 1-6)
select cron.schedule('sc-radar', '20 9 * * 1-6', $cmd$select net.http_post(url := (select decrypted_secret from vault.decrypted_secrets where name = 'sc_PROJECT_URL') || '/functions/v1/extra/tarefa?task=radar', headers := jsonb_build_object('x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sc_CRON_SECRET')), body := '{}'::jsonb, timeout_milliseconds := 10000)$cmd$);

-- sc-resumo-contatos  (*/30 0,11-23 * * *)
select cron.schedule('sc-resumo-contatos', '*/30 0,11-23 * * *', $cmd$select public.invoke_worker('contacts-digest')$cmd$);

-- sc-resumo-dia  (0 1 * * *)
select cron.schedule('sc-resumo-dia', '0 1 * * *', $cmd$select public.invoke_worker('evening')$cmd$);

-- sc-semana  (0 23 * * 0)
select cron.schedule('sc-semana', '0 23 * * 0', $cmd$select public.invoke_worker('weekly')$cmd$);

-- 0024: bot de atendimento (a cada 30 s)
select cron.schedule('sc-atendente', '30 seconds', $$select public.atendente_varrer()$$);
