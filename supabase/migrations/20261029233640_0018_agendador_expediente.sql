-- Migração 0018_agendador_expediente (aplicada em 2026-10-29).
-- Exportada do histórico de migrações do Supabase.

alter table public.agendador_config add column if not exists feriados_extras date[] not null default '{}';
update public.agendador_config
   set dias_semana = '{1,2,3,4,5}', hora_inicio = 8, hora_fim = 19, almoco_inicio = null, almoco_fim = null, updated_at = now()
 where id = 1;
