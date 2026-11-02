// Regras puras das tarefas (sem rede nem banco), testadas em supabase/tests/tarefas.test.mjs.

export const RECORRENCIAS = ['diaria', 'dias_uteis', 'semanal', 'mensal'] as const;

/** Próxima data de uma tarefa recorrente. */
export function proximaRecorrencia(dia: string, regra: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  if (regra === 'diaria') d.setUTCDate(d.getUTCDate() + 1);
  else if (regra === 'semanal') d.setUTCDate(d.getUTCDate() + 7);
  else if (regra === 'mensal') { const alvo = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1); const fim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(alvo, fim)); }
  else { do d.setUTCDate(d.getUTCDate() + 1); while ([0, 6].includes(d.getUTCDay())); } // dias_uteis
  return d.toISOString().slice(0, 10);
}

const PARADAS = new Set(['para', 'com', 'que', 'dos', 'das', 'uma', 'por', 'nos', 'nas', 'sobre', 'como', 'mais', 'seu', 'sua', 'aos', 'pela', 'pelo', 'fazer', 'ver']);
export function normalizar(t: unknown): string {
  return String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}
const tokens = (t: unknown) => new Set(normalizar(t).split(' ').filter((w) => w.length >= 3 && !PARADAS.has(w)));
export function similaridade(a: unknown, b: unknown): number {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let i = 0;
  for (const x of A) if (B.has(x)) i++;
  return i / (A.size + B.size - i);
}
/** Chave para impedir sugestões repetidas: palavras significativas em ordem alfabética. */
export const chaveTarefa = (t: string) => [...tokens(t)].sort().join(' ').slice(0, 200);

/** Uma sugestão só passa se tiver ação concreta, exigir acompanhamento, não existir e tiver confiança suficiente. */
export function sugestaoAprovada(c: { acao_concreta?: boolean; exige_acompanhamento?: boolean; ja_existe?: boolean; confianca?: number; titulo?: string },
  existentes: string[], limiar = 0.55) {
  if (!c?.titulo || String(c.titulo).trim().length < 6) return { ok: false, motivo: 'sem título' };
  if (!c.acao_concreta) return { ok: false, motivo: 'sem ação concreta' };
  if (!c.exige_acompanhamento) return { ok: false, motivo: 'não exige acompanhamento' };
  if (c.ja_existe) return { ok: false, motivo: 'já existe' };
  if ((Number(c.confianca) || 0) < 0.75) return { ok: false, motivo: 'confiança baixa' };
  const igual = existentes.find((e) => similaridade(c.titulo, e) >= limiar);
  if (igual) return { ok: false, motivo: `parecida com "${igual}"` };
  return { ok: true, motivo: '' };
}
