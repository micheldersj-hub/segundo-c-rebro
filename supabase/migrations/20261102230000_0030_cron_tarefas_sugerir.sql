-- 0030: rotina que sugere tarefas a partir das conversas (a cada 20 min; só chama a função se houver mensagem nova).
select cron.schedule('sc-tarefas-sugerir', '*/20 * * * *', 'select public.tarefas_sugerir()');
