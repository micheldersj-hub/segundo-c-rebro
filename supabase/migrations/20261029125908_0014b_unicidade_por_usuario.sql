-- Migração 0014b_unicidade_por_usuario (aplicada em 2026-10-29).
-- Exportada do histórico de migrações do Supabase.

alter table public.reflections drop constraint if exists reflections_period_period_start_key;
alter table public.reflections add constraint reflections_user_period_start_key unique nulls not distinct (user_id, period, period_start);
alter table public.skills drop constraint if exists skills_name_key;
alter table public.skills add constraint skills_user_name_key unique nulls not distinct (user_id, name);
