// Interação: abrir formulário de saldo, enviar, trocar temporizador, aplicar preset — sem erros e com as requisições certas.
import { createRequire } from 'node:module';
const require = createRequire('/usr/lib/node_modules/');
const { chromium } = require('playwright');
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const RAIZ = process.env.APP_DIR || new URL('../../../segundo-cerebro-app', import.meta.url).pathname;
const srv = http.createServer((q, r) => { const f = path.join(RAIZ, decodeURIComponent(new URL(q.url, 'http://x').pathname)); fs.readFile(f, (e, d) => { r.writeHead(e ? 404 : 200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); r.end(d); }); }).listen(8766);
const STUB = `export function createClient(){return{auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}}},signOut:async()=>({})}}}`;
const painel = fs.readFileSync(new URL('./fx/consumo_painel.json', import.meta.url).pathname, 'utf8');
const br = await chromium.launch(); const pg = await br.newPage({ viewport: { width: 390, height: 860 } });
const erros = [], posts = [];
pg.on('pageerror', (e) => erros.push(e.message));
await pg.route('**/*', async (rt) => {
  const u = new URL(rt.request().url());
  if (u.host === 'localhost:8766') return rt.continue();
  if (u.host.includes('jsdelivr')) return rt.fulfill({ status: 200, contentType: 'text/javascript', body: STUB });
  if (u.pathname.includes('/consumo/')) { if (rt.request().method() === 'POST') posts.push(`${u.pathname.split('/consumo')[1]} ${rt.request().postData()}`); return rt.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: painel }); }
  return rt.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' });
});
await pg.addInitScript(() => { localStorage.setItem('cerebro-chave', 'k'); localStorage.setItem('cerebro-ativar-depois', String(Date.now())); });
await pg.goto('http://localhost:8766/index.html#config'); await pg.waitForTimeout(1200);
await pg.click('.cfg-hero [data-cfg-form="recarga"]'); await pg.fill('.cfg-saldo-form input', '25,50'); await pg.click('.cfg-saldo-form .btn.primario'); await pg.waitForTimeout(400);
await pg.click('[data-cfg-dia]:nth-of-type(20)').catch(() => {}); await pg.waitForTimeout(200);
await pg.click('#cfg-abas [data-cfg-aba="economia"]'); await pg.waitForTimeout(600);
await pg.selectOption('[data-cfg-tempo="radar"]', 'seg_qua_sex'); await pg.waitForTimeout(400);
await pg.click('[data-cfg-preset="economico"]'); await pg.waitForTimeout(400);
await pg.click('#cfg-abas [data-cfg-aba="alertas"]'); await pg.waitForTimeout(600);
await pg.fill('[name="alerta_dia_usd"]', '3'); await pg.click('#cfg-alertas .btn.primario'); await pg.waitForTimeout(400);
console.log(posts.join('\n')); console.log(erros.length ? 'ERROS: ' + erros.join(' | ') : 'SEM ERROS');
await br.close(); srv.close();
