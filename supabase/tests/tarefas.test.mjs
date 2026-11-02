import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carregar } from './carregar.mjs';
const R = await carregar('tarefas/regras.ts');

test('recorrência diária, semanal, mensal e dias úteis', () => {
  assert.equal(R.proximaRecorrencia('2026-11-06', 'diaria'), '2026-11-07');
  assert.equal(R.proximaRecorrencia('2026-11-06', 'dias_uteis'), '2026-11-09', 'sexta → segunda');
  assert.equal(R.proximaRecorrencia('2026-11-06', 'semanal'), '2026-11-13');
  assert.equal(R.proximaRecorrencia('2026-01-31', 'mensal'), '2026-02-28', 'fim de mês ajusta');
});
test('chave de tarefa ignora ordem, acento e palavras vazias', () => {
  assert.equal(R.chaveTarefa('Ligar para o Bruno sobre a maquininha'), R.chaveTarefa('ligar Bruno maquininha'));
});
test('sugestão só passa com critérios e sem duplicidade', () => {
  const ok = { titulo: 'Enviar proposta de split para a Padaria Sabor', acao_concreta: true, exige_acompanhamento: true, ja_existe: false, confianca: 0.9 };
  assert.equal(R.sugestaoAprovada(ok, []).ok, true);
  assert.equal(R.sugestaoAprovada({ ...ok, acao_concreta: false }, []).ok, false);
  assert.equal(R.sugestaoAprovada({ ...ok, confianca: 0.5 }, []).ok, false);
  assert.equal(R.sugestaoAprovada({ ...ok, ja_existe: true }, []).ok, false);
  assert.equal(R.sugestaoAprovada(ok, ['Enviar a proposta de split à Padaria Sabor']).ok, false, 'parecida com tarefa existente');
});
