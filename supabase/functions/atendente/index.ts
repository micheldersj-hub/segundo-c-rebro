// Atendente IA do WhatsApp Business do Michelder (B2B PAY).
//
// Regras escolhidas pelo dono (02/11/2026):
// - Autonomia mista: envia sozinho só o que é seguro (saudação, dúvida sobre produto, coleta de dados, encaminhamento);
//   o resto vira rascunho para ele aprovar no app.
// - Fala com clientes e prospects; nunca família, amigos, equipe, fornecedores ou contatos silenciados.
// - No expediente, só entra se ele não responder em `espera_min`; fora do expediente responde em ~1 min.
// - Nunca cita valores, taxas ou condições comerciais.
//
// Rotas:
//   POST /varrer             (x-cron-secret)  processa mensagens novas      ?wait=1 espera o resultado
//   POST /simular            (x-cron-secret)  {wa_id, agora?} decide sem enviar nem gravar
//   GET  /contatos?q=        (administrador)  busca contatos por nome, empresa, assunto ou número
//   POST /transcrever         (administrador)  áudio curto → texto (busca por voz)
//   GET|POST /config         (administrador)  liga/desliga, espera, base de conhecimento, últimas decisões
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const db = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const H = 3_600_000;
const MIN = 60_000;

// ---------------------------------------------------------------- segredos e utilidades
let segCache: Record<string, string> | null = null;
let segEm = 0;
async function segredos(): Promise<Record<string, string>> {
  if (segCache && Date.now() - segEm < 60_000) return segCache;
  const { data, error } = await db.rpc('get_app_secrets');
  if (error) throw new Error(`segredos: ${error.message}`);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data ?? {})) out[k.replace(/^sc_/, '')] = String(v);
  segCache = out; segEm = Date.now();
  return out;
}
async function seg(nome: string, padrao?: string): Promise<string> {
  const v = Deno.env.get(nome) ?? (await segredos())[nome] ?? padrao;
  if (!v) throw new Error(`Configuração ausente: ${nome}`);
  return v;
}
function igual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-app-key, authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
function emSegundoPlano(p: Promise<unknown>, rotulo: string) {
  const seguro = p.catch((e) => console.error(`[${rotulo}]`, e instanceof Error ? e.stack ?? e.message : e));
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil?.(seguro);
}

// ---------------------------------------------------------------- Claude
// Remove metades soltas de emoji (surrogates) que deixam o JSON inválido para a API.
const jsonSeguro = (v: unknown) => JSON.stringify(v).replace(/(?<!\\)((?:\\\\)*)\\ud[89a-f][0-9a-f]{2}/gi, '$1');
// deno-lint-ignore no-explicit-any
async function claude(corpo: Record<string, unknown>): Promise<any> {
  const chave = await seg('ANTHROPIC_API_KEY');
  const body = jsonSeguro(corpo);
  for (let t = 0; ; t++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body,
    });
    if(r.ok){const __j=await r.json();__usoIA(__j);return __j}
    const det = await r.text();
    if ((r.status === 429 || r.status >= 500) && t < 2) { await new Promise((ok) => setTimeout(ok, 1500 * (t + 1))); continue; }
    throw new Error(`Claude ${r.status}: ${det.slice(0, 300)}`);
  }
}

// ---------------------------------------------------------------- avisos (notificação no app + push)
const enc = new TextEncoder();
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const junta = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
async function hkdf(sal: Uint8Array, ikm: Uint8Array, info: Uint8Array, n: number) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: sal, info }, k, n * 8));
}
async function cifrarPush(texto: string, p256dh: string, auth: string) {
  const pub = deB64u(p256dh), segAuth = deB64u(auth);
  const chaveCli = await crypto.subtle.importKey('raw', pub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const efemera = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const localPub = new Uint8Array(await crypto.subtle.exportKey('raw', efemera.publicKey));
  const compart = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: chaveCli }, efemera.privateKey, 256));
  const prk = await hkdf(segAuth, compart, junta(enc.encode('WebPush: info\0'), pub, localPub), 32);
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(sal, prk, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(sal, prk, enc.encode('Content-Encoding: nonce\0'), 12);
  const k = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, k, junta(enc.encode(texto), new Uint8Array([2]))));
  const cab = new Uint8Array(21); cab.set(sal, 0); new DataView(cab.buffer).setUint32(16, 4096); cab[20] = localPub.length;
  return junta(cab, localPub, cifrado);
}
async function vapid(endpoint: string, pubB64: string, privD: string, sujeito: string) {
  const pub = deB64u(pubB64);
  const k = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d: privD, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const h = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const c = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: sujeito })));
  const s = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k, enc.encode(`${h}.${c}`)));
  return `vapid t=${h}.${c}.${b64u(s)}, k=${pubB64}`;
}
async function avisar(tipo: string, titulo: string, corpo: string, dados: Record<string, unknown> = {}) {
  const { data: n, error } = await db.from('notifications').insert({ kind: tipo, title: titulo, body: corpo, data: dados }).select('id, user_id').single();
  if (error) { console.warn('aviso:', error.message); return; }
  const { data: subs } = await db.from('push_subscriptions').select('endpoint, keys').eq('user_id', n.user_id);
  if (!subs?.length) return;
  const [pub, priv, sujeito] = await Promise.all([seg('VAPID_PUBLIC_KEY'), seg('VAPID_PRIVATE_KEY'), seg('VAPID_SUBJECT')]);
  const carga = JSON.stringify({ title: titulo, body: corpo.length > 180 ? corpo.slice(0, 177) + '…' : corpo, kind: tipo, id: n.id, url: dados.url ?? './#avisos', urgente: !!dados.urgente });
  await Promise.all(subs.map(async (s) => {
    try {
      const r = await fetch(s.endpoint, {
        method: 'POST',
        headers: { Authorization: await vapid(s.endpoint, pub, priv, sujeito), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high' },
        body: await cifrarPush(carga, s.keys.p256dh, s.keys.auth),
      });
      if (r.status === 404 || r.status === 410) await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
    } catch (e) { console.warn('push:', (e as Error).message); }
  }));
}

// ---------------------------------------------------------------- WhatsApp (YCloud)
async function enviarWhatsApp(waId: string, texto: string): Promise<string> {
  const de = (await seg('WA_NUMERO')).replace(/\D/g, '');
  const r = await fetch('https://api.ycloud.com/v2/whatsapp/messages/sendDirectly', {
    method: 'POST',
    headers: { 'X-API-Key': await seg('YCLOUD_API_KEY'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `+${de}`, to: `+${waId.replace(/\D/g, '')}`, type: 'text', text: { body: texto, previewUrl: false } }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.status === 'failed') throw new Error(`WhatsApp ${r.status}: ${j.errorMessage ?? j.error?.message ?? JSON.stringify(j).slice(0, 200)}`);
  const id = j.wamid ?? j.id ?? `atendente-${Date.now()}`;
  await db.rpc('record_wa_message', { p_id: id, p_wa_id: waId, p_direction: 'out', p_type: 'text', p_body: texto, p_at: new Date().toISOString(), p_name: null, p_history: false });
  await db.from('wa_messages').update({ por_dimy: true }).eq('id', id);
  return id;
}

// ---------------------------------------------------------------- expediente (mesmo do agendador)
const FUSO = 3 * H; // Brasília, -03:00
const local = (d: Date) => new Date(d.getTime() - FUSO);
const iso = (d: Date) => d.toISOString().slice(0, 10);
function pascoa(a: number) {
  const g = a % 19, c = Math.floor(a / 100), h = (c - Math.floor(c / 4) - Math.floor((8 * c + 13) / 25) + 19 * g + 15) % 30;
  const i = h - Math.floor(h / 28) * (1 - Math.floor(29 / (h + 1)) * Math.floor((21 - g) / 11));
  const j = (a + Math.floor(a / 4) + i + 2 - c + Math.floor(c / 4)) % 7, l = i - j;
  const m = 3 + Math.floor((l + 40) / 44), d = l + 28 - 31 * Math.floor(m / 4);
  return new Date(Date.UTC(a, m - 1, d));
}
function feriado(dia: string) {
  const a = Number(dia.slice(0, 4)), p = pascoa(a), mais = (n: number) => iso(new Date(p.getTime() + n * 24 * H));
  return ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'].map((x) => `${a}-${x}`)
    .concat([mais(-48), mais(-47), mais(-2), mais(60)]).includes(dia);
}
type CfgAg = { ativo: boolean; dias_semana: number[]; hora_inicio: number; hora_fim: number; feriados_extras: string[] | null };
function noExpediente(ag: CfgAg, agora: number) {
  const l = local(new Date(agora)), dia = iso(l), hora = l.getUTCHours() + l.getUTCMinutes() / 60;
  if (!ag.dias_semana.includes(l.getUTCDay()) || feriado(dia) || (ag.feriados_extras ?? []).includes(dia)) return false;
  return hora >= ag.hora_inicio && hora < ag.hora_fim;
}

// ---------------------------------------------------------------- decisão da IA
const AUTO = new Set(['saudacao', 'duvida_produto', 'qualificacao', 'preco_proposta']);
const FORA = new Set(['familia', 'amigo', 'equipe', 'fornecedor', 'servico']);
const PRECO = /R\$\s*\d|\d+([.,]\d+)?\s*%|\d+([.,]\d+)?\s*(por cento|reais)|\btaxa(s)? de \d|mensalidade de \d|aluguel de \d/i;

const FERRAMENTA = {
  name: 'decidir_resposta',
  description: 'Decide e escreve a resposta do atendente.',
  input_schema: {
    type: 'object',
    properties: {
      acao: { type: 'string', enum: ['responder', 'encaminhar', 'nada'], description: 'responder: o atendente responde. encaminhar: só avisa que o Michelder vai retornar (assunto que não é do atendente). nada: não precisa resposta (ok, obrigado, figurinha, conversa encerrada, spam, assunto pessoal).' },
      categoria: { type: 'string', enum: ['saudacao', 'duvida_produto', 'qualificacao', 'preco_proposta', 'reuniao', 'suporte_cliente', 'financeiro', 'reclamacao', 'pessoal', 'spam', 'outro'] },
      resposta: { type: 'string', description: 'Texto da mensagem para o WhatsApp (vazio se acao = nada).' },
      certeza: { type: 'number', minimum: 0, maximum: 1, description: 'Quão seguro você está de que esta resposta é adequada e correta (0 a 1).' },
      motivo: { type: 'string', description: 'Em 1 frase, por que decidiu assim.' },
      resumo_para_michelder: { type: 'string', description: 'O que a pessoa quer, em 1 frase, para o aviso no celular dele.' },
      dados: {
        type: 'object',
        description: 'O que já se sabe sobre a pessoa/empresa pela conversa inteira (vazio se não souber).',
        properties: { nome: { type: 'string' }, empresa: { type: 'string' }, segmento: { type: 'string' }, cidade: { type: 'string' }, faturamento_cartao: { type: 'string' }, maquininha_atual: { type: 'string' } },
      },
    },
    required: ['acao', 'categoria', 'resposta', 'certeza', 'motivo', 'resumo_para_michelder'],
  },
};

type Msg = { id: string; direction: string; type: string; body: string | null; occurred_at: string; created_at: string; por_dimy: boolean; agenda_status: string | null; atendente_status: string | null; from_history: boolean };
const hhmm = (s: string) => { const l = local(new Date(s)); return `${String(l.getUTCDate()).padStart(2, '0')}/${String(l.getUTCMonth() + 1).padStart(2, '0')} ${String(l.getUTCHours()).padStart(2, '0')}:${String(l.getUTCMinutes()).padStart(2, '0')}`; };

async function decidirIA(p: {
  nome: string; perfil: Record<string, unknown> | null; historico: Msg[]; novas: Msg[]; conhecimento: string;
  primeiraVez: boolean; expediente: boolean; agora: number; agendadorAtivo: boolean;
}) {
  const quem = (m: Msg) => m.direction === 'in' ? p.nome : m.por_dimy ? 'Assistente (automático)' : 'Michelder';
  const linha = (m: Msg) => `[${hhmm(m.occurred_at)}] ${quem(m)}: ${m.body ?? `[${m.type}]`}`;
  const perfil = p.perfil ? Object.entries(p.perfil).filter(([k, v]) => v && ['nome', 'empresa', 'relacao', 'resumo', 'pendencias'].includes(k)).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('; ') : v}`).join(' · ') : '';
  const system = `Você é o assistente virtual de atendimento do WhatsApp Business do Michelder (B2B PAY, meios de pagamento, Belo Horizonte).
Você responde clientes e potenciais clientes quando o Michelder não está disponível. Agora: ${hhmm(new Date(p.agora).toISOString())} (horário de Brasília), ${p.expediente ? 'dentro do expediente (ele está ocupado)' : 'fora do expediente (seg–sex, 8h–19h)'}.

BASE DE CONHECIMENTO (só afirme o que está aqui ou na conversa):
${p.conhecimento.trim() || '(vazia)'}

REGRAS
- Português do Brasil, tom cordial e profissional, mensagens curtas (2 a 5 linhas), no máximo 1 emoji. Sem markdown pesado.
- ${p.primeiraVez ? 'É a PRIMEIRA mensagem sua nesta conversa: comece dizendo que é o assistente virtual do Michelder.' : 'Você já se apresentou nesta conversa; não repita a apresentação.'}
- NUNCA informe valores, taxas, percentuais, mensalidades, prazos de recebimento ou condições comerciais, nem estimativas. Se perguntarem, diga que o Michelder prepara a proposta sob medida e peça os dados do negócio.
- Nunca prometa economia garantida, nunca dê orientação jurídica ou contábil, nunca invente informação, nunca peça senha, documento ou dados de cartão.
- Objetivo comercial: entender o negócio (nome, empresa, segmento, cidade, faturamento mensal no cartão, maquininha atual), uma pergunta por vez, sem interrogatório; com os dados, diga que o Michelder vai preparar a análise.
- ${p.agendadorAtivo ? 'Pedidos de REUNIÃO são tratados por outro assistente de agenda: use categoria "reuniao" e acao "nada".' : 'Se pedirem reunião, diga que o Michelder retorna para combinar o horário (acao "encaminhar").'}
- Suporte de quem já é cliente (pagamento não caiu, maquininha com defeito, estorno, saque), assunto financeiro, reclamação ou qualquer coisa fora da base: acao "encaminhar", com uma resposta curta e acolhedora dizendo que você já avisou o Michelder e ele retorna ${p.expediente ? 'assim que possível' : 'no próximo horário de atendimento'}. Não tente resolver.
- Assunto pessoal ou conversa que é claramente entre o Michelder e alguém próximo: acao "nada", categoria "pessoal".
- Mensagens só de "ok", "obrigado", emoji ou figurinha, ou quando a conversa já foi concluída: acao "nada".
- Analise as MENSAGENS NOVAS; o histórico é contexto. Se o Michelder já respondeu o assunto, não repita.`;
  const user = `CONTATO: ${p.nome}${perfil ? `\nPERFIL: ${perfil}` : ''}

HISTÓRICO:
${p.historico.map(linha).join('\n') || '(sem histórico)'}

MENSAGENS NOVAS:
${p.novas.map(linha).join('\n')}`;
  const modelo = await seg('CLAUDE_CHAT_MODEL', 'claude-sonnet-5-5');
  // O modelo de chat não aceita tool_choice forçado: pede a ferramenta no texto e tenta de novo se não vier.
  // deno-lint-ignore no-explicit-any
  let bloco: any = null;
  for (let t = 0; t < 2 && !bloco; t++) {
    const r = await claude({
      model: modelo, max_tokens: 900, tools: [FERRAMENTA], tool_choice: { type: 'auto' },
      system: `${system}\n\nIMPORTANTE: responda exclusivamente chamando a ferramenta "${FERRAMENTA.name}".`,
      messages: [{ role: 'user', content: user }],
    });
    // deno-lint-ignore no-explicit-any
    bloco = r.content?.find((b: any) => b.type === 'tool_use') ?? null;
  }
  if (!bloco) throw new Error('IA não decidiu');
  return bloco.input as {
    acao: 'responder' | 'encaminhar' | 'nada'; categoria: string; resposta: string; certeza: number; motivo: string;
    resumo_para_michelder: string; dados?: Record<string, string>;
  };
}

// ---------------------------------------------------------------- atendimento de um contato
type Resultado = { resultado: string; motivo: string; texto?: string; analise?: unknown; esperar?: boolean };

async function atender(waId: string, pendentes: Msg[], opts: { simular?: boolean; agora?: number } = {}): Promise<Resultado> {
  const agora = opts.agora ?? Date.now();
  const [{ data: cfg }, { data: ag }, { data: contato }, { data: perfil }] = await Promise.all([
    db.from('atendente_config').select('*').eq('id', 1).single(),
    db.from('agendador_config').select('ativo, dias_semana, hora_inicio, hora_fim, feriados_extras').eq('id', 1).single(),
    db.from('contacts').select('name, muted, message_count').eq('wa_id', waId).maybeSingle(),
    db.from('contato_perfil').select('nome, empresa, relacao, resumo, pendencias').eq('wa_id', waId).maybeSingle(),
  ]);
  if (contato?.muted) return { resultado: 'ignorado', motivo: 'contato silenciado' };
  if (perfil?.relacao && FORA.has(perfil.relacao)) return { resultado: 'ignorado', motivo: `relação "${perfil.relacao}": fica com o Michelder` };

  const { data: hist } = await db.from('wa_messages')
    .select('id, direction, type, body, occurred_at, created_at, por_dimy, agenda_status, atendente_status, from_history')
    .eq('wa_id', waId).lte('occurred_at', new Date(agora + MIN).toISOString()).order('occurred_at', { ascending: false }).limit(40);
  const todas = ((hist ?? []) as Msg[]).reverse();
  const ids = new Set(pendentes.map((m) => m.id));
  const primeiraNova = Math.min(...pendentes.map((m) => Date.parse(m.occurred_at)));
  const ultimaChegada = Math.max(...pendentes.map((m) => Date.parse(m.created_at)));

  // O Michelder (ou o agendador) já respondeu depois dessas mensagens?
  const depois = todas.filter((m) => m.direction === 'out' && Date.parse(m.occurred_at) >= primeiraNova);
  if (depois.some((m) => !m.por_dimy)) return { resultado: 'dono respondeu', motivo: 'o Michelder respondeu' };
  if (depois.some((m) => m.por_dimy)) return { resultado: 'agendador', motivo: 'o assistente de agenda já respondeu' };

  if (!opts.simular) {
    // Áudio ainda sem transcrição: espera um pouco.
    if (pendentes.some((m) => m.body === '[áudio]') && agora - ultimaChegada < 3 * MIN) return { resultado: 'esperando', motivo: 'transcrição do áudio', esperar: true };
    // Coordenação com o agendador: espera ele olhar as mensagens (até 5 min).
    if (ag?.ativo) {
      if (pendentes.some((m) => m.agenda_status === 'feito' || m.agenda_status === 'rascunho')) return { resultado: 'agendador', motivo: 'pedido de reunião, tratado pelo agendador' };
      if (pendentes.some((m) => !m.agenda_status || m.agenda_status === 'processando') && agora - ultimaChegada < 5 * MIN) return { resultado: 'esperando', motivo: 'agendador analisando', esperar: true };
    }
  }
  const expediente = ag ? noExpediente(ag as CfgAg, agora) : false;
  const espera = expediente ? cfg.espera_min * MIN : cfg.espera_fora_s * 1000;
  if (!opts.simular && agora - ultimaChegada < espera) return { resultado: 'esperando', motivo: expediente ? 'dando tempo para o Michelder responder' : 'juntando mensagens', esperar: true };

  const nome = contato?.name ?? perfil?.nome ?? `+${waId}`;
  const ultimoBot = todas.filter((m) => m.direction === 'out' && m.por_dimy).map((m) => Date.parse(m.occurred_at)).pop() ?? 0;
  const ultimoDono = todas.filter((m) => m.direction === 'out' && !m.por_dimy).map((m) => Date.parse(m.occurred_at)).pop() ?? 0;
  const { count: autos6h } = await db.from('atendente_decisoes').select('id', { count: 'exact', head: true })
    .eq('wa_id', waId).eq('resultado', 'enviado').gte('created_at', new Date(agora - 6 * H).toISOString());

  const d = await decidirIA({
    nome, perfil, historico: todas.filter((m) => !ids.has(m.id)).slice(-24), novas: pendentes, conhecimento: cfg.conhecimento,
    primeiraVez: agora - ultimoBot > 7 * 24 * H, expediente, agora, agendadorAtivo: !!ag?.ativo,
  });
  const base = { analise: d };
  let texto = (d.resposta ?? '').trim();
  if (d.acao === 'nada' || !texto) return { ...base, resultado: 'sem resposta', motivo: d.motivo };

  // Regras de segurança: o que pode sair sem aprovação.
  const travas: string[] = [];
  const categoriaOk = d.acao === 'encaminhar' || AUTO.has(d.categoria);
  if (!categoriaOk) travas.push(`assunto "${d.categoria}"`);
  if (Number(d.certeza) < (d.acao === 'encaminhar' ? 0.6 : 0.8)) travas.push(`certeza ${Math.round(Number(d.certeza) * 100)}%`);
  if (PRECO.test(texto)) travas.push('a resposta cita valor');
  if (texto.length > 900) travas.push('resposta longa');
  if ((autos6h ?? 0) >= cfg.max_auto_6h) travas.push(`já foram ${autos6h} respostas automáticas em 6 h`);
  if (agora - ultimoDono < 30 * MIN) travas.push('você falou com essa pessoa há pouco');
  if (!perfil && (contato?.message_count ?? 0) > 30) travas.push('contato antigo ainda sem perfil');
  if (agora - ultimoBot > 7 * 24 * H && !/assistente/i.test(texto)) texto = `Olá! Aqui é o assistente virtual do Michelder. ${texto}`;

  const aviso = `${nome}: ${d.resumo_para_michelder || d.motivo}`;
  if (opts.simular) return { ...base, resultado: travas.length ? 'rascunho' : 'enviaria', motivo: travas.length ? `precisa de aprovação: ${travas.join(', ')}` : d.motivo, texto };

  if (!travas.length) {
    await enviarWhatsApp(waId, texto);
    if (d.acao === 'encaminhar') {
      await avisar('urgente', `💬 ${nome} precisa de você`, `${d.resumo_para_michelder}\nO assistente já avisou que você retorna.`, { url: `./#contato/${waId}`, contact: waId, urgente: true });
    } else if (d.dados?.faturamento_cartao && (d.dados?.empresa || d.dados?.segmento)) {
      const { count } = await db.from('atendente_decisoes').select('id', { count: 'exact', head: true }).eq('wa_id', waId).eq('motivo', 'lead qualificado').gte('created_at', new Date(agora - 7 * 24 * H).toISOString());
      if (!count) {
        const dd = d.dados;
        await avisar('lembrete', `🔥 Lead qualificado: ${dd.empresa || nome}`, [dd.nome, dd.segmento, dd.cidade, dd.faturamento_cartao && `cartão: ${dd.faturamento_cartao}`, dd.maquininha_atual && `usa ${dd.maquininha_atual}`].filter(Boolean).join(' · '), { url: `./#contato/${waId}`, contact: waId });
        await db.from('atendente_decisoes').insert({ wa_id: waId, resultado: 'aviso', motivo: 'lead qualificado', analise: dd });
      }
    }
    return { ...base, resultado: 'enviado', motivo: d.motivo, texto };
  }

  // Rascunho para aprovação no app (o card de aprovação do contato).
  await db.from('agendador_rascunhos').update({ status: 'vencido', decidido_em: new Date().toISOString() }).eq('wa_id', waId).eq('status', 'pendente').eq('origem', 'atendente');
  await db.from('agendador_rascunhos').insert({ wa_id: waId, agendamento_id: null, texto, opcoes: [], motivo: `${aviso} (aprovação: ${travas.join(', ')})`, origem: 'atendente' });
  await avisar(d.acao === 'encaminhar' || ['reclamacao', 'suporte_cliente', 'financeiro'].includes(d.categoria) ? 'urgente' : 'lembrete',
    `💬 ${nome}: posso responder?`, `${d.resumo_para_michelder}\nPreparei a resposta; aprove no contato.`, { url: `./#contato/${waId}`, contact: waId });
  return { ...base, resultado: 'rascunho', motivo: travas.join(', '), texto };
}

// ---------------------------------------------------------------- varredura
async function varrer(): Promise<string> {
  const { data: cfg } = await db.from('atendente_config').select('ativo').eq('id', 1).single();
  if (!cfg?.ativo) return 'desligado';
  // Destrava o que ficou preso em "processando" (função caiu no meio).
  await db.from('wa_messages').update({ atendente_status: null }).eq('atendente_status', 'processando').lt('created_at', new Date(Date.now() - 15 * MIN).toISOString());
  const { data } = await db.from('wa_messages')
    .select('id, wa_id, direction, type, body, occurred_at, created_at, por_dimy, agenda_status, atendente_status, from_history')
    .eq('direction', 'in').is('atendente_status', null).eq('from_history', false)
    .gte('created_at', new Date(Date.now() - 24 * H).toISOString()).order('created_at').limit(200);
  const porContato = new Map<string, Msg[]>();
  for (const m of (data ?? []) as (Msg & { wa_id: string })[]) porContato.set(m.wa_id, [...(porContato.get(m.wa_id) ?? []), m]);
  const log: string[] = [];
  for (const [waId, msgs] of porContato) {
    const { data: trava } = await db.rpc('agendador_travar_v2', { p_wa: `atendente:${waId}`, p_segundos: 120 });
    if (trava !== true) { log.push(`+${waId}: ocupado`); continue; }
    try {
      const r = await atender(waId, msgs);
      if (r.esperar) { log.push(`+${waId}: ${r.motivo}`); continue; }
      await db.from('wa_messages').update({ atendente_status: r.resultado }).in('id', msgs.map((m) => m.id)).is('atendente_status', null);
      await db.from('atendente_decisoes').insert({ wa_id: waId, msg_ids: msgs.map((m) => m.id), analise: r.analise ?? null, resultado: r.resultado, motivo: r.motivo, texto: r.texto ?? null });
      log.push(`+${waId}: ${r.resultado}`);
    } catch (e) {
      console.error('[atendente]', waId, e);
      const n = msgs.filter((m) => Date.now() - Date.parse(m.created_at) > 20 * MIN).length;
      if (n === msgs.length) await db.from('wa_messages').update({ atendente_status: 'erro' }).in('id', msgs.map((m) => m.id));
      log.push(`+${waId}: erro ${(e as Error).message.slice(0, 120)}`);
    } finally {
      await db.rpc('agendador_soltar', { p_wa: `atendente:${waId}` });
    }
  }
  return log.join(' | ') || 'nada novo';
}

// ---------------------------------------------------------------- acesso do administrador
async function ehAdmin(req: Request): Promise<boolean> {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (token.split('.').length === 3) {
    const { data, error } = await db.auth.getUser(token);
    if (error || !data.user) return false;
    const { data: m } = await db.from('membros').select('papel, ativo').eq('user_id', data.user.id).maybeSingle();
    return !!m?.ativo && m.papel === 'admin';
  }
  const chave = req.headers.get('x-app-key') ?? '';
  return !!chave && igual(chave, await seg('APP_KEY'));
}

async function config(req: Request) {
  if (req.method === 'POST') {
    const b = await req.json().catch(() => ({}));
    const up: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof b.ativo === 'boolean') up.ativo = b.ativo;
    const faixa = (v: unknown, a: number, z: number) => Math.min(z, Math.max(a, Math.round(Number(v))));
    if (b.espera_min != null && Number.isFinite(Number(b.espera_min))) up.espera_min = faixa(b.espera_min, 1, 240);
    if (b.max_auto_6h != null && Number.isFinite(Number(b.max_auto_6h))) up.max_auto_6h = faixa(b.max_auto_6h, 1, 20);
    if (typeof b.conhecimento === 'string') up.conhecimento = b.conhecimento.slice(0, 12000);
    const { error } = await db.from('atendente_config').update(up).eq('id', 1);
    if (error) return json({ erro: error.message }, 400);
  }
  const [{ data: c }, { data: ult }] = await Promise.all([
    db.from('atendente_config').select('ativo, espera_min, espera_fora_s, max_auto_6h, conhecimento, updated_at').eq('id', 1).single(),
    db.from('atendente_decisoes').select('wa_id, resultado, motivo, texto, created_at').in('resultado', ['enviado', 'rascunho']).order('created_at', { ascending: false }).limit(12),
  ]);
  const nomes = new Map<string, string>();
  const waIds = [...new Set((ult ?? []).map((x) => x.wa_id))];
  if (waIds.length) {
    const { data: cs } = await db.from('contacts').select('wa_id, name').in('wa_id', waIds);
    for (const x of cs ?? []) if (x.name) nomes.set(x.wa_id, x.name);
  }
  return json({ config: c, ultimas: (ult ?? []).map((x) => ({ ...x, nome: nomes.get(x.wa_id) ?? null })) });
}

// ---------------------------------------------------------------- busca de contatos (app) e transcrição para busca por voz
const semAcento = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
async function buscarContatos(q: string) {
  const termo = semAcento(q).replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
  if (!termo) return [];
  const digitos = q.replace(/\D/g, '');
  const palavras = termo.split(/\s+/).filter((p) => p.length >= 2 && !/^\d+$/.test(p));
  const [{ data: cs }, { data: ps }] = await Promise.all([
    db.from('contacts').select('wa_id, name, muted, last_seen, awaiting_reply, last_summary').order('last_seen', { ascending: false }).limit(3000),
    db.from('contato_perfil').select('wa_id, nome, empresa, relacao, resumo').limit(3000),
  ]);
  const perfil = new Map((ps ?? []).map((p) => [p.wa_id, p]));
  const achados: { c: Record<string, unknown>; pontos: number }[] = [];
  for (const c of cs ?? []) {
    if (c.name === '[teste removido]') continue;
    const p = perfil.get(c.wa_id);
    const nome = semAcento(String(c.name ?? p?.nome ?? ''));
    const empresa = semAcento(String(p?.empresa ?? ''));
    const resto = semAcento(`${p?.resumo ?? ''} ${p?.relacao ?? ''} ${c.last_summary ?? ''}`);
    let pontos = 0;
    if (digitos.length >= 4 && String(c.wa_id).includes(digitos)) pontos += 50;
    if (palavras.length) {
      let todas = true;
      for (const w of palavras) {
        if (nome.split(/\s+/).some((n) => n.startsWith(w))) pontos += 20;
        else if (nome.includes(w)) pontos += 12;
        else if (empresa.includes(w)) pontos += 10;
        else if (resto.includes(w)) pontos += 3;
        else todas = false;
      }
      if (!todas && !(digitos.length >= 4 && pontos >= 50)) continue;
      if (nome === termo) pontos += 30;
    }
    if (pontos > 0) achados.push({ c: { ...c, empresa: p?.empresa ?? null, relacao: p?.relacao ?? null }, pontos });
  }
  return achados.sort((a, b) => b.pontos - a.pontos || Date.parse(String(b.c.last_seen)) - Date.parse(String(a.c.last_seen))).slice(0, 30).map((x) => x.c);
}
async function transcrever(audio: Blob, tipo: string) {
  const cab = new Uint8Array(await audio.slice(0, 16).arrayBuffer());
  const txt = String.fromCharCode(...cab);
  const ext = txt.slice(4, 8) === 'ftyp' ? 'm4a' : cab[0] === 0x1a && cab[1] === 0x45 ? 'webm' : txt.startsWith('RIFF') ? 'wav' : txt.startsWith('OggS') ? 'ogg' : /webm/.test(tipo) ? 'webm' : 'm4a';
  for (const modelo of ['whisper-1', 'gpt-4o-mini-transcribe']) {
    const f = new FormData();
    f.append('file', new File([audio], `busca.${ext}`, { type: ext === 'm4a' ? 'audio/mp4' : tipo || 'audio/webm' }));
    f.append('model', modelo);
    f.append('language', 'pt');
    f.append('prompt', 'Nome de um contato, empresa ou número de telefone.');
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${await seg('OPENAI_API_KEY')}` }, body: f });
    if (r.ok) return String((await r.json()).text ?? '').trim();
    console.warn('[busca-voz]', modelo, r.status, (await r.text()).slice(0, 200));
  }
  throw new Error('Não consegui entender o áudio. Toque e fale de novo.');
}

// ---------------------------------------------------------------- rotas
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const rota = url.pathname.replace(/^.*\/atendente/, '') || '/';
  try {
    if (rota === '/varrer' || rota === '/simular') {
      if (!igual(req.headers.get('x-cron-secret') ?? '', await seg('CRON_SECRET'))) return json({ erro: 'forbidden' }, 403);
      if (rota === '/varrer') {
        if (url.searchParams.get('wait') === '1') return json({ resultado: await varrer() });
        emSegundoPlano(varrer().then((r) => r !== 'nada novo' && console.log('[atendente]', r)), 'atendente');
        return json({ status: 'started' }, 202);
      }
      const b = await req.json().catch(() => ({}));
      const waId = String(b.wa_id ?? '').replace(/\D/g, '');
      const agora = b.agora ? Date.parse(String(b.agora)) : Date.now();
      // Simulação: as últimas mensagens recebidas (até `agora`) são tratadas como novas.
      const { data: ms } = await db.from('wa_messages').select('id, direction, type, body, occurred_at, created_at, por_dimy, agenda_status, atendente_status, from_history')
        .eq('wa_id', waId).lte('occurred_at', new Date(agora).toISOString()).order('occurred_at', { ascending: false }).limit(12);
      const lista = (ms ?? []) as Msg[];
      const novas: Msg[] = [];
      for (const m of lista) { if (m.direction !== 'in') break; novas.unshift(m); }
      if (!novas.length) return json({ resultado: 'nada', motivo: 'a última mensagem não é do contato' });
      return json(await atender(waId, novas, { simular: true, agora }));
    }
    if (rota === '/contatos' || rota === '/transcrever') {
      if (!(await ehAdmin(req))) return json({ erro: 'O WhatsApp está conectado só ao administrador.' }, 403);
      if (rota === '/contatos') return json({ contatos: await buscarContatos(String(url.searchParams.get('q') ?? '').slice(0, 80)) });
      const audio = await req.blob();
      if (audio.size < 800) return json({ erro: 'Muito curto. Toque e fale de novo.' }, 400);
      if (audio.size > 5e6) return json({ erro: 'Áudio longo demais para uma busca.' }, 400);
      try { return json({ texto: await transcrever(audio, req.headers.get('content-type') ?? '') }); }
      catch (e) { return json({ erro: (e as Error).message }, 422); }
    }
    if (rota === '/config') {
      if (!(await ehAdmin(req))) return json({ erro: 'Só o administrador configura o atendimento.' }, 403);
      return await config(req);
    }
    return json({ erro: 'não encontrado' }, 404);
  } catch (e) {
    console.error('atendente', rota, e);
    return json({ erro: (e as Error).message }, 500);
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
      body: JSON.stringify({ funcao: "atendente", tarefa: (__iaCtx && __iaCtx.getStore()) || null, modelo: String(j.model || ""), entrada: u.input_tokens || 0, saida: u.output_tokens || 0,
        cache_escrita: u.cache_creation_input_tokens || 0, cache_leitura: u.cache_read_input_tokens || 0, buscas: st.web_search_requests || 0 }) }).catch(() => {});
    try { globalThis.EdgeRuntime?.waitUntil?.(p); } catch { /* sem waitUntil */ }
  } catch { /* nunca atrapalha */ }
}
