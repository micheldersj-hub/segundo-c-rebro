// node --test tests/consumo.test.mjs  (roda a lógica pura do painel de consumo)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

// logica.ts → .mjs (só tipos a remover)
const dir = mkdtempSync(join(tmpdir(), 'consumo-'));
const src = new URL('../functions/consumo/logica.ts', import.meta.url);
execSync(`tsc --target es2022 --module esnext --skipLibCheck --outDir ${dir} ${src.pathname}`);
const L = await import(join(dir, 'logica.js'));

const T = (rotina, atual, opcoes) => ({ rotina, nome: rotina, descricao: '', padrao: opcoes[0].id, atual, opcoes });
const radar = T('radar', 'seg_sab', [{ id: 'seg_sab', rotulo: '', por_dia: 0.857 }, { id: 'seg_qua_sex', rotulo: '', por_dia: 0.429 }, { id: 'desligado', rotulo: '', por_dia: 0 }]);

test('estimativa proporcional às execuções e zero quando desligado', () => {
  assert.equal(L.estimarOpcao(radar, 1.0, 'desligado'), 0);
  assert.ok(Math.abs(L.estimarOpcao(radar, 1.0, 'seg_qua_sex') - 0.5006) < 0.001);
  assert.equal(L.estimarOpcao({ ...radar, atual: 'desligado' }, 0, 'seg_sab'), null);   // sem base
});

test('ritmo não chuta com menos de 3 h de dados e divide pelos dias reais', () => {
  const agora = Date.parse('2026-11-10T12:00:00Z');
  assert.equal(L.ritmoDiario(5, '2026-11-10T10:00:00Z', agora), null);
  assert.equal(L.ritmoDiario(6, '2026-11-08T12:00:00Z', agora), 3);       // 2 dias
  assert.equal(L.ritmoDiario(14, '2026-10-01T00:00:00Z', agora), 2);     // teto de 7 dias
});

test('dias restantes', () => {
  assert.equal(L.diasRestantes(10, 2), 5);
  assert.equal(L.diasRestantes(-1, 2), 0);
  assert.equal(L.diasRestantes(10, 0), Infinity);
  assert.equal(L.diasRestantes(null, 2), null);
});

test('ritmo com preset troca só as rotinas que mudam', () => {
  const r = L.ritmoCom(3, [radar], { radar: 1 }, { radar: 'desligado' });
  assert.equal(r, 2);
  assert.equal(L.ritmoCom(3, [radar], { radar: 1 }, { radar: 'seg_sab' }), 3);
});

test('preset atual reconhece o conjunto e cai em personalizado', () => {
  const ts = Object.entries(L.PRESETS.economico.opcoes).map(([r, a]) => ({ rotina: r, atual: a, opcoes: [] }));
  assert.equal(L.presetAtual(ts), 'economico');
  ts[0].atual = 'desligado';
  assert.equal(L.presetAtual(ts), 'personalizado');
});

test('avisos: saldo baixo uma vez por recarga, dias por dia, sem crédito urgente', () => {
  const cfg = { saldo_usd: 20, saldo_em: '2026-11-03T12:00:00Z', alerta_saldo_usd: 5, alerta_dias: 5, alerta_dia_usd: 2, economia_auto: true, economia_auto_usd: 3, avisos: {} };
  let a = L.avisosDevidos({ cfg, saldo: 4, dias: 2, hojeUsd: 1, hoje: '2026-11-05', semCredito: false });
  assert.deepEqual(a.map((x) => x.chave.split(':')[0]), ['saldo_baixo']);
  a = L.avisosDevidos({ cfg: { ...cfg, avisos: { [a[0].chave]: 'x' } }, saldo: 3.5, dias: 1.5, hojeUsd: 1, hoje: '2026-11-05', semCredito: false });
  assert.equal(a.length, 0);
  a = L.avisosDevidos({ cfg, saldo: 9, dias: 4, hojeUsd: 2.5, hoje: '2026-11-05', semCredito: true });
  assert.deepEqual(a.map((x) => x.chave.split(':')[0]), ['sem_credito', 'dias', 'dia']);
  assert.ok(a[0].urgente);
});

test('relatório oficial: centavos → dólares por dia', () => {
  const d = L.somarRelatorio([{ data: [{ starting_at: '2026-11-01T00:00:00Z', results: [{ amount: '123.5', currency: 'USD' }, { amount: '26.5', currency: 'USD' }] },
    { starting_at: '2026-11-02T00:00:00Z', results: [] }] }]);
  assert.equal(d['2026-11-01'], 1.5);
  assert.equal(d['2026-11-02'], 0);
});

writeFileSync(join(dir, 'ok'), '1');

test('calibração: saldo conferido e relatório oficial', () => {
  assert.equal(L.fatorPorSaldo(20, 14, 2), 3);          // gastou 6 de verdade, mediu 2
  assert.equal(L.fatorPorSaldo(20, 25, 2), null);       // saldo subiu: houve recarga
  assert.equal(L.fatorPorSaldo(null, 14, 2), null);
  assert.equal(L.fatorPorSaldo(20, 19.99, 2), null);
  assert.equal(L.fatorPorOficial(4, 2), 2);
  assert.equal(L.fatorPorOficial(4, 0.01), null);
  assert.equal(L.fatorPorOficial(1000, 1), 50);         // teto
});
