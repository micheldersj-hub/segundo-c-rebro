-- 0037: o nome de quem mexeu (ex.: "por Ana") vale só para a alteração feita naquele mesmo pedido.
-- Evita atribuir a ela algo que o dono, o Dimy por voz ou uma rotina fizeram depois. Só acréscimos.
alter table public.tarefas add column if not exists ultimo_autor_em timestamptz;

-- Se uma alteração não informou autor novo, o autor anterior não vale mais.
create or replace function public.tarefas_limpar_autor() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.ultimo_autor_em is not distinct from old.ultimo_autor_em then
    new.ultimo_autor := null;
  end if;
  return new;
end $$;
drop trigger if exists tarefas_limpar_autor on public.tarefas;
create trigger tarefas_limpar_autor before update on public.tarefas
  for each row execute function public.tarefas_limpar_autor();

-- O histórico só herda o autor se a tarefa foi alterada nesta mesma transação.
create or replace function public.tarefa_historico_autor() returns trigger
language plpgsql security definer set search_path = public as $$
declare a text;
begin
  if new.por = 'app' then
    select ultimo_autor into a from tarefas
     where id = new.tarefa_id and xmin::text::bigint = (txid_current() % 4294967296);
    if a is not null and a <> '' then new.por := a; end if;
  end if;
  return new;
end $$;
