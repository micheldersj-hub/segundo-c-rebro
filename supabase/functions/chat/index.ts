// @ts-nocheck
// CHAT interno da equipe + COMPARTILHAMENTO de agenda e tarefas (ex.: secretária).
// Privacidade: cada pedido confere se a pessoa participa da conversa. Ninguém, nem o administrador, lê conversa dos outros.
// Rotas (JWT de membro ou x-app-key do dono):
//   GET  /pessoas                          equipe ativa + contas que compartilharam comigo (agenda/tarefas)
//   GET  /conversas                        minhas conversas (o grupo "Equipe" sempre existe), última mensagem e não lidas
//   POST /conversas {com}                  abre (ou cria) a conversa individual com um membro
//   GET  /conversas/:id/mensagens?antes=   50 por página, da mais nova para trás (devolvidas em ordem de tempo)
//   GET  /conversas/:id/mensagens?depois=  só as novas (para atualizar a tela a cada poucos segundos)
//   POST /conversas/:id/mensagens {texto}  envia texto; com arquivo: corpo binário + ?nome=&texto=  (até 25 MB)
//   POST /conversas/:id/lido               marca como lida
//   POST /mensagens/:id/apagar             só o autor apaga a própria mensagem (some para todos)
//   GET  /anexo/:mensagem                  link temporário (10 min) para baixar o arquivo
//   GET  /naolidas                         total de mensagens não lidas
//   GET  /acessos                          (dono) com quem compartilho agenda/tarefas
//   POST /acessos {membro, agenda, tarefas}   (dono) concede ou ajusta;   POST /acessos/:membro/remover
import { createClient } from 'npm:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-app-key, authorization, x-conta', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
const falha = (msg: string, status = 400) => Object.assign(new Error(msg), { status });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ---------------------------------------------------------------- segredos (Vault)
let segCache: Record<string, string> | null = null, segEm = 0;
async function segs() {
  if (!segCache || Date.now() - segEm > 60_000) {
    const { data, error } = await db.rpc('get_app_secrets');
    if (error) throw new Error('não consegui ler a configuração do servidor');
    segCache = {}; for (const [k, v] of Object.entries(data ?? {})) segCache[k.replace(/^sc_/, '')] = String(v);
    segEm = Date.now();
  }
  return segCache;
}
async function seg(nome: string) { const v = Deno.env.get(nome) ?? (await segs())[nome]; if (!v) throw new Error(`configuração ausente: ${nome}`); return v; }
const igual = (a: string, b: string) => { if (!a || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

// ---------------------------------------------------------------- quem está pedindo
type Eu = { id: string; nome: string; admin: boolean };
const cacheJwt = new Map<string, { q: Eu; ate: number }>();
async function membro(id: string): Promise<Eu | null> {
  const { data: m } = await db.from('membros').select('user_id, nome, papel, ativo').eq('user_id', id).maybeSingle();
  return m?.ativo ? { id: m.user_id, nome: m.nome, admin: m.papel === 'admin' } : null;
}
async function quem(req: Request): Promise<Eu | null> {
  const a = req.headers.get('authorization') ?? '';
  const t = a.startsWith('Bearer ') ? a.slice(7).trim() : '';
  if (t.split('.').length === 3) {
    const c = cacheJwt.get(t); if (c && c.ate > Date.now()) return c.q;
    const { data, error } = await db.auth.getUser(t);
    if (error || !data.user) return null;
    const q = await membro(data.user.id); if (!q) return null;
    cacheJwt.set(t, { q, ate: Date.now() + 60_000 }); if (cacheJwt.size > 200) cacheJwt.delete(cacheJwt.keys().next().value);
    return q;
  }
  const k = req.headers.get('x-app-key') ?? '';
  if (k && igual(k, await seg('APP_KEY'))) {
    const { data } = await db.from('membros').select('user_id').eq('papel', 'admin').eq('ativo', true).order('created_at').limit(1).maybeSingle();
    return data ? await membro(data.user_id) : null;
  }
  return null;
}

// ---------------------------------------------------------------- aviso no celular (mesmo formato dos outros módulos; não entra em "Avisos")
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
async function avisarCelular(uids: string[], titulo: string, corpo: string, url: string, tag: string) {
  if (!uids.length) return;
  const { data: subs } = await db.from('push_subscriptions').select('endpoint, keys').in('user_id', uids);
  if (!subs?.length) return;
  const [pub, priv, suj] = await Promise.all([seg('VAPID_PUBLIC_KEY'), seg('VAPID_PRIVATE_KEY'), seg('VAPID_SUBJECT')]);
  const carga = JSON.stringify({ title: titulo, body: corpo.length > 160 ? corpo.slice(0, 157) + '…' : corpo, kind: 'chat', id: tag, url });
  await Promise.all(subs.map(async (s) => {
    try {
      const r = await fetch(s.endpoint, { method: 'POST', headers: { Authorization: await vapid(s.endpoint, pub, priv, suj), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'normal' }, body: await cifrarPush(carga, s.keys.p256dh, s.keys.auth) });
      if (r.status === 404 || r.status === 410) await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
    } catch (e) { console.warn('[chat] push:', (e as Error).message); }
  }));
}

// ---------------------------------------------------------------- conversas
async function equipeAtiva() {
  const { data } = await db.from('membros').select('user_id, nome, papel').eq('ativo', true).order('created_at');
  return data ?? [];
}
// O grupo "Equipe" sempre tem todos os membros ativos (quem entra na equipe já participa).
async function grupoEquipe() {
  let { data: c } = await db.from('chat_conversas').select('id').eq('chave', 'equipe').maybeSingle();
  if (!c) {
    const r = await db.from('chat_conversas').upsert({ tipo: 'grupo', nome: 'Equipe', chave: 'equipe' }, { onConflict: 'chave' }).select('id').single();
    if (r.error) throw r.error; c = r.data;
  }
  const ativos = await equipeAtiva();
  const { data: part } = await db.from('chat_participantes').select('user_id').eq('conversa_id', c.id);
  const tem = new Set((part ?? []).map((p) => p.user_id));
  const faltam = ativos.filter((m) => !tem.has(m.user_id)).map((m) => ({ conversa_id: c.id, user_id: m.user_id }));
  if (faltam.length) await db.from('chat_participantes').upsert(faltam, { onConflict: 'conversa_id,user_id', ignoreDuplicates: true });
  // Quem sai da equipe (membro inativo) não entra mais no servidor, então deixa de ver o grupo sem precisar apagar nada.
  return c.id as string;
}
async function participa(conversa: string, uid: string) {
  if (!UUID.test(conversa)) return false;
  const { data } = await db.from('chat_participantes').select('user_id').eq('conversa_id', conversa).eq('user_id', uid).maybeSingle();
  return !!data;
}
async function exigirParticipante(conversa: string, eu: Eu) {
  if (!(await participa(conversa, eu.id))) throw falha('Conversa não encontrada.', 404);
}
async function listarConversas(eu: Eu) {
  await grupoEquipe();
  const { data: minhas } = await db.from('chat_participantes').select('conversa_id').eq('user_id', eu.id);
  const ids = (minhas ?? []).map((x) => x.conversa_id);
  if (!ids.length) return [];
  const [{ data: convs }, { data: parts }, { data: nl }, equipe] = await Promise.all([
    db.from('chat_conversas').select('id, tipo, nome, chave, ultima_em').in('id', ids),
    db.from('chat_participantes').select('conversa_id, user_id, lido_em').in('conversa_id', ids),
    db.rpc('chat_nao_lidas', { p_user: eu.id }),
    equipeAtiva(),
  ]);
  const nomes = new Map(equipe.map((m) => [m.user_id, m.nome]));
  const naoLidas = new Map((nl ?? []).map((x) => [x.conversa_id, Number(x.n)]));
  const ultimas = await Promise.all(ids.map((id) => db.from('chat_mensagens').select('id, autor, texto, anexo_nome, criado_em, apagada').eq('conversa_id', id).order('criado_em', { ascending: false }).limit(1).maybeSingle().then((r) => [id, r.data])));
  const ult = new Map(ultimas);
  return (convs ?? []).map((c) => {
    const outros = (parts ?? []).filter((p) => p.conversa_id === c.id && p.user_id !== eu.id);
    const outro = c.tipo === 'individual' ? outros[0] : null;
    const u = ult.get(c.id);
    return {
      id: c.id, tipo: c.tipo,
      nome: c.tipo === 'grupo' ? (c.nome || 'Equipe') : (nomes.get(outro?.user_id) ?? 'Ex-integrante'),
      com: outro?.user_id ?? null, ativo: c.tipo === 'grupo' || nomes.has(outro?.user_id),
      participantes: c.tipo === 'grupo' ? outros.length + 1 : 2,
      ultima: u ? { texto: u.apagada ? 'Mensagem apagada' : (u.texto || (u.anexo_nome ? `📎 ${u.anexo_nome}` : '')), autor: u.autor === eu.id ? 'Você' : (nomes.get(u.autor)?.split(' ')[0] ?? ''), em: u.criado_em } : null,
      nao_lidas: naoLidas.get(c.id) ?? 0, ultima_em: c.ultima_em,
    };
  }).sort((a, b) => (a.tipo === 'grupo' ? -1 : b.tipo === 'grupo' ? 1 : 0) || Date.parse(b.ultima?.em ?? b.ultima_em) - Date.parse(a.ultima?.em ?? a.ultima_em));
}
async function abrirIndividual(eu: Eu, com: string) {
  if (!UUID.test(com) || com === eu.id) throw falha('Escolha alguém da equipe.');
  const outro = await membro(com); if (!outro) throw falha('Essa pessoa não está ativa na equipe.', 404);
  const chave = [eu.id, com].sort().join(':');
  let { data: c } = await db.from('chat_conversas').select('id').eq('chave', chave).maybeSingle();
  if (!c) {
    const r = await db.from('chat_conversas').upsert({ tipo: 'individual', chave }, { onConflict: 'chave' }).select('id').single();
    if (r.error) throw r.error; c = r.data;
    await db.from('chat_participantes').upsert([{ conversa_id: c.id, user_id: eu.id }, { conversa_id: c.id, user_id: com }], { onConflict: 'conversa_id,user_id', ignoreDuplicates: true });
  }
  return { id: c.id, nome: outro.nome };
}
const CAMPOS_MSG = 'id, autor, texto, anexo_nome, anexo_tipo, anexo_tamanho, criado_em, apagada';
async function mensagens(conversa: string, eu: Eu, antes?: string | null, depois?: string | null) {
  await exigirParticipante(conversa, eu);
  let q = db.from('chat_mensagens').select(CAMPOS_MSG).eq('conversa_id', conversa);
  if (depois) q = q.gt('criado_em', depois).order('criado_em', { ascending: true }).limit(200);
  else { if (antes) q = q.lt('criado_em', antes); q = q.order('criado_em', { ascending: false }).limit(50); }
  const { data, error } = await q; if (error) throw error;
  const lista = depois ? (data ?? []) : (data ?? []).reverse();
  const equipe = await equipeAtiva(), nomes = new Map(equipe.map((m) => [m.user_id, m.nome]));
  const { data: parts } = await db.from('chat_participantes').select('user_id, lido_em').eq('conversa_id', conversa).neq('user_id', eu.id);
  return {
    mensagens: lista.map((m) => ({ ...m, texto: m.apagada ? null : m.texto, anexo_nome: m.apagada ? null : m.anexo_nome, minha: m.autor === eu.id, autor_nome: nomes.get(m.autor) ?? 'Ex-integrante' })),
    mais: !depois && (data?.length ?? 0) === 50,
    // "visto": até quando os outros leram (para mostrar ✓✓ nas minhas mensagens)
    lido_pelos_outros: (parts ?? []).length ? (parts ?? []).map((p) => p.lido_em).sort()[0] : null,
  };
}
async function enviar(conversa: string, eu: Eu, texto: string, anexo?: { bytes: Uint8Array; nome: string; tipo: string }) {
  await exigirParticipante(conversa, eu);
  texto = String(texto ?? '').trim().slice(0, 4000);
  if (!texto && !anexo) throw falha('Escreva uma mensagem.');
  const reg: Record<string, unknown> = { conversa_id: conversa, autor: eu.id, texto: texto || null };
  if (anexo) {
    if (anexo.bytes.length > 25 * 1024 * 1024) throw falha('Arquivo grande demais (máximo 25 MB).');
    const nome = anexo.nome.replace(/[\\/]/g, '_').slice(0, 140) || 'arquivo';
    const caminho = `${conversa}/${crypto.randomUUID()}-${nome.replace(/[^\w.\-]+/g, '_')}`;
    const up = await db.storage.from('chat').upload(caminho, anexo.bytes, { contentType: anexo.tipo || 'application/octet-stream', upsert: false });
    if (up.error) throw falha('Não consegui guardar o arquivo. Tente de novo.');
    Object.assign(reg, { anexo_caminho: caminho, anexo_nome: nome, anexo_tipo: anexo.tipo || null, anexo_tamanho: anexo.bytes.length });
  }
  const { data: m, error } = await db.from('chat_mensagens').insert(reg).select(CAMPOS_MSG).single();
  if (error) throw error;
  await Promise.all([
    db.from('chat_conversas').update({ ultima_em: m.criado_em }).eq('id', conversa),
    db.from('chat_participantes').update({ lido_em: m.criado_em }).eq('conversa_id', conversa).eq('user_id', eu.id),
  ]);
  // Aviso no celular dos outros participantes (sem esperar; nunca atrapalha o envio)
  const p = (async () => {
    const [{ data: c }, { data: parts }] = await Promise.all([
      db.from('chat_conversas').select('tipo, nome').eq('id', conversa).single(),
      db.from('chat_participantes').select('user_id').eq('conversa_id', conversa).neq('user_id', eu.id),
    ]);
    const titulo = c?.tipo === 'grupo' ? `${eu.nome.split(' ')[0]} em ${c.nome || 'Equipe'}` : eu.nome;
    await avisarCelular((parts ?? []).map((x) => x.user_id), titulo, texto || `📎 ${reg.anexo_nome}`, `./#equipe/${conversa}`, `chat-${conversa}`);
  })().catch((e) => console.warn('[chat] aviso:', e.message));
  try { globalThis.EdgeRuntime?.waitUntil?.(p); } catch { /* sem waitUntil */ }
  return { mensagem: { ...m, minha: true, autor_nome: eu.nome } };
}

// ---------------------------------------------------------------- compartilhamento de agenda e tarefas
async function contasCompartilhadasComigo(eu: Eu) {
  const { data } = await db.from('acessos_compartilhados').select('dono, agenda, tarefas').eq('membro', eu.id);
  const lista = [];
  for (const a of data ?? []) { const d = await membro(a.dono); if (d && (a.agenda || a.tarefas)) lista.push({ dono: a.dono, nome: d.nome, agenda: a.agenda, tarefas: a.tarefas }); }
  return lista;
}
async function meusAcessos(eu: Eu) {
  const [{ data }, equipe] = await Promise.all([db.from('acessos_compartilhados').select('membro, agenda, tarefas, atualizado_em').eq('dono', eu.id), equipeAtiva()]);
  const nomes = new Map(equipe.map((m) => [m.user_id, m.nome]));
  return (data ?? []).filter((a) => nomes.has(a.membro)).map((a) => ({ ...a, nome: nomes.get(a.membro) }));
}

// ---------------------------------------------------------------- rotas
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  try {
    const eu = await quem(req);
    if (!eu) return json({ erro: 'Sessão expirada. Entre de novo.' }, 401);
    const url = new URL(req.url);
    const p = url.pathname.replace(/^.*\/chat/, '').split('/').filter(Boolean);
    const ehJson = (req.headers.get('content-type') ?? '').includes('json');
    const corpo = req.method === 'POST' && ehJson ? await req.json().catch(() => ({})) : {};

    if (req.method === 'GET' && p[0] === 'pessoas') {
      const equipe = await equipeAtiva();
      return json({ eu: { id: eu.id, nome: eu.nome, admin: eu.admin }, equipe: equipe.filter((m) => m.user_id !== eu.id).map((m) => ({ id: m.user_id, nome: m.nome, admin: m.papel === 'admin' })), compartilhadas: await contasCompartilhadasComigo(eu) });
    }
    if (req.method === 'GET' && p[0] === 'naolidas') {
      await grupoEquipe();
      const { data } = await db.rpc('chat_nao_lidas', { p_user: eu.id });
      return json({ total: (data ?? []).reduce((s, x) => s + Number(x.n), 0) });
    }
    if (p[0] === 'conversas' && !p[1]) {
      if (req.method === 'GET') return json({ conversas: await listarConversas(eu) });
      if (req.method === 'POST') return json(await abrirIndividual(eu, String(corpo.com ?? '')));
    }
    if (p[0] === 'conversas' && p[1] && p[2] === 'mensagens') {
      if (req.method === 'GET') return json(await mensagens(p[1], eu, url.searchParams.get('antes'), url.searchParams.get('depois')));
      if (req.method === 'POST') {
        if (ehJson) return json(await enviar(p[1], eu, corpo.texto));
        const bytes = new Uint8Array(await req.arrayBuffer());
        if (!bytes.length) throw falha('Arquivo vazio.');
        return json(await enviar(p[1], eu, url.searchParams.get('texto') ?? '', { bytes, nome: url.searchParams.get('nome') ?? 'arquivo', tipo: req.headers.get('content-type') ?? '' }));
      }
    }
    if (req.method === 'POST' && p[0] === 'conversas' && p[1] && p[2] === 'lido') {
      await exigirParticipante(p[1], eu);
      await db.from('chat_participantes').update({ lido_em: new Date().toISOString() }).eq('conversa_id', p[1]).eq('user_id', eu.id);
      return json({ ok: true });
    }
    if (req.method === 'POST' && p[0] === 'mensagens' && UUID.test(p[1] ?? '') && p[2] === 'apagar') {
      const { data: m } = await db.from('chat_mensagens').select('id, autor, anexo_caminho').eq('id', p[1]).maybeSingle();
      if (!m || m.autor !== eu.id) throw falha('Só quem enviou pode apagar a mensagem.', 403);
      if (m.anexo_caminho) await db.storage.from('chat').remove([m.anexo_caminho]);
      await db.from('chat_mensagens').update({ apagada: true, texto: null, anexo_caminho: null }).eq('id', m.id);
      return json({ ok: true });
    }
    if (req.method === 'GET' && p[0] === 'anexo' && UUID.test(p[1] ?? '')) {
      const { data: m } = await db.from('chat_mensagens').select('conversa_id, anexo_caminho, anexo_nome, apagada').eq('id', p[1]).maybeSingle();
      if (!m || m.apagada || !m.anexo_caminho) throw falha('Arquivo não encontrado.', 404);
      await exigirParticipante(m.conversa_id, eu);
      const { data, error } = await db.storage.from('chat').createSignedUrl(m.anexo_caminho, 600, { download: url.searchParams.get('baixar') ? m.anexo_nome : undefined });
      if (error) throw falha('Não consegui abrir o arquivo.');
      return json({ url: data.signedUrl, nome: m.anexo_nome });
    }
    if (p[0] === 'acessos') {
      if (req.method === 'GET' && !p[1]) return json({ acessos: await meusAcessos(eu) });
      if (req.method === 'POST' && !p[1]) {
        const alvo = String(corpo.membro ?? '');
        if (!UUID.test(alvo) || alvo === eu.id || !(await membro(alvo))) throw falha('Escolha alguém ativo da equipe.');
        const agenda = corpo.agenda !== false, tarefas = corpo.tarefas !== false;
        if (!agenda && !tarefas) { await db.from('acessos_compartilhados').delete().eq('dono', eu.id).eq('membro', alvo); return json({ acessos: await meusAcessos(eu) }); }
        const { error } = await db.from('acessos_compartilhados').upsert({ dono: eu.id, membro: alvo, agenda, tarefas, atualizado_em: new Date().toISOString() }, { onConflict: 'dono,membro' });
        if (error) throw error;
        return json({ acessos: await meusAcessos(eu) });
      }
      if (req.method === 'POST' && UUID.test(p[1] ?? '') && p[2] === 'remover') {
        await db.from('acessos_compartilhados').delete().eq('dono', eu.id).eq('membro', p[1]);
        return json({ acessos: await meusAcessos(eu) });
      }
    }
    return json({ erro: 'não encontrado' }, 404);
  } catch (e) {
    const st = (e as any).status ?? 400;
    if (st >= 500 || !(e as any).status) console.error('[chat]', e);
    return json({ erro: (e as Error).message || 'Falhou. Tente de novo.' }, st);
  }
});
