-- Migração 0023_auditoria (aplicada em 2026-11-01).
-- Exportada do histórico de migrações do Supabase.

alter function public.wa_historico_antigo() set search_path = public;
alter table public.app_diag
  add constraint app_diag_tamanhos check (
    coalesce(length(versao), 0) <= 20 and coalesce(length(ua), 0) <= 300
    and coalesce(length(evento), 0) <= 60 and coalesce(length(detalhe), 0) <= 1000
  ) not valid;
alter table public.app_diag validate constraint app_diag_tamanhos;
update storage.buckets set file_size_limit = 10485760, allowed_mime_types = array['application/pdf', 'text/csv', 'text/plain']
where id = 'exportes';
create index if not exists agendador_rascunhos_agendamento on public.agendador_rascunhos (agendamento_id);
create index if not exists dossies_created_by on public.dossies (created_by);
create index if not exists membros_convidado_por on public.membros (convidado_por);
