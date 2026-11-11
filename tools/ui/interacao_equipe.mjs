// Interação: chat da equipe no app (v47) — lista com grupo e conversa privada, abrir conversa, enviar texto,
// ver arquivo, e a troca "Minha agenda | Agenda do chefe" / "Minhas tarefas | Tarefas do chefe" (x-conta). LARG=320 ESCURO=1
import { createRequire } from 'node:module';
const require = createRequire('/usr/lib/node_modules/');
const { chromium } = require('playwright');
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const RAIZ = process.env.APP_DIR || new URL('../../../segundo-cerebro-app', import.meta.url).pathname;
const LARG = +(process.env.LARG || 390), ESCURO = process.env.ESCURO === '1', SAIDA = process.env.SAIDA || '/tmp';
const srv = http.createServer((q, r) => { const f = path.join(RAIZ, decodeURIComponent(new URL(q.url, 'http://x').pathname)); fs.readFile(f, (e, d) => { r.writeHead(e ? 404 : 200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); r.end(d); }); }).listen(8769);
const STUB = `export function createClient(){return{auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}}},signOut:async()=>({})}}}`;
const agora = Date.now(), iso = (h) => new Date(agora + h * 36e5).toISOString();
const CHEFE = '22222222-2222-2222-2222-222222222222';
const R = {
  '/chat/pessoas': { eu: { id: 'u1', nome: 'Ana Secretária', admin: false }, equipe: [{ id: CHEFE, nome: 'Carlos Chefe', admin: true }], compartilhadas: [{ dono: CHEFE, nome: 'Carlos Chefe', agenda: true, tarefas: true }] },
  '/chat/naolidas': { total: 3 },
  '/chat/conversas': { conversas: [{ id: 'c1', tipo: 'grupo', nome: 'Equipe', participantes: 2, ultima: { texto: 'Bom dia!', autor: 'Carlos', em: iso(-1) }, nao_lidas: 3, ativo: true }, { id: 'c2', tipo: 'individual', nome: 'Carlos Chefe', participantes: 2, ultima: null, nao_lidas: 0, ativo: true }] },
  '/chat/conversas/c1/mensagens': { mensagens: [{ id: 'm1', autor: 'x', autor_nome: 'Carlos Chefe', texto: 'Ana, marca a visita da Padaria para quinta?', criado_em: iso(-1), minha: false }, { id: 'm2', autor: 'u1', autor_nome: 'Ana', texto: 'Marco sim!', criado_em: iso(-0.9), minha: true }, { id: 'm3', autor: 'x', autor_nome: 'Carlos Chefe', anexo_nome: 'proposta.pdf', anexo_tipo: 'application/pdf', anexo_tamanho: 90000, criado_em: iso(-0.5), minha: false }], mais: false, lido_pelos_outros: iso(-0.95) },
  '/app/hoje': { avisos: [], perguntas: [], agenda: [], aguardando: [], lembretes: [] },
  '/app/agenda': { google: true, eventos: [{ id: 'e1', titulo: 'Reunião', inicio: iso(2), fim: iso(3) }] },
  '/tarefas': { dia: iso(0).slice(0, 10), hoje: iso(0).slice(0, 10), tarefas: [], atrasadas: [], contagem: {}, prazos: [], sugestoes_pendentes: 0 },
};
const br = await chromium.launch(); const pg = await br.newPage({ viewport: { width: LARG, height: 760 }, colorScheme: ESCURO ? 'dark' : 'light' });
const erros = [], posts = [], contas = [];
pg.on('pageerror', (e) => erros.push(e.message));
await pg.route('**/*', async (rt) => {
  const u = new URL(rt.request().url());
  if (u.host === 'localhost:8769') return rt.continue();
  if (u.host.includes('jsdelivr')) return rt.fulfill({ status: 200, contentType: 'text/javascript', body: STUB });
  const j = (b) => rt.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
  const p = u.pathname.replace('/functions/v1', '');
  const xc = rt.request().headers()['x-conta']; if (xc) contas.push(`${p} ${xc}`);
  if (rt.request().method() === 'POST') { posts.push(`${p} ${rt.request().postData() || ''}`); if (p.startsWith('/chat/conversas/c1/mensagens')) return j({ mensagem: { id: 'mn', texto: 'Feito, marquei.', minha: true, autor_nome: 'Ana', criado_em: new Date().toISOString() } }); return j({ ok: true }); }
  if (p === '/app/agenda') return j(xc ? { google: true, eventos: [{ id: 'e1', titulo: 'Visita Padaria', inicio: iso(2), fim: iso(3), local: 'Padaria Pão Dourado, Betim' }] } : { google: false, eventos: [] });   // ela não tem Google próprio
  return j(R[p] ?? {});
});
await pg.addInitScript(() => { localStorage.setItem('cerebro-chave', 'k'); localStorage.setItem('cerebro-ativar-depois', String(Date.now())); });
const r = []; const ok = (c, t) => r.push(`${c ? 'OK    ' : 'FALHOU'} ${t}`);
const semRolagem = () => pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
try {
  await pg.goto('http://localhost:8769/index.html#hoje'); await pg.waitForTimeout(1500);
  ok(await pg.isVisible('.chat-atalho') && (await pg.textContent('#badge-equipe')) === '3', 'Hoje: botão do chat da equipe com 3 não lidas');
  ok(await pg.isVisible('#conta-agenda') && /Agenda de Carlos/.test(await pg.textContent('#conta-agenda')), 'Hoje: escolha "Minha agenda | Agenda de Carlos"');
  ok(contas.some((c) => c.startsWith('/app/agenda') && c.endsWith(CHEFE)) && /Agenda de Carlos/.test(await pg.textContent('#conta-agenda .on')), 'Sem Google próprio: abre direto a agenda compartilhada');
  ok(/Ir com Waze/.test(await pg.textContent('#linha-tempo')), 'Compromisso com endereço mostra "Ir com Waze" e Mapas');
  await pg.click('[data-acao="evento"]'); await pg.waitForTimeout(400);
  ok(/agenda de Carlos/.test(await pg.textContent('#folha-titulo')), 'Novo compromisso diz em qual agenda vai ser marcado');
  await pg.fill('#folha [name=titulo]', 'Visita teste'); await pg.fill('#folha [name=local]', 'Rua Rio Orenoco, 725'); await pg.click('#folha-salvar'); await pg.waitForTimeout(600);
  ok(posts.some((p) => p.startsWith('/app/agenda ') && p.includes('Rua Rio Orenoco')) && contas.filter((c) => c.startsWith('/app/agenda')).length > 1, 'Compromisso marcado na agenda compartilhada, com o endereço');
  contas.length = 0; await pg.click('[data-conta-agenda="' + CHEFE + '"]'); await pg.waitForTimeout(700);
  ok(contas.some((c) => c.startsWith('/app/agenda') && c.endsWith(CHEFE)), 'Agenda do chefe pedida com a conta dele');
  await pg.click('[data-conta-agenda=""]'); await pg.waitForTimeout(400);
  await pg.click('.chat-atalho'); await pg.waitForTimeout(1000);
  ok((await pg.$$('.ch-item')).length === 2 && /Bom dia/.test(await pg.textContent('#ch-lista')), 'Equipe: lista com grupo e conversa privada');
  ok(await semRolagem(), 'Equipe: sem rolagem lateral'); await pg.screenshot({ path: `${SAIDA}/app_equipe_lista_${LARG}${ESCURO ? '_escuro' : ''}.png` });
  await pg.click('.ch-item'); await pg.waitForTimeout(900);
  ok(/marca a visita/.test(await pg.textContent('#ch-msgs')) && /proposta\.pdf/.test(await pg.textContent('#ch-msgs')), 'Conversa: mensagens e arquivo');
  ok(!(await pg.isVisible('.abas')), 'Conversa: barra de baixo some para dar espaço');
  await pg.fill('#ch-texto', 'Feito, marquei.'); await pg.click('.ch-enviar'); await pg.waitForTimeout(500);
  ok(posts.some((p) => p.startsWith('/chat/conversas/c1/mensagens ') && p.includes('Feito, marquei')), 'Conversa: envia a mensagem');
  ok(/Feito, marquei/.test(await pg.textContent('#ch-msgs')), 'Conversa: mensagem aparece na tela');
  ok(await pg.evaluate(() => { const f = document.querySelector('#ch-form').getBoundingClientRect(); return f.bottom <= innerHeight + 1 && f.top > innerHeight / 2; }), 'Conversa: caixa de mensagem presa embaixo, visível');
  ok(await semRolagem(), 'Conversa: sem rolagem lateral'); await pg.screenshot({ path: `${SAIDA}/app_equipe_conversa_${LARG}${ESCURO ? '_escuro' : ''}.png` });
  await pg.click('#ch-voltar'); await pg.waitForTimeout(600);
  ok(await pg.isVisible('#ch-lista') && await pg.isVisible('.abas'), 'Voltar: lista e barra de baixo de novo');
  await pg.goto('http://localhost:8769/index.html#tarefas'); await pg.waitForTimeout(1000);
  ok(await pg.isVisible('#conta-tarefas'), 'Tarefas: escolha "Minhas tarefas | Tarefas de Carlos"');
  contas.length = 0; await pg.click('[data-conta-tarefas="' + CHEFE + '"]'); await pg.waitForTimeout(600);
  ok(contas.some((c) => c.startsWith('/tarefas') && c.endsWith(CHEFE)), 'Tarefas do chefe pedidas com a conta dele');
} catch (e) { r.push(`FALHOU parou: ${e.message.split('\n')[0]}`); }
console.log(r.join('\n')); console.log(erros.length ? 'ERROS: ' + [...new Set(erros)].join(' | ') : 'SEM ERROS DE PÁGINA');
await br.close(); srv.close();
