-- 0028: agenda o ciclo do Olho de Deus (uma etapa a cada 2 min). sc-tarefas-sugerir entra na 0029, junto com a rota /sugerir.
select cron.schedule('sc-olho', '*/2 * * * *', 'select public.olho_ciclo()');
