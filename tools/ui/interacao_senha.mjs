// Criar senha pelo link de convite (v48). Reproduz o defeito de 11/11: depois do link, a biblioteca de login
// do Supabase travava (getSession/updateUser nunca respondiam) e o botão "Salvar e entrar" ficava parado.
// Aqui ela trava de propósito; o app tem que gravar a senha pelo servidor (/equipe/senha) e entrar. LARG=320
import { createRequire } from 'node:module';
const require = createRequire('/usr/lib/node_modules/');
const { chromium } = require('playwright');
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const RAIZ = process.env.APP_DIR || new URL('../../../segundo-cerebro-app', import.meta.url).pathname;
const LARG = +(process.env.LARG || 390), ESCURO = process.env.ESCURO === '1';
const srv = http.createServer((q, r) => { const f = path.join(RAIZ, decodeURIComponent(new URL(q.url, 'http://x').pathname)); fs.readFile(f, (e, d) => { r.writeHead(e ? 404 : 200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); r.end(d); }); }).listen(8771);
// Biblioteca de login falsa: o link funciona (verifyOtp), mas depois disso getSession e updateUser nunca respondem.
const STUB = `let travou=false;const sess={access_token:'a.b.c',user:{id:'u2'}};
export function createClient(){return{auth:{
  getSession:()=>travou?new Promise(()=>{}):Promise.resolve({data:{session:null}}),
  verifyOtp:async()=>{travou=true;return{data:{session:sess},error:null}},
  updateUser:()=>new Promise(()=>{}),
  onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}}},signOut:async()=>({}),signInWithPassword:async()=>({error:{message:'x'}})}}}`;
const br = await chromium.launch(); const pg = await br.newPage({ viewport: { width: LARG, height: 760 }, colorScheme: ESCURO ? 'dark' : 'light' });
const erros = [], posts = [], auth = [];
pg.on('pageerror', (e) => erros.push(e.message));
await pg.route('**/*', async (rt) => {
  const u = new URL(rt.request().url());
  if (u.host === 'localhost:8771') return rt.continue();
  if (u.host.includes('jsdelivr')) return rt.fulfill({ status: 200, contentType: 'text/javascript', body: STUB });
  const p = u.pathname.replace('/functions/v1', ''), j = (b, st = 200) => rt.fulfill({ status: st, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
  auth.push(`${p} ${rt.request().headers().authorization || ''}`);
  if (rt.request().method() === 'POST') { posts.push(`${p} ${rt.request().postData() || ''}`); if (p === '/equipe/senha') { const s = JSON.parse(rt.request().postData()).senha; return s === 'fraca123' ? j({ erro: 'Essa senha é fácil de adivinhar ou já apareceu em vazamentos. Escolha outra.' }, 400) : j({ ok: true }); } return j({}); }
  if (p === '/equipe/eu') return j({ usuario: { id: 'u2', nome: 'Amanda Aquiles', email: 'amanda@x.com', papel: 'membro' }, dono: false });
  if (p === '/app/hoje') return j({ avisos: [], perguntas: [], agenda: [], aguardando: [], lembretes: [] });
  return j({});
});
const r = []; const ok = (c, t) => r.push(`${c ? 'OK    ' : 'FALHOU'} ${t}`);
try {
  await pg.goto('http://localhost:8771/index.html#acesso=codigo-de-teste'); await pg.waitForTimeout(5500);
  ok(await pg.isVisible('#form-senha') && /Amanda/.test(await pg.textContent('#senha-ola')), 'Link abre a tela "Crie sua senha" com o nome dela');
  await pg.fill('#nova-senha', 'fraca123'); await pg.fill('#nova-senha2', 'fraca123'); await pg.click('#form-senha button[type=submit]'); await pg.waitForTimeout(800);
  ok(/vazamentos/.test(await pg.textContent('#form-senha [data-erro]')) && await pg.isEnabled('#form-senha button[type=submit]'), 'Senha recusada pelo servidor: explica e o botão volta a funcionar');
  await pg.fill('#nova-senha', 'Senha-forte-2026'); await pg.fill('#nova-senha2', 'Senha-forte-2026'); await pg.click('#form-senha button[type=submit]'); await pg.waitForTimeout(400);
  ok(/Salvando/.test(await pg.textContent('#form-senha button[type=submit]')) || !(await pg.isVisible('#form-senha')), 'Botão mostra "Salvando…" enquanto grava');
  await pg.waitForTimeout(5500);
  ok(posts.some((p) => p.startsWith('/equipe/senha ') && p.includes('Senha-forte-2026')), 'Senha vai para o servidor (/equipe/senha), mesmo com a biblioteca de login travada');
  ok(auth.some((a) => a.startsWith('/equipe/senha Bearer a.b.c')), 'Pedido leva a sessão aberta pelo link');
  ok(!(await pg.isVisible('#entrar')) && await pg.isVisible('#app'), 'Entra no app depois de salvar');
} catch (e) { r.push(`FALHOU parou: ${e.message.split('\n')[0]}`); }
console.log(r.join('\n')); console.log(erros.length ? 'ERROS: ' + [...new Set(erros)].join(' | ') : 'SEM ERROS DE PÁGINA');
await br.close(); srv.close();
