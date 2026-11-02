// @ts-nocheck
// Tarefas em funil: A fazer → Fazendo → Feito, por dia, com "passar para o próximo dia útil".
// Rotas (JWT de membro ou x-app-key):
//   GET  /?dia=YYYY-MM-DD           tarefas do dia (+ atrasadas, se for hoje) e contagem dos próximos dias
//   POST /                          cria {titulo, notas?, dia?, prioridade?, etapa?}
//   POST /:id                       altera {titulo?, notas?, dia?, prioridade?, etapa?, ordem?}
//   POST /:id/adiar                 passa para o próximo dia útil
//   POST /:id/arquivar              tira da lista (não apaga)
//   POST /adiar-pendentes {dia}     passa tudo o que não foi feito no dia (e atrasadas) para o próximo dia útil
import { createClient } from 'npm:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-app-key, authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
const ETAPAS = ['a_fazer', 'fazendo', 'feito'];
const CAMPOS = 'id, titulo, notas, dia, etapa, prioridade, ordem, adiada_vezes, dia_original, concluida_em, created_at';

// ---------------------------------------------------------------- quem é
let appKey: string | null = null;
async function chaveApp() {
  if (appKey) return appKey;
  const { data } = await db.rpc('get_app_secrets');
  appKey = String((data ?? {}).sc_APP_KEY ?? '');
  return appKey;
}
const igual = (a: string, b: string) => {
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};
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
  const contagem: Record<string, { total: number; feitas: number }> = {};
  for (const t of proximos.data ?? []) {
    const c = (contagem[t.dia] ??= { total: 0, feitas: 0 });
    c.total++;
    if (t.etapa === 'feito') c.feitas++;
  }
  return { dia, hoje, tarefas: doDia.data ?? [], atrasadas: atrasadas.data ?? [], contagem };
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
  return up;
}

async function adiar(uid: string, ids: string[]) {
  if (!ids.length) return 0;
  const { data } = await db.from('tarefas').select('id, dia, dia_original, adiada_vezes').eq('user_id', uid).in('id', ids).neq('etapa', 'feito');
  const hoje = hojeSP();
  for (const t of data ?? []) {
    const base = t.dia < hoje ? hoje : t.dia;
    await db.from('tarefas').update({
      dia: proximoUtil(base),
      dia_original: t.dia_original ?? t.dia,
      adiada_vezes: (t.adiada_vezes ?? 0) + 1,
      updated_at: new Date().toISOString(),
    }).eq('id', t.id).eq('user_id', uid);
  }
  return (data ?? []).length;
}

// ---------------------------------------------------------------- rotas
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  try {
    const uid = await usuario(req);
    if (!uid) return json({ erro: 'Sessão expirada. Entre de novo.' }, 401);
    const url = new URL(req.url);
    const partes = url.pathname.replace(/^.*\/tarefas/, '').split('/').filter(Boolean);
    const corpo = req.method === 'POST' ? await req.json().catch(() => ({})) : {};

    if (req.method === 'GET' && !partes.length) {
      const dia = diaValido(url.searchParams.get('dia')) ? url.searchParams.get('dia')! : hojeSP();
      return json(await listar(uid, dia));
    }
    if (req.method !== 'POST') return json({ erro: 'não encontrado' }, 404);

    if (!partes.length) {
      const dados = limpar({ etapa: 'a_fazer', ...corpo });
      if (!dados.titulo) return json({ erro: 'Escreva a tarefa.' }, 400);
      const { data, error } = await db.from('tarefas').insert({ user_id: uid, dia: hojeSP(), ...dados }).select(CAMPOS).single();
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
      await db.from('tarefas').update({ arquivada: true, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', uid);
      return json({ ok: true });
    }
    if (partes.length === 1) {
      const up = limpar(corpo);
      const { data, error } = await db.from('tarefas').update({ ...up, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', uid).select(CAMPOS).maybeSingle();
      if (error) throw error;
      if (!data) return json({ erro: 'Tarefa não encontrada.' }, 404);
      return json({ tarefa: data });
    }
    return json({ erro: 'não encontrado' }, 404);
  } catch (e) {
    console.error('tarefas', e);
    return json({ erro: (e as Error).message || 'Falhou. Tente de novo.' }, 400);
  }
});
