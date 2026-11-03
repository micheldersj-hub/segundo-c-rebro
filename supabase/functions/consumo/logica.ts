// Regras puras do painel de consumo (testáveis sem servidor).

export type Opcao = { id: string; rotulo: string; por_dia: number };
export type Temporizador = { rotina: string; nome: string; descricao: string; padrao: string; opcoes: Opcao[]; atual: string };
export type PorRotina = { rotina: string; usd7: number | null; usd30: number | null; chamadas7: number; buscas7: number; primeiro: string };

export const PRESETS: Record<string, { nome: string; descricao: string; opcoes: Record<string, string> }> = {
  completo: { nome: 'Completo', descricao: 'Tudo no ritmo máximo.',
    opcoes: { radar: 'seg_sab', olho: 'completo', contatos: '30min', tarefas: '20min', perfis: '3min', plano: 'ligado', resumo_dia: 'ligado', resumos: 'ligado' } },
  equilibrado: { nome: 'Equilibrado', descricao: 'Quase tudo, com intervalos maiores.',
    opcoes: { radar: 'uteis', olho: 'equilibrado', contatos: '1h', tarefas: '1h', perfis: '15min', plano: 'ligado', resumo_dia: 'ligado', resumos: 'ligado' } },
  economico: { nome: 'Econômico', descricao: 'O essencial; o Radar 3x por semana.',
    opcoes: { radar: 'seg_qua_sex', olho: 'economico', contatos: '2h', tarefas: '3h', perfis: '1h', plano: 'ligado', resumo_dia: 'desligado', resumos: 'ligado' } },
  minimo: { nome: 'Mínimo', descricao: 'Só o que responde você e os clientes.',
    opcoes: { radar: 'semanal', olho: 'desligado', contatos: '3x', tarefas: '2x', perfis: 'diario', plano: 'ligado', resumo_dia: 'desligado', resumos: 'desligado' } },
};

/** Qual preset bate com as opções em uso (ou "personalizado"). */
export function presetAtual(ts: Temporizador[]): string {
  for (const [id, p] of Object.entries(PRESETS)) {
    if (ts.every((t) => !(t.rotina in p.opcoes) || p.opcoes[t.rotina] === t.atual)) return id;
  }
  return 'personalizado';
}

const opc = (t: Temporizador, id: string) => t.opcoes.find((o) => o.id === id);

/**
 * Gasto médio por dia de cada rotina (US$/dia), a partir dos últimos 7 dias.
 * Rotinas com menos de 7 dias de dados dividem pelo tempo que de fato têm (mínimo de 1 dia, para não exagerar o começo).
 */
export function gastoDiaRotina(r: PorRotina, agora = Date.now()) {
  const dias = Math.min(7, Math.max(1, (agora - Date.parse(r.primeiro)) / 864e5));
  return Number(r.usd7 ?? 0) / dias;
}

/**
 * Estimativa de quanto a rotina gastaria por dia com outra opção.
 * Proporcional às execuções por dia. Se hoje a rotina está desligada (ou sem dados), não há base: devolve null.
 */
export function estimarOpcao(t: Temporizador, gastoDia: number, opcaoId: string): number | null {
  const atual = opc(t, t.atual), alvo = opc(t, opcaoId);
  if (!alvo) return null;
  if (alvo.por_dia === 0) return 0;
  if (!atual || atual.por_dia === 0) return null;
  return gastoDia * (alvo.por_dia / atual.por_dia);
}

/** Ritmo diário total (US$/dia): média dos últimos 7 dias, ou do tempo que já tem de dados. */
export function ritmoDiario(usd7: number, primeiro: string | null, agora = Date.now()) {
  if (!primeiro) return null;
  const horas = (agora - Date.parse(primeiro)) / 36e5;
  if (horas < 3) return null;                         // pouco dado: melhor não chutar
  const dias = Math.min(7, Math.max(horas / 24, 0.25));
  return usd7 / dias;
}

/** Ritmo se trocar as rotinas para as opções dadas (as que não mudam continuam iguais). */
export function ritmoCom(ritmo: number, ts: Temporizador[], gastos: Record<string, number>, escolha: Record<string, string>) {
  let r = ritmo;
  for (const t of ts) {
    const novo = escolha[t.rotina];
    if (!novo || novo === t.atual) continue;
    const g = gastos[t.rotina] ?? 0;
    const est = estimarOpcao(t, g, novo);
    if (est === null) continue;                        // sem base para estimar: não mexe
    r += est - g;
  }
  return Math.max(0, r);
}

export function diasRestantes(saldo: number | null, ritmo: number | null) {
  if (saldo === null || ritmo === null) return null;
  if (saldo <= 0) return 0;
  if (ritmo <= 0.0001) return Infinity;
  return saldo / ritmo;
}

export type Cfg = { saldo_usd: number | null; saldo_em: string | null; alerta_saldo_usd: number; alerta_dias: number; alerta_dia_usd: number | null;
  economia_auto: boolean; economia_auto_usd: number; avisos: Record<string, string> };

export type Aviso = { chave: string; titulo: string; corpo: string; urgente?: boolean };

/** Quais avisos mandar agora (cada um só uma vez por chave). */
export function avisosDevidos(o: { cfg: Cfg; saldo: number | null; dias: number | null; hojeUsd: number; hoje: string; semCredito: boolean }): Aviso[] {
  const { cfg, saldo, dias, hojeUsd, hoje, semCredito } = o;
  const ja = cfg.avisos || {};
  const out: Aviso[] = [];
  const usd = (v: number) => `US$ ${v.toFixed(2).replace('.', ',')}`;
  if (semCredito) {
    out.push({ chave: `sem_credito:${hoje}`, titulo: 'O crédito de IA acabou',
      corpo: 'A Anthropic recusou as chamadas por falta de saldo. Recarregue em console.anthropic.com › Plans & Billing; o que chegou enquanto isso é processado depois, sozinho.', urgente: true });
  }
  if (saldo !== null && cfg.saldo_em) {
    if (saldo <= cfg.alerta_saldo_usd) {
      out.push({ chave: `saldo_baixo:${cfg.saldo_em}`, titulo: 'Crédito de IA baixo',
        corpo: `O saldo estimado está em ${usd(Math.max(0, saldo))}${dias !== null && isFinite(dias) ? `, o que dá para uns ${Math.max(0, Math.floor(dias))} dia(s) no ritmo atual` : ''}. Recarregue ou passe para o modo Econômico em Configuração.`, urgente: saldo <= cfg.alerta_saldo_usd / 2 });
    } else if (dias !== null && isFinite(dias) && dias <= cfg.alerta_dias) {
      out.push({ chave: `dias:${cfg.saldo_em}:${hoje}`, titulo: `Crédito de IA dura uns ${Math.max(0, Math.floor(dias))} dia(s)`,
        corpo: `No ritmo atual o saldo (${usd(saldo)}) acaba em cerca de ${Math.max(0, Math.round(dias * 10) / 10)} dia(s). Em Configuração você vê o que mais gasta e pode espaçar as rotinas.` });
    }
  }
  if (cfg.alerta_dia_usd && hojeUsd > cfg.alerta_dia_usd) {
    out.push({ chave: `dia:${hoje}`, titulo: 'Gasto de IA acima do normal hoje',
      corpo: `Hoje já foram ${usd(hojeUsd)} (seu limite de aviso é ${usd(cfg.alerta_dia_usd)}). Veja em Configuração o que está consumindo.` });
  }
  return out.filter((a) => !ja[a.chave]);
}

/** Soma o relatório de custo da Admin API (valores em centavos de dólar, como texto decimal) por dia. */
export function somarRelatorio(paginas: any[]): Record<string, number> {
  const dias: Record<string, number> = {};
  for (const pg of paginas) for (const b of pg?.data ?? []) {
    const dia = String(b.starting_at ?? '').slice(0, 10);
    if (!dia) continue;
    let total = 0;
    for (const r of b.results ?? []) {
      if (r.currency && r.currency !== 'USD') continue;
      const v = Number(r.amount); if (isFinite(v)) total += v / 100;
    }
    dias[dia] = (dias[dia] ?? 0) + total;
  }
  return dias;
}

// ---------------------------------------------------------------- calibração (gasto real ÷ gasto medido)
// Nem toda função grava o consumo ainda (cada uma passa a gravar quando é republicada). O fator corrige a soma medida
// usando uma referência real: o relatório oficial (chave de administrador) ou o saldo que o dono confere no console.
const limitar = (v: number) => Math.min(50, Math.max(0.5, v));
export function fatorPorSaldo(saldoAnterior: number | null, saldoAgora: number, medido: number): number | null {
  if (saldoAnterior === null || !isFinite(saldoAnterior)) return null;
  const real = saldoAnterior - saldoAgora;
  if (medido < 0.05 || real < 0.02) return null;           // pouco gasto para comparar, ou houve recarga no meio
  return Math.round(limitar(real / medido) * 100) / 100;
}
export function fatorPorOficial(oficial: number, medido: number): number | null {
  if (medido < 0.05 || oficial <= 0) return null;
  return Math.round(limitar(oficial / medido) * 100) / 100;
}
export const FUNCOES_IA = ['app', 'worker', 'extra', 'olho', 'tarefas', 'atendente', 'agendador', 'ycloud', 'oraculo', 'gravador', 'documento', 'instagram'];
