-- Migração 0012_oraculo_envio (aplicada em 2026-10-29).
-- Exportada do histórico de migrações do Supabase.

alter table dossies add column if not exists enviar_para text;
alter table dossies add column if not exists envio jsonb;
