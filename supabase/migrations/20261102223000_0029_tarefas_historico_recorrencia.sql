-- 0029: Tarefas 2.0 no banco — histórico automático e recorrência valem para QUALQUER caminho
-- (app, Dimy por voz, Olho de Deus, sugestões). Só acréscimos: função + gatilho novos.

-- Próxima data de uma recorrência (espelha proximaRecorrencia em functions/tarefas/regras.ts).
create or replace function public.tarefa_proxima_data(d date, regra text) returns date
language plpgsql immutable set search_path = public as $$
declare n date;
begin
  if regra = 'diaria' then return d + 1;
  elsif regra = 'semanal' then return d + 7;
  elsif regra = 'mensal' then return (d + interval '1 month')::date;   -- 31/01 → 28 ou 29/02
  else
    n := d + 1;
    while extract(isodow from n) in (6, 7) loop n := n + 1; end loop;  -- dias úteis
    return n;
  end if;
end $$;

create or replace function public.tarefas_auditar() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  raiz uuid;
  prox date;
  nova uuid;
begin
  if tg_op = 'INSERT' then
    insert into tarefa_historico (tarefa_id, acao, detalhe, por)
    values (new.id, 'criada', 'para ' || to_char(new.dia, 'DD/MM') || coalesce(' · prazo ' || to_char(new.prazo, 'DD/MM'), ''),
            case new.origem when 'manual' then 'app' else new.origem end);
    return new;
  end if;

  if new.etapa is distinct from old.etapa then
    insert into tarefa_historico (tarefa_id, acao, detalhe) values (new.id, 'etapa',
      replace(replace(replace(old.etapa || ' → ' || new.etapa, 'a_fazer', 'A fazer'), 'fazendo', 'Fazendo'), 'feito', 'Feito'));
  end if;
  if new.dia is distinct from old.dia then
    insert into tarefa_historico (tarefa_id, acao, detalhe) values (new.id, 'dia', to_char(old.dia, 'DD/MM') || ' → ' || to_char(new.dia, 'DD/MM'));
  end if;
  if new.prazo is distinct from old.prazo then
    insert into tarefa_historico (tarefa_id, acao, detalhe) values (new.id, 'prazo', coalesce(to_char(old.prazo, 'DD/MM'), 'sem prazo') || ' → ' || coalesce(to_char(new.prazo, 'DD/MM'), 'sem prazo'));
  end if;
  if new.titulo is distinct from old.titulo then
    insert into tarefa_historico (tarefa_id, acao, detalhe) values (new.id, 'editada', 'título: ' || left(old.titulo, 120));
  end if;
  if new.arquivada is distinct from old.arquivada then
    insert into tarefa_historico (tarefa_id, acao, detalhe) values (new.id, case when new.arquivada then 'arquivada' else 'restaurada' end, null);
  end if;
  if new.recorrencia is distinct from old.recorrencia then
    insert into tarefa_historico (tarefa_id, acao, detalhe) values (new.id, 'recorrencia', coalesce(new.recorrencia, 'sem repetição'));
  end if;

  -- Recorrência: ao concluir, cria a próxima (uma só, mesmo se marcar/desmarcar várias vezes).
  if new.etapa = 'feito' and old.etapa is distinct from 'feito' and new.recorrencia is not null and not new.arquivada then
    raiz := coalesce(new.recorrencia_origem, new.id);
    prox := tarefa_proxima_data(new.dia, new.recorrencia);
    while prox < hoje loop prox := tarefa_proxima_data(prox, new.recorrencia); end loop;
    if (new.recorrencia_ate is null or prox <= new.recorrencia_ate)
       and not exists (select 1 from tarefas where (recorrencia_origem = raiz or id = raiz) and dia = prox and not arquivada and id <> new.id) then
      insert into tarefas (user_id, titulo, notas, dia, etapa, prioridade, projeto, area, prazo, recorrencia, recorrencia_ate,
                           recorrencia_origem, contato_wa, empresa, oportunidade, origem)
      values (new.user_id, new.titulo, new.notas, prox, 'a_fazer', new.prioridade, new.projeto, new.area,
              case when new.prazo is null then null else new.prazo + (prox - new.dia) end,
              new.recorrencia, new.recorrencia_ate, raiz, new.contato_wa, new.empresa, new.oportunidade, 'recorrencia')
      returning id into nova;
      insert into tarefa_subtarefas (tarefa_id, titulo, ordem)
        select nova, titulo, ordem from tarefa_subtarefas where tarefa_id = new.id;
      insert into tarefa_historico (tarefa_id, acao, detalhe, por) values (new.id, 'recorrencia', 'próxima criada para ' || to_char(prox, 'DD/MM'), 'sistema');
    end if;
  end if;
  return new;
end $$;
revoke all on function public.tarefas_auditar() from public, anon, authenticated;

create or replace trigger tarefas_auditar after insert or update on public.tarefas
  for each row execute function public.tarefas_auditar();
