// Interação: aba Conexões (v46) — estados (ok, fora, vence logo, saldo), faixa de alerta nas outras abas,
// trocar chave (recusada pelo fornecedor → mensagem e nada muda; aceita → atualiza) e "Conferir agora". LARG=320 ESCURO=1
import { createRequire } from 'node:module';
const require = createRequire('/usr/lib/node_modules/');
const { chromium } = require('playwright');
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const RAIZ = process.env.APP_DIR || new URL('../../../segundo-cerebro-app', import.meta.url).pathname;
const LARG = +(process.env.LARG || 390), ESCURO = process.env.ESCURO === '1', SAIDA = process.env.SAIDA || '/tmp';
const srv = http.createServer((q, r) => { const f = path.join(RAIZ, decodeURIComponent(new URL(q.url, 'http://x').pathname)); fs.readFile(f, (e, d) => { r.writeHead(e ? 404 : 200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); r.end(d); }); }).listen(8768);
const STUB = `export function createClient(){return{auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}}},signOut:async()=>({})}}}`;
const agora = Date.now(), iso = (h) => new Date(agora + h * 36e5).toISOString();
const base = JSON.parse(fs.readFileSync(new URL('./fx/consumo_painel.json', import.meta.url).pathname, 'utf8'));
const cx = (servico, nome, ok, extra = {}) => ({ servico, nome, ok, desde: iso(-5), verificado_em: iso(-0.1), detalhe: ok ? 'Funcionando' : 'A Anthropic recusou a chave (vencida, apagada ou desativada).', expira_em: null, saldo: null, troca: ['anthropic', 'openai', 'ycloud'].includes(servico), onde: '', usado: true, essencial: servico !== 'meta', ...extra });
let chaves = [cx('anthropic', 'Claude (Anthropic)', false), cx('openai', 'OpenAI (memória e áudio)', true, { expira_em: iso(24 * 3) }), cx('ycloud', 'WhatsApp comercial (YCloud)', true, { saldo: 0.5 }), cx('meta', 'WhatsApp (Meta)', true, { usado: false }), cx('google', 'Gmail e Agenda (Google)', true, { detalhe: 'Funcionando (renova sozinho)' })];
const painel = () => JSON.stringify({ ...base, atualizado_em: new Date().toISOString(), chaves });
const br = await chromium.launch(); const pg = await br.newPage({ viewport: { width: LARG, height: 860 }, colorScheme: ESCURO ? 'dark' : 'light' });
const erros = [], posts = [];
pg.on('pageerror', (e) => erros.push(e.message));
await pg.route('**/*', async (rt) => {
  const u = new URL(rt.request().url());
  if (u.host === 'localhost:8768') return rt.continue();
  if (u.host.includes('jsdelivr')) return rt.fulfill({ status: 200, contentType: 'text/javascript', body: STUB });
  const j = (b, st = 200) => rt.fulfill({ status: st, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: typeof b === 'string' ? b : JSON.stringify(b) });
  if (u.pathname.includes('/consumo/')) {
    const rota = u.pathname.split('/consumo')[1];
    if (rt.request().method() === 'POST') posts.push(`${rota} ${rt.request().postData()}`);
    if (rota === '/chave') {
      const b = JSON.parse(rt.request().postData());
      if (b.chave.includes('ruim')) return j({ erro: 'A Anthropic recusou a chave (vencida, apagada ou desativada). Nada foi trocado.' }, 400);
      chaves = chaves.map((c) => (c.servico === b.servico ? { ...c, ok: true, detalhe: 'Funcionando', desde: new Date().toISOString() } : c));
    }
    return j(painel());
  }
  return j('{}');
});
await pg.addInitScript(() => { localStorage.setItem('cerebro-chave', 'k'); localStorage.setItem('cerebro-ativar-depois', String(Date.now())); });
const r = []; const ok = (c, t) => r.push(`${c ? 'OK    ' : 'FALHOU'} ${t}`);
try {
  await pg.goto('http://localhost:8768/index.html#config'); await pg.waitForTimeout(1200);
  ok(/Claude \(Anthropic\) parou/.test(await pg.textContent('.cfg-faixa-fora')), 'Faixa de alerta na aba Consumo');
  await pg.click('.cfg-faixa-fora'); await pg.waitForTimeout(500);
  const linhas = await pg.$$eval('.cnx', (l) => l.map((x) => `${x.className.replace('cnx ', '')}|${x.querySelector('b').textContent}|${x.querySelector('small').textContent}`));
  ok(linhas.length === 4 && !linhas.some((l) => l.includes('Meta')), `Lista sem o serviço fora de uso (${linhas.length})`);
  ok(linhas[0].startsWith('fora|Claude') && /Parou em/.test(linhas[0]), 'Anthropic aparece parada com data');
  ok(linhas[1].startsWith('atencao|OpenAI') && /vence em .*\(3 dias\)/.test(linhas[1]), `OpenAI em atenção com validade (${linhas[1].split('|')[2]})`);
  ok(/saldo US\$ 0,50/.test(linhas[2]), 'Saldo da YCloud');
  ok(!(await pg.$('.cfg-faixa-fora')), 'Faixa some dentro da própria aba');
  ok(/conta oficial/.test(await pg.textContent('.cfg-conexoes')), 'Dica da chave de administrador para aviso antecipado');
  await pg.screenshot({ path: `${SAIDA}/conexoes_${LARG}${ESCURO ? '_escuro' : ''}.png`, fullPage: true });
  await pg.click('[data-cfg-trocar="anthropic"]'); await pg.waitForTimeout(400);
  ok((await pg.getAttribute('#folha [name=chave]', 'type')) === 'password' && /Never/.test(await pg.textContent('#folha-campos')), 'Folha de troca: campo oculto e orientação "Never"');
  await pg.click('#folha-salvar'); await pg.waitForTimeout(300);
  ok(/Cole a chave/.test(await pg.textContent('#folha-erro')) && !posts.some((p) => p.startsWith('/chave ')), 'Vazio: pede a chave e não envia');
  await pg.fill('#folha [name=chave]', 'sk-ant-api03-ruim-xxxxxxxxxxxxxxxxxxxxxxxx'); await pg.click('#folha-salvar'); await pg.waitForTimeout(600);
  ok(/recusou.*Nada foi trocado/.test(await pg.textContent('#folha-erro')) && !(await pg.isHidden('#folha')), 'Chave recusada: mensagem clara e folha continua aberta');
  await pg.fill('#folha [name=chave]', 'sk-ant-api03-boa-xxxxxxxxxxxxxxxxxxxxxxxxx'); await pg.click('#folha-salvar'); await pg.waitForTimeout(800);
  ok((await pg.$eval('.cnx', (x) => x.className)).includes('ok'), 'Chave aceita: Anthropic volta a "funcionando"');
  ok(!(await pg.content()).includes('sk-ant-api03-boa'), 'A chave não fica em lugar nenhum da tela');
  await pg.click('[data-cfg-testar]'); await pg.waitForTimeout(600);
  ok(posts.some((p) => p.startsWith('/chaves-testar')), 'Conferir agora chama o servidor');
  ok(!(await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'Sem rolagem lateral');
} catch (e) { r.push(`FALHOU parou: ${e.message.split('\n')[0]}`); }
console.log(r.filter((x) => x.trim() !== 'OK').join('\n')); console.log(erros.length ? 'ERROS: ' + erros.join(' | ') : 'SEM ERROS DE PÁGINA');
await br.close(); srv.close();
