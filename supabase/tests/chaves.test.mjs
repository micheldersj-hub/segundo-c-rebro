// node --test supabase/tests/chaves.test.mjs — regras do monitor de chaves (funções/consumo/chaves.ts)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
const dir = mkdtempSync(join(tmpdir(), 'chaves-'));
execSync(`tsc --target es2022 --module esnext --skipLibCheck --outDir ${dir} ${new URL('../functions/consumo/chaves.ts', import.meta.url).pathname}`);
const C = await import(join(dir, 'chaves.js'));
const T0 = '2026-11-10T12:00:00.000Z';

test('leituras: recusada, vencida, sem crédito, instável', () => {
  assert.equal(C.lerAnthropic(200, '').ok, true);
  assert.equal(C.lerAnthropic(401, '{"error":{"type":"authentication_error"}}').ok, false);
  assert.equal(C.lerAnthropic(529, '').ok, null);
  assert.equal(C.lerAnthropic(0, '').ok, null);
  assert.match(C.lerOpenAI(401, '{"error":{"message":"Your API key has expired. Create a new API key to continue."}}').detalhe, /venceu/);
  assert.match(C.lerOpenAI(401, '{"error":{"message":"Incorrect API key provided"}}').detalhe, /recusou/);
  assert.match(C.lerOpenAI(429, '{"error":{"code":"insufficient_quota","message":"You exceeded your current quota"}}').detalhe, /sem crédito/);
  assert.equal(C.lerOpenAI(429, '{"error":{"code":"rate_limit_exceeded"}}').ok, null);
  assert.deepEqual(C.lerYCloud(200, '{"amount":0.50000,"currency":"USD"}'), { ok: true, detalhe: 'Funcionando', saldo: 0.5 });
  assert.equal(C.lerYCloud(401, '').ok, false);
});
test('Meta: token que não vence, que vence e inválido', () => {
  assert.deepEqual(C.lerMeta(200, '{"data":{"is_valid":true,"expires_at":0}}'), { ok: true, detalhe: 'Funcionando (não vence)', expira_em: null });
  assert.equal(C.lerMeta(200, '{"data":{"is_valid":true,"expires_at":1798000000}}').expira_em, new Date(1798000000e3).toISOString());
  assert.equal(C.lerMeta(200, '{"data":{"is_valid":false}}').ok, false);
});
test('Google: renovação parada há mais de 3 h derruba', () => {
  const agora = Date.parse(T0);
  assert.equal(C.lerGoogle(new Date(agora - 50 * 6e4).toISOString(), agora).ok, true);
  assert.match(C.lerGoogle(new Date(agora - 5 * 36e5).toISOString(), agora).detalhe, /5 h/);
  assert.equal(C.lerGoogle(null, agora).ok, false);
});
test('Admin API: acha a chave pela dica parcial e lê a validade', () => {
  const chave = 'sk-ant-api03-R2DxxxxxxxxxxxxxxxxxxxxxxxxxxxigAA';
  const lista = [{ partial_key_hint: 'sk-ant-api03-ZZZ...0000', expires_at: null }, { partial_key_hint: 'sk-ant-api03-R2D...igAA', expires_at: '2026-12-01T00:00:00Z' }];
  assert.deepEqual(C.validadeDaChave(lista, chave), { achou: true, expira_em: '2026-12-01T00:00:00Z' });
  assert.deepEqual(C.validadeDaChave(lista, 'sk-ant-api03-outra'), { achou: false, expira_em: null });
  assert.equal(C.dicaBate('', chave), false);
});
test('estado: 401 cai na hora; instabilidade só depois de 3 seguidas; volta zera', () => {
  let e = C.proximoEstado(null, { ok: true, detalhe: 'Funcionando' }, 'anthropic', T0);
  assert.equal(e.ok, true);
  e = C.proximoEstado(e, { ok: null, detalhe: 'sem resposta' }, 'anthropic', '2026-11-10T12:10:00Z');
  e = C.proximoEstado(e, { ok: null, detalhe: 'sem resposta' }, 'anthropic', '2026-11-10T12:20:00Z');
  assert.equal(e.ok, true); assert.equal(e.falhas_seguidas, 2);
  e = C.proximoEstado(e, { ok: null, detalhe: 'sem resposta' }, 'anthropic', '2026-11-10T12:30:00Z');
  assert.equal(e.ok, false); assert.equal(e.desde, '2026-11-10T12:30:00Z');
  e = C.proximoEstado(e, { ok: true, detalhe: 'Funcionando' }, 'anthropic', '2026-11-10T12:40:00Z');
  assert.equal(e.ok, true); assert.equal(e.falhas_seguidas, 0); assert.equal(e.desde, '2026-11-10T12:40:00Z');
  const f = C.proximoEstado(e, { ok: false, detalhe: 'recusada' }, 'anthropic', '2026-11-10T12:50:00Z');
  assert.equal(f.ok, false); assert.equal(f.desde, '2026-11-10T12:50:00Z');
  const g = C.proximoEstado(f, { ok: false, detalhe: 'recusada' }, 'anthropic', '2026-11-10T13:00:00Z');
  assert.equal(g.desde, '2026-11-10T12:50:00Z', 'continua fora desde a primeira falha');
});
test('avisos: caiu (urgente), voltou, vence em 7/3/1 dias sem repetir, saldo YCloud, serviço não usado', () => {
  const ok = { servico: 'anthropic', ok: true, desde: T0, verificado_em: T0, detalhe: 'Funcionando', expira_em: null, saldo: null, falhas_seguidas: 0 };
  const fora = { ...ok, ok: false, desde: '2026-11-10T13:00:00Z', detalhe: 'A Anthropic recusou a chave.' };
  let a = C.avisosDasChaves(ok, fora, {});
  assert.equal(a.length, 1); assert.ok(a[0].urgente); assert.match(a[0].corpo, /Conexões/); assert.match(a[0].corpo, /nada se perde/);
  assert.equal(C.avisosDasChaves(fora, { ...fora, verificado_em: 'x' }, { [a[0].chave]: 'x' }).length, 0, 'não repete');
  a = C.avisosDasChaves(fora, { ...ok, desde: '2026-11-10T14:00:00Z' }, {});
  assert.match(a[0].titulo, /voltou/);
  const agora = Date.parse(T0);
  const E = new Date(agora + 6.5 * 864e5).toISOString(), comVal = { ...ok, expira_em: E }, em = (d) => Date.parse(E) - d * 864e5;   // mesma chave, relógio andando
  assert.equal(C.avisosDasChaves(ok, comVal, {}, em(10)).length, 0);
  a = C.avisosDasChaves(ok, comVal, {}, em(6.5)); assert.match(a[0].titulo, /7 dias/);
  const dados = { [a[0].chave]: 'x' };
  assert.equal(C.avisosDasChaves(ok, comVal, dados, em(6)).length, 0, 'não repete o de 7 dias');
  a = C.avisosDasChaves(ok, comVal, dados, em(2.5)); assert.match(a[0].titulo, /3 dias/);
  dados[a[0].chave] = 'x';
  a = C.avisosDasChaves(ok, comVal, dados, em(0.5)); assert.match(a[0].titulo, /amanhã/); assert.ok(a[0].urgente);
  const yc = { ...ok, servico: 'ycloud', saldo: 0.1 };
  assert.match(C.avisosDasChaves(yc, yc, {}, agora)[0].titulo, /YCloud/);
  assert.equal(C.avisosDasChaves({ ...yc, saldo: 5 }, { ...yc, saldo: 5 }, {}, agora).length, 0);
  assert.equal(C.avisosDasChaves(ok, { ...fora, servico: 'meta' }, {}, agora, false).length, 0, 'serviço fora de uso não avisa');
});
test('formato da chave antes de testar', () => {
  assert.equal(C.formatoValido('anthropic', 'sk-ant-api03-' + 'a'.repeat(40)), null);
  assert.equal(C.formatoValido('anthropic', 'sk-ant-usr-' + 'B1'.repeat(30)), null);
  assert.match(C.formatoValido('anthropic', 'sk-ant-admin01-' + 'a'.repeat(40)), /administrador/);
  assert.match(C.formatoValido('anthropic', 'sk-proj-abc'), /Anthropic/);
  assert.match(C.formatoValido('openai', 'sk-proj-abc def'), /espaços/);
  assert.equal(C.formatoValido('openai', 'sk-proj-' + 'x'.repeat(40)), null);
  assert.match(C.formatoValido('google', 'x'), /não aceita/);
});
