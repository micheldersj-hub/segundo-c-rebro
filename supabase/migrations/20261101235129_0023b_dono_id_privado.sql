-- Migração 0023b_dono_id_privado (aplicada em 2026-11-01).
-- Exportada do histórico de migrações do Supabase.

revoke execute on function public.dono_id() from public, anon, authenticated;
