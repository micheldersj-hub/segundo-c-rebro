// node --test tools/ui/exportar.test.mjs — serviços de exportação do app (exportar.js) com o jsPDF real guardado em vendor/.
// O PDF gerado é conferido de verdade: texto extraído com pdftotext, páginas contadas, cabeçalho repetido, acentos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const APP = process.env.APP_DIR || new URL('../../../segundo-cerebro-app', import.meta.url).pathname;
const X = await import(join(APP, 'exportar.js'));
const { jsPDF } = createRequire(import.meta.url)(join(APP, 'vendor/jspdf-4.2.1.umd.min.js'));
const dir = mkdtempSync(join(tmpdir(), 'exp-'));
const texto = (buf, nome) => { const f = join(dir, nome); writeFileSync(f, Buffer.from(buf)); return { f, txt: execFileSync('pdftotext', ['-layout', f, '-']).toString(), paginas: +execFileSync('pdfinfo', [f]).toString().match(/Pages:\s+(\d+)/)[1] }; };
const empresa = (i, extra = {}) => ({ nome: `Padaria São João ${i}`, categoria: 'Panificação', distancia_m: 120 + i * 37, endereco: `Rua Turmalina ${i}, Betim, CEP 32641-832`, telefone: '(31) 3333-44' + String(i % 100).padStart(2, '0'), site: `https://padaria${i}.com.br`, motivo: 'Segmento próximo, faturamento alinhado', lat: -19.9, lng: -44.1, ...extra });
const gerar = async (n, extra) => X.pdfEmpresas(jsPDF, X.prepararEmpresas(Array.from({ length: n }, (_, i) => empresa(i + 1, extra?.(i)))), { titulo: 'Empresas perto de Betim · padaria', subtitulo: 'Rua Turmalina 12' });

// ---------- telefone ----------
test('telefone: DDD, código do país, 0 de discagem, internacional', () => {
  const ok = (e, d) => { const r = X.normalizarTelefone(e); assert.equal(r.ok, true, `${e}: ${r.erro}`); assert.equal(r.digitos, d); assert.equal(r.e164, `+${d}`); };
  ok('31994970760', '5531994970760'); ok('(31) 9 9497-0760', '5531994970760'); ok('+55 31 99497-0760', '5531994970760');
  ok('5531994970760', '5531994970760'); ok('031 99497-0760', '5531994970760'); ok('31 3333-4444', '553133334444');
  ok('553194970760', '553194970760');                        // formato antigo (sem o 9) que o WhatsApp ainda usa
  ok('+351 912 345 678', '351912345678'); ok('00 1 415 555 0100', '14155550100');
});
test('telefone: inválidos com motivo específico', () => {
  const erro = (e, c) => { const r = X.normalizarTelefone(e); assert.equal(r.ok, false, e); assert.equal(r.codigo, c, `${e}: ${r.codigo}`); };
  erro('994970760', 'sem_ddd'); erro('', 'vazio'); erro('Bruno', 'nao_numero'); erro('20 99497-0760', 'ddd_invalido');
  erro('31 89497-0760', 'invalido'); erro('319949707601234', 'invalido'); erro('+12', 'invalido');
  assert.match(X.normalizarTelefone('994970760').erro, /DDD/);
});
test('telefone: máscara e exibição', () => {
  assert.equal(X.mascaraTelefone('31994970760'), '(31) 99497-0760');
  assert.equal(X.mascaraTelefone('3133334444'), '(31) 3333-4444');
  assert.equal(X.mascaraTelefone('5531994970760'), '+55 (31) 99497-0760');
  assert.equal(X.mascaraTelefone('+351912'), '+351912');
  assert.equal(X.foneLegivel('5531994970760'), '+55 (31) 99497-0760');
  assert.equal(X.linkWhatsApp('31 99497-0760', 'Olá, ç & ?'), 'https://wa.me/5531994970760?text=Ol%C3%A1%2C%20%C3%A7%20%26%20%3F');
  assert.throws(() => X.linkWhatsApp('994970760'), { codigo: 'telefone_invalido' });
});
// ---------- e-mail ----------
test('e-mail: válido e inválidos com motivo', () => {
  assert.deepEqual(X.validarEmail(' Bruno@Empresa.com.br '), { ok: true, email: 'bruno@empresa.com.br' });
  for (const [e, re] of [['', /Digite/], ['bruno', /@/], ['a@b', /domínio/], ['a b@c.com', /espaços/], ['a@c.com, d@e.com', /vírgulas/], ['a..b@c.com', /antes do @/], ['a@-c.com', /domínio/]])
    assert.match(X.validarEmail(e).erro, re, e);
});
// ---------- dados ----------
test('dados: lista vazia, formato errado, campos vazios e controle', () => {
  assert.throws(() => X.prepararEmpresas([]), { codigo: 'vazio' });
  assert.throws(() => X.prepararEmpresas(null), { codigo: 'dados_invalidos' });
  const [e] = X.prepararEmpresas([null, { nome: '  Pa\u0000daria \n Nova ', distancia_m: null }]);
  assert.equal(e.nome, 'Padaria Nova'); assert.equal(e.distancia, ''); assert.equal(e.n, '1');
  assert.equal(X.prepararEmpresas([{}])[0].nome, '(sem nome)');
  assert.equal(X.prepararEmpresas([{ nome: 'A', distancia_m: 1530 }])[0].distancia, '1,5 km');
  assert.equal(X.prepararEmpresas([{ nome: 'Pão' }])[0].nome, 'Pão');      // acento decomposto vira composto
});
// ---------- CSV ----------
test('CSV: BOM, separador, aspas, vírgulas, quebras de linha, fórmulas', () => {
  const s = X.gerarCsv(['A', 'B', 'C'], [['x;y', 'diz "oi"', 'linha1\nlinha2'], ['=HYPERLINK("x")', '+55 31', '-12,5'], ['São João, ação', '', null]]);
  assert.ok(s.startsWith('﻿A;B;C\r\n'));
  const linhas = s.slice(1).split('\r\n');
  assert.equal(linhas[1], '"x;y";"diz ""oi""";"linha1\nlinha2"');
  assert.equal(linhas[2], `"'=HYPERLINK(""x"")";'+55 31;-12,5`);
  assert.equal(linhas[3], 'São João, ação;;');
  assert.equal(Buffer.from(s, 'utf8').subarray(0, 3).toString('hex'), 'efbbbf');
});
test('CSV: 12 e 5000 empresas, mesmas linhas e colunas do PDF', () => {
  for (const n of [12, 5000]) {
    const emp = X.prepararEmpresas(Array.from({ length: n }, (_, i) => empresa(i + 1, { motivo: i === 3 ? 'tem "aspas"; e\nquebra' : 'ok' })));
    const s = X.csvEmpresas(emp);
    // lê de volta com um leitor RFC 4180 simples
    const reg = []; let cel = '', lin = [], q = false;
    for (let i = 1; i < s.length; i++) { const c = s[i];
      if (q) { if (c === '"' && s[i + 1] === '"') { cel += '"'; i++; } else if (c === '"') q = false; else cel += c; }
      else if (c === '"') q = true; else if (c === ';') { lin.push(cel); cel = ''; } else if (c === '\r') {} else if (c === '\n') { lin.push(cel); reg.push(lin); lin = []; cel = ''; } else cel += c; }
    assert.equal(reg.length, n + 1); assert.ok(reg.every((l) => l.length === 9));
    assert.deepEqual(reg[0], ['Empresa', 'Segmento', 'Distância', 'Endereço', 'Telefone', 'Site', 'Por que abordar', 'Latitude', 'Longitude']);
    assert.equal(reg[4][6], 'tem "aspas"; e quebra'.replace(' quebra', ' quebra'));
    assert.equal(reg[n][0], `Padaria São João ${n}`);
  }
});
// ---------- PDF ----------
test('PDF: 1 empresa, título, data, identificação, acentos', async () => {
  const { txt, paginas } = texto(await gerar(1), 'um.pdf');
  assert.equal(paginas, 1);
  for (const t of ['Empresas perto de Betim · padaria', 'Padaria São João 1', 'Panificação', 'Gerado em', 'Relatório OR-', 'Página 1 de 1', '1 empresa'])
    assert.ok(txt.includes(t), `faltou "${t}"`);
});
test('PDF: 12, 100 e 500 empresas com todas as linhas, várias páginas e cabeçalho repetido', async () => {
  for (const n of [12, 100, 500]) {
    const t0 = Date.now(), buf = await gerar(n), ms = Date.now() - t0;
    const { txt, paginas } = texto(buf, `n${n}.pdf`);
    for (let i = 1; i <= n; i++) assert.ok(txt.includes(`Padaria São João ${i} `) || txt.includes(`Padaria São João ${i}\n`), `${n}: faltou a empresa ${i}`);
    const cab = (txt.match(/Empresa\s+Segmento\s+Distância/g) || []).length;
    assert.equal(cab, paginas, `${n}: cabeçalho em ${cab} de ${paginas} páginas`);
    assert.ok(txt.includes(`Página ${paginas} de ${paginas}`));
    console.log(`  ${n} empresas → ${paginas} páginas, ${(buf.byteLength / 1024).toFixed(0)} KB, ${ms} ms`);
  }
});
test('PDF: nomes e endereços enormes, URL sem espaço, caracteres especiais, emoji e campos vazios', async () => {
  const longo = 'Comércio de Pães, Doces & Salgados Ltda — Unidade Centro '.repeat(6);
  const buf = await gerar(8, (i) => i === 0 ? { nome: longo, endereco: 'Avenida '.repeat(40) + 'nº 1.234, apto 501', site: 'https://' + 'x'.repeat(220) + '.com.br' }
    : i === 1 ? { nome: 'Açaí & Café “Ñandú” – 50% off 🍞🥐', telefone: '', site: '', motivo: '' }
    : i === 2 ? { motivo: 'texto '.repeat(1200) } : {});
  const { txt, paginas } = texto(buf, 'longos.pdf');
  assert.ok(txt.includes('Açaí & Café “Ñandú” – 50% off'), 'acentos e aspas curvas');
  assert.ok(!/🍞|🥐/.test(txt));
  assert.ok(txt.includes('Padaria São João 8'));
  assert.ok(paginas >= 2, 'texto gigante quebra página sem travar');
  // nada passa da margem: a maior linha do PDF não pode sair da página (pdftotext -bbox)
  const bbox = execFileSync('pdftotext', ['-bbox', join(dir, 'longos.pdf'), '-']).toString();
  const xs = [...bbox.matchAll(/xMax="([\d.]+)"/g)].map((m) => +m[1]);
  assert.ok(Math.max(...xs) <= 842 - 30, `texto saiu da página: ${Math.max(...xs)}`);
});
test('PDF: falhas viram erro claro e nunca sucesso falso', async () => {
  assert.throws(() => X.criarDocumento(undefined, { titulo: 'x' }), { codigo: 'biblioteca' });
  const com = (output) => function (o) { const d = new jsPDF(o); d.output = output; return d; };   // jsPDF não aceita subclasse
  assert.throws(() => X.criarDocumento(com(() => { throw new Error('sem memória'); }), { titulo: 'x' }).finalizar(), { codigo: 'geracao' });
  assert.throws(() => X.criarDocumento(com(() => new ArrayBuffer(10)), { titulo: 'x' }).finalizar(), { codigo: 'geracao' });
  const corte = new Uint8Array(new jsPDF().output('arraybuffer')).slice(0, 2000).buffer;                // PDF truncado (sem %%EOF)
  assert.throws(() => X.criarDocumento(com(() => corte), { titulo: 'x' }).finalizar(), { codigo: 'geracao' });
});
test('PDF do dossiê (retrato): seções, listas e tabela de 2 colunas', async () => {
  const d = X.criarDocumento(jsPDF, { titulo: 'Oráculo · Padaria Três Poderes', subtitulo: 'CNPJ 12.345.678/0001-90' });
  d.secao('Resumo'); d.p('Empresa de panificação com 3 lojas.'); d.lista(['Primeiro passo', 'Segundo passo']);
  await d.tabela(['Campo', 'Valor'], [['Situação', 'ATIVA'], ['Endereço', 'Rua X, 10, Betim/MG']]);
  const { txt } = texto(d.finalizar(), 'dossie.pdf');
  for (const t of ['Oráculo · Padaria Três Poderes', 'Resumo', '- Primeiro passo', 'Situação', 'ATIVA']) assert.ok(txt.includes(t), t);
});
// ---------- compartilhar e erros de envio ----------
test('compartilhar: sucesso, cancelamento, sem gesto, sem suporte', async () => {
  const arq = [{ name: 'a.pdf' }];
  const nav = (comp) => ({ canShare: () => true, share: comp });
  assert.equal(await X.compartilharArquivos(nav(async () => {}), { arquivos: arq }), 'compartilhado');
  assert.equal(await X.compartilharArquivos(nav(async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); }), { arquivos: arq }), 'cancelado');
  await assert.rejects(X.compartilharArquivos(nav(async () => { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }); }), { arquivos: arq }), { codigo: 'sem_gesto' });
  await assert.rejects(X.compartilharArquivos({ canShare: () => false }, { arquivos: arq }), { codigo: 'sem_compartilhar' });
  await assert.rejects(X.compartilharArquivos({}, { arquivos: arq }), { codigo: 'sem_compartilhar' });
});
test('erros de envio: cada caso com sua mensagem', () => {
  assert.equal(X.erroDeEnvio(Object.assign(new TypeError('Load failed'))).codigo, 'sem_internet');
  assert.equal(X.erroDeEnvio(Object.assign(new Error('x'), { status: 401 })).codigo, 'sessao');
  assert.match(X.erroDeEnvio(Object.assign(new Error('...'), { codigo: 'fora_janela' })).message, /24 h/);
  assert.match(X.erroDeEnvio(Object.assign(new Error('Mais de um contato: Ana, Ana Paula.'), { codigo: 'contato_ambiguo' })).message, /Ana Paula/);
  assert.equal(X.erroDeEnvio(new Error('WhatsApp 400: {"error":{}}')).message, 'O envio falhou. Tente de novo.');
});
