// @ts-nocheck
// OLHO DE DEUS — inteligência de mercado, monitoramento e antecipação estratégica (B2B PAY).
//
// Como funciona (sem "tempo real" falso):
//   - O cron sc-olho chama POST /ciclo a cada 2 min. Cada chamada: recupera execuções travadas, agenda o que venceu
//     (respeitando o limite diário) e avança UMA etapa de UMA execução da fila. Cada etapa cabe no tempo do servidor.
//   - Tipos: descoberta (semanal), regulatorio (diária, fontes oficiais), setor (diária, usa o Radar + pesquisa própria),
//     empresa (a cada N horas por empresa, padrão 72 h).
//   - Etapas: pesquisar (web) → extrair (estruturar + conferir fontes) → analisar (impacto estratégico) → gravar (alertas, push,
//     memória do Dimy, sugestões de tarefa). Falhou? Tenta de novo até 3 vezes e registra o erro.
//
// Rotas do app (JWT de membro ou x-app-key; alterações só para o administrador):
//   GET  /painel | /empresas | /empresas/:id | /movimentos | /alertas | /execucoes | /config
//   POST /empresas  /empresas/:id  /empresas/:id/atualizar  /alertas/:id/lido  /alertas/lidos  /movimentos/:id/tarefa
//   POST /descobrir  /config
// Rotas internas (x-cron-secret): POST /ciclo (?wait=1 roda a etapa e devolve o resultado)
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  atinge, chaveMovimento, CAMPOS_PERFIL, conferirEvidencias, dataValida, deveAlertar, diffPerfil, ehDuplicado, hojeSP, mesmaEmpresa,
  nivelValido, normalizar, pesoNivel, planejar, ROTULOS_CLASSIFICACAO, slug, textoDaPagina, urlLimpa,
} from './logica.ts';

const URL_BASE = Deno.env.get('SUPABASE_URL')!;
const db = createClient(URL_BASE, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-app-key, authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
const log = (...a: unknown[]) => console.log('[olho]', ...a);

// ---------------------------------------------------------------- segredos (Vault) — nunca vão para log nem resposta
let segCache: Record<string, string> | null = null, segEm = 0;
async function seg(nome: string, padrao?: string) {
  if (!segCache || Date.now() - segEm > 60_000) {
    const { data, error } = await db.rpc('get_app_secrets');
    if (error) throw new Error('não consegui ler a configuração do servidor');
    segCache = {}; for (const [k, v] of Object.entries(data ?? {})) segCache[k.replace(/^sc_/, '')] = String(v);
    segEm = Date.now();
  }
  const v = Deno.env.get(nome) ?? segCache[nome] ?? padrao;
  if (!v) throw new Error(`configuração ausente: ${nome}`);
  return v;
}
const igual = (a: string, b: string) => { if (!a || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

// ---------------------------------------------------------------- acesso
type Quem = { id: string; admin: boolean };
const cacheJwt = new Map<string, { q: Quem; ate: number }>();
async function quem(req: Request): Promise<Quem | null> {
  const a = req.headers.get('authorization') ?? '';
  const t = a.startsWith('Bearer ') ? a.slice(7).trim() : '';
  if (t.split('.').length === 3) {
    const c = cacheJwt.get(t); if (c && c.ate > Date.now()) return c.q;
    const { data, error } = await db.auth.getUser(t);
    if (error || !data.user) return null;
    const { data: m } = await db.from('membros').select('papel, ativo').eq('user_id', data.user.id).maybeSingle();
    if (!m?.ativo) return null;
    const q = { id: data.user.id, admin: m.papel === 'admin' };
    cacheJwt.set(t, { q, ate: Date.now() + 60_000 });
    return q;
  }
  const k = req.headers.get('x-app-key') ?? '';
  if (k && igual(k, await seg('APP_KEY'))) return { id: (await adminId()) ?? '', admin: true };
  return null;
}
let adminCache: string | null = null;
async function adminId() {
  if (adminCache) return adminCache;
  const { data } = await db.from('membros').select('user_id').eq('papel', 'admin').eq('ativo', true).order('created_at').limit(1).maybeSingle();
  return (adminCache = data?.user_id ?? null);
}

// ---------------------------------------------------------------- Claude (pesquisa na web e saída estruturada)
const jsonSeguro = (v: unknown) => JSON.stringify(v).replace(/(?<!\\)((?:\\\\)*)\\ud[89a-f][0-9a-f]{2}/gi, '$1');
async function claude(corpo: Record<string, unknown>) {
  const chave = await seg('ANTHROPIC_API_KEY');
  for (let t = 0; ; t++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: jsonSeguro(corpo) });
    if(r.ok){const __j=await r.json();__usoIA(__j);return __j}
    const det = (await r.text()).slice(0, 300);
    if ((r.status === 429 || r.status >= 500) && t < 2) { await new Promise((ok) => setTimeout(ok, 2500 * (t + 1))); continue; }
    throw new Error(`IA ${r.status}: ${det}`);
  }
}
const modeloChat = () => seg('CLAUDE_CHAT_MODEL', 'claude-sonnet-5-5');
const modeloRapido = () => seg('CLAUDE_FAST_MODEL', 'claude-haiku-4-5-20251001');

/** Pesquisa na web pela própria API (respeita limite de buscas). Devolve texto e as URLs realmente citadas/visitadas. */
async function pesquisar(system: string, user: string, opts: { maxUsos?: number; dominios?: string[] } = {}) {
  const ferramenta: Record<string, unknown> = { type: 'web_search_20250305', name: 'web_search', max_uses: opts.maxUsos ?? 5, user_location: { type: 'approximate', city: 'Belo Horizonte', region: 'Minas Gerais', country: 'BR', timezone: 'America/Sao_Paulo' } };
  if (opts.dominios?.length) ferramenta.allowed_domains = opts.dominios;
  const msgs: unknown[] = [{ role: 'user', content: user }];
  const blocos: any[] = [], paradas: string[] = [];
  for (let i = 0; i < 6; i++) {
    const r = await claude({ model: await modeloChat(), max_tokens: 12000, system, tools: [ferramenta], messages: msgs });
    blocos.push(...r.content); paradas.push(r.stop_reason);
    if (r.stop_reason !== 'pause_turn') break;
    msgs.push({ role: 'assistant', content: r.content });
  }
  const fontes = new Map<string, string>();
  for (const b of blocos) {
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) for (const x of b.content) if (x?.url) fontes.set(x.url, x.title ?? '');
    if (b.type === 'text' && Array.isArray(b.citations)) for (const c of b.citations) if (c?.url) fontes.set(c.url, c.title ?? '');
  }
  const texto = blocos.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  const buscas = blocos.filter((b) => b.type === 'server_tool_use').length;
  return { texto: texto.slice(0, 30000), fontes: [...fontes].map(([url, titulo]) => ({ url, titulo })).slice(0, 80), diag: { paradas, buscas, texto_tam: texto.length } };
}

/** Saída estruturada por ferramenta (o modelo de chat não aceita ferramenta forçada: pede no texto e cai para o rápido). */
async function extrair(nome: string, schema: Record<string, unknown>, system: string, user: string, maxTokens = 4000) {
  const tool = { name: nome, description: `Registra ${nome}.`, input_schema: schema };
  // Resposta cortada por limite de tokens chega com a ferramenta vazia/incompleta: descarta e tenta com mais espaço.
  const pega = (r: any) => (r?.stop_reason === 'max_tokens' ? null : r?.content?.find((b: any) => b.type === 'tool_use')?.input ?? null);
  let espaco = maxTokens;
  for (let t = 0; t < 2; t++) {
    const r = await claude({ model: await modeloChat(), max_tokens: espaco, tools: [tool], tool_choice: { type: 'auto' }, system: `${system}\n\nIMPORTANTE: responda exclusivamente chamando a ferramenta "${nome}".`, messages: [{ role: 'user', content: user }] });
    const x = pega(r);
    if (x) return x;
    if (r?.stop_reason === 'max_tokens') { log('extração cortada por limite', nome, espaco); espaco = Math.min(32000, espaco * 2); }
  }
  const x = pega(await claude({ model: await modeloRapido(), max_tokens: Math.min(espaco, 16000), tools: [tool], tool_choice: { type: 'tool', name: nome }, system, messages: [{ role: 'user', content: user }] }));
  if (!x) throw new Error(`a IA não devolveu ${nome}`);
  return x;
}

// ---------------------------------------------------------------- avisos no celular (mesmo formato dos outros módulos)
const enc = new TextEncoder();
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const junta = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
async function hkdf(sal: Uint8Array, ikm: Uint8Array, info: Uint8Array, n: number) { const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']); return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: sal, info }, k, n * 8)); }
async function cifrarPush(texto: string, p256dh: string, auth: string) {
  const pub = deB64u(p256dh), sa = deB64u(auth);
  const cli = await crypto.subtle.importKey('raw', pub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ef = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const lp = new Uint8Array(await crypto.subtle.exportKey('raw', ef.publicKey));
  const comp = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: cli }, ef.privateKey, 256));
  const prk = await hkdf(sa, comp, junta(enc.encode('WebPush: info\0'), pub, lp), 32);
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const k = await crypto.subtle.importKey('raw', await hkdf(sal, prk, enc.encode('Content-Encoding: aes128gcm\0'), 16), 'AES-GCM', false, ['encrypt']);
  const cif = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: await hkdf(sal, prk, enc.encode('Content-Encoding: nonce\0'), 12) }, k, junta(enc.encode(texto), new Uint8Array([2]))));
  const cab = new Uint8Array(21); cab.set(sal, 0); new DataView(cab.buffer).setUint32(16, 4096); cab[20] = lp.length;
  return junta(cab, lp, cif);
}
async function vapid(endpoint: string, pubB64: string, privD: string, sujeito: string) {
  const pub = deB64u(pubB64);
  const k = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d: privD, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const h = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))), c = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: sujeito })));
  const s = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k, enc.encode(`${h}.${c}`)));
  return `vapid t=${h}.${c}.${b64u(s)}, k=${pubB64}`;
}
async function avisar(uid: string, tipo: string, titulo: string, corpo: string, dados: Record<string, unknown> = {}) {
  const { data: n } = await db.from('notifications').insert({ user_id: uid, kind: tipo, title: titulo, body: corpo, data: dados }).select('id').single();
  const { data: subs } = await db.from('push_subscriptions').select('endpoint, keys').eq('user_id', uid);
  if (!n || !subs?.length) return;
  const [pub, priv, suj] = await Promise.all([seg('VAPID_PUBLIC_KEY'), seg('VAPID_PRIVATE_KEY'), seg('VAPID_SUBJECT')]);
  const carga = JSON.stringify({ title: titulo, body: corpo.length > 180 ? corpo.slice(0, 177) + '…' : corpo, kind: tipo, id: n.id, url: dados.url ?? './#olho', urgente: !!dados.urgente });
  await Promise.all(subs.map(async (s) => {
    try {
      const r = await fetch(s.endpoint, { method: 'POST', headers: { Authorization: await vapid(s.endpoint, pub, priv, suj), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high' }, body: await cifrarPush(carga, s.keys.p256dh, s.keys.auth) });
      if (r.status === 404 || r.status === 410) await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
    } catch (e) { console.warn('[olho] push:', (e as Error).message); }
  }));
}

// ---------------------------------------------------------------- configuração e contexto
async function config() {
  const { data } = await db.from('olho_config').select('*').eq('id', 1).single();
  return data;
}
const DIRETRIZES = `Regras de integridade (obrigatórias):
- Use só informação pública e cite a URL de onde veio. Não invente fontes, números, datas, taxas ou parceiros.
- Separe fato (com fonte) de inferência (diga "inferência").
- Nunca chame uma empresa de fraudulenta, mentirosa ou irregular. Quando o que ela promete não aparece comprovado, diga exatamente isso:
  "não encontrei comprovação pública de X" e o que falta investigar.
- Pessoas físicas: só cargo/papel profissional público. Nada de vida pessoal.`;

// ---------------------------------------------------------------- esquemas de saída
const S = (d: string) => ({ type: 'string', description: d });
const A = (d: string, items: unknown = { type: 'string' }) => ({ type: 'array', description: d, items });
const ESQ_MOV = {
  type: 'object',
  properties: {
    tipo: { type: 'string', enum: ['produto', 'preco_taxa', 'parceria', 'expansao', 'campanha', 'estrategia', 'infraestrutura', 'regulatorio', 'mercado', 'oportunidade'] },
    empresa: S('Empresa envolvida (vazio se for o mercado/regulador)'),
    titulo: S('Manchete curta do fato'), resumo: S('O que aconteceu, 1 a 3 frases, só fatos'),
    data: S('YYYY-MM-DD do fato, se a fonte disser'), url: S('URL exata da fonte'), fonte: S('Nome do veículo/site'),
    segmentos: A('Segmentos afetados'),
  },
  required: ['tipo', 'titulo', 'resumo', 'url'],
};
const ESQ_DESCOBERTA = {
  type: 'object', properties: {
    empresas: A('Empresas encontradas', { type: 'object', properties: {
      nome: S('Nome comercial'), site: S('Site oficial'), segmentos: A('Segmentos'),
      categoria: { type: 'string', enum: ['concorrente', 'similar'], description: 'concorrente: oferece o mesmo com estrutura comprovável; similar: anuncia o mesmo mas a estrutura/entrega não está clara' },
      motivo: S('Por que entra no radar, com base nas fontes'),
    }, required: ['nome', 'categoria', 'motivo'] }),
  }, required: ['empresas'],
};
const ESQ_EMPRESA = {
  type: 'object', properties: {
    perfil: { type: 'object', properties: {
      identificacao: S('Razão social/CNPJ/sede, se públicos'), site_redes: A('Site e perfis oficiais (URLs)'), produtos: A('Produtos e serviços'),
      diferenciais: A('Diferenciais comerciais anunciados'), publico_alvo: S('Público-alvo'), infraestrutura: S('Infraestrutura/tecnologia divulgada (adquirência própria? licença de IP no BC? usa parceiro?)'),
      parceiros: A('Instituições e parceiros com informação pública verificável'), taxas_condicoes: S('Taxas e condições divulgadas, com data'),
      lancamentos: A('Produtos lançados recentemente'), mudancas_estrategicas: A('Mudanças estratégicas'), campanhas: A('Campanhas de marketing'),
      expansao: A('Expansão comercial'), parcerias_anunciadas: A('Parcerias anunciadas'), regulatorio: A('Mudanças regulatórias/operacionais relevantes'),
    } },
    categoria: { type: 'string', enum: ['concorrente', 'similar', 'descartada'], description: 'concorrente = entrega o mesmo que a B2B PAY com estrutura comprovável; similar = anuncia o mesmo, mas a estrutura não está comprovada; descartada = não atua nos segmentos' },
    justificativa_categoria: S('Por que essa categoria, citando as evidências'),
    classificacoes: A('Classificação técnica de infraestrutura/entrega', { type: 'object', properties: {
      rotulo: { type: 'string', enum: [...ROTULOS_CLASSIFICACAO] }, confianca: { type: 'number', minimum: 0, maximum: 1 },
      evidencias: A('Evidências', { type: 'object', properties: { afirmacao: S('O que a fonte mostra'), url: S('URL exata'), fonte: S('Nome da fonte') }, required: ['afirmacao', 'url'] }),
      conclusao: S('O que se pode concluir tecnicamente'), a_investigar: S('O que ainda precisa ser verificado'),
    }, required: ['rotulo', 'confianca', 'evidencias', 'conclusao'] }),
    resumo: S('Quem é, em 2 a 3 frases'),
    nivel_ameaca: { type: 'string', enum: ['critico', 'alto', 'medio', 'baixo'] },
    movimentos: A('Fatos NOVOS dos últimos 120 dias que NÃO estão na lista de já conhecidos', ESQ_MOV),
  }, required: ['perfil', 'categoria', 'justificativa_categoria', 'classificacoes', 'resumo', 'nivel_ameaca', 'movimentos'],
};
const ESQ_MOVS = { type: 'object', properties: { movimentos: A('Fatos novos', ESQ_MOV) }, required: ['movimentos'] };
const ESQ_ANALISE = {
  type: 'object', properties: {
    analises: A('Uma por movimento, na mesma ordem', { type: 'object', properties: {
      indice: { type: 'integer' }, relevancia: { type: 'string', enum: ['critico', 'alto', 'medio', 'baixo'] },
      ameaca: { type: 'boolean' }, oportunidade: { type: 'boolean' },
      o_que_significa: S('O que isso significa para a operação da B2B PAY'), comparacao: S('Comparação com o que a B2B PAY oferece'),
      vantagens_concorrente: S('Vantagens competitivas do outro lado (se houver)'), ameacas: S('Ameaças concretas'),
      impacto_comercial: S('Impacto comercial provável'), posicionamento: S('Como se posicionar'), diferenciacao: S('Oportunidades de diferenciação'),
      acao_recomendada: S('Uma ação concreta e curta'), porque_importa: S('Por que importa, 1 frase'),
      tarefa: { type: 'object', description: 'Só se valer acompanhamento real', properties: { titulo: S('Tarefa no infinitivo'), prazo_dias: { type: 'integer', minimum: 0, maximum: 60 } } },
      tarefas_relacionadas: A('ids das tarefas abertas que precisam ser revisadas por causa disso'),
    }, required: ['indice', 'relevancia', 'ameaca', 'oportunidade', 'o_que_significa', 'impacto_comercial', 'acao_recomendada', 'porque_importa'] }),
  }, required: ['analises'],
};
const RUBRICA = `Níveis: critico = movimento que pode tirar clientes ou margem da B2B PAY já (ex.: concorrente forte lança split na origem para PMEs com taxa agressiva em MG, regra do BC que muda a operação);
alto = novidade importante de concorrente ou mudança de mercado; medio = oportunidade/movimento que merece acompanhamento; baixo = informativo sem impacto imediato.
Seja criterioso: a maioria das notícias é medio ou baixo.`;

// ---------------------------------------------------------------- execução (uma etapa por chamada)
type Exec = { id: string; tipo: string; empresa_id: string | null; passo: string; dados: any; tentativas: number; pedido_por: string };
async function salvar(ex: Exec, campos: Record<string, unknown>) {
  await db.from('olho_execucoes').update({ ...campos, trabalhando_ate: null }).eq('id', ex.id);
}
async function falhar(ex: Exec, e: Error) {
  const fim = ex.tentativas >= 3;
  const voltar = /refazendo/.test(e.message) && ex.passo === 'extrair' && !ex.dados?.refeita;   // pesquisa fraca: refaz a pesquisa uma vez
  await db.from('olho_execucoes').update({ ...(voltar && !fim ? { passo: 'pesquisar', dados: { refeita: true } } : {}), status: fim ? 'erro' : 'rodando', erro: e.message.slice(0, 500), trabalhando_ate: fim ? null : new Date(Date.now() + 3 * 60e3).toISOString(), terminado_em: fim ? new Date().toISOString() : null }).eq('id', ex.id);
  if (fim && ex.empresa_id) await db.from('olho_empresas').update({ proxima_em: new Date(Date.now() + 12 * 3600e3).toISOString() }).eq('id', ex.empresa_id);
  log('erro', ex.tipo, ex.passo, e.message);
}

async function conhecidos(empresaId: string | null, dias = 120) {
  let q = db.from('olho_movimentos').select('titulo').gte('created_at', new Date(Date.now() - dias * 864e5).toISOString()).order('created_at', { ascending: false }).limit(60);
  q = empresaId ? q.eq('empresa_id', empresaId) : q.is('empresa_id', null);
  const { data } = await q;
  return (data ?? []).map((x) => x.titulo);
}

async function passoPesquisar(ex: Exec, cfg: any) {
  const hoje = hojeSP();
  if (ex.tipo === 'descoberta') {
    const { data: ja } = await db.from('olho_empresas').select('nome');
    const r = await pesquisar(`Você é analista de inteligência competitiva da B2B PAY. Hoje é ${hoje}.\n${DIRETRIZES}`,
      `Negócio monitorado:\n${cfg.meu_negocio}\n\nSegmentos: ${cfg.segmentos.join(', ')}.\n\nEncontre empresas que atuam no Brasil e concorrem com essa oferta (meios de pagamento para PMEs, maquininhas, subadquirentes, split de pagamentos, BaaS/white label, ERP com pagamentos, PDV/NFC-e/TEF, soluções para eventos e estabelecimentos). Pesquise em português e só empresas com operação no Brasil (ignore provedores estrangeiros sem operação aqui e artigos genéricos). Inclua grandes e médias (ex.: adquirentes e subadquirentes conhecidas) e também fintechs menores que anunciam split, white label ou BaaS. Termine com uma LISTA de 15 a 25 empresas: nome — site oficial — segmentos — por que é relevante (com a URL da fonte). Já monitoradas (não repita): ${(ja ?? []).map((x) => x.nome).join(', ') || 'nenhuma'}.`, { maxUsos: 6 });
    return { texto: r.texto, fontes: r.fontes, diag: r.diag };
  }
  if (ex.tipo === 'regulatorio') {
    const r = await pesquisar(`Você acompanha regulação de pagamentos no Brasil para a B2B PAY. Hoje é ${hoje}.\n${DIRETRIZES}`,
      `Liste normas, resoluções, comunicados e consultas públicas do Banco Central (e do governo, quando afetarem pagamentos) publicados nos últimos 30 dias sobre: Pix (inclusive Pix Automático, Pix por aproximação, MED), arranjos de pagamento, instituições de pagamento, subcredenciadores/subadquirência, split payment e reforma tributária, Open Finance, cartões e antecipação de recebíveis. Para cada uma: número/nome, data, o que muda, a partir de quando, e a URL oficial.`,
      { maxUsos: 6, dominios: ['bcb.gov.br', 'gov.br', 'in.gov.br', 'receita.fazenda.gov.br'] });
    return { texto: r.texto, fontes: r.fontes, diag: r.diag };
  }
  if (ex.tipo === 'setor') {
    const { data: rad } = await db.from('radar_edicoes').select('dia, conteudo').eq('status', 'pronto').order('created_at', { ascending: false }).limit(1).maybeSingle();
    const radar = (rad?.conteudo?.noticias ?? []).map((n: any) => `- ${n.titulo} — ${n.resumo} (${n.fonte ?? ''} ${n.url ?? ''})`).join('\n');
    const { data: emps } = await db.from('olho_empresas').select('nome').in('categoria', ['concorrente', 'similar']).eq('ativo', true).limit(40);
    const r = await pesquisar(`Você é analista de inteligência competitiva da B2B PAY. Hoje é ${hoje}.\n${DIRETRIZES}`,
      `Pesquise movimentos dos ÚLTIMOS 7 DIAS no mercado brasileiro de pagamentos que importam para este negócio:\n${cfg.meu_negocio}\n\nFoque em: lançamentos de produtos (especialmente split, conta PJ, maquininhas, white label, BaaS), mudanças de taxas e condições, parcerias, aquisições, expansão regional (MG/BH), campanhas agressivas, novos entrantes, oportunidades comerciais (segmentos com demanda, dores de PMEs).\nEmpresas monitoradas: ${(emps ?? []).map((e) => e.nome).join(', ')}.\n${radar ? `O Radar de hoje (${rad.dia}) já trouxe estas notícias; use como ponto de partida, não repita sem novidade:\n${radar}` : ''}`, { maxUsos: 6 });
    return { texto: r.texto, fontes: r.fontes, diag: r.diag };
  }
  // empresa
  const { data: emp } = await db.from('olho_empresas').select('*').eq('id', ex.empresa_id).single();
  let site: { mudou: boolean; trecho: string } | null = null;
  const urlSite = urlLimpa(emp.site);
  if (urlSite && (!emp.site_verificado_em || Date.now() - Date.parse(emp.site_verificado_em) > 20 * 3600e3)) {
    try {
      const r = await fetch(urlSite, { headers: { 'User-Agent': 'SegundoCerebro-OlhoDeDeus/1.0 (monitoramento de pagina publica; 1 acesso a cada 3 dias)', 'Accept-Language': 'pt-BR' }, signal: AbortSignal.timeout(12000), redirect: 'follow' });
      if (r.ok && /html/.test(r.headers.get('content-type') ?? '')) {
        const txt = textoDaPagina(await r.text());
        const h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(normalizar(txt))))).map((b) => b.toString(16).padStart(2, '0')).join('');
        site = { mudou: !!emp.site_hash && emp.site_hash !== h, trecho: txt.slice(0, 6000) };
        await db.from('olho_empresas').update({ site_hash: h, site_verificado_em: new Date().toISOString() }).eq('id', emp.id);
      }
    } catch (e) { log('site indisponível', emp.nome, (e as Error).message); }
  }
  const r = await pesquisar(`Você é analista de inteligência competitiva da B2B PAY. Hoje é ${hoje}.\n${DIRETRIZES}`,
    `Faça o levantamento público atualizado da empresa "${emp.nome}"${urlSite ? ` (site ${urlSite})` : ''}.
1. Identificação, site e redes oficiais; produtos e serviços; diferenciais; público-alvo.
2. Infraestrutura e tecnologia: é adquirente/subadquirente? tem autorização do Banco Central como instituição de pagamento (consulte bcb.gov.br)? Usa banco/BaaS/processadora parceira? É white label de alguém?
3. Instituições e parceiros com informação pública verificável.
4. Taxas e condições comerciais divulgadas (com data).
5. Novidades dos últimos 120 dias: lançamentos, mudanças estratégicas, campanhas, expansão, parcerias, mudanças regulatórias/operacionais.
Compare o que a empresa promete com o que as fontes comprovam.`, { maxUsos: 5 });
  return { texto: r.texto, fontes: r.fontes, diag: r.diag, site };
}

async function passoExtrair(ex: Exec, cfg: any) {
  const d = ex.dados, hoje = hojeSP();
  if (String(d.texto ?? '').length < 200) throw new Error(`pesquisa sem texto útil (${JSON.stringify(d.diag ?? {})}); refazendo`);
  const fontesTxt = (d.fontes ?? []).map((f: any) => `- ${f.titulo} ${f.url}`).join('\n');
  if (ex.tipo === 'descoberta') {
    const x = await extrair('registrar_empresas', ESQ_DESCOBERTA, `Extraia as empresas citadas na pesquisa (no máximo 25), com motivo de no máximo 1 frase. Use como site só o que a pesquisa indicar; se estiver marcado como inferência ou não confirmado, deixe o site vazio. ${DIRETRIZES}`, `PESQUISA:\n${d.texto}\n\nFONTES:\n${fontesTxt}`, 12000);
    const empresas = (x.empresas ?? []).filter((e: any) => e?.nome).slice(0, 25);
    if (!empresas.length) throw new Error('extração de empresas vazia; refazendo');
    return { empresas };
  }
  if (ex.tipo === 'empresa') {
    const { data: emp } = await db.from('olho_empresas').select('nome, perfil').eq('id', ex.empresa_id).single();
    const ja = await conhecidos(ex.empresa_id);
    const x = await extrair('registrar_inteligencia_empresa', ESQ_EMPRESA, `Você estrutura inteligência competitiva para a B2B PAY. Hoje é ${hoje}.\nNegócio da B2B PAY:\n${cfg.meu_negocio}\n${DIRETRIZES}\nToda evidência precisa de URL que esteja na lista de fontes. ${RUBRICA}`,
      `EMPRESA: ${emp.nome}\n\nPERFIL ANTERIOR (para comparar):\n${JSON.stringify(emp.perfil ?? {}).slice(0, 4000)}\n\nJÁ CONHECIDOS (não repita):\n${ja.map((t) => `- ${t}`).join('\n') || '(nenhum)'}\n\n${d.site ? `SITE OFICIAL (${d.site.mudou ? 'MUDOU desde a última visita' : 'sem mudança detectada'}):\n${d.site.trecho}\n\n` : ''}PESQUISA:\n${d.texto}\n\nFONTES:\n${fontesTxt}`, 12000);
    return { analise_empresa: x };
  }
  const ja = await conhecidos(null, 45);
  const x = await extrair('registrar_movimentos', ESQ_MOVS, `Extraia fatos novos e relevantes para a B2B PAY. Hoje é ${hoje}. ${DIRETRIZES}\nIgnore o que não for dos últimos ${ex.tipo === 'regulatorio' ? 30 : 10} dias ou já conhecido.`,
    `JÁ CONHECIDOS:\n${ja.map((t) => `- ${t}`).join('\n') || '(nenhum)'}\n\nPESQUISA:\n${d.texto}\n\nFONTES:\n${fontesTxt}`, 8000);
  return { movimentos: x.movimentos ?? [] };
}

/** Separa só o que é realmente novo (fonte conferida, sem duplicata) e analisa o impacto estratégico. */
async function passoAnalisar(ex: Exec, cfg: any) {
  const d = ex.dados;
  if (ex.tipo === 'descoberta') return {};
  const vistas = new Set((d.fontes ?? []).map((f: any) => urlLimpa(f.url)).filter(Boolean));
  const doms = new Set([...vistas].map((u: any) => new URL(u).host));
  const brutos = ex.tipo === 'empresa' ? (d.analise_empresa?.movimentos ?? []) : (d.movimentos ?? []);
  const { data: emp } = ex.empresa_id ? await db.from('olho_empresas').select('nome').eq('id', ex.empresa_id).single() : { data: null };
  const ja = await conhecidos(ex.empresa_id, 180);
  const novos: any[] = [];
  for (const m of brutos.slice(0, 12)) {
    const url = urlLimpa(m.url);
    if (!url || !(vistas.has(url) || doms.has(new URL(url).host))) continue;           // fonte não veio da pesquisa: fora
    if (ehDuplicado(m.titulo, [...ja, ...novos.map((n) => n.titulo)])) continue;
    const chave = chaveMovimento(emp?.nome ?? m.empresa ?? null, m.titulo, url);
    const { data: existe } = await db.from('olho_movimentos').select('id').eq('hash', chave).maybeSingle();
    if (existe) continue;
    novos.push({ ...m, url, hash: chave, data: dataValida(m.data) });
  }
  if (!novos.length) return { novos: [], analises: [] };
  const uid = await adminId();
  const { data: abertas } = await db.from('tarefas').select('id, titulo, projeto, empresa').eq('user_id', uid).eq('arquivada', false).neq('etapa', 'feito').limit(60);
  const x = await extrair('analisar_movimentos', ESQ_ANALISE, `Você é o estrategista da B2B PAY. Para cada movimento, diga o que significa para a operação, compare com a oferta da B2B PAY, avalie ameaça/oportunidade e recomende uma ação.\nNegócio da B2B PAY:\n${cfg.meu_negocio}\n${RUBRICA}\n${DIRETRIZES}\nSugira tarefa só quando houver ação concreta que exija acompanhamento. Em tarefas_relacionadas, use apenas ids da lista de tarefas abertas.`,
    `MOVIMENTOS:\n${novos.map((m, i) => `${i}. [${m.tipo}] ${m.empresa || emp?.nome || 'mercado'} — ${m.titulo}: ${m.resumo} (${m.fonte ?? ''} ${m.url}${m.data ? `, ${m.data}` : ''})`).join('\n')}\n\nTAREFAS ABERTAS:\n${(abertas ?? []).map((t) => `${t.id} | ${t.titulo}${t.projeto ? ` | projeto ${t.projeto}` : ''}${t.empresa ? ` | ${t.empresa}` : ''}`).join('\n') || '(nenhuma)'}`, 10000);
  const validas = new Set((abertas ?? []).map((t) => t.id));
  const analises = (x.analises ?? []).map((a: any) => ({ ...a, relevancia: nivelValido(a.relevancia), tarefas_relacionadas: (a.tarefas_relacionadas ?? []).filter((id: string) => validas.has(id)) }));
  return { novos, analises };
}

async function acharOuCriarEmpresa(nome: string | undefined, origemTexto: string) {
  if (!nome || normalizar(nome).length < 2) return null;
  const s = slug(nome);
  const { data: todas } = await db.from('olho_empresas').select('id, nome, slug, silenciada, categoria').limit(1000);
  const data = (todas ?? []).find((e) => e.slug === s || mesmaEmpresa(e.nome, nome));
  if (data) return data;
  const { data: nova } = await db.from('olho_empresas').insert({ nome: nome.slice(0, 120), slug: s, categoria: 'candidata', origem: 'movimento', motivo_inclusao: origemTexto.slice(0, 300), proxima_em: new Date(Date.now() + 3600e3).toISOString() }).select('id, nome, silenciada, categoria').single();
  return nova;
}

async function passoGravar(ex: Exec, cfg: any) {
  const d = ex.dados, uid = await adminId(), agora = new Date().toISOString();
  let novidades = 0;
  if (ex.tipo === 'descoberta') {
    const vistas = new Set((d.fontes ?? []).map((f: any) => urlLimpa(f.url)).filter(Boolean));
    const { data: todas } = await db.from('olho_empresas').select('nome, slug').limit(1000);
    const nomes = (todas ?? []).map((x) => x.nome), slugs = new Set((todas ?? []).map((x) => x.slug));
    for (const e of d.empresas ?? []) {
      const s = slug(e.nome); if (!s) continue;
      if (slugs.has(s) || nomes.some((n) => mesmaEmpresa(n, e.nome))) continue;   // mesma empresa escrita de outro jeito
      nomes.push(e.nome); slugs.add(s);
      const site = urlLimpa(e.site);
      await db.from('olho_empresas').insert({ nome: e.nome.slice(0, 120), slug: s, site, segmentos: (e.segmentos ?? []).slice(0, 8), categoria: e.categoria === 'concorrente' ? 'concorrente' : 'similar', origem: 'descoberta', motivo_inclusao: String(e.motivo ?? '').slice(0, 500) + (site && !vistas.has(site) ? ' (site a confirmar)' : ''), proxima_em: new Date(Date.now() + novidades * 1800e3).toISOString() });
      novidades++;
    }
    return { novidades, resumo: `${novidades} empresa(s) nova(s) no radar` };
  }
  if (ex.tipo === 'empresa') {
    const x = d.analise_empresa ?? {}, { data: emp } = await db.from('olho_empresas').select('*').eq('id', ex.empresa_id).single();
    const perfil: Record<string, unknown> = {};
    for (const c of CAMPOS_PERFIL) if (x.perfil?.[c] != null) perfil[c] = x.perfil[c];
    const mudancas = diffPerfil(emp.perfil ?? {}, perfil);
    const classes = conferirEvidencias(x.classificacoes, (d.fontes ?? []).map((f: any) => f.url).concat(emp.site ? [emp.site] : []));
    const freq = emp.frequencia_h ?? cfg.frequencia_empresa_h;
    await db.from('olho_snapshots').insert({ empresa_id: emp.id, execucao_id: ex.id, perfil, mudancas });
    await db.from('olho_empresas').update({
      perfil: { ...(emp.perfil ?? {}), ...perfil }, classificacoes: classes, resumo: String(x.resumo ?? emp.resumo ?? '').slice(0, 800),
      nivel_ameaca: nivelValido(x.nivel_ameaca), categoria: emp.origem === 'manual' && emp.categoria !== 'candidata' ? emp.categoria : (['concorrente', 'similar', 'descartada'].includes(x.categoria) ? x.categoria : emp.categoria),
      motivo_inclusao: x.justificativa_categoria ? String(x.justificativa_categoria).slice(0, 800) : emp.motivo_inclusao,
      ultima_em: agora, proxima_em: new Date(Date.now() + freq * 3600e3).toISOString(), updated_at: agora,
    }).eq('id', emp.id);
    novidades += mudancas.length ? 1 : 0;
  }
  // movimentos + alertas + memória + sugestões
  const { data: empAtual } = ex.empresa_id ? await db.from('olho_empresas').select('id, nome, silenciada').eq('id', ex.empresa_id).single() : { data: null };
  for (let i = 0; i < (d.novos ?? []).length; i++) {
    const m = d.novos[i], a = (d.analises ?? []).find((y: any) => y.indice === i) ?? d.analises?.[i] ?? {};
    const empresa = empAtual ?? (m.empresa ? await acharOuCriarEmpresa(m.empresa, `citada em: ${m.titulo}`) : null);
    const relevancia = nivelValido(a.relevancia);
    const { data: mov, error } = await db.from('olho_movimentos').insert({
      empresa_id: empresa?.id ?? null, execucao_id: ex.id, tipo: String(m.tipo ?? 'mercado').slice(0, 30), titulo: String(m.titulo).slice(0, 300), resumo: String(m.resumo ?? '').slice(0, 1200),
      data_evento: m.data, fonte: String(m.fonte ?? '').slice(0, 120) || null, url: m.url, segmentos: (m.segmentos ?? []).slice(0, 6),
      relevancia, ameaca: !!a.ameaca, oportunidade: !!a.oportunidade, hash: m.hash,
      analise: { o_que_significa: a.o_que_significa, comparacao: a.comparacao, vantagens_concorrente: a.vantagens_concorrente, ameacas: a.ameacas, impacto_comercial: a.impacto_comercial, posicionamento: a.posicionamento, diferenciacao: a.diferenciacao, acao_recomendada: a.acao_recomendada, porque_importa: a.porque_importa, tarefas_relacionadas: a.tarefas_relacionadas ?? [] },
    }).select('id').single();
    if (error) { if (!/duplicate/.test(error.message)) log('movimento não gravado', error.message); continue; }
    novidades++;
    if (deveAlertar({ relevancia, titulo: m.titulo, resumo: m.resumo, segmentos: m.segmentos }, cfg, !!empresa?.silenciada)) {
      await db.from('olho_alertas').insert({ movimento_id: mov.id, nivel: relevancia, titulo: String(m.titulo).slice(0, 300), empresa: empresa?.nome ?? (m.empresa || null), quando: m.data, fonte: m.fonte ?? null, url: m.url, porque: a.porque_importa ?? null, impacto: a.impacto_comercial ?? null, acao: a.acao_recomendada ?? null });
      if (uid && atinge(relevancia, cfg.nivel_push)) {
        const rotulo = { critico: '🔴 CRÍTICO', alto: '🟠 ALTO', medio: '🟡 MÉDIO', baixo: '⚪ BAIXO' }[relevancia];
        await avisar(uid, relevancia === 'critico' ? 'urgente' : 'olho', `👁️ ${rotulo}: ${empresa?.nome ?? m.empresa ?? 'Mercado'}`, `${m.titulo}\n${a.acao_recomendada ? `Ação: ${a.acao_recomendada}` : ''}`, { url: `./#olho/movimento/${mov.id}`, urgente: relevancia === 'critico' });
        await db.from('olho_alertas').update({ notificado: true }).eq('movimento_id', mov.id);
      }
    }
    // Memória do Dimy: o que é alto/crítico vira conhecimento usado nas conversas.
    if (uid && atinge(relevancia, 'alto')) {
      await db.from('raw_events').upsert({ user_id: uid, source: 'oraculo', external_id: `olho-${mov.id}`, content: `Olho de Deus (${relevancia}) — ${empresa?.nome ?? m.empresa ?? 'mercado'}: ${m.titulo}. ${m.resumo ?? ''} Significado para a B2B PAY: ${a.o_que_significa ?? ''} Ação recomendada: ${a.acao_recomendada ?? ''} Fonte: ${m.url}`.slice(0, 3000), metadata: { olho: true, movimento: mov.id }, occurred_at: agora }, { onConflict: 'source,external_id', ignoreDuplicates: true });
    }
    // Sugestão de tarefa (nunca cria a tarefa sozinho).
    const rel = a.tarefas_relacionadas ?? [];
    if (uid && a.tarefa?.titulo && atinge(relevancia, 'medio') && (a.oportunidade || a.ameaca || ex.tipo === 'regulatorio')) {
      const prazo = Number.isFinite(a.tarefa.prazo_dias) ? new Date(Date.now() + a.tarefa.prazo_dias * 864e5).toISOString().slice(0, 10) : null;
      await db.from('tarefa_sugestoes').upsert({ user_id: uid, titulo: String(a.tarefa.titulo).slice(0, 200), notas: `${m.titulo} — ${a.porque_importa ?? ''} (${m.url})`.slice(0, 1000), prazo, prioridade: atinge(relevancia, 'alto') ? 1 : 2, projeto: 'Inteligência de mercado', empresa: empresa?.nome ?? m.empresa ?? null, origem: 'olho', origem_ref: mov.id, motivo: a.acao_recomendada ?? null, criterios: { relevancia, oportunidade: !!a.oportunidade, ameaca: !!a.ameaca }, chave: normalizar(a.tarefa.titulo).slice(0, 200) }, { onConflict: 'user_id,origem,origem_ref,chave', ignoreDuplicates: true });
    }
    if (uid && rel.length) {
      const { data: ts } = await db.from('tarefas').select('id, titulo').in('id', rel);
      for (const t of ts ?? []) await db.from('tarefa_sugestoes').upsert({ user_id: uid, titulo: `Revisar "${t.titulo}"`.slice(0, 200), notas: `Pode ser afetada por: ${m.titulo} (${m.url})`, prioridade: atinge(relevancia, 'alto') ? 1 : 2, projeto: 'Inteligência de mercado', origem: 'olho', origem_ref: mov.id, motivo: `Relacionada a ${m.titulo}`, criterios: { revisar_tarefa: t.id }, chave: `revisar ${t.id}` }, { onConflict: 'user_id,origem,origem_ref,chave', ignoreDuplicates: true });
    }
  }
  return { novidades, resumo: `${(d.novos ?? []).length} movimento(s) novo(s)` };
}

async function avancar(ex: Exec) {
  const cfg = await config();
  try {
    if (ex.tipo === 'empresa' && !ex.empresa_id) throw new Error('empresa removida');
    if (ex.passo === 'inicio' || ex.passo === 'pesquisar') {
      const r = await passoPesquisar(ex, cfg);
      await salvar(ex, { passo: 'extrair', dados: { ...r, refeita: !!ex.dados?.refeita }, fontes: r.fontes?.length ?? 0, tentativas: 0 });
      return `pesquisa: ${r.fontes?.length ?? 0} fontes`;
    }
    if (ex.passo === 'extrair') {
      const r = await passoExtrair(ex, cfg);
      await salvar(ex, { passo: 'analisar', dados: { ...ex.dados, ...r }, tentativas: 0 });
      return 'extração feita';
    }
    if (ex.passo === 'analisar') {
      const r = await passoAnalisar(ex, cfg);
      await salvar(ex, { passo: 'gravar', dados: { ...ex.dados, ...r }, tentativas: 0 });
      return `análise: ${r.novos?.length ?? 0} novo(s)`;
    }
    if (ex.passo === 'gravar') {
      const r = await passoGravar(ex, cfg);
      await salvar(ex, { passo: 'fim', status: 'ok', novidades: r.novidades, resumo: r.resumo, terminado_em: new Date().toISOString(), erro: null });
      return `ok: ${r.resumo}`;
    }
    await salvar(ex, { status: 'ok', terminado_em: new Date().toISOString() });
    return 'nada a fazer';
  } catch (e) { await falhar(ex, e as Error); return `erro: ${(e as Error).message}`; }
}

async function ciclo() {
  const cfg = await config();
  if (!cfg?.ativo) return 'desligado';
  // Recuperação: etapa travada há muito tempo volta para a fila (ou desiste depois de 3 tentativas).
  await db.from('olho_execucoes').update({ status: 'erro', erro: 'tempo esgotado em 3 tentativas', terminado_em: new Date().toISOString(), trabalhando_ate: null }).eq('status', 'rodando').gte('tentativas', 4).lt('trabalhando_ate', new Date().toISOString());
  // Agendamento.
  const inicioDia = new Date(`${hojeSP()}T00:00:00-03:00`).toISOString();
  const [{ count: feitasHoje }, { count: abertas }, ult, { data: vencidas }, { count: total }] = await Promise.all([
    db.from('olho_execucoes').select('id', { count: 'exact', head: true }).gte('created_at', inicioDia).eq('pedido_por', 'agenda'),
    db.from('olho_execucoes').select('id', { count: 'exact', head: true }).in('status', ['fila', 'rodando']),
    Promise.all(['setor', 'regulatorio', 'descoberta'].map((t) => db.from('olho_execucoes').select('created_at').eq('tipo', t).neq('status', 'erro').order('created_at', { ascending: false }).limit(1).maybeSingle())),
    db.from('olho_empresas').select('id').eq('ativo', true).in('categoria', ['concorrente', 'similar', 'candidata']).lte('proxima_em', new Date().toISOString()).order('proxima_em').limit(5),
    db.from('olho_empresas').select('id', { count: 'exact', head: true }).neq('categoria', 'descartada'),
  ]);
  const ts = (x: any) => (x?.data?.created_at ? Date.parse(x.data.created_at) : null);
  const plano = planejar({ agora: Date.now(), feitasHoje: feitasHoje ?? 0, max: cfg.max_execucoes_dia, abertas: abertas ?? 0, ultimaSetor: ts(ult[0]), ultimaRegulatorio: ts(ult[1]), ultimaDescoberta: ts(ult[2]), empresasVencidas: vencidas ?? [], totalEmpresas: total ?? 0 });
  for (const p of plano) await db.from('olho_execucoes').insert({ tipo: p.tipo, empresa_id: p.empresa_id ?? null }).then(() => {}, () => {}); // índice único evita duplicata
  // Uma etapa por chamada.
  const { data: pegou } = await db.rpc('olho_pegar_execucao');
  const ex = (pegou ?? [])[0];
  if (!ex) return `nada na fila (agendadas ${plano.length})`;
  return `${ex.tipo}${ex.empresa_id ? ` ${ex.empresa_id.slice(0, 8)}` : ''} ${ex.passo} → ${await avancar(ex)}`;
}

// ---------------------------------------------------------------- API do app
const LIMITES = { empresas: 300, movimentos: 200 };
async function painel() {
  const desde = new Date(Date.now() - 30 * 864e5).toISOString();
  const [emp, alertas, movs, execs, cfg, sug] = await Promise.all([
    db.from('olho_empresas').select('id, nome, categoria, segmentos, nivel_ameaca, ultima_em, ativo').neq('categoria', 'descartada'),
    db.from('olho_alertas').select('*').is('lido_em', null).order('created_at', { ascending: false }).limit(30),
    db.from('olho_movimentos').select('id, empresa_id, tipo, titulo, resumo, data_evento, fonte, url, relevancia, ameaca, oportunidade, segmentos, created_at, analise').gte('created_at', desde).order('created_at', { ascending: false }).limit(60),
    db.from('olho_execucoes').select('id, tipo, status, passo, terminado_em, created_at, novidades, fontes, erro').order('created_at', { ascending: false }).limit(12),
    config(),
    db.from('tarefa_sugestoes').select('id', { count: 'exact', head: true }).eq('status', 'pendente').eq('origem', 'olho'),
  ]);
  const es = emp.data ?? [], ms = movs.data ?? [];
  const nomes = Object.fromEntries(es.map((e) => [e.id, e.nome]));
  const porNivel = { critico: 0, alto: 0, medio: 0, baixo: 0 } as Record<string, number>;
  for (const a of alertas.data ?? []) porNivel[a.nivel]++;
  const ultimaOk = (execs.data ?? []).find((x) => x.status === 'ok');
  return {
    status: { ativo: cfg.ativo, ultima_coleta: ultimaOk?.terminado_em ?? null, em_andamento: (execs.data ?? []).filter((x) => ['fila', 'rodando'].includes(x.status)).length, frequencia: { empresas_h: cfg.frequencia_empresa_h, setor: 'diária (7h–22h)', regulatorio: 'diária (7h–22h)', descoberta: 'semanal', ciclo: 'a cada 2 min, uma etapa por vez' }, limite_dia: cfg.max_execucoes_dia },
    kpis: { concorrentes: es.filter((e) => e.categoria === 'concorrente' && e.ativo).length, similares: es.filter((e) => e.categoria === 'similar' && e.ativo).length, candidatas: es.filter((e) => e.categoria === 'candidata').length, movimentos_30d: ms.length, oportunidades: ms.filter((m) => m.oportunidade).length, ameacas: ms.filter((m) => m.ameaca).length, alertas: porNivel, sugestoes: sug.count ?? 0 },
    alertas: alertas.data ?? [],
    movimentos: ms.slice(0, 25).map((m) => ({ ...m, empresa: nomes[m.empresa_id] ?? null })),
    oportunidades: ms.filter((m) => m.oportunidade).slice(0, 8).map((m) => ({ ...m, empresa: nomes[m.empresa_id] ?? null })),
    ameacas: ms.filter((m) => m.ameaca).sort((a, b) => pesoNivel(b.relevancia) - pesoNivel(a.relevancia)).slice(0, 8).map((m) => ({ ...m, empresa: nomes[m.empresa_id] ?? null })),
    execucoes: execs.data ?? [],
  };
}

async function rotas(req: Request, rota: string, url: URL, q: Quem) {
  const partes = rota.split('/').filter(Boolean);
  const corpo = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  const soAdmin = () => { if (!q.admin) throw Object.assign(new Error('Só o administrador altera o Olho de Deus.'), { status: 403 }); };
  if (req.method === 'GET' && rota === '/painel') return json(await painel());
  if (req.method === 'GET' && rota === '/empresas') {
    let x = db.from('olho_empresas').select('id, nome, site, categoria, segmentos, ativo, silenciada, nivel_ameaca, resumo, ultima_em, proxima_em, classificacoes').order('nome').limit(LIMITES.empresas);
    const cat = url.searchParams.get('categoria'); if (cat) x = x.eq('categoria', cat); else x = x.neq('categoria', 'descartada');
    const { data } = await x;
    const sg = normalizar(url.searchParams.get('segmento') ?? ''), busca = normalizar(url.searchParams.get('q') ?? '');
    return json({ empresas: (data ?? []).filter((e) => (!sg || e.segmentos.some((s: string) => normalizar(s).includes(sg))) && (!busca || normalizar(`${e.nome} ${e.resumo ?? ''}`).includes(busca))) });
  }
  if (req.method === 'GET' && partes[0] === 'empresas' && partes[1]) {
    const id = partes[1];
    const [{ data: e }, { data: snaps }, { data: movs }, { data: execs }] = await Promise.all([
      db.from('olho_empresas').select('*').eq('id', id).maybeSingle(),
      db.from('olho_snapshots').select('id, created_at, mudancas').eq('empresa_id', id).order('created_at', { ascending: false }).limit(20),
      db.from('olho_movimentos').select('*').eq('empresa_id', id).order('created_at', { ascending: false }).limit(60),
      db.from('olho_execucoes').select('id, status, passo, created_at, terminado_em, fontes, novidades, erro').eq('empresa_id', id).order('created_at', { ascending: false }).limit(10),
    ]);
    if (!e) return json({ erro: 'Empresa não encontrada.' }, 404);
    return json({ empresa: e, historico: snaps ?? [], movimentos: movs ?? [], execucoes: execs ?? [] });
  }
  if (req.method === 'GET' && rota === '/movimentos') {
    let x = db.from('olho_movimentos').select('id, empresa_id, tipo, titulo, resumo, data_evento, fonte, url, relevancia, ameaca, oportunidade, segmentos, created_at, analise').order('created_at', { ascending: false }).limit(LIMITES.movimentos);
    const p = url.searchParams;
    if (p.get('empresa')) x = x.eq('empresa_id', p.get('empresa'));
    if (p.get('tipo')) x = x.eq('tipo', p.get('tipo'));
    if (p.get('desde')) x = x.gte('created_at', p.get('desde'));
    if (p.get('relevancia')) x = x.in('relevancia', ['critico', 'alto', 'medio', 'baixo'].filter((n) => atinge(n, p.get('relevancia')!)));
    if (p.get('filtro') === 'oportunidades') x = x.eq('oportunidade', true);
    if (p.get('filtro') === 'ameacas') x = x.eq('ameaca', true);
    const { data } = await x;
    const ids = [...new Set((data ?? []).map((m) => m.empresa_id).filter(Boolean))];
    const { data: es } = ids.length ? await db.from('olho_empresas').select('id, nome, segmentos, categoria').in('id', ids) : { data: [] };
    const mapa = Object.fromEntries((es ?? []).map((e) => [e.id, e]));
    const sg = normalizar(p.get('segmento') ?? ''), cat = p.get('categoria');
    return json({ movimentos: (data ?? []).map((m) => ({ ...m, empresa: mapa[m.empresa_id]?.nome ?? null, categoria: mapa[m.empresa_id]?.categoria ?? null }))
      .filter((m) => (!sg || [...m.segmentos, ...(mapa[m.empresa_id]?.segmentos ?? [])].some((s: string) => normalizar(s).includes(sg))) && (!cat || m.categoria === cat)) });
  }
  if (req.method === 'GET' && partes[0] === 'movimentos' && partes[1]) {
    const { data: m } = await db.from('olho_movimentos').select('*').eq('id', partes[1]).maybeSingle();
    if (!m) return json({ erro: 'Movimento não encontrado.' }, 404);
    const { data: e } = m.empresa_id ? await db.from('olho_empresas').select('id, nome').eq('id', m.empresa_id).single() : { data: null };
    return json({ movimento: { ...m, empresa: e?.nome ?? null } });
  }
  if (req.method === 'GET' && rota === '/alertas') {
    let x = db.from('olho_alertas').select('*').order('created_at', { ascending: false }).limit(100);
    if (url.searchParams.get('nivel')) x = x.in('nivel', ['critico', 'alto', 'medio', 'baixo'].filter((n) => atinge(n, url.searchParams.get('nivel')!)));
    if (url.searchParams.get('nao_lidos') === '1') x = x.is('lido_em', null);
    return json({ alertas: (await x).data ?? [] });
  }
  if (req.method === 'GET' && rota === '/execucoes') return json({ execucoes: (await db.from('olho_execucoes').select('id, tipo, empresa_id, status, passo, pedido_por, created_at, iniciado_em, terminado_em, fontes, novidades, resumo, erro').order('created_at', { ascending: false }).limit(80)).data ?? [] });
  if (rota === '/config') {
    if (req.method === 'POST') {
      soAdmin();
      const up: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof corpo.ativo === 'boolean') up.ativo = corpo.ativo;
      if (typeof corpo.meu_negocio === 'string') up.meu_negocio = corpo.meu_negocio.slice(0, 4000);
      if (Array.isArray(corpo.temas_alerta)) up.temas_alerta = corpo.temas_alerta.map(String).map((s: string) => s.trim().slice(0, 80)).filter(Boolean).slice(0, 30);
      if (Array.isArray(corpo.segmentos)) up.segmentos = corpo.segmentos.map(String).map((s: string) => s.trim().slice(0, 60)).filter(Boolean).slice(0, 30);
      for (const k of ['nivel_minimo_alerta', 'nivel_push']) if (['critico', 'alto', 'medio', 'baixo'].includes(corpo[k])) up[k] = corpo[k];
      if (Number.isFinite(Number(corpo.max_execucoes_dia))) up.max_execucoes_dia = Math.min(200, Math.max(1, Math.round(Number(corpo.max_execucoes_dia))));
      if (Number.isFinite(Number(corpo.frequencia_empresa_h))) up.frequencia_empresa_h = Math.min(720, Math.max(12, Math.round(Number(corpo.frequencia_empresa_h))));
      const { error } = await db.from('olho_config').update(up).eq('id', 1);
      if (error) return json({ erro: error.message }, 400);
    }
    return json({ config: await config(), admin: q.admin });
  }
  if (req.method !== 'POST') return json({ erro: 'não encontrado' }, 404);
  soAdmin();
  if (rota === '/empresas') {
    const nome = String(corpo.nome ?? '').trim().slice(0, 120);
    if (nome.length < 2) return json({ erro: 'Informe o nome da empresa.' }, 400);
    const s = slug(nome);
    const { data: todas } = await db.from('olho_empresas').select('id, nome, slug').limit(1000);
    const ja = (todas ?? []).find((e) => e.slug === s || mesmaEmpresa(e.nome, nome));
    if (ja) return json({ erro: `Essa empresa já está no radar (${ja.nome}).`, id: ja.id }, 409);
    const cat = ['concorrente', 'similar'].includes(corpo.categoria) ? corpo.categoria : 'candidata';
    const { data, error } = await db.from('olho_empresas').insert({ nome, slug: s, site: urlLimpa(corpo.site), categoria: cat, origem: 'manual', motivo_inclusao: 'Incluída por você', proxima_em: new Date().toISOString() }).select('id').single();
    if (error) return json({ erro: error.message }, 400);
    await db.from('olho_execucoes').insert({ tipo: 'empresa', empresa_id: data.id, pedido_por: 'usuario' }).then(() => {}, () => {});
    return json({ ok: true, id: data.id });
  }
  if (partes[0] === 'empresas' && partes[1] && partes[2] === 'atualizar') {
    const { error } = await db.from('olho_execucoes').insert({ tipo: 'empresa', empresa_id: partes[1], pedido_por: 'usuario' });
    return json({ ok: true, mensagem: error ? 'Já está na fila; sai em poucos minutos.' : 'Na fila. Leva de 4 a 8 minutos (pesquisa → análise).' });
  }
  if (partes[0] === 'empresas' && partes[1]) {
    const up: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (['concorrente', 'similar', 'candidata', 'descartada'].includes(corpo.categoria)) { up.categoria = corpo.categoria; up.origem = 'manual'; }
    for (const k of ['ativo', 'silenciada']) if (typeof corpo[k] === 'boolean') up[k] = corpo[k];
    if (corpo.site !== undefined) up.site = urlLimpa(corpo.site);
    if (corpo.frequencia_h === null || Number.isFinite(Number(corpo.frequencia_h))) up.frequencia_h = corpo.frequencia_h === null ? null : Math.min(720, Math.max(12, Math.round(Number(corpo.frequencia_h))));
    const { error } = await db.from('olho_empresas').update(up).eq('id', partes[1]);
    return error ? json({ erro: error.message }, 400) : json({ ok: true });
  }
  if (rota === '/descobrir') {
    const { error } = await db.from('olho_execucoes').insert({ tipo: 'descoberta', pedido_por: 'usuario' });
    return json({ ok: true, mensagem: error ? 'Uma busca de empresas já está em andamento.' : 'Buscando novas empresas. Leva alguns minutos.' });
  }
  if (rota === '/alertas/lidos') { await db.from('olho_alertas').update({ lido_em: new Date().toISOString() }).is('lido_em', null); return json({ ok: true }); }
  if (partes[0] === 'alertas' && partes[2] === 'lido') { await db.from('olho_alertas').update({ lido_em: new Date().toISOString() }).eq('id', partes[1]); return json({ ok: true }); }
  if (partes[0] === 'movimentos' && partes[2] === 'tarefa') {
    const { data: m } = await db.from('olho_movimentos').select('id, titulo, url, analise, empresa_id, relevancia').eq('id', partes[1]).maybeSingle();
    if (!m) return json({ erro: 'Movimento não encontrado.' }, 404);
    const { data: e } = m.empresa_id ? await db.from('olho_empresas').select('nome').eq('id', m.empresa_id).single() : { data: null };
    const titulo = String(corpo.titulo ?? m.analise?.acao_recomendada ?? `Analisar: ${m.titulo}`).slice(0, 300);
    const { data: t, error } = await db.from('tarefas').insert({ user_id: q.id, titulo, notas: `${m.titulo} — ${m.url}`.slice(0, 2000), dia: hojeSP(), prioridade: atinge(m.relevancia, 'alto') ? 1 : 2, projeto: 'Inteligência de mercado', empresa: e?.nome ?? null, origem: 'olho' }).select('id').single();
    if (error) return json({ erro: error.message }, 400);
    await db.from('tarefa_historico').insert({ tarefa_id: t.id, acao: 'criada', detalhe: `A partir do Olho de Deus: ${m.titulo}`, por: 'olho' });
    await db.from('tarefa_sugestoes').update({ status: 'aceita', tarefa_id: t.id, decidido_em: new Date().toISOString() }).eq('origem', 'olho').eq('origem_ref', m.id).eq('status', 'pendente');
    return json({ ok: true, tarefa_id: t.id });
  }
  return json({ erro: 'não encontrado' }, 404);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const rota = url.pathname.replace(/^.*\/olho/, '') || '/';
  try {
    if (rota === '/ciclo') {
      if (!igual(req.headers.get('x-cron-secret') ?? '', await seg('CRON_SECRET'))) return json({ erro: 'forbidden' }, 403);
      if (url.searchParams.get('wait') === '1') return json({ resultado: await ciclo() });
      const p = ciclo().then((r) => log(r)).catch((e) => log('ciclo falhou', e.message));
      (globalThis as any).EdgeRuntime?.waitUntil?.(p);
      return json({ status: 'started' }, 202);
    }
    const q = await quem(req);
    if (!q) return json({ erro: 'Sessão expirada. Entre de novo.' }, 401);
    return await rotas(req, rota, url, q);
  } catch (e) {
    const st = (e as any).status ?? 500;
    if (st === 500) console.error('[olho]', rota, e);
    return json({ erro: st === 500 ? 'Falha no Olho de Deus. Tente de novo em instantes.' : (e as Error).message }, st);
  }
});

// ---- consumo de IA (0032): grava tokens e buscas de cada chamada bem-sucedida em ia_consumo; nunca bloqueia nem quebra a chamada.
import { AsyncLocalStorage as __IA_ALS } from "node:async_hooks";
var __iaCtx = new __IA_ALS();
function __usoIA(j) {
  try {
    const u = j && j.usage; if (!u) return;
    const url = Deno.env.get("SUPABASE_URL"), k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); if (!url || !k) return;
    const st = u.server_tool_use || {};
    const p = fetch(url + "/rest/v1/ia_consumo", { method: "POST", headers: { apikey: k, Authorization: "Bearer " + k, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ funcao: "olho", tarefa: (__iaCtx && __iaCtx.getStore()) || null, modelo: String(j.model || ""), entrada: u.input_tokens || 0, saida: u.output_tokens || 0,
        cache_escrita: u.cache_creation_input_tokens || 0, cache_leitura: u.cache_read_input_tokens || 0, buscas: st.web_search_requests || 0 }) }).catch(() => {});
    try { globalThis.EdgeRuntime?.waitUntil?.(p); } catch { /* sem waitUntil */ }
  } catch { /* nunca atrapalha */ }
}
