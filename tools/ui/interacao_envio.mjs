// Interação ponta a ponta da exportação do Oráculo (v44) num Chromium com tela de iPhone:
// PDF/CSV com folha nativa (sucesso, cancelamento, sem suporte), e-mail (inválido, falha, sucesso com anexos reais),
// WhatsApp pelo celular (número não salvo, sem DDD, link oficial + arquivo) e pelo número comercial (lista, 24 h, erros da Meta),
// sem internet, toque duplo, rascunho preservado, 500 empresas. Os arquivos compartilhados/enviados são abertos e conferidos.
// LARG=320 ESCURO=1 node interacao_envio.mjs
import { createRequire } from 'node:module';
const require = createRequire('/usr/lib/node_modules/');
const { chromium } = require('playwright');
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
const RAIZ = process.env.APP_DIR || new URL('../../../segundo-cerebro-app', import.meta.url).pathname;
const LARG = +(process.env.LARG || 390), ESCURO = process.env.ESCURO === '1', SAIDA = process.env.SAIDA || '/tmp';
const GANCHO = `\nwindow.__t = { empresas(l) { Geo.empresas = l; Geo.segmento = 'padaria'; Geo.ultimo = { local: { bairro: 'Betim', cidade: 'Betim', endereco: 'Rua Turmalina 12, Betim' } }; document.querySelector('#__exp').innerHTML = blocoExportar('perto', 'Exportar ou enviar as ' + l.length + ' empresas'); }, fechar: fecharFolha };\n`;
const srv = http.createServer((q, r) => { const f = path.join(RAIZ, decodeURIComponent(new URL(q.url, 'http://x').pathname)); fs.readFile(f, (e, d) => { r.writeHead(e ? 404 : 200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); r.end(f.endsWith('app.js') && d ? d + GANCHO : d); }); }).listen(8767);
const STUB = `export function createClient(){return{auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}}},signOut:async()=>({})}}}`;
const agora = Date.now(), h = (x) => new Date(agora - x * 3600e3).toISOString();
const contatos = { contatos: [
  { wa_id: '5531988887777', name: 'Bruno Lima', last_seen: h(2), last_in_at: h(2) },
  { wa_id: '5531977776666', name: 'Ana Souza', last_seen: h(50), last_in_at: h(50) },
  { wa_id: '5500000000000', name: '[teste removido]', last_seen: h(1), last_in_at: h(1) },
] };
const empresa = (i) => ({ nome: i === 3 ? 'Açaí & Café “Ñandú”; "Premium"' : `Padaria São João ${i}`, categoria: 'Panificação', distancia_m: 100 + i * 40, endereco: `Rua Turmalina ${i}, Betim`, telefone: `(31) 3333-44${String(i).padStart(2, '0')}`, site: '', motivo: i === 5 ? 'linha 1\nlinha 2' : 'Segmento próximo' });
const br = await chromium.launch();
const ctx = await br.newContext({ viewport: { width: LARG, height: 780 }, colorScheme: ESCURO ? 'dark' : 'light', hasTouch: true, isMobile: true });
const pg = await ctx.newPage(); pg.setDefaultTimeout(5000);
const erros = [], posts = [], abertos = [];
let semRede = false, modoServidor = 'ok';
pg.on('pageerror', (e) => erros.push(e.message));
ctx.on('page', async (p) => { abertos.push(p.url()); await p.close().catch(() => {}); });
await ctx.route('**/*', async (rt) => {
  const u = new URL(rt.request().url());
  if (u.host === 'localhost:8767') return rt.continue();
  if (u.host === 'wa.me') { abertos.push(u.href); return rt.fulfill({ status: 200, body: 'ok' }); }
  if (u.host.includes('jsdelivr')) return rt.fulfill({ status: 200, contentType: 'text/javascript', body: STUB });
  const j = (b, st = 200) => rt.fulfill({ status: st, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
  if (u.pathname.endsWith('/contatos')) return j(contatos);
  if (u.pathname.endsWith('/exportar')) {
    if (semRede) return rt.abort('internetdisconnected');
    const b = JSON.parse(rt.request().postData()); posts.push(b);
    if (b.canal === 'email' && modoServidor === 'falha') return j({ erro: 'O Gmail não aceitou o envio.', codigo: 'email_falhou' }, 422);
    if (b.canal === 'whatsapp' && b.para === '5531977776666') return j({ erro: 'Ana Souza não escreve há mais de 24 h; a Meta não deixa.', codigo: 'fora_janela' }, 422);
    return j({ ok: true, enviado: true, mensagem: b.canal === 'email' ? `E-mail enviado para ${b.para}.` : 'Enviado no WhatsApp comercial para Bruno Lima.' });
  }
  return j({});
});
// Folha nativa simulada: guarda o que foi compartilhado; comportamento configurável (ok, cancelar, sem suporte).
await pg.addInitScript(() => {
  localStorage.setItem('cerebro-chave', 'k'); localStorage.setItem('cerebro-ativar-depois', String(Date.now()));
  window.__share = { modo: 'ok', feitos: [] };
  navigator.canShare = (d) => window.__share.modo !== 'sem' && !!d?.files?.length;
  navigator.share = async (d) => {
    if (window.__share.modo === 'cancelar') throw new DOMException('cancelado', 'AbortError');
    const arqs = await Promise.all(d.files.map(async (f) => ({ nome: f.name, tipo: f.type, b64: btoa(String.fromCharCode(...new Uint8Array(await f.arrayBuffer()))) })));
    window.__share.feitos.push({ arqs, text: d.text || '' });
  };
});
await pg.goto('http://localhost:8767/index.html#hoje'); await pg.waitForTimeout(900);
await pg.evaluate(() => { const d = document.createElement('div'); d.id = '__exp'; d.style.cssText = 'position:fixed;top:60px;left:8px;right:8px;z-index:5'; document.body.append(d); });
const r = []; const ok = (c, t) => r.push(`${c ? 'OK    ' : 'FALHOU'} ${t}`);
const dir = fs.mkdtempSync(path.join(SAIDA, 'envio-'));
const salvar = (a) => { const f = path.join(dir, a.nome); fs.writeFileSync(f, Buffer.from(a.b64 ?? a.base64, 'base64')); return f; };
const txtPdf = (f) => execFileSync('pdftotext', ['-layout', f, '-']).toString();
const feitos = () => pg.evaluate(() => window.__share.feitos.length);
const ultimo = () => pg.evaluate(() => window.__share.feitos.at(-1));
const msg = () => pg.textContent('#folha-erro');
const folhaAberta = () => pg.evaluate(() => !document.querySelector('#folha').hidden && document.querySelector('#folha').classList.contains('aberta'));
const enviar = async () => { await pg.click('#folha-salvar'); await pg.waitForTimeout(500); };
const fechar = async () => { await pg.evaluate(() => window.__t.fechar()); await pg.waitForTimeout(300); };
const ultimoAviso = () => pg.evaluate(() => [...document.querySelectorAll('.aviso, #aviso, .toast')].map((e) => e.textContent).join(' | '));
await pg.evaluate((l) => window.__t.empresas(l), Array.from({ length: 12 }, (_, i) => empresa(i + 1)));

try {
// ---- PDF: folha nativa, conteúdo, cancelamento, toque duplo ----
await pg.click('[data-exp="pdf"]'); await pg.click('[data-exp="pdf"]').catch(() => {}); await pg.waitForTimeout(1200);
ok(await folhaAberta() && /PDF pronto/.test(await pg.textContent('#folha-titulo')), 'PDF: folha "PDF pronta" com o arquivo');
ok(/empresas-perto-betim-padaria\.pdf/.test(await pg.textContent('#folha-campos')) && /12 empresas/.test(await pg.textContent('#folha-campos')), 'PDF: nome do arquivo e quantidade');
await pg.screenshot({ path: `${dir}/pdf_pronto_${LARG}${ESCURO ? '_escuro' : ''}.png` });
await pg.evaluate(() => (window.__share.modo = 'cancelar')); await enviar();
ok(await folhaAberta() && /cancelado/i.test(await msg()) && await pg.evaluate(() => document.querySelector('#folha-erro').classList.contains('neutro')), 'PDF: cancelar mantém a folha aberta com aviso neutro');
await pg.evaluate(() => (window.__share.modo = 'ok')); await enviar();
ok(!(await folhaAberta()) && (await feitos()) === 1, 'PDF: tentar de novo compartilha (uma vez só, sem duplicar)');
let u = await ultimo(), f = salvar(u.arqs[0]), t = txtPdf(f);
ok(u.arqs[0].tipo === 'application/pdf' && /^%PDF-/.test(fs.readFileSync(f, 'latin1').slice(0, 5)), 'PDF: arquivo é PDF de verdade');
ok(Array.from({ length: 12 }, (_, i) => i + 1).every((i) => i === 3 || t.includes(`Padaria São João ${i}`)) && t.includes('Açaí & Café “Ñandú”; "Premium"'), 'PDF: as 12 empresas, com acentos e aspas');
ok(t.includes('Empresas perto de Betim · padaria') && /Relatório OR-/.test(t) && /Gerado em/.test(t), 'PDF: título, data e identificação');
// ---- sem suporte a compartilhar: vira "Baixar" ----
await pg.evaluate(() => (window.__share.modo = 'sem')); await pg.click('[data-exp="pdf"]'); await pg.waitForTimeout(900);
ok((await pg.textContent('#folha-salvar')) === 'Baixar' && await pg.$('#folha [data-baixar][download]'), 'PDF: sem compartilhar nativo → botão Baixar');
await fechar(); await pg.evaluate(() => (window.__share.modo = 'ok'));
// ---- CSV ----
await pg.click('[data-exp="csv"]'); await pg.waitForTimeout(600); await enviar();
u = await ultimo(); f = salvar(u.arqs[0]); const csv = fs.readFileSync(f);
ok(csv.subarray(0, 3).toString('hex') === 'efbbbf' && /^text\/csv/.test(u.arqs[0].tipo), 'CSV: UTF-8 com BOM e tipo text/csv');
const csvTxt = csv.toString('utf8');
ok(csvTxt.includes('"Açaí & Café “Ñandú”; ""Premium"""') && csvTxt.includes(';linha 1 linha 2') && csvTxt.split('\r\n').filter(Boolean).length === 13, 'CSV: 12 linhas + cabeçalho, aspas, ";" e quebra de linha corretos');
// ---- E-mail ----
await pg.click('[data-exp="email"]'); await pg.waitForTimeout(500);
await pg.fill('#folha [name=para]', 'bruno@'); await enviar();
ok(/@|domínio/.test(await msg()) && posts.length === 0, `E-mail inválido: "${await msg()}" e nada enviado`);
await pg.fill('#folha [name=para]', 'Bruno@Empresa.com.br'); modoServidor = 'falha'; await enviar(); await pg.waitForTimeout(800);
ok(await folhaAberta() && /Gmail/.test(await msg()), `E-mail com falha do servidor: "${await msg()}" e folha continua aberta`);
modoServidor = 'ok'; await enviar(); await pg.waitForTimeout(900);
let p = posts.at(-1);
ok(!(await folhaAberta()) && p.canal === 'email' && p.para === 'bruno@empresa.com.br' && p.arquivos.length === 2, 'E-mail: enviou para o endereço normalizado com PDF e CSV');
ok(txtPdf(salvar(p.arquivos[0])).includes('Padaria São João 12') && Buffer.from(p.arquivos[1].base64, 'base64').toString('utf8').includes('Padaria São João 12'), 'E-mail: anexos são o PDF e o CSV reais');
// ---- WhatsApp pelo celular: número não salvo ----
await pg.click('[data-exp="whatsapp"]'); await pg.waitForTimeout(900);
await pg.screenshot({ path: `${dir}/whats_${LARG}${ESCURO ? '_escuro' : ''}.png` });
await pg.fill('#folha .contato-busca', '994970760'); await pg.waitForTimeout(150);
ok(/DDD/.test(await pg.textContent('.contato-status')), `Celular: sem DDD → "${await pg.textContent('.contato-status')}"`);
await enviar();
ok(/DDD/.test(await msg()) && abertos.length === 0, 'Celular: não abre nada com número inválido');
await pg.fill('#folha .contato-busca', ''); await pg.type('#folha .contato-busca', '31994970760'); await pg.waitForTimeout(200);
ok((await pg.inputValue('#folha .contato-busca')) === '(31) 99497-0760' && /\+55 \(31\) 99497-0760/.test(await pg.textContent('.contato-status')), 'Celular: máscara e validação do número digitado');
ok(/1\. Abrir conversa/.test(await pg.textContent('#folha-salvar')), 'Celular: etapa 1 no botão');
await enviar(); await pg.waitForTimeout(400);
ok(abertos.some((x) => x.startsWith('https://wa.me/5531994970760?text=Segue%20a%20lista%20de%2012%20empresas')), `Celular: abriu o link oficial com E.164 e mensagem (${abertos.at(-1)?.slice(0, 60)})`);
ok(/2\. Mandar o arquivo/.test(await pg.textContent('#folha-salvar')) && /Volte aqui/.test(await msg()), 'Celular: passa para a etapa 2 sem dizer que enviou');
const antes = await feitos(); await enviar(); await pg.waitForTimeout(400);
u = await ultimo();
ok((await feitos()) === antes + 1 && u.arqs.length === 1 && /\.pdf$/.test(u.arqs[0].nome) && u.text === '', 'Celular: etapa 2 manda o PDF pela folha nativa (sem repetir o texto)');
// ---- WhatsApp pelo celular sem número + PDF e CSV ----
await pg.click('[data-exp="whatsapp"]'); await pg.waitForTimeout(600);
ok((await pg.inputValue('#folha [name=texto]')).startsWith('Segue a lista'), 'Rascunho: mensagem preservada ao reabrir');
await pg.click('#folha label:has(input[name=csv])'); await pg.waitForTimeout(300); await enviar();
u = await ultimo();
ok(u.arqs.length === 2 && /Segue a lista/.test(u.text), 'Celular sem número: compartilha PDF + CSV com a mensagem');
// ---- WhatsApp comercial ----
await pg.click('[data-exp="whatsapp"]'); await pg.waitForTimeout(600);
await pg.click('#folha .escolha label:has(input[value=comercial])'); await pg.waitForTimeout(300);
const ops = await pg.$$eval('.contato-op', (bs) => bs.map((b) => `${b.dataset.nome}${b.disabled ? '(bloq)' : ''}`));
ok(ops.includes('Bruno Lima') && ops.includes('Ana Souza(bloq)') && !ops.some((o) => /teste/.test(o)), `Comercial: lista respeita 24 h (${ops.join(', ')})`);
ok((await pg.textContent('#folha-salvar')) === 'Enviar agora', 'Comercial: botão Enviar agora');
await pg.fill('#folha .contato-busca', 'brun'); await pg.click('.contato-op'); await enviar(); await pg.waitForTimeout(900);
p = posts.at(-1);
ok(!(await folhaAberta()) && p.canal === 'whatsapp' && p.para === '5531988887777' && p.arquivos.length >= 1, 'Comercial: enviou para Bruno com o arquivo');
await pg.click('[data-exp="whatsapp"]'); await pg.waitForTimeout(600);
ok(await pg.isChecked('#folha input[value=comercial]'), 'Rascunho: modo comercial lembrado');
await pg.click('#folha [data-trocar]').catch(() => {}); await pg.fill('#folha .contato-busca', '31977776666'); await pg.waitForTimeout(150); await pg.click('.contato-op:not([disabled])').catch(() => {});
await enviar(); await pg.waitForTimeout(800);
ok(await folhaAberta() && /24 h/.test(await msg()), `Comercial fora das 24 h: "${await msg()}"`);
semRede = true; await pg.click('#folha [data-trocar]').catch(() => {}); await pg.fill('#folha .contato-busca', 'brun'); await pg.click('.contato-op'); await enviar(); await pg.waitForTimeout(800);
ok(await folhaAberta() && /internet/i.test(await msg()), `Sem internet: "${await msg()}"`);
semRede = false; await enviar(); await pg.waitForTimeout(800);
ok(!(await folhaAberta()), 'Sem internet → tentar de novo funciona');
// ---- lista vazia e 500 empresas ----
await pg.evaluate(() => window.__t.empresas([])); await pg.click('[data-exp="pdf"]'); await pg.waitForTimeout(500);
ok(/Faça a busca/.test(await pg.evaluate(() => document.body.innerText)), 'Lista vazia: mensagem clara, sem arquivo');
await pg.evaluate((l) => window.__t.empresas(l), Array.from({ length: 500 }, (_, i) => empresa(i + 1)));
const t0 = Date.now(); await pg.click('[data-exp="pdf"]'); await pg.waitForSelector('#folha.aberta'); const ms = Date.now() - t0; await enviar();
u = await ultimo(); t = txtPdf(salvar(u.arqs[0]));
ok(t.includes('Padaria São João 500') && /Página \d+ de \d+/.test(t), `500 empresas: PDF completo em ${ms} ms`);
ok(!(await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'Sem rolagem lateral');
} catch (e) { r.push(`FALHOU parou: ${e.message.split('\n')[0]} | folha: ${await msg().catch(() => '')}`); }
console.log(r.join('\n')); console.log(erros.length ? 'ERROS: ' + erros.join(' | ') : 'SEM ERROS DE PÁGINA'); console.log('prints em', dir);
await br.close(); srv.close();
process.exit(r.some((x) => x.startsWith('FALHOU')) || erros.length ? 1 : 0);
