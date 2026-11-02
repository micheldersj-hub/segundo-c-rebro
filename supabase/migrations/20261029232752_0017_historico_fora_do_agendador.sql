-- Migração 0017_historico_fora_do_agendador (aplicada em 2026-10-29).
-- Exportada do histórico de migrações do Supabase.

create or replace function public.wa_historico_antigo() returns trigger
language plpgsql as $$
begin
  if new.from_history and new.direction = 'in' and new.agenda_status is null then
    new.agenda_status := 'antigo';
  end if;
  return new;
end $$;

create trigger wa_historico_antigo before insert or update of from_history on public.wa_messages
  for each row execute function public.wa_historico_antigo();

update public.wa_messages set agenda_status = 'antigo'
  where from_history and direction = 'in' and agenda_status is null;
