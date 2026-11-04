// Ações de tarefas: chamam as mesmas rotas do app web e atualizam a tela na hora (com volta atrás se falhar).
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from './api';
import type { Etapa, ListaTarefas, Tarefa } from './tipos';

export const proximaEtapa = (e: Etapa): Etapa => (e === 'a_fazer' ? 'fazendo' : e === 'fazendo' ? 'feito' : 'a_fazer');

export function useAcoesTarefas(dia: string) {
  const qc = useQueryClient();
  const chave = ['tarefas', dia];
  const trocar = (id: string, f: (t: Tarefa) => Tarefa) => {
    const antes = qc.getQueryData<ListaTarefas>(chave);
    if (antes) qc.setQueryData<ListaTarefas>(chave, { ...antes, tarefas: antes.tarefas.map((t) => (t.id === id ? f(t) : t)), atrasadas: antes.atrasadas.map((t) => (t.id === id ? f(t) : t)) });
    return antes;
  };
  const depois = () => { void qc.invalidateQueries({ queryKey: ['tarefas'] }); void qc.invalidateQueries({ queryKey: ['hoje'] }); };

  const mover = useMutation({
    mutationFn: ({ id, etapa }: { id: string; etapa: Etapa }) => api<{ tarefa: Tarefa }>(`/tarefas/${id}`, { corpo: { etapa } }),
    onMutate: ({ id, etapa }) => ({ antes: trocar(id, (t) => ({ ...t, etapa })) }),
    onError: (_e, _v, ctx) => { if (ctx?.antes) qc.setQueryData(chave, ctx.antes); },
    onSettled: depois,
  });
  const criar = useMutation({
    mutationFn: (titulo: string) => api<{ tarefa: Tarefa }>('/tarefas', { corpo: { titulo, dia } }),
    onSettled: depois,
  });
  const adiar = useMutation({
    mutationFn: (id: string) => api(`/tarefas/${id}/adiar`, { corpo: {} }),
    onSettled: depois,
  });
  return { mover, criar, adiar };
}
