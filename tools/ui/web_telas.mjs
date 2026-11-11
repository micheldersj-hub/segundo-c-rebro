// Dimy Web: abre cada tela num navegador de computador com dados de teste (servidor simulado) e confere
// erros, layout (sem rolagem lateral), ações principais e que as gravações vão para as mesmas rotas do app.
// LARG=1440 ESCURO=1 SAIDA=/tmp node web_telas.mjs
import { createRequire } from 'node:module';
const require = createRequire('/usr/lib/node_modules/');
const { chromium } = require('playwright');
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const RAIZ = process.env.WEB_DIR || new URL('../../../segundo-cerebro-app/web', import.meta.url).pathname;
const FX = new URL('./fx/', import.meta.url).pathname, fx = (n) => JSON.parse(fs.readFileSync(FX + n, 'utf8'));
const LARG = +(process.env.LARG || 1440), ESCURO = process.env.ESCURO === '1', SAIDA = process.env.SAIDA || '/tmp';
const srv = http.createServer((q, r) => { const f = path.join(RAIZ, decodeURIComponent(new URL(q.url, 'http://x').pathname)); fs.readFile(f, (e, d) => { r.writeHead(e ? 404 : 200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.json') ? 'application/json' : 'text/html' }); r.end(d); }); }).listen(8770);
const STUB = `export function createClient(){return{auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}}},signOut:async()=>({}),signInWithPassword:async()=>({error:{message:'invalid'}})}}}`;
const agora = Date.now(), iso = (h) => new Date(agora + h * 36e5).toISOString(), dia = (n) => new Date(agora + n * 864e5).toISOString().slice(0, 10);
const contatos = [{ wa_id: '5531988887777', name: 'Bruno Lima', empresa: 'Padaria Sol', last_seen: iso(-1), last_in_at: iso(-1), awaiting_reply: true, last_summary: 'Pediu proposta de maquininha' },
  { wa_id: '5531977776666', name: 'Ana Souza', last_seen: iso(-50), last_in_at: iso(-50), awaiting_reply: false, last_summary: 'Agradeceu' }];
const D = {
  '/app/hoje': { avisos: [{ id: 'a1', kind: 'urgente', title: '🚨 Cliente', body: 'Bruno precisa da proposta hoje', data: { contact: '5531988887777' }, created_at: iso(-1) }], perguntas: [{ question: 'A visita de amanhã é às 10h ou 14h?' }], agenda: [{ titulo: 'Reunião B2B PAY', inicio: iso(1), local: 'Av. Afonso Pena 1000, BH' }], aguardando: contatos.slice(0, 1), lembretes: [{ id: 'l1', text: 'Ligar para o contador', due_at: iso(2) }] },
  '/app/agenda': { google: true, eventos: [{ id: 'e1', titulo: 'Reunião B2B PAY', inicio: iso(1), fim: iso(2), local: 'Av. Afonso Pena 1000, BH' }, { id: 'e2', titulo: 'Visita Padaria Sol', inicio: iso(26), fim: iso(27) }, { id: 'e3', titulo: 'Almoço com o Toninho', inicio: iso(-20), fim: iso(-19) }] },
  '/app/contatos': { contatos },
  '/app/conversa': { turnos: [{ role: 'user', content: 'Me lembra de ligar pro contador amanhã', created_at: iso(-3) }, { role: 'assistant', content: 'Feito! *Lembrete* criado para amanhã às 9h.', created_at: iso(-3) }] },
  '/app/equipe/eu': {}, '/equipe/eu': { usuario: { id: 'u1', nome: 'Michelder Silva', email: 'm@x.com', papel: 'admin' }, dono: true },
  '/tarefas': fx('tarefas.json'), '/tarefas/projetos': { projetos: [{ projeto: 'Rede Payments', abertas: 3, feitas: 2, vencidas: 1, areas: ['Comercial'] }] }, '/tarefas/sugestoes': fx('tarefas_sugestoes.json'),
  '/olho/painel': fx('olho_painel.json'), '/olho/config': fx('olho_config.json'), '/olho/empresas': fx('olho_empresas.json'), '/olho/alertas': { alertas: fx('olho_painel.json').alertas }, '/olho/movimentos': { movimentos: fx('olho_painel.json').movimentos },
  '/oraculo/dossies': { dossies: [{ id: 'd1', nome: 'Padaria Três Poderes', status: 'pronto', risco: 'baixo', resumo: 'Panificação com 3 lojas em Betim' }, { id: 'd2', alvo: 'Casa de Lanches', status: 'pesquisando', etapa: 'Pesquisando mercado' }] },
  '/oraculo/dossies/d1': { id: 'd1', nome: 'Padaria Três Poderes', cnpj: '12345678000190', status: 'pronto', risco: 'baixo', cadastro: { situacao: 'ATIVA', abertura: '2010-05-01', porte: 'ME', simples: true, capital_social: 50000, cnae_fiscal_descricao: 'Padaria e confeitaria', municipio: 'Betim', uf: 'MG', telefone: '3133334444' },
    dossie: { resumo: 'Empresa familiar de panificação.', financeiro: { resumo: 'Sem sinais negativos públicos.', sinais: [] }, abordagem: { tese: 'Volume alto no cartão', gancho: 'Taxas de antecipação', canal: 'Dono, pessoalmente', mensagem_whatsapp: 'Oi! Sou da B2B PAY…', roteiro: ['Apresentar', 'Simular'], objecoes: [{ objecao: 'Já tenho maquininha', resposta: 'Compare as taxas' }] }, empresa: { o_que_faz: 'Pães e doces' }, mercado: { posicionamento: 'Bairro', concorrentes: ['Padaria X'] }, socios: [{ nome: 'João Silva', cargo: 'Sócio', papel: 'decisor', perfil: 'Fundador' }], proximos_passos: ['Agendar visita'] }, fontes: ['https://exemplo.com.br'] },
};
// Caso real que quebrou o quadro: atrasadas com anotação longa (o cartão passava por cima da coluna vizinha)
const TF = fx('tarefas.json'), longa = 'Camila (+553796706371). Entrega de amanhã cancelada porque a máquina não foi liberada a tempo; nova previsão terça 10/11 ou quarta 11/11. Por quê? Ver com o suporte e confirmar com o cliente antes de reagendar.';
TF.atrasadas = [{ ...TF.tarefas[0], id: '00000000-0000-0000-0000-0000000000a1', titulo: 'Alinhar com a Amanda sobre o cliente Calango, de Pará de Minas, no F7 na Contrapag', notas: longa, dia: dia(-7), adiada_vezes: 1, prazo: null, etapa: 'a_fazer' },
  { ...TF.tarefas[0], id: '00000000-0000-0000-0000-0000000000a2', titulo: 'Ver com a Amanda a diferença de valores e desconto no aluguel de máquina da Nabrasa', notas: longa, dia: dia(-7), prioridade: 1, prazo: null, etapa: 'a_fazer' }];
TF.tarefas = TF.tarefas.map((t, i) => (i === 0 ? { ...t, notas: longa } : t)); D['/tarefas'] = TF;
// Caso real: muitos urgentes e avisos (antes, a coluna da direita ficava enorme e obrigava a rolar a página inteira)
D['/app/hoje'].avisos.push(...Array.from({ length: 14 }, (_, i) => ({ id: `u${i}`, kind: i % 3 ? 'urgente' : 'info', title: i % 3 ? 'Urgente' : `${i} conversas novas`, body: `💬 Cliente ${i}: posso responder? Erick pede uma diretriz de como abordar o Eduardo sobre a operação dos postos (antecipação 25k com trava na carteira), ainda não o contatou. Preparei a resposta; aprove no contato.`, data: { contact: '5531988887777' }, created_at: iso(-i) })));
D['/app/hoje'].aguardando = Array.from({ length: 15 }, (_, i) => ({ ...contatos[0], wa_id: `55319000000${String(i).padStart(2, '0')}`, name: `Contato ${i}`, last_in_at: iso(-i * 20) }));
// Equipe: chat e conta compartilhada (secretária vendo agenda/tarefas do chefe)
Object.assign(D, {
  '/chat/pessoas': { eu: { id: 'u1', nome: 'Michelder', admin: true }, equipe: [{ id: '11111111-1111-1111-1111-111111111111', nome: 'Ana Secretária' }], compartilhadas: [{ dono: '22222222-2222-2222-2222-222222222222', nome: 'Carlos Chefe', agenda: true, tarefas: true }] },
  '/chat/naolidas': { total: 2 },
  '/chat/acessos': { acessos: [] },
  '/chat/conversas': { conversas: [{ id: 'c1', tipo: 'grupo', nome: 'Equipe', participantes: 2, ultima: { texto: 'Bom dia!', autor: 'Ana', em: iso(-1) }, nao_lidas: 2, ativo: true }, { id: 'c2', tipo: 'individual', nome: 'Ana Secretária', com: '11111111-1111-1111-1111-111111111111', participantes: 2, ultima: null, nao_lidas: 0, ativo: true }] },
  '/chat/conversas/c1/mensagens': { mensagens: [{ id: 'm1', autor: 'a', autor_nome: 'Ana Secretária', texto: 'Bom dia! Confirmei a visita das 14h.', criado_em: iso(-1), minha: false }, { id: 'm2', autor: 'u1', autor_nome: 'Michelder', texto: 'Ótimo, obrigado.', criado_em: iso(-0.5), minha: true }, { id: 'm3', autor: 'a', autor_nome: 'Ana Secretária', anexo_nome: 'proposta.pdf', anexo_tipo: 'application/pdf', anexo_tamanho: 120000, criado_em: iso(-0.4), minha: false }], mais: false, lido_pelos_outros: iso(-0.45) },
});
const D2 = { [`/tarefas/${fx('tarefas.json').tarefas[0].id}/detalhe`]: { tarefa: fx('tarefas.json').tarefas[0], subtarefas: [], historico: [] }, '/app/contatos/5531977776666': { contato: contatos[1], mensagens: [{ direction: 'in', body: 'Obrigada!', occurred_at: iso(-50) }], perfil: null }, '/app/contatos/5531988887777': { contato: contatos[0], mensagens: [{ direction: 'in', body: 'Oi, me manda a proposta?', occurred_at: iso(-1) }, { direction: 'out', body: 'Claro, já envio.', occurred_at: iso(-0.9) }], perfil: { relacao: 'prospect', empresa: 'Padaria Sol', resumo: 'Dono de padaria', temas: ['maquininha'], pendencias: ['Enviar proposta'], msgs_analisadas: 12, atualizado_em: iso(-5) } } };
const br = await chromium.launch(); const ctx = await br.newContext({ viewport: { width: LARG, height: 900 }, colorScheme: ESCURO ? 'dark' : 'light' });
const pg = await ctx.newPage(); const erros = [], posts = [], contas = [];
pg.on('pageerror', (e) => erros.push(e.message)); pg.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && erros.push(m.text()));
await ctx.route('**/*', async (rt) => {
  const u = new URL(rt.request().url());
  if (u.host === 'localhost:8770') return rt.continue();
  if (u.host.includes('jsdelivr')) return rt.fulfill({ status: 200, contentType: 'text/javascript', body: STUB });
  if (u.host.includes('fonts.')) return rt.fulfill({ status: 200, body: '' });
  const p = u.pathname.replace('/functions/v1', ''), j = (b) => rt.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
  const xc = rt.request().headers()['x-conta']; if (xc) contas.push(`${p} ${xc}`);
  if (rt.request().method() === 'POST' && p === '/equipe/convidar') { posts.push(`${p} ${rt.request().postData()}`); return rt.fulfill({ status: 409, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ erro: 'Essa pessoa já está na equipe. Use "Novo link" na lista.' }) }); }
  if (p === '/equipe' && rt.request().method() === 'GET') return rt.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ membros: [{ user_id: '11111111-1111-1111-1111-111111111111', email: 'lfirpe@gmail.com', nome: 'Luciene Firpe', ativo: true }] }) });
  if (p === '/equipe/11111111-1111-1111-1111-111111111111/link') { posts.push(`${p} `); return rt.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ email: 'lfirpe@gmail.com', nome: 'Luciene Firpe', link: 'https://exemplo/#acesso=novo', validade_min: 60 }) }); }
  if (rt.request().method() === 'POST') { posts.push(`${p} ${rt.request().postData() || ''}`); if (p.startsWith('/chat/')) return j({ mensagem: { id: `mx${posts.length}`, texto: 'enviada', minha: true, autor_nome: 'Michelder', criado_em: new Date().toISOString() }, acessos: [], id: 'c2' }); return j({ ok: 'Enviado.', resposta: 'Certo, anotado.', tarefa: { dia: dia(1) }, id: 'd1', mensagem: 'ok', movidas: 1, para: dia(1) }); }
  return j(D2[p] ?? D[p] ?? D[p.replace(/\/[^/]+$/, '')] ?? {});
});
await pg.addInitScript(() => { localStorage.setItem('cerebro-chave', 'k'); });
const r = []; const ok = (c, t) => r.push(`${c ? 'OK    ' : 'FALHOU'} ${t}`);
const semRolagem = () => pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const foto = (n) => pg.screenshot({ path: `${SAIDA}/web_${n}_${LARG}${ESCURO ? '_escuro' : ''}.png` });
try {
  await pg.goto('http://localhost:8770/index.html#/hoje'); await pg.waitForTimeout(1500);
  ok(await pg.isVisible('.lateral') && (await pg.$$('.hj-tile')).length >= 4 && (await pg.$$('.hj-bloco')).length >= 5, 'Hoje: resumo do dia e painel em colunas');
  ok(/Reunião B2B PAY/.test(await pg.textContent('#h-agenda')), 'Hoje: agenda de hoje');
  ok(/posso responder/.test(await pg.textContent('#h-pede')) && /Ligar para o contador/.test(await pg.textContent('#h-lembretes')), 'Hoje: "Pede você" e lembretes');
  ok(await semRolagem(), 'Hoje: sem rolagem lateral');
  if (LARG >= 1200) ok(await pg.evaluate(() => document.scrollingElement.scrollHeight <= innerHeight + 1), 'Hoje: cabe na janela, sem rolar a página (cada bloco rola por dentro)');
  if (LARG >= 1200) ok(await pg.evaluate(() => [...document.querySelectorAll('.hj-bloco')].filter((b) => !b.hidden).every((b) => b.getBoundingClientRect().bottom <= innerHeight + 1)), 'Hoje: nenhum bloco termina abaixo da janela');
  await foto('hoje');
  await pg.click('[data-h-visto]'); await pg.waitForTimeout(400);
  ok(posts.some((p) => /^\/app\/avisos\/[^/]+\/lido /.test(p)), 'Hoje: "Resolvido" marca só aquele aviso');
  await pg.click('[data-h-aba="avisos"]'); await pg.waitForTimeout(200);
  ok(/conversas novas/.test(await pg.textContent('#h-pede')), 'Hoje: aba Avisos');
  await pg.click('[data-h-concluir]'); await pg.waitForTimeout(500);
  ok(posts.some((p) => /^\/tarefas\/[^/ ]+ /.test(p) && p.includes('"etapa":"feito"')), 'Hoje: concluir tarefa com um clique');
  await pg.click('[data-h="evento"]'); await pg.waitForTimeout(200);
  await pg.fill('#janela [name=titulo]', 'Teste visita'); await pg.click('#janela-ok'); await pg.waitForTimeout(500);
  ok(posts.some((p) => p.startsWith('/app/agenda ') && p.includes('Teste visita')), 'Hoje: novo compromisso grava em /agenda (mesma rota do app)');
  await pg.goto('http://localhost:8770/index.html#/agenda/semana'); await pg.waitForTimeout(1200);
  ok(await pg.isVisible('.menu a[data-menu="agenda"].on') && (await pg.$$('.ag-cab-dia')).length === 7, 'Agenda: no menu e com a semana em colunas');
  ok((await pg.$$('.ag-ev')).length >= 1 && /Reunião B2B PAY/.test(await pg.textContent('#ag-vista')), 'Agenda: compromissos na grade de horários');
  ok(/Reunião B2B PAY/.test(await pg.textContent('#ag-prox')), 'Agenda: próximos 7 dias ao lado');
  ok(await semRolagem(), 'Agenda: sem rolagem lateral'); await foto('agenda_semana');
  const col = await pg.$('.ag-col'); const bx = await col.boundingBox(), area = await (await pg.$('.ag-corpo')).boundingBox(); await pg.mouse.click(bx.x + bx.width / 2, area.y + 75);   // ponto visível da grade (ela abre rolada até a hora atual) await pg.waitForTimeout(250);
  ok(await pg.evaluate(() => document.querySelector('#janela').open && /\d\d:\d\d/.test(document.querySelector('#janela [name=inicio]').value)), 'Agenda: clicar num horário vazio abre "Novo compromisso" naquela hora');
  await pg.click('#janela [data-fechar]');
  await pg.click('[data-ag-modo="mes"]'); await pg.waitForTimeout(700);
  ok((await pg.$$('.ag-mes .cal-dia')).length >= 28 && /Reunião B2B PAY/.test(await pg.textContent('#ag-vista')), 'Agenda: visão do mês'); await foto('agenda_mes');
  await pg.click('[data-ag-modo="dia"]'); await pg.waitForTimeout(700);
  ok((await pg.$$('.ag-col')).length === 1, 'Agenda: visão do dia');
  await pg.goto('http://localhost:8770/index.html#/tarefas'); await pg.waitForTimeout(1200);
  ok((await pg.$$('.tf-col')).length >= 3 && (await pg.$$('.tf-card')).length > 0, 'Tarefas: quadro com colunas e cartões');
  ok(await semRolagem(), 'Tarefas: sem rolagem lateral'); await foto('tarefas');
  ok(await pg.evaluate(() => [...document.querySelectorAll('.tf-col')].every((c) => { const r = c.getBoundingClientRect(); return [...c.querySelectorAll('.tf-card')].every((k) => { const q = k.getBoundingClientRect(); return q.left >= r.left - 1 && q.right <= r.right + 1; }); })), 'Tarefas: nenhum cartão passa da sua coluna (notas longas)');
  ok(/Reunião B2B PAY/.test(await pg.textContent('#tf-agenda')), 'Tarefas: compromissos do dia acima do quadro');
  await pg.fill('#tf-titulo', 'Nova pelo computador'); await pg.press('#tf-titulo', 'Enter'); await pg.waitForTimeout(400);
  ok(posts.some((p) => p.startsWith('/tarefas ') && p.includes('Nova pelo computador')), 'Tarefas: Enter cria tarefa');
  await pg.locator('.tf-col[data-tf-col="a_fazer"] .tf-card').first().dragTo(pg.locator('.tf-col[data-tf-col="fazendo"]')); await pg.waitForTimeout(500);
  ok(posts.some((p) => /^\/tarefas\/[^/ ]+ /.test(p) && p.includes('"etapa":"fazendo"')), 'Tarefas: arrastar para "Fazendo" muda a etapa');
  await pg.click('.tf-card .tf-corpo'); await pg.waitForTimeout(500);
  ok(await pg.isVisible('#tf-lado'), 'Tarefas: detalhe abre ao lado');
  await pg.click('[data-tf-painel="projetos"]'); await pg.waitForTimeout(400);
  ok(/Rede Payments/.test(await pg.textContent('#tfl-corpo')), 'Tarefas: projetos'); await foto('tarefas_lado');
  await pg.goto('http://localhost:8770/index.html#/conversa'); await pg.waitForTimeout(900);
  await pg.fill('#cv-texto', 'Oi Dimy'); await pg.press('#cv-texto', 'Enter'); await pg.waitForTimeout(500);
  ok(posts.some((p) => p.startsWith('/app/chat ') && p.includes('Oi Dimy')) && /Certo, anotado/.test(await pg.textContent('#cv-msgs')), 'Conversa: envia e mostra a resposta');
  await foto('conversa');
  await pg.goto('http://localhost:8770/index.html#/whats/5531988887777'); await pg.waitForTimeout(1200);
  ok((await pg.$$('#wa-lista .pessoa')).length === 2 && /Oi, me manda a proposta/.test(await pg.textContent('#wa-msgs')), 'WhatsApp: lista e conversa lado a lado');
  ok(await pg.isVisible('#wa-enviar') && !(await pg.isVisible('#wa-abrir')), 'WhatsApp: dentro das 24 h envia pelo número comercial');
  await pg.fill('#wa-resposta', 'Segue a proposta'); await pg.click('#wa-enviar'); await pg.waitForTimeout(500);
  ok(posts.some((p) => p.startsWith('/app/contatos/5531988887777/responder')), 'WhatsApp: resposta vai para a mesma rota do app');
  await foto('whats');
  await pg.click('[data-wa="5531977776666"]'); await pg.waitForTimeout(800);
  ok(await pg.isVisible('#wa-abrir') && /24 h/.test(await pg.textContent('#wa-dica24')), 'WhatsApp: fora das 24 h abre o WhatsApp Web');
  await pg.goto('http://localhost:8770/index.html#/equipe'); await pg.waitForTimeout(1200);
  ok(await pg.isVisible('.menu a[data-menu="equipe"].on') && (await pg.$$('#eq-lista .pessoa')).length === 2, 'Equipe: no menu, com grupo e conversa individual');
  ok(/Confirmei a visita/.test(await pg.textContent('#eq-msgs')) && /proposta\.pdf/.test(await pg.textContent('#eq-msgs')), 'Equipe: mensagens e arquivo na conversa do grupo');
  ok(/2/.test(await pg.textContent('#b-equipe')), 'Equipe: contador de não lidas no menu');
  await pg.fill('#eq-texto', 'Pode marcar para amanhã'); await pg.press('#eq-texto', 'Enter'); await pg.waitForTimeout(400);
  ok(posts.some((p) => p.startsWith('/chat/conversas/c1/mensagens ') && p.includes('Pode marcar')), 'Equipe: Enter envia a mensagem');
  ok(await semRolagem(), 'Equipe: sem rolagem lateral'); await foto('equipe');
  await pg.click('[data-eq="compartilhar"]'); await pg.waitForTimeout(400);
  ok(await pg.evaluate(() => document.querySelector('#janela').open && /Ana Secretária/.test(document.querySelector('#janela').textContent)), 'Equipe: compartilhar agenda e tarefas lista a equipe');
  await pg.check('#janela [name="agenda_11111111-1111-1111-1111-111111111111"]'); await pg.check('#janela [name="tarefas_11111111-1111-1111-1111-111111111111"]');
  await pg.click('#janela-ok'); await pg.waitForTimeout(400);
  ok(posts.some((p) => p.startsWith('/chat/acessos ') && p.includes('"agenda":true') && p.includes('"tarefas":true')), 'Equipe: compartilhamento grava agenda e tarefas');
  await pg.click('[data-eq="convidar"]'); await pg.waitForTimeout(300);
  await pg.fill('#janela [name=nome]', 'Luciene Firpe'); await pg.fill('#janela [name=email]', 'lfirpe@gmail.com'); await pg.click('#janela-ok'); await pg.waitForTimeout(700);
  ok(posts.some((p) => p.startsWith('/equipe/11111111-1111-1111-1111-111111111111/link')) && /link novo/.test(await pg.textContent('#janela')) && /acesso=novo/.test(await pg.textContent('#janela')), 'Equipe: quem já está na equipe ganha um link novo (sem erro)');
  await pg.click('#janela [data-fechar]');
  await pg.goto('http://localhost:8770/index.html#/tarefas'); await pg.waitForTimeout(1000);
  ok(await pg.isVisible('.seletor-conta'), 'Conta: seletor "Minha | Carlos" nas Tarefas');
  contas.length = 0; await pg.click('.seletor-conta [data-conta^="2222"]'); await pg.waitForTimeout(900);
  ok(contas.some((c) => c.startsWith('/tarefas')) && /Tarefas de Carlos Chefe/.test(await pg.textContent('.cab-sup')), 'Conta: ao escolher o chefe, as tarefas vêm da conta dele');
  await pg.goto('http://localhost:8770/index.html#/agenda'); await pg.waitForTimeout(900);
  ok(contas.some((c) => c.startsWith('/app/agenda')), 'Conta: a agenda também vem da conta escolhida');
  contas.length = 0; await pg.goto('http://localhost:8770/index.html#/hoje'); await pg.waitForTimeout(900);
  ok(!contas.length, 'Conta: a tela Hoje continua sendo da própria pessoa');
  await pg.goto('http://localhost:8770/index.html#/agenda'); await pg.waitForTimeout(600); await pg.click('.seletor-conta [data-conta=""]'); await pg.waitForTimeout(500);
  await pg.goto('http://localhost:8770/index.html#/oraculo/d1'); await pg.waitForTimeout(1200);
  ok(/Padaria Três Poderes/.test(await pg.textContent('#or-detalhe')) && /Risco baixo/.test(await pg.textContent('#or-detalhe')), 'Oráculo: dossiê ao lado da lista');
  await pg.click('[data-or-aba="socios"]');
  ok(/João Silva/.test(await pg.textContent('#or-pane')), 'Oráculo: abas do dossiê');
  const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 8000 }).catch(() => null), pg.click('[data-exp="pdf"]')]);
  ok(dl && /\.pdf$/.test(dl.suggestedFilename()), `Oráculo: PDF baixa direto (${dl?.suggestedFilename()})`);
  ok(await semRolagem(), 'Oráculo: sem rolagem lateral'); await foto('oraculo');
  await pg.goto('http://localhost:8770/index.html#/olho/visao'); await pg.waitForTimeout(1200);
  ok((await pg.$$('.kpi')).length === 6, 'Olho: indicadores');
  await pg.click('[data-ol-aba="empresas"]'); await pg.waitForTimeout(800);
  const emp = await pg.$('.ol-emp'); if (emp) { await emp.click(); await pg.waitForTimeout(600); }
  ok(!emp || await pg.isVisible('#ol-lado'), 'Olho: empresa abre ao lado');
  ok(await semRolagem(), 'Olho: sem rolagem lateral'); await foto('olho');
  await pg.keyboard.press('g'); await pg.keyboard.press('t'); await pg.waitForTimeout(600);
} catch (e) { r.push(`FALHOU parou: ${e.message.split('\n')[0]}`); }
console.log(r.filter((x) => x.trim() !== 'OK').join('\n')); console.log(erros.length ? 'ERROS: ' + [...new Set(erros)].join(' | ') : 'SEM ERROS DE PÁGINA');
await br.close(); srv.close();
