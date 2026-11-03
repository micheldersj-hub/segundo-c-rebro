// @ts-nocheck
// CONSUMO — painel de crédito de IA (Anthropic), temporizadores das rotinas e alertas.
//
// De onde vêm os números:
//   - ia_consumo: cada função que chama a API grava o "usage" devolvido pela Anthropic (tokens e buscas na web);
//     o custo é calculado no banco com a tabela ia_precos. É uma medição real das chamadas, não um chute.
//   - Saldo: a Anthropic não expõe o saldo pela API. O dono informa o saldo quando recarrega; daí em diante
//     saldo estimado = saldo informado − gasto medido.
//   - Conferência opcional: com uma chave de administrador (Admin API), o custo oficial por dia vem do cost_report.
//
// Rotas do app (JWT de membro administrador ou x-app-key):
//   GET  /painel
//   POST /config        { saldo_usd?, alerta_saldo_usd?, alerta_dias?, alerta_dia_usd?, economia_auto?, economia_auto_usd? }
//   POST /temporizador  { rotina, opcao }
//   POST /preset        { preset }
//   POST /chave-admin   { chave }   (vazio remove)
// Rota interna (x-cron-secret): POST /verificar — confere alertas, economia automática e o relatório oficial.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { avisosDevidos, diasRestantes, gastoDiaRotina, estimarOpcao, fatorPorOficial, fatorPorSaldo, FUNCOES_IA, PRESETS, presetAtual, ritmoCom, ritmoDiario, somarRelatorio } from './logica.ts';

const URL_BASE = Deno.env.get('SUPABASE_URL')!;
const db = createClient(URL_BASE, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-app-key, authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
const log = (...a: unknown[]) => console.log('[consumo]', ...a);
const falha = (msg: string, status = 400) => Object.assign(new Error(msg), { status });

// ---------------------------------------------------------------- segredos (Vault) — nunca vão para log nem resposta
let segCache: Record<string, string> | null = null, segEm = 0;
async function segs(forcar = false) {
  if (forcar || !segCache || Date.now() - segEm > 60_000) {
    const { data, error } = await db.rpc('get_app_secrets');
    if (error) throw new Error('não consegui ler a configuração do servidor');
    segCache = {}; for (const [k, v] of Object.entries(data ?? {})) segCache[k.replace(/^sc_/, '')] = String(v);
    segEm = Date.now();
  }
  return segCache;
}
async function seg(nome: string) { const v = Deno.env.get(nome) ?? (await segs())[nome]; if (!v) throw new Error(`configuração ausente: ${nome}`); return v; }
async function segOpc(nome: string) { return (await segs())[nome] || ''; }
const igual = (a: string, b: string) => { if (!a || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

// ---------------------------------------------------------------- acesso (só o administrador vê crédito e mexe nas rotinas)
const cacheJwt = new Map<string, { q: any; ate: number }>();
async function quem(req: Request) {
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
async function avisar(uid: string, titulo: string, corpo: string, urgente = false) {
  const { data: n } = await db.from('notifications').insert({ user_id: uid, kind: urgente ? 'urgente' : 'consumo', title: titulo, body: corpo, data: { url: './#config' } }).select('id').single();
  const { data: subs } = await db.from('push_subscriptions').select('endpoint, keys').eq('user_id', uid);
  if (!n || !subs?.length) return;
  const [pub, priv, suj] = await Promise.all([seg('VAPID_PUBLIC_KEY'), seg('VAPID_PRIVATE_KEY'), seg('VAPID_SUBJECT')]);
  const carga = JSON.stringify({ title: titulo, body: corpo.length > 180 ? corpo.slice(0, 177) + '…' : corpo, kind: 'consumo', id: n.id, url: './#config', urgente });
  await Promise.all(subs.map(async (s) => {
    try {
      const r = await fetch(s.endpoint, { method: 'POST', headers: { Authorization: await vapid(s.endpoint, pub, priv, suj), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high' }, body: await cifrarPush(carga, s.keys.p256dh, s.keys.auth) });
      if (r.status === 404 || r.status === 410) await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
    } catch (e) { console.warn('[consumo] push:', (e as Error).message); }
  }));
}

// ---------------------------------------------------------------- dados
const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
async function cfg() { return (await db.from('ia_config').select('*').eq('id', 1).single()).data; }
async function rpc(nome: string, args?: Record<string, unknown>) {
  const { data, error } = await db.rpc(nome, args);
  if (error) throw new Error(`${nome}: ${error.message}`);
  return data;
}

const NOMES: Record<string, string> = {
  radar: 'Radar da internet', olho: 'Olho de Deus', contatos: 'Resumo dos contatos', tarefas: 'Sugestão de tarefas', perfis: 'Perfis dos contatos',
  plano: 'Plano da manhã', resumo_dia: 'Resumo do fim do dia', resumos: 'Resumos da semana e do mês', memoria: 'Memória (aprender com as mensagens)',
  conversa: 'Conversa com o Dimy', atendente: 'Atendimento automático', agendador: 'Agendamento pelo WhatsApp', whatsapp: 'Leitura das mensagens do WhatsApp',
  oraculo: 'Oráculo (dossiês)', gravador: 'Gravações e reuniões', documento: 'Documentos', instagram: 'Instagram',
};

async function montarPainel() {
  const [c, d, ts, sinais, temChave, medidas] = await Promise.all([
    cfg(), rpc('ia_painel_dados'), rpc('ia_temporizadores_estado'),
    rpc('ia_sinais_sem_credito', { p_desde: new Date(Date.now() - 90 * 6e4).toISOString() }), segOpc('ANTHROPIC_ADMIN_KEY'), rpc('ia_funcoes_medidas'),
  ]);
  const agora = Date.now();
  const gastos: Record<string, number> = {};
  for (const r of d.por_rotina) gastos[r.rotina] = gastoDiaRotina(r, agora);
  // fator de calibração: gasto real ÷ gasto medido (1 = medição completa ou ainda sem referência)
  const fator = c.fator ? Number(c.fator) : 1;
  const ritmoMedido = ritmoDiario(Number(d.d7.usd), d.primeiro, agora);
  const ritmo = ritmoMedido === null ? null : ritmoMedido * fator;
  const saldo = c.saldo_usd !== null && c.saldo_em ? Number(c.saldo_usd) - Number(d.desde_saldo) * fator : null;
  const dias = diasRestantes(saldo, ritmo);
  const naoMedidas = FUNCOES_IA.filter((f) => !(medidas ?? []).includes(f));
  const temporizadores = ts.map((t) => ({
    ...t,
    gasto_dia: gastos[t.rotina] ?? 0,
    opcoes: t.opcoes.map((o) => ({ id: o.id, rotulo: o.rotulo, estimativa_dia: estimarOpcao(t, gastos[t.rotina] ?? 0, o.id) })),
  }));
  const presets = Object.entries(PRESETS).map(([id, p]) => {
    const r = ritmo === null ? null : ritmoCom(ritmo, ts, gastos, p.opcoes);
    return { id, nome: p.nome, descricao: p.descricao, ritmo_dia: r, dias: diasRestantes(saldo, r) };
  });
  const semCredito = (sinais.memoria + sinais.radar + sinais.olho) > 0 && (!sinais.ultimo_sucesso || Date.parse(sinais.ultimo_sucesso) < agora - 30 * 6e4);
  return {
    atualizado_em: new Date().toISOString(),
    coletando_desde: d.primeiro,
    saldo: { informado: c.saldo_usd, informado_em: c.saldo_em, gasto_desde: Number(d.desde_saldo) * fator, estimado: saldo },
    ritmo_dia: ritmo,
    ritmo_medido: ritmoMedido,
    cobertura: { fator: c.fator ? fator : null, origem: c.fator_origem, em: c.fator_em, medidas: medidas ?? [], nao_medidas: naoMedidas,
      outras_dia: ritmoMedido !== null && c.fator ? ritmoMedido * (fator - 1) : null, conferencias: (c.conferencias ?? []).slice(-5) },
    dias_restantes: dias === Infinity ? null : dias,
    acaba_em: dias !== null && isFinite(dias) ? new Date(agora + dias * 864e5).toISOString() : null,
    sem_credito: semCredito,
    periodos: { hoje: d.hoje, d7: d.d7, d30: d.d30, h24: d.h24 },
    por_dia: d.por_dia,
    por_rotina: d.por_rotina.map((r) => ({ ...r, nome: NOMES[r.rotina] ?? r.rotina, gasto_dia: gastos[r.rotina] })),
    por_modelo: d.por_modelo,
    temporizadores, preset: presetAtual(ts), presets,
    alertas: { saldo_usd: Number(c.alerta_saldo_usd), dias: c.alerta_dias, dia_usd: c.alerta_dia_usd === null ? null : Number(c.alerta_dia_usd),
      economia_auto: c.economia_auto, economia_auto_usd: Number(c.economia_auto_usd) },
    oficial: { ativo: !!temChave, total_30d: d.oficial_30d, atualizado_em: c.oficial_em, erro: c.oficial_erro },
    precos: d.precos,
  };
}

// ---------------------------------------------------------------- relatório oficial (Admin API, opcional)
async function relatorioOficial(chave: string, dias = 31) {
  const inicio = new Date(Date.now() - dias * 864e5); inicio.setUTCHours(0, 0, 0, 0);
  const paginas: any[] = [];
  let pagina = '';
  for (let i = 0; i < 6; i++) {
    const u = new URL('https://api.anthropic.com/v1/organizations/cost_report');
    u.searchParams.set('starting_at', inicio.toISOString());
    u.searchParams.set('bucket_width', '1d');
    u.searchParams.set('limit', '31');
    if (pagina) u.searchParams.set('page', pagina);
    const r = await fetch(u, { headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01' } });
    if (r.status === 401 || r.status === 403) throw falha('A Anthropic não aceitou essa chave. Use uma chave de administrador (começa com sk-ant-admin).');
    if (!r.ok) throw falha(`A Anthropic respondeu ${r.status} ao relatório de custo. Tente de novo mais tarde.`, 502);
    const j = await r.json();
    paginas.push(j);
    if (!j.has_more || !j.next_page) break;
    pagina = j.next_page;
  }
  return somarRelatorio(paginas);
}
async function sincronizarOficial(forcar = false) {
  const chave = await segOpc('ANTHROPIC_ADMIN_KEY');
  if (!chave) return 'sem chave';
  const c = await cfg();
  if (!forcar && c.oficial_em && Date.now() - Date.parse(c.oficial_em) < 55 * 6e4) return 'recente';
  try {
    const dias = await relatorioOficial(chave);
    const linhas = Object.entries(dias).map(([dia, custo]) => ({ dia, custo_usd: Math.round(custo * 1e4) / 1e4, atualizado_em: new Date().toISOString() }));
    if (linhas.length) await db.from('ia_oficial').upsert(linhas, { onConflict: 'dia' });
    const up: Record<string, unknown> = { oficial_em: new Date().toISOString(), oficial_erro: null };
    // Calibração pelo relatório oficial: dias completos (UTC) desde o primeiro dia inteiro de medição, até 7 dias.
    const { data: prim } = await db.from('ia_consumo').select('created_at').order('created_at').limit(1).maybeSingle();
    if (prim) {
      const ini = new Date(prim.created_at); ini.setUTCHours(24, 0, 0, 0);
      const fim = new Date(); fim.setUTCHours(0, 0, 0, 0);
      const de = new Date(Math.max(ini.getTime(), fim.getTime() - 7 * 864e5));
      if (fim > de) {
        let oficial = 0;
        for (const [dia, v] of Object.entries(dias)) { const t = Date.parse(`${dia}T00:00:00Z`); if (t >= de.getTime() && t < fim.getTime()) oficial += v; }
        const medido = Number(await rpc('ia_medido_entre', { p_de: de.toISOString(), p_ate: fim.toISOString() }));
        const f = fatorPorOficial(oficial, medido);
        if (f !== null) Object.assign(up, { fator: f, fator_origem: 'oficial', fator_em: new Date().toISOString() });
      }
    }
    await db.from('ia_config').update(up).eq('id', 1);
    return `${linhas.length} dia(s)`;
  } catch (e) {
    await db.from('ia_config').update({ oficial_erro: (e as Error).message.slice(0, 200) }).eq('id', 1);
    throw e;
  }
}

// ---------------------------------------------------------------- rotina de verificação (cron a cada 30 min)
async function aplicarPreset(id: string) {
  const p = PRESETS[id]; if (!p) throw falha('Modo desconhecido.');
  for (const [rotina, opcao] of Object.entries(p.opcoes)) await rpc('ia_aplicar_temporizador', { p_rotina: rotina, p_opcao: opcao });
}
async function verificar() {
  const res: Record<string, unknown> = {};
  try { res.oficial = await sincronizarOficial(); } catch (e) { res.oficial = `erro: ${(e as Error).message}`; }
  const p = await montarPainel();
  const c = await cfg();
  const uid = await adminId();
  const hoje = hojeSP();
  const avisos = { ...(c.avisos || {}) };
  // Economia automática: saldo abaixo do limite → modo Econômico (uma vez por recarga).
  if (c.economia_auto && p.saldo.estimado !== null && c.saldo_em && p.saldo.estimado <= Number(c.economia_auto_usd)
      && !avisos[`economia:${c.saldo_em}`] && !['economico', 'minimo'].includes(p.preset)) {
    await aplicarPreset('economico');
    avisos[`economia:${c.saldo_em}`] = new Date().toISOString();
    if (uid) await avisar(uid, 'Modo Econômico ligado',
      `O saldo estimado chegou a US$ ${p.saldo.estimado.toFixed(2).replace('.', ',')}. Espacei o Radar, o Olho de Deus e as rotinas para o crédito durar mais. Para voltar, toque em Configuração.`);
    res.economia = 'ligada';
  }
  const devidos = avisosDevidos({ cfg: { ...c, avisos }, saldo: p.saldo.estimado, dias: p.dias_restantes ?? (p.saldo.estimado !== null && p.ritmo_dia === 0 ? Infinity : null),
    hojeUsd: Number(p.periodos.hoje.usd), hoje, semCredito: p.sem_credito });
  for (const a of devidos) {
    if (uid) await avisar(uid, a.titulo, a.corpo, !!a.urgente);
    avisos[a.chave] = new Date().toISOString();
  }
  // guarda só os avisos dos últimos 60 dias
  for (const [k, v] of Object.entries(avisos)) if (Date.now() - Date.parse(String(v)) > 60 * 864e5) delete avisos[k];
  await db.from('ia_config').update({ avisos }).eq('id', 1);
  res.avisos = devidos.map((a) => a.chave);
  res.saldo = p.saldo.estimado; res.ritmo = p.ritmo_dia;
  return res;
}

// ---------------------------------------------------------------- rotas
const num = (v: unknown, min: number, max: number) => {
  if (v === null || v === '' || v === undefined) return null;
  const n = Number(String(v).replace(',', '.'));
  if (!isFinite(n) || n < min || n > max) throw falha('Valor fora do intervalo permitido.');
  return Math.round(n * 100) / 100;
};

async function rotas(req: Request, rota: string, q: any) {
  if (!q.admin) throw falha('Só o administrador vê o consumo e mexe nas rotinas.', 403);
  const corpo = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  if (req.method === 'GET' && rota === '/painel') return json(await montarPainel());
  if (req.method !== 'POST') return json({ erro: 'não encontrado' }, 404);

  if (rota === '/config') {
    const up: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if ('saldo_usd' in corpo) {                         // "recarreguei": o saldo passa a ser este, a partir de agora
      const s = num(corpo.saldo_usd, 0, 100000);
      up.saldo_usd = s; up.saldo_em = s === null ? null : new Date().toISOString();
    }
    if ('conferir_saldo_usd' in corpo) {                // "conferi no console": calibra a medição e recomeça a conta daqui
      const s = num(corpo.conferir_saldo_usd, 0, 100000);
      if (s === null) throw falha('Informe o saldo que aparece no console.');
      const c = await cfg();
      const medido = c.saldo_em ? Number(await rpc('ia_medido_entre', { p_de: c.saldo_em, p_ate: new Date().toISOString() })) : 0;
      const f = c.saldo_em ? fatorPorSaldo(c.saldo_usd === null ? null : Number(c.saldo_usd), s, medido) : null;
      const agoraIso = new Date().toISOString();
      const reg = { em: agoraIso, antes: c.saldo_usd === null ? null : Number(c.saldo_usd), desde: c.saldo_em, agora: s, medido: Math.round(medido * 1e4) / 1e4, fator: f };
      Object.assign(up, { saldo_usd: s, saldo_em: agoraIso, conferencias: [...(c.conferencias ?? []), reg].slice(-20) });
      // só troca o fator quando a referência é melhor (o oficial vence o saldo)
      if (f !== null && c.fator_origem !== 'oficial') Object.assign(up, { fator: f, fator_origem: 'saldo', fator_em: agoraIso });
    }
    if ('alerta_saldo_usd' in corpo) up.alerta_saldo_usd = num(corpo.alerta_saldo_usd, 0, 10000) ?? 0;
    if ('alerta_dias' in corpo) up.alerta_dias = Math.round(num(corpo.alerta_dias, 0, 90) ?? 0);
    if ('alerta_dia_usd' in corpo) up.alerta_dia_usd = num(corpo.alerta_dia_usd, 0, 10000);
    if ('economia_auto' in corpo) up.economia_auto = !!corpo.economia_auto;
    if ('economia_auto_usd' in corpo) up.economia_auto_usd = num(corpo.economia_auto_usd, 0, 10000) ?? 0;
    const { error } = await db.from('ia_config').update(up).eq('id', 1);
    if (error) throw new Error(error.message);
    return json(await montarPainel());
  }
  if (rota === '/temporizador') {
    const rotina = String(corpo.rotina ?? ''), opcao = String(corpo.opcao ?? '');
    if (!/^[a-z_]{2,20}$/.test(rotina) || !/^[a-z0-9_]{1,20}$/.test(opcao)) throw falha('Escolha inválida.');
    await rpc('ia_aplicar_temporizador', { p_rotina: rotina, p_opcao: opcao }).catch((e) => { throw falha(/opção inválida/.test(e.message) ? 'Escolha inválida.' : 'Não consegui mudar o agendamento.', /opção inválida/.test(e.message) ? 400 : 500); });
    log('temporizador', rotina, opcao);
    return json(await montarPainel());
  }
  if (rota === '/preset') {
    const id = String(corpo.preset ?? '');
    await aplicarPreset(id);
    log('preset', id);
    return json(await montarPainel());
  }
  if (rota === '/chave-admin') {
    const chave = String(corpo.chave ?? '').trim();
    if (!chave) {
      await rpc('set_app_secret', { secret_name: 'ANTHROPIC_ADMIN_KEY', secret_value: '' });
      await db.from('ia_config').update({ oficial_em: null, oficial_erro: null }).eq('id', 1);
      segCache = null;
      return json(await montarPainel());
    }
    if (!/^sk-ant-admin[\w-]{10,}$/.test(chave)) throw falha('Essa não parece uma chave de administrador (ela começa com sk-ant-admin).');
    await relatorioOficial(chave, 2);                 // valida antes de guardar
    await rpc('set_app_secret', { secret_name: 'ANTHROPIC_ADMIN_KEY', secret_value: chave });
    segCache = null;
    await sincronizarOficial(true).catch((e) => log('sincronizar', e.message));
    return json(await montarPainel());
  }
  if (rota === '/sincronizar') { await sincronizarOficial(true); return json(await montarPainel()); }
  return json({ erro: 'não encontrado' }, 404);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const rota = url.pathname.replace(/^.*\/consumo/, '') || '/';
  try {
    if (rota === '/verificar') {
      if (!igual(req.headers.get('x-cron-secret') ?? '', await seg('CRON_SECRET'))) return json({ erro: 'forbidden' }, 403);
      const r = await verificar();
      log('verificar', JSON.stringify(r));
      return json(r);
    }
    const q = await quem(req);
    if (!q) return json({ erro: 'Sessão expirada. Entre de novo.' }, 401);
    return await rotas(req, rota, q);
  } catch (e) {
    const st = (e as any).status ?? 500;
    if (st === 500) console.error('[consumo]', rota, e);
    return json({ erro: st === 500 ? 'Falha ao carregar o consumo. Tente de novo em instantes.' : (e as Error).message }, st);
  }
});
