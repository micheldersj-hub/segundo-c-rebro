// Interação: folha "Enviar no WhatsApp" com lista de contatos (busca, regra das 24 h, número digitado) e o carregador do PDF
// com o pacote da tabela em formatos diferentes (o formato real da CDN deu "autoTable is not a function" na v42).
import { createRequire } from 'node:module';
const require = createRequire('/usr/lib/node_modules/');
const { chromium } = require('playwright');
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const RAIZ = process.env.APP_DIR || new URL('../../../segundo-cerebro-app', import.meta.url).pathname;
const LARG = +(process.env.LARG || 390), ESCURO = process.env.ESCURO === '1';
const GANCHO = '\nwindow.__t = { abrirFolha, carregarPdf, reset: () => { libPdf = null; } };\n';
const srv = http.createServer((q, r) => { const f = path.join(RAIZ, decodeURIComponent(new URL(q.url, 'http://x').pathname)); fs.readFile(f, (e, d) => { r.writeHead(e ? 404 : 200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); r.end(f.endsWith('app.js') && d ? d + GANCHO : d); }); }).listen(8767);
const STUB = `export function createClient(){return{auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}}},signOut:async()=>({})}}}`;
const JSPDF = `export class jsPDF { autoTable(o){ this.lastAutoTable={finalY:1}; } } export default { jsPDF };`;
const FORMATOS = {   // formatos possíveis do pacote da tabela vindo da CDN
  cjs_aninhado: `const f=(d,o)=>{d.lastAutoTable={finalY:1}}; export default { default: f, applyPlugin(){} };`,
  nomeado: `export function autoTable(d,o){d.lastAutoTable={finalY:1}} export default {};`,
  so_plugin: `export default { applyPlugin(j){ j.API={autoTable(){}} } };`,
};
let formato = 'cjs_aninhado';
const agora = Date.now(), h = (x) => new Date(agora - x * 3600e3).toISOString();
const contatos = { contatos: [
  { wa_id: '5531988887777', name: 'Bruno Lima', last_seen: h(2), last_in_at: h(2) },
  { wa_id: '5531977776666', name: 'Ana Souza', last_seen: h(50), last_in_at: h(50) },
  { wa_id: '5531966665555', name: '<unknown>', last_seen: h(5), last_in_at: h(5) },
  { wa_id: '5500000000000', name: '[teste removido]', last_seen: h(1), last_in_at: h(1) },
] };
const br = await chromium.launch(); const pg = await br.newPage({ viewport: { width: LARG, height: 800 }, colorScheme: ESCURO ? 'dark' : 'light' });
const erros = [], posts = [];
pg.on('pageerror', (e) => erros.push(e.message));
await pg.route('**/*', async (rt) => {
  const u = new URL(rt.request().url());
  if (u.host === 'localhost:8767') return rt.continue();
  if (u.host.includes('jsdelivr')) return rt.fulfill({ status: 200, contentType: 'text/javascript', body: u.pathname.includes('autotable') ? FORMATOS[formato] : u.pathname.includes('jspdf') ? JSPDF : STUB });
  const j = (b) => rt.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
  if (u.pathname.endsWith('/contatos')) return j(contatos);
  if (rt.request().method() === 'POST') posts.push(`${u.pathname.split('/').pop()} ${rt.request().postData()}`);
  return j({});
});
await pg.addInitScript(() => { localStorage.setItem('cerebro-chave', 'k'); localStorage.setItem('cerebro-ativar-depois', String(Date.now())); });
await pg.goto('http://localhost:8767/index.html#hoje'); await pg.waitForTimeout(1000);
const r = [];
const ok = (cond, txt) => r.push(`${cond ? 'OK ' : 'FALHOU'} ${txt}`);
// 1) PDF nos três formatos
for (const f of Object.keys(FORMATOS)) {
  formato = f; await pg.reload(); await pg.waitForTimeout(500);   // módulo novo a cada formato (a CDN fica em cache por página)
  const res = await pg.evaluate(async (f) => { window.__t.reset(); try { const { jsPDF, autoTable } = await window.__t.carregarPdf(`?${f}`); const d = new jsPDF(); autoTable(d, {}); return typeof autoTable; } catch (e) { return 'erro: ' + e.message; } }, f);
  ok(res === 'function', `PDF com formato ${f} → ${res}`);
}
// 2) Folha com lista de contatos
await pg.evaluate(() => window.__t.abrirFolha({ titulo: 'Enviar no WhatsApp', botao: 'Enviar', campos: [{ tipo: 'contato', rotulo: 'Para quem', nome: 'para', dica: 'dica' }], salvar: async (f) => { await fetch('https://x.supabase.co/functions/v1/extra/exportar', { method: 'POST', body: JSON.stringify(f) }); } }));
await pg.waitForTimeout(600);
const nomes = await pg.$$eval('.contato-op', (bs) => bs.map((b) => `${b.dataset.nome}${b.disabled ? ' (bloq)' : ''}`));
ok(nomes[0] === 'Bruno Lima' && nomes.some((n) => n === 'Ana Souza (bloq)') && !nomes.some((n) => n.includes('teste')), `lista: ${nomes.join(', ')}`);
await pg.screenshot({ path: `/tmp/claude-0/envio_${LARG}${ESCURO ? '_escuro' : ''}.png` });
const largo = await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth);
ok(!largo, 'sem rolagem lateral');
await pg.fill('.contato-busca', 'brun'); await pg.waitForTimeout(150);
ok((await pg.$$('.contato-op')).length === 1, 'busca "brun" filtra para 1');
await pg.fill('.contato-busca', '31 95555-4444'); await pg.waitForTimeout(150);
ok(/Enviar para/.test(await pg.textContent('.contato-lista')), 'número digitado vira opção');
await pg.fill('.contato-busca', 'bruno'); await pg.click('.contato-op');
ok(await pg.isVisible('.contato-escolhido') && (await pg.inputValue('[name=para]')) === '5531988887777', 'escolher Bruno preenche o número');
await pg.click('#folha-salvar'); await pg.waitForTimeout(400);
ok(posts.some((p) => p.includes('5531988887777')), `enviou: ${posts.join(' | ')}`);
console.log(r.join('\n')); console.log(erros.length ? 'ERROS: ' + erros.join(' | ') : 'SEM ERROS');
await br.close(); srv.close();
