// Simula o bug do iOS e o teclado com um visualViewport falso e confere a barra e o painel de resposta.
import { createRequire } from 'node:module';
const require = createRequire('/usr/lib/node_modules/');
const { chromium } = require('playwright');
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const RAIZ = process.env.APP_DIR || new URL('../../../segundo-cerebro-app', import.meta.url).pathname;
const srv = http.createServer((q, r) => { const f = path.join(RAIZ, decodeURIComponent(new URL(q.url, 'http://x').pathname)); fs.readFile(f, (e, d) => { r.writeHead(e ? 404 : 200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); r.end(d); }); }).listen(8767);
const STUB = `export function createClient(){return{auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}}},signOut:async()=>({})}}}`;
const br = await chromium.launch(); const pg = await br.newPage({ viewport: { width: 390, height: 844 } });
const erros = []; pg.on('pageerror', (e) => erros.push(e.message));
await pg.route('**/*', async (rt) => {
  const u = new URL(rt.request().url());
  if (u.host === 'localhost:8767') return rt.continue();
  if (u.host.includes('jsdelivr')) return rt.fulfill({ status: 200, contentType: 'text/javascript', body: STUB });
  return rt.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"turnos":[],"mensagens":[]}' });
});
await pg.addInitScript(() => {
  localStorage.setItem('cerebro-chave', 'k'); localStorage.setItem('cerebro-ativar-depois', String(Date.now()));
  const fake = new EventTarget(); fake.height = 844; fake.offsetTop = 0; fake.width = 390;
  Object.defineProperty(window, 'visualViewport', { get: () => fake });
  window.__vv = fake;
});
await pg.goto('http://localhost:8767/index.html#conversa'); await pg.waitForTimeout(1000);
const ler = () => pg.evaluate(() => ({ desloc: getComputedStyle(document.documentElement).getPropertyValue('--vv-desloc'), tec: document.documentElement.classList.contains('teclado'), abas: getComputedStyle(document.querySelector('.abas')).visibility }));
console.log('normal', await ler());
// bug do iOS: tela visível de 844, mas o navegador acha que tem 500
await pg.evaluate(() => { Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => 500 }); window.__vv.dispatchEvent(new Event('resize')); });
await pg.waitForTimeout(100); console.log('bug iOS', await ler());
// teclado aberto: innerHeight 844, área visível 500, com foco num campo
await pg.evaluate(() => { Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => 844 }); window.__vv.height = 500; const t = document.querySelector('#v-conversa textarea, #v-conversa input'); t?.focus(); window.__vv.dispatchEvent(new Event('resize')); });
await pg.waitForTimeout(500); console.log('teclado', await ler(), await pg.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--vv-teclado')));
// fecha o teclado
await pg.evaluate(() => { window.__vv.height = 844; document.activeElement?.blur(); window.__vv.dispatchEvent(new Event('resize')); });
await pg.waitForTimeout(400); console.log('fechou', await ler());
console.log(erros.length ? 'ERROS ' + erros.join(' | ') : 'SEM ERROS');
await br.close(); srv.close();
