// @ts-nocheck
// Tarefas em funil: A fazer → Fazendo → Feito, por dia, com "passar para o próximo dia útil".
// Rotas (JWT de membro ou x-app-key):
//   GET  /?dia=YYYY-MM-DD           tarefas do dia (+ atrasadas, se for hoje) e contagem dos próximos dias
//   POST /                          cria {titulo, notas?, dia?, prioridade?, etapa?}
//   POST /:id                       altera {titulo?, notas?, dia?, prioridade?, etapa?, ordem?}
//   POST /:id/adiar                 passa para o próximo dia útil
//   POST /:id/arquivar              tira da lista (não apaga)
//   POST /adiar-pendentes {dia}     passa tudo o que não foi feito no dia (e atrasadas) para o próximo dia útil
// Tarefas 2.0 (acréscimos; as rotas acima continuam iguais):
//   campos novos em criar/alterar: projeto, area, prazo, recorrencia, recorrencia_ate, empresa, contato_wa, oportunidade
//   GET  /:id/detalhe                tarefa + subtarefas + histórico
//   POST /:id/subtarefas {titulo}    POST /:id/subtarefas/:sid {titulo?, feita?}    POST /:id/subtarefas/:sid/apagar
//   POST /:id/nota {texto}           registra uma anotação no histórico
//   GET  /lixeira                    arquivadas (60 dias)   POST /:id/restaurar   POST /:id/excluir {confirmar:true}
//   GET  /projetos                   projetos/áreas com contagem    GET /buscar?projeto=&q=&prazo=vencido
//   GET  /sugestoes                  POST /sugestoes/:id/aceitar {dia?}   POST /sugestoes/:id/descartar
//   POST /sugerir  (x-cron-secret)   lê conversas novas e sugere tarefas (nunca cria sozinho)
// Histórico e recorrência ficam no banco (gatilho tarefas_auditar), valendo também para o Dimy e o Olho de Deus.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { chaveTarefa, normalizar, RECORRENCIAS, sugestaoAprovada } from './regras.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-app-key, authorization, x-conta',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
const ETAPAS = ['a_fazer', 'fazendo', 'feito'];
const CAMPOS = 'id, titulo, notas, dia, etapa, prioridade, ordem, adiada_vezes, dia_original, concluida_em, created_at, projeto, area, prazo, recorrencia, recorrencia_ate, empresa, contato_wa, oportunidade, origem';

// ---------------------------------------------------------------- quem é
let segredos: Record<string, string> | null = null;
async function seg(nome: string, padrao = '') {
  if (!segredos) {
    const { data } = await db.rpc('get_app_secrets');
    segredos = {};
    for (const [k, v] of Object.entries(data ?? {})) segredos[k.replace(/^sc_/, '')] = String(v);
  }
  return Deno.env.get(nome) ?? segredos[nome] ?? padrao;
}
const chaveApp = () => seg('APP_KEY');
const igual = (a: string, b: string) => {
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};
// Agir pela conta de outra pessoa (ex.: secretária nas tarefas do dono): header x-conta + permissão em acessos_compartilhados.
import { AsyncLocalStorage } from 'node:async_hooks';
const pedido = new AsyncLocalStorage<{ autor: string | null }>();
const autorAtual = () => pedido.getStore()?.autor ?? null;
const marca = () => ({ ultimo_autor: autorAtual(), ultimo_autor_em: new Date().toISOString() });
const porAgora = () => autorAtual() ?? 'app';
const cacheJwt = new Map<string, { id: string; ate: number }>();
async function usuario(req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (token.split('.').length === 3) {
    const c = cacheJwt.get(token);
    if (c && c.ate > Date.now()) return c.id;
    const { data, error } = await db.auth.getUser(token);
    if (error || !data.user) return null;
    const { data: m } = await db.from('membros').select('ativo').eq('user_id', data.user.id).maybeSingle();
    if (!m?.ativo) return null;
    cacheJwt.set(token, { id: data.user.id, ate: Date.now() + 60_000 });
    return data.user.id;
  }
  const k = req.headers.get('x-app-key') ?? '';
  if (k && igual(k, await chaveApp())) {
    const { data } = await db.from('membros').select('user_id').eq('papel', 'admin').eq('ativo', true).order('created_at').limit(1).maybeSingle();
    return data?.user_id ?? null;
  }
  return null;
}

// ---------------------------------------------------------------- datas (fuso de São Paulo)
const hojeSP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const somaDias = (d: string, n: number) => {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const diaValido = (d: unknown) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(`${d}T12:00:00Z`));
/** Próximo dia útil (segunda a sexta) depois de `d`. */
function proximoUtil(d: string) {
  let n = somaDias(d, 1);
  while ([0, 6].includes(new Date(`${n}T12:00:00Z`).getUTCDay())) n = somaDias(n, 1);
  return n;
}

// ---------------------------------------------------------------- ações
async function listar(uid: string, dia: string) {
  const hoje = hojeSP();
  const ate = somaDias(dia, 7);
  const [doDia, atrasadas, proximos] = await Promise.all([
    db.from('tarefas').select(CAMPOS).eq('user_id', uid).eq('arquivada', false).eq('dia', dia).order('ordem'),
    dia === hoje
      ? db.from('tarefas').select(CAMPOS).eq('user_id', uid).eq('arquivada', false).lt('dia', hoje).neq('etapa', 'feito').order('dia').order('ordem').limit(50)
      : Promise.resolve({ data: [] }),
    db.from('tarefas').select('dia, etapa').eq('user_id', uid).eq('arquivada', false).gte('dia', somaDias(dia, -3)).lte('dia', ate),
  ]);
  if (doDia.error) throw doDia.error;
  const todas = [...(doDia.data ?? []), ...(atrasadas.data ?? [])];
  const [subs, prazos, sug] = await Promise.all([
    todas.length ? db.from('tarefa_subtarefas').select('tarefa_id, feita').in('tarefa_id', todas.map((t) => t.id)) : Promise.resolve({ data: [] }),
    db.from('tarefas').select(CAMPOS).eq('user_id', uid).eq('arquivada', false).neq('etapa', 'feito').not('prazo', 'is', null).lte('prazo', somaDias(hoje, 2)).order('prazo').limit(30),
    db.from('tarefa_sugestoes').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('status', 'pendente'),
  ]);
  const progresso: Record<string, { total: number; feitas: number }> = {};
  for (const x of subs.data ?? []) { const p = (progresso[x.tarefa_id] ??= { total: 0, feitas: 0 }); p.total++; if (x.feita) p.feitas++; }
  for (const t of todas) (t as any).subtarefas = progresso[t.id] ?? null;
  const contagem: Record<string, { total: number; feitas: number }> = {};
  for (const t of proximos.data ?? []) {
    const c = (contagem[t.dia] ??= { total: 0, feitas: 0 });
    c.total++;
    if (t.etapa === 'feito') c.feitas++;
  }
  return { dia, hoje, tarefas: doDia.data ?? [], atrasadas: atrasadas.data ?? [], contagem, prazos: prazos.data ?? [], sugestoes_pendentes: sug.count ?? 0 };
}

function limpar(b: Record<string, unknown>) {
  const up: Record<string, unknown> = {};
  if (typeof b.titulo === 'string') {
    const t = b.titulo.trim().slice(0, 300);
    if (!t) throw new Error('Escreva a tarefa.');
    up.titulo = t;
  }
  if (typeof b.notas === 'string') up.notas = b.notas.trim().slice(0, 2000) || null;
  if (b.dia !== undefined) {
    if (!diaValido(b.dia)) throw new Error('Dia inválido.');
    up.dia = b.dia;
  }
  if (b.prioridade !== undefined) up.prioridade = Math.min(3, Math.max(1, Math.round(Number(b.prioridade)) || 2));
  if (b.etapa !== undefined) {
    if (!ETAPAS.includes(String(b.etapa))) throw new Error('Etapa inválida.');
    up.etapa = b.etapa;
    up.concluida_em = b.etapa === 'feito' ? new Date().toISOString() : null;
  }
  if (b.ordem !== undefined && Number.isFinite(Number(b.ordem))) up.ordem = Number(b.ordem);
  for (const k of ['projeto', 'area', 'empresa', 'oportunidade']) if (b[k] !== undefined) up[k] = typeof b[k] === 'string' ? (b[k] as string).trim().slice(0, 80) || null : null;
  if (b.contato_wa !== undefined) up.contato_wa = typeof b.contato_wa === 'string' ? b.contato_wa.replace(/[^\d@.a-z]/gi, '').slice(0, 60) || null : null;
  for (const k of ['prazo', 'recorrencia_ate']) if (b[k] !== undefined) {
    if (b[k] === null || b[k] === '') up[k] = null;
    else if (!diaValido(b[k])) throw new Error('Data inválida.');
    else up[k] = b[k];
  }
  if (b.recorrencia !== undefined) {
    if (b.recorrencia === null || b.recorrencia === '') up.recorrencia = null;
    else if (!RECORRENCIAS.includes(String(b.recorrencia) as any)) throw new Error('Repetição inválida.');
    else up.recorrencia = b.recorrencia;
  }
  return up;
}

async function adiar(uid: string, ids: string[]) {
  if (!ids.length) return 0;
  const { data } = await db.from('tarefas').select('id, dia, dia_original, adiada_vezes').eq('user_id', uid).in('id', ids).neq('etapa', 'feito');
  const hoje = hojeSP();
  for (const t of data ?? []) {
    const base = t.dia < hoje ? hoje : t.dia;
    await db.from('tarefas').update({
      ...marca(),
      dia: proximoUtil(base),
      dia_original: t.dia_original ?? t.dia,
      adiada_vezes: (t.adiada_vezes ?? 0) + 1,
      updated_at: new Date().toISOString(),
    }).eq('id', t.id).eq('user_id', uid);
  }
  return (data ?? []).length;
}

// ---------------------------------------------------------------- sugestões a partir das conversas
async function claude(corpo: Record<string, unknown>) {
  const chave = await seg('ANTHROPIC_API_KEY');
  for (let t = 0; ; t++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
    if(r.ok){const __j=await r.json();__usoIA(__j);return __j}
    const det = (await r.text()).slice(0, 200);
    if ((r.status === 429 || r.status >= 500) && t < 2) { await new Promise((ok) => setTimeout(ok, 2000 * (t + 1))); continue; }
    throw new Error(`IA ${r.status}: ${det}`);
  }
}
const ESQ_SUG = {
  type: 'object', properties: { candidatas: { type: 'array', items: { type: 'object', properties: {
    evento: { type: 'integer', description: 'número da mensagem de onde saiu' },
    titulo: { type: 'string', description: 'Tarefa no infinitivo, curta e específica (quem/o quê)' },
    notas: { type: 'string', description: 'Contexto mínimo: quem pediu, o que foi combinado' },
    acao_concreta: { type: 'boolean', description: 'Existe uma ação concreta a fazer?' },
    compromisso: { type: 'boolean', description: 'Michelder assumiu um compromisso ou recebeu um pedido?' },
    prazo: { type: 'string', description: 'YYYY-MM-DD se houver prazo explícito ou claramente implícito ("amanhã", "sexta")' },
    exige_acompanhamento: { type: 'boolean', description: 'Precisa de acompanhamento (não é algo já resolvido na própria conversa)?' },
    ja_existe: { type: 'boolean', description: 'Já está na lista de tarefas abertas?' },
    confianca: { type: 'number', minimum: 0, maximum: 1 },
    motivo: { type: 'string', description: 'Por que isso merece virar tarefa (1 frase)' },
    projeto: { type: 'string' }, empresa: { type: 'string' },
  }, required: ['evento', 'titulo', 'acao_concreta', 'compromisso', 'exige_acompanhamento', 'ja_existe', 'confianca', 'motivo'] } } },
  required: ['candidatas'],
};
async function sugerir() {
  const { data: est } = await db.from('tarefa_sugestor_estado').select('*').eq('id', 1).single();
  const desde = est?.ultimo_evento ?? new Date(Date.now() - 864e5).toISOString();
  const { data: evs } = await db.from('raw_events').select('id, user_id, source, content, occurred_at, created_at').in('source', ['app', 'whatsapp_eu', 'gravacao']).gt('created_at', desde).order('created_at').limit(40);
  // sugestões paradas há 14 dias vencem (não ficam acumulando)
  await db.from('tarefa_sugestoes').update({ status: 'vencida', decidido_em: new Date().toISOString() }).eq('status', 'pendente').lt('created_at', new Date(Date.now() - 14 * 864e5).toISOString());
  if (!evs?.length) { await db.from('tarefa_sugestor_estado').update({ ultima_execucao: new Date().toISOString(), ultimo_resultado: 'nada novo' }).eq('id', 1); return { lidas: 0, sugeridas: 0 }; }
  const porUsuario = new Map<string, typeof evs>();
  for (const e of evs) if (e.user_id && (e.content ?? '').trim().length > 15) (porUsuario.get(e.user_id) ?? porUsuario.set(e.user_id, []).get(e.user_id)!).push(e);
  let sugeridas = 0; const descartes: string[] = [];
  for (const [uid, lista] of porUsuario) {
    const [{ data: abertas }, { data: recentes }] = await Promise.all([
      db.from('tarefas').select('titulo').eq('user_id', uid).eq('arquivada', false).neq('etapa', 'feito').limit(200),
      db.from('tarefa_sugestoes').select('titulo').eq('user_id', uid).gte('created_at', new Date(Date.now() - 30 * 864e5).toISOString()).limit(200),
    ]);
    const existentes = [...(abertas ?? []), ...(recentes ?? [])].map((x) => x.titulo);
    const fonte = { app: 'conversa com o Dimy', whatsapp_eu: 'mensagem que Michelder enviou no WhatsApp', gravacao: 'gravação de reunião' } as Record<string, string>;
    const hoje = hojeSP();
    const sys = `Você identifica tarefas reais nas conversas de Michelder (B2B PAY). Hoje é ${hoje} (${new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'America/Sao_Paulo' }).format(new Date())}).
Sugira uma tarefa SOMENTE quando houver ação concreta, compromisso assumido ou pedido recebido, ainda não resolvido na própria conversa e que precise de acompanhamento.
NÃO sugira: conversa social, perguntas já respondidas, informações sem ação, coisas que o Dimy já fez (lembrete criado, mensagem enviada), nem nada que já esteja na lista de abertas.
Na dúvida, não sugira. Prefira 0 a uma sugestão fraca.`;
    const user = `TAREFAS ABERTAS E SUGESTÕES RECENTES (não repita):\n${existentes.slice(0, 120).map((t) => `- ${t}`).join('\n') || '(nenhuma)'}\n\nMENSAGENS NOVAS:\n${lista.map((e, i) => `${i}. [${fonte[e.source] ?? e.source} · ${String(e.occurred_at ?? e.created_at).slice(0, 16)}] ${String(e.content).slice(0, 1500)}`).join('\n')}`;
    const tool = { name: 'sugerir_tarefas', description: 'Registra as tarefas candidatas (lista vazia se não houver).', input_schema: ESQ_SUG };
    let x: any = null;
    for (let t = 0; t < 2 && !x; t++) {
      const r = await claude({ model: await seg('CLAUDE_CHAT_MODEL', 'claude-sonnet-5-5'), max_tokens: 3000, tools: [tool], tool_choice: { type: 'auto' }, system: `${sys}\n\nIMPORTANTE: responda exclusivamente chamando a ferramenta "sugerir_tarefas".`, messages: [{ role: 'user', content: user }] });
      x = r.content?.find((b: any) => b.type === 'tool_use')?.input ?? null;
    }
    if (!x) { const r = await claude({ model: await seg('CLAUDE_FAST_MODEL', 'claude-haiku-4-5-20251001'), max_tokens: 3000, tools: [tool], tool_choice: { type: 'tool', name: 'sugerir_tarefas' }, system: sys, messages: [{ role: 'user', content: user }] }); x = r.content?.find((b: any) => b.type === 'tool_use')?.input ?? { candidatas: [] }; }
    for (const c of (x.candidatas ?? []).slice(0, 10)) {
      const ok = sugestaoAprovada(c, existentes);
      if (!ok.ok) { descartes.push(`${String(c.titulo ?? '').slice(0, 40)}: ${ok.motivo}`); continue; }
      const ev = lista[c.evento] ?? lista[0];
      const prazo = diaValido(c.prazo) && c.prazo >= hoje ? c.prazo : null;
      const { error } = await db.from('tarefa_sugestoes').insert({
        user_id: uid, titulo: String(c.titulo).trim().slice(0, 200), notas: String(c.notas ?? '').slice(0, 800) || null, prazo, dia: prazo && prazo < somaDias(hoje, 7) ? prazo : null,
        prioridade: prazo && prazo <= somaDias(hoje, 1) ? 1 : 2, projeto: c.projeto?.slice(0, 80) || null, empresa: c.empresa?.slice(0, 80) || null,
        origem: 'conversa', origem_ref: ev.id, motivo: String(c.motivo ?? '').slice(0, 300),
        criterios: { acao_concreta: !!c.acao_concreta, compromisso: !!c.compromisso, exige_acompanhamento: !!c.exige_acompanhamento, confianca: c.confianca, fonte: ev.source },
        chave: chaveTarefa(c.titulo),
      });
      if (!error) { sugeridas++; existentes.push(c.titulo); }
    }
  }
  const ultimo = evs[evs.length - 1].created_at;
  const resumo = `${evs.length} mensagem(ns) lida(s), ${sugeridas} sugestão(ões)${descartes.length ? `; descartadas: ${descartes.slice(0, 5).join(' · ')}` : ''}`;
  await db.from('tarefa_sugestor_estado').update({ ultimo_evento: ultimo, ultima_execucao: new Date().toISOString(), ultimo_resultado: resumo.slice(0, 1000) }).eq('id', 1);
  console.log('[tarefas] sugerir:', resumo);
  return { lidas: evs.length, sugeridas, descartes };
}

// ---------------------------------------------------------------- rotas
Deno.serve((req) => pedido.run({ autor: null }, () => tratar(req)));
async function tratar(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  try {
    if (new URL(req.url).pathname.endsWith('/sugerir')) {
      if (!igual(req.headers.get('x-cron-secret') ?? '', await seg('CRON_SECRET'))) return json({ erro: 'forbidden' }, 403);
      return json(await sugerir());
    }
    let uid = await usuario(req);
    if (!uid) return json({ erro: 'Sessão expirada. Entre de novo.' }, 401);
    const url = new URL(req.url);
    const conta = req.headers.get('x-conta') ?? '';
    if (conta && conta !== uid) {
      // Ex.: secretária abrindo as tarefas do dono. Só com permissão dada por ele; excluir de vez continua só com o dono.
      const { data: ac } = await db.from('acessos_compartilhados').select('tarefas').eq('dono', conta).eq('membro', uid).maybeSingle();
      if (!ac?.tarefas) return json({ erro: 'Você não tem acesso às tarefas dessa pessoa.' }, 403);
      const { data: dono } = await db.from('membros').select('ativo').eq('user_id', conta).maybeSingle();
      if (!dono?.ativo) return json({ erro: 'Essa conta não está mais ativa.' }, 403);
      if (/\/excluir$/.test(url.pathname)) return json({ erro: 'Só o dono das tarefas pode excluir de vez. Mande para a lixeira.' }, 403);
      const { data: eu } = await db.from('membros').select('nome').eq('user_id', uid).maybeSingle();
      pedido.getStore()!.autor = `por ${String(eu?.nome ?? 'equipe').split(' ')[0]}`;
      uid = conta;
    }
    const partes = url.pathname.replace(/^.*\/tarefas/, '').split('/').filter(Boolean);
    const corpo = req.method === 'POST' ? await req.json().catch(() => ({})) : {};

    if (req.method === 'GET' && !partes.length) {
      const dia = diaValido(url.searchParams.get('dia')) ? url.searchParams.get('dia')! : hojeSP();
      return json(await listar(uid, dia));
    }
    if (req.method === 'GET' && partes[0] === 'lixeira') {
      const { data } = await db.from('tarefas').select(CAMPOS + ', arquivada_em, updated_at').eq('user_id', uid).eq('arquivada', true).gte('updated_at', new Date(Date.now() - 60 * 864e5).toISOString()).order('updated_at', { ascending: false }).limit(100);
      return json({ tarefas: data ?? [] });
    }
    if (req.method === 'GET' && partes[0] === 'projetos') {
      const { data } = await db.from('tarefas').select('projeto, area, etapa, prazo').eq('user_id', uid).eq('arquivada', false);
      const hoje = hojeSP(), mapa: Record<string, { projeto: string; abertas: number; feitas: number; vencidas: number; areas: string[] }> = {};
      for (const t of data ?? []) {
        if (!t.projeto) continue;
        const p = (mapa[t.projeto] ??= { projeto: t.projeto, abertas: 0, feitas: 0, vencidas: 0, areas: [] });
        if (t.etapa === 'feito') p.feitas++; else { p.abertas++; if (t.prazo && t.prazo < hoje) p.vencidas++; }
        if (t.area && !p.areas.includes(t.area)) p.areas.push(t.area);
      }
      const areas = [...new Set((data ?? []).map((t) => t.area).filter(Boolean))];
      return json({ projetos: Object.values(mapa).sort((a, b) => b.abertas - a.abertas), areas });
    }
    if (req.method === 'GET' && partes[0] === 'buscar') {
      const p = url.searchParams;
      let q = db.from('tarefas').select(CAMPOS).eq('user_id', uid).eq('arquivada', false).order('dia').limit(200);
      if (p.get('projeto')) q = q.eq('projeto', p.get('projeto'));
      if (p.get('area')) q = q.eq('area', p.get('area'));
      if (p.get('empresa')) q = q.ilike('empresa', `%${p.get('empresa')!.replace(/[%_]/g, '')}%`);
      if (p.get('abertas') !== '0') q = q.neq('etapa', 'feito');
      if (p.get('prazo') === 'vencido') q = q.lt('prazo', hojeSP());
      const { data } = await q;
      const termo = normalizar(p.get('q') ?? '');
      return json({ tarefas: (data ?? []).filter((t) => !termo || normalizar(`${t.titulo} ${t.notas ?? ''} ${t.empresa ?? ''} ${t.projeto ?? ''}`).includes(termo)) });
    }
    if (req.method === 'GET' && partes[0] === 'sugestoes') {
      const { data } = await db.from('tarefa_sugestoes').select('id, titulo, notas, dia, prazo, prioridade, projeto, empresa, contato_wa, origem, origem_ref, motivo, criterios, created_at').eq('user_id', uid).eq('status', 'pendente').order('created_at', { ascending: false }).limit(30);
      return json({ sugestoes: data ?? [] });
    }
    if (req.method === 'GET' && partes[1] === 'detalhe' && /^[0-9a-f-]{36}$/.test(partes[0])) {
      const [{ data: t }, { data: subs }, { data: hist }] = await Promise.all([
        db.from('tarefas').select(CAMPOS + ', arquivada, recorrencia_origem').eq('id', partes[0]).eq('user_id', uid).maybeSingle(),
        db.from('tarefa_subtarefas').select('id, titulo, feita, ordem').eq('tarefa_id', partes[0]).order('ordem'),
        db.from('tarefa_historico').select('acao, detalhe, por, created_at').eq('tarefa_id', partes[0]).order('created_at', { ascending: false }).limit(50),
      ]);
      if (!t) return json({ erro: 'Tarefa não encontrada.' }, 404);
      return json({ tarefa: t, subtarefas: subs ?? [], historico: hist ?? [] });
    }
    if (req.method !== 'POST') return json({ erro: 'não encontrado' }, 404);

    if (partes[0] === 'sugestoes' && partes[1] && ['aceitar', 'descartar'].includes(partes[2])) {
      const { data: s } = await db.from('tarefa_sugestoes').select('*').eq('id', partes[1]).eq('user_id', uid).eq('status', 'pendente').maybeSingle();
      if (!s) return json({ erro: 'Sugestão não encontrada (talvez já decidida).' }, 404);
      if (partes[2] === 'descartar') {
        await db.from('tarefa_sugestoes').update({ status: 'descartada', decidido_em: new Date().toISOString() }).eq('id', s.id);
        return json({ ok: true });
      }
      const dia = diaValido(corpo.dia) ? corpo.dia : (s.dia && s.dia >= hojeSP() ? s.dia : hojeSP());
      const { data: t, error } = await db.from('tarefas').insert({
        ...marca(),
        user_id: uid, titulo: String(corpo.titulo ?? s.titulo).slice(0, 300), notas: [s.notas, s.motivo ? `Por quê: ${s.motivo}` : null].filter(Boolean).join('\n').slice(0, 2000) || null,
        dia, prazo: s.prazo, prioridade: s.prioridade, projeto: s.projeto, empresa: s.empresa, contato_wa: s.contato_wa, origem: s.origem === 'olho' ? 'olho' : 'sugestao',
      }).select(CAMPOS).single();
      if (error) throw error;
      await db.from('tarefa_sugestoes').update({ status: 'aceita', tarefa_id: t.id, decidido_em: new Date().toISOString() }).eq('id', s.id);
      return json({ ok: true, tarefa: t });
    }

    if (!partes.length) {
      const dados = limpar({ etapa: 'a_fazer', ...corpo });
      if (!dados.titulo) return json({ erro: 'Escreva a tarefa.' }, 400);
      const { data, error } = await db.from('tarefas').insert({ user_id: uid, dia: hojeSP(), ...dados, ...marca() }).select(CAMPOS).single();
      if (error) throw error;
      return json({ tarefa: data });
    }
    if (partes[0] === 'adiar-pendentes') {
      const dia = diaValido(corpo.dia) ? corpo.dia : hojeSP();
      let q = db.from('tarefas').select('id').eq('user_id', uid).eq('arquivada', false).neq('etapa', 'feito');
      q = dia === hojeSP() ? q.lte('dia', dia) : q.eq('dia', dia);
      const { data } = await q;
      const n = await adiar(uid, (data ?? []).map((x) => x.id));
      return json({ ok: true, movidas: n, para: proximoUtil(dia < hojeSP() ? hojeSP() : dia) });
    }
    const id = partes[0];
    if (!/^[0-9a-f-]{36}$/.test(id)) return json({ erro: 'tarefa inválida' }, 400);
    if (partes[1] === 'adiar') {
      const n = await adiar(uid, [id]);
      const { data } = await db.from('tarefas').select(CAMPOS).eq('id', id).eq('user_id', uid).maybeSingle();
      return json({ ok: n > 0, tarefa: data });
    }
    if (partes[1] === 'arquivar') {
      await db.from('tarefas').update({ arquivada: true, arquivada_em: new Date().toISOString(), updated_at: new Date().toISOString(), ...marca() }).eq('id', id).eq('user_id', uid);
      return json({ ok: true });
    }
    if (partes[1] === 'restaurar') {
      const { data } = await db.from('tarefas').update({ arquivada: false, arquivada_em: null, updated_at: new Date().toISOString(), ...marca() }).eq('id', id).eq('user_id', uid).select(CAMPOS).maybeSingle();
      return data ? json({ ok: true, tarefa: data }) : json({ erro: 'Tarefa não encontrada.' }, 404);
    }
    if (partes[1] === 'excluir') {
      // exclusão definitiva: só da lixeira e com confirmação explícita
      if (corpo.confirmar !== true) return json({ erro: 'Confirme a exclusão definitiva.' }, 400);
      const { data: t } = await db.from('tarefas').select('id, arquivada').eq('id', id).eq('user_id', uid).maybeSingle();
      if (!t) return json({ erro: 'Tarefa não encontrada.' }, 404);
      if (!t.arquivada) return json({ erro: 'Mande para a lixeira antes de excluir de vez.' }, 409);
      await db.from('tarefas').delete().eq('id', id).eq('user_id', uid);
      return json({ ok: true });
    }
    // dono da tarefa (para subtarefas e notas)
    const dono = async () => !!(await db.from('tarefas').select('id').eq('id', id).eq('user_id', uid).maybeSingle()).data;
    if (partes[1] === 'nota') {
      const texto = String(corpo.texto ?? '').trim().slice(0, 1000);
      if (!texto) return json({ erro: 'Escreva a anotação.' }, 400);
      if (!(await dono())) return json({ erro: 'Tarefa não encontrada.' }, 404);
      await db.from('tarefa_historico').insert({ tarefa_id: id, acao: 'nota', detalhe: texto, por: porAgora() });
      return json({ ok: true });
    }
    if (partes[1] === 'subtarefas') {
      if (!(await dono())) return json({ erro: 'Tarefa não encontrada.' }, 404);
      const sid = partes[2];
      if (!sid) {
        const titulo = String(corpo.titulo ?? '').trim().slice(0, 200);
        if (!titulo) return json({ erro: 'Escreva a subtarefa.' }, 400);
        const { data, error } = await db.from('tarefa_subtarefas').insert({ tarefa_id: id, titulo }).select('id, titulo, feita, ordem').single();
        if (error) throw error;
        await db.from('tarefa_historico').insert({ tarefa_id: id, acao: 'subtarefa', detalhe: `+ ${titulo}`, por: porAgora() });
        return json({ subtarefa: data });
      }
      if (!/^[0-9a-f-]{36}$/.test(sid)) return json({ erro: 'subtarefa inválida' }, 400);
      if (partes[3] === 'apagar') {
        const { data } = await db.from('tarefa_subtarefas').delete().eq('id', sid).eq('tarefa_id', id).select('titulo').maybeSingle();
        if (data) await db.from('tarefa_historico').insert({ tarefa_id: id, acao: 'subtarefa', detalhe: `− ${data.titulo}`, por: porAgora() });
        return json({ ok: true });
      }
      const up: Record<string, unknown> = {};
      if (typeof corpo.titulo === 'string' && corpo.titulo.trim()) up.titulo = corpo.titulo.trim().slice(0, 200);
      if (typeof corpo.feita === 'boolean') up.feita = corpo.feita;
      const { data } = await db.from('tarefa_subtarefas').update(up).eq('id', sid).eq('tarefa_id', id).select('id, titulo, feita, ordem').maybeSingle();
      if (data && typeof corpo.feita === 'boolean') await db.from('tarefa_historico').insert({ tarefa_id: id, acao: 'subtarefa', detalhe: `${corpo.feita ? '✓' : '○'} ${data.titulo}`, por: porAgora() });
      return data ? json({ subtarefa: data }) : json({ erro: 'Subtarefa não encontrada.' }, 404);
    }
    if (partes.length === 1) {
      const up = limpar(corpo);
      const { data, error } = await db.from('tarefas').update({ ...up, updated_at: new Date().toISOString(), ...marca() }).eq('id', id).eq('user_id', uid).select(CAMPOS).maybeSingle();
      if (error) throw error;
      if (!data) return json({ erro: 'Tarefa não encontrada.' }, 404);
      return json({ tarefa: data });
    }
    return json({ erro: 'não encontrado' }, 404);
  } catch (e) {
    console.error('tarefas', e);
    return json({ erro: (e as Error).message || 'Falhou. Tente de novo.' }, 400);
  }
}

// ---- consumo de IA (0032): grava tokens e buscas de cada chamada bem-sucedida em ia_consumo; nunca bloqueia nem quebra a chamada.
import { AsyncLocalStorage as __IA_ALS } from "node:async_hooks";
var __iaCtx = new __IA_ALS();
function __usoIA(j) {
  try {
    const u = j && j.usage; if (!u) return;
    const url = Deno.env.get("SUPABASE_URL"), k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); if (!url || !k) return;
    const st = u.server_tool_use || {};
    const p = fetch(url + "/rest/v1/ia_consumo", { method: "POST", headers: { apikey: k, Authorization: "Bearer " + k, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ funcao: "tarefas", tarefa: (__iaCtx && __iaCtx.getStore()) || null, modelo: String(j.model || ""), entrada: u.input_tokens || 0, saida: u.output_tokens || 0,
        cache_escrita: u.cache_creation_input_tokens || 0, cache_leitura: u.cache_read_input_tokens || 0, buscas: st.web_search_requests || 0 }) }).catch(() => {});
    try { globalThis.EdgeRuntime?.waitUntil?.(p); } catch { /* sem waitUntil */ }
  } catch { /* nunca atrapalha */ }
}
