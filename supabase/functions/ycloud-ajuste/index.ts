/**
 * Ajuste leve do webhook da YCloud (sem dependências, para deploy rápido).
 * POST /ycloud-ajuste?acao=ver|sem-historico|com-historico   (x-cron-secret)
 */
const URL_BASE = Deno.env.get('SUPABASE_URL')!;
const SRK = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const HIST = 'whatsapp.smb.history';

async function segredos(): Promise<Record<string, string>> {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/get_app_secrets`, {
    method: 'POST', headers: { apikey: SRK, authorization: `Bearer ${SRK}`, 'content-type': 'application/json' }, body: '{}',
  });
  if (!r.ok) throw new Error(`segredos ${r.status}`);
  return await r.json();
}

function igual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let n = 0;
  for (let i = 0; i < a.length; i++) n |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return n === 0;
}

const out = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return out({ ok: true });
  try {
    const s = await segredos();
    if (!igual(req.headers.get('x-cron-secret') ?? '', s.sc_CRON_SECRET ?? '\u0000')) return out({ erro: 'forbidden' }, 403);
    const chave = s.sc_YCLOUD_API_KEY;
    const yc = (p: string, init: RequestInit = {}) =>
      fetch(`https://api.ycloud.com/v2${p}`, { ...init, headers: { 'X-API-Key': chave, 'Content-Type': 'application/json' } });
    const acao = new URL(req.url).searchParams.get('acao') ?? 'ver';
    const alvo = `${URL_BASE}/functions/v1/ycloud`;
    const lista = await yc('/webhookEndpoints?limit=100');
    if (!lista.ok) return out({ erro: `YCloud ${lista.status}`, corpo: (await lista.text()).slice(0, 300) }, 502);
    // deno-lint-ignore no-explicit-any
    const eps = (((await lista.json()) as any).items ?? []).filter((w: any) => w.url === alvo);
    const res = [];
    for (const w of eps) {
      const ev: string[] = w.enabledEvents ?? [];
      if (acao === 'ver') { res.push({ id: w.id, status: w.status, eventos: ev }); continue; }
      const novos = acao === 'sem-historico' ? ev.filter((e) => e !== HIST) : [...new Set([...ev, HIST])];
      const r = await yc(`/webhookEndpoints/${w.id}`, { method: 'PATCH', body: JSON.stringify({ enabledEvents: novos }) });
      const corpo = await r.json().catch(() => ({}));
      // deno-lint-ignore no-explicit-any
      res.push({ id: w.id, http: r.status, eventos: (corpo as any).enabledEvents ?? novos });
    }
    return out({ acao, webhooks: res });
  } catch (e) {
    return out({ erro: (e as Error).message }, 500);
  }
});
