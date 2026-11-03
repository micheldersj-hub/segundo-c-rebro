// Roda o app inteiro (index.html real) no Chromium; chamadas ao servidor respondidas com JSON real capturado (fx/).
import { createRequire } from 'node:module'; const { chromium } = createRequire(import.meta.url)('playwright');
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
const RAIZ = process.env.APP_DIR || new URL('../../../segundo-cerebro-app', import.meta.url).pathname, FX = new URL('./fx', import.meta.url).pathname;
const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/json' };
const srv = http.createServer((q, r) => { const f = path.join(RAIZ, decodeURIComponent(new URL(q.url, 'http://x').pathname)); fs.readFile(f.endsWith('/') ? f + 'index.html' : f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': tipos[path.extname(f)] || 'application/octet-stream' }); r.end(d); }); }).listen(8765);
const fx = (n) => { try { return fs.readFileSync(`${FX}/${n}.json`, 'utf8'); } catch { return null; } };
const STUB = `export function createClient(){ const auth={ getSession: async()=>({data:{session:null}}), signOut: async()=>({}), onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}} }; return { auth, from(){ return { select(){return this}, insert: async()=>({}) } }, channel(){ return { on(){return this}, subscribe(){return this} } } }; }`;
const br = await chromium.launch();
const larguras = (process.argv[2] || '390').split(',').map(Number);
const telas = (process.argv[3] || 'olho').split(',');
const erros = [];
for (const w of larguras) {
  const ctx = await br.newContext({ viewport: { width: w, height: 860 }, deviceScaleFactor: 2, colorScheme: process.env.ESCURO ? 'dark' : 'light', serviceWorkers: 'block' });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => erros.push(`[${w}] pageerror ${e.message}`));
  pg.on('console', (m) => { if (m.type() === 'error') erros.push(`[${w}] console ${m.text()}`); });
  await pg.route('**/*', async (rt) => {
    const u = new URL(rt.request().url());
    if (u.host === 'localhost:8765') return rt.continue();
    if (u.host.includes('jsdelivr')) return rt.fulfill({ status: 200, contentType: 'text/javascript', body: STUB });
    if (u.host.includes('supabase.co')) {
      const m = u.pathname.match(/functions\/v1\/(\w+)(\/.*)?$/);
      const nome = m ? `${m[1]}${(m[2] || '').replace(/\//g, '_')}` : 'x';
      const metodo = rt.request().method();
      const corpo = fx(`${metodo === 'POST' ? 'POST_' : ''}${nome}`) ?? fx(nome) ?? (metodo === 'POST' ? '{"ok":true}' : '{}');
      return rt.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: corpo });
    }
    return rt.fulfill({ status: 204, body: '' });
  });
  await pg.addInitScript(() => { localStorage.setItem('cerebro-chave', 'chave-de-teste-local'); localStorage.setItem('cerebro-ativar-depois', String(Date.now())); });
  for (const t of telas) {
    await pg.goto(`http://localhost:8765/index.html#${t}`); await pg.waitForTimeout(1600);
    const sw = await pg.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    if (sw[0] > sw[1]) erros.push(`[${w}] #${t} transborda: scrollWidth ${sw[0]} > ${sw[1]}`);
    const nome = t.replace(/\W/g, '_');
    await pg.screenshot({ path: `${process.env.SAIDA || '/tmp'}/ui_${nome}_${w}${process.env.ESCURO ? '_esc' : ''}.png`, fullPage: true });
  }
  await ctx.close();
}
await br.close(); srv.close();
console.log(erros.length ? erros.join('\n') : 'SEM ERROS');
