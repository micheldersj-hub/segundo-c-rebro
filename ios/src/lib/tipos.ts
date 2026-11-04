// Formato das respostas do backend atual (contrato existente; não mudou nada no servidor).
export type Aviso = { id: string; kind: string; title: string; body: string; data: Record<string, unknown>; read_at: string | null; created_at: string };
export type Compromisso = { id: string; inicio: string; titulo: string; local: string | null };
export type ContatoEsperando = { wa_id: string; name: string | null; last_summary: string | null; last_in_at: string | null; last_seen: string | null };
export type Lembrete = { id: string; text: string; due_at: string };
export type Hoje = {
  agora: string; google: boolean; agenda: Compromisso[] | { erro: string } | null; aguardando: ContatoEsperando[];
  lembretes: Lembrete[]; avisos: Aviso[]; perguntas: { id: string; question: string; created_at: string }[];
};
export type Etapa = 'a_fazer' | 'fazendo' | 'feito';
export type Tarefa = {
  id: string; titulo: string; notas: string | null; dia: string; etapa: Etapa; prioridade: 1 | 2 | 3; ordem: number; adiada_vezes: number;
  dia_original: string | null; concluida_em: string | null; projeto: string | null; area: string | null; prazo: string | null;
  empresa: string | null; contato_wa: string | null; origem: string | null; subtarefas?: { total: number; feitas: number } | null;
};
export type ListaTarefas = { dia: string; hoje: string; tarefas: Tarefa[]; atrasadas: Tarefa[]; contagem: Record<string, { total: number; feitas: number }>; prazos: Tarefa[]; sugestoes_pendentes: number };
