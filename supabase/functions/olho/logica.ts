// Regras puras do Olho de Deus (sem rede nem banco), testadas em supabase/tests/olho.test.mjs.

export const NIVEIS = ['baixo', 'medio', 'alto', 'critico'] as const;
export type Nivel = typeof NIVEIS[number];
export const pesoNivel = (n: string) => Math.max(0, NIVEIS.indexOf(n as Nivel));
export const nivelValido = (n: unknown): Nivel => (NIVEIS.includes(n as Nivel) ? (n as Nivel) : 'baixo');
export const atinge = (n: string, minimo: string) => pesoNivel(n) >= pesoNivel(minimo);

export const ROTULOS_CLASSIFICACAO = [
  'Infraestrutura própria comprovada',
  'Infraestrutura terceirizada identificada',
  'Modelo White Label',
  'Dependência de parceiros',
  'Capacidade operacional não comprovada',
  'Informações comerciais divergentes',
  'Alegações sem comprovação pública suficiente',
] as const;

export const CAMPOS_PERFIL = [
  'identificacao', 'site_redes', 'produtos', 'diferenciais', 'publico_alvo', 'infraestrutura', 'parceiros',
  'taxas_condicoes', 'lancamentos', 'mudancas_estrategicas', 'campanhas', 'expansao', 'parcerias_anunciadas', 'regulatorio',
] as const;

const PARADAS = new Set(['para', 'com', 'que', 'dos', 'das', 'uma', 'por', 'nos', 'nas', 'sobre', 'como', 'mais', 'seu', 'sua', 'aos', 'pela', 'pelo', 'the', 'and', 'nova', 'novo', 'empresa']);

export function normalizar(t: unknown): string {
  return String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}
export const slug = (nome: string) => normalizar(nome).replace(/\s+/g, '-').slice(0, 80);
export const tokens = (t: unknown) => new Set(normalizar(t).split(' ').filter((w) => w.length >= 3 && !PARADAS.has(w)));

/** Similaridade de Jaccard entre dois textos (0 a 1). */
export function similaridade(a: unknown, b: unknown): number {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let i = 0;
  for (const x of A) if (B.has(x)) i++;
  return i / (A.size + B.size - i);
}
export const ehDuplicado = (titulo: string, existentes: string[], limiar = 0.6) => existentes.some((e) => similaridade(titulo, e) >= limiar);

/** URL limpa (sem rastreadores, âncora, barra final); só http(s). */
export function urlLimpa(u: unknown): string | null {
  try {
    const x = new URL(String(u ?? '').trim());
    if (!/^https?:$/.test(x.protocol)) return null;
    x.hash = '';
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$|ref_)/i.test(k)) x.searchParams.delete(k);
    return `${x.protocol}//${x.host.replace(/^www\./, '')}${x.pathname.replace(/\/+$/, '')}${x.search}`;
  } catch { return null; }
}
export const dominio = (u: unknown) => { const l = urlLimpa(u); return l ? new URL(l).host : null; };

/** Chave única de um movimento: mesma notícia (url) ou mesmo título para a mesma empresa não entram duas vezes. */
export function chaveMovimento(empresa: string | null, titulo: string, url: unknown): string {
  const u = urlLimpa(url);
  const t = normalizar(titulo).split(' ').slice(0, 8).join(' ');
  return (u ? `u:${u}|${t}` : `t:${slug(empresa ?? 'mercado')}|${t}`).slice(0, 400);
}

export function dataValida(d: unknown): string | null {
  const s = String(d ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T12:00:00Z`);
  if (isNaN(t) || t > Date.now() + 2 * 864e5 || t < Date.parse('2015-01-01')) return null;
  return s;
}

const valorTexto = (v: unknown) => (Array.isArray(v) ? v.map(normalizar).filter(Boolean).sort().join(' | ') : normalizar(v));
/** O que mudou no perfil entre duas coletas (ignora campos vazios na coleta nova). */
export function diffPerfil(antes: Record<string, unknown> = {}, depois: Record<string, unknown> = {}) {
  const mud: { campo: string; antes: unknown; depois: unknown }[] = [];
  for (const c of CAMPOS_PERFIL) {
    const d = depois[c];
    if (d == null || valorTexto(d) === '') continue;
    const a = antes[c];
    if (valorTexto(a) === valorTexto(d)) continue;
    if (a != null && valorTexto(a) !== '' && similaridade(valorTexto(a), valorTexto(d)) >= 0.85) continue; // só reescrita
    mud.push({ campo: c, antes: a ?? null, depois: d });
  }
  return mud;
}

/** Evidência só vale como "verificada" se a URL apareceu de fato na pesquisa (evita fonte inventada). */
export function conferirEvidencias(classes: unknown, fontesVistas: string[]) {
  const vistas = new Set(fontesVistas.map((f) => urlLimpa(f)).filter(Boolean) as string[]);
  const doms = new Set([...vistas].map((v) => new URL(v).host));
  const lista = Array.isArray(classes) ? classes : [];
  return lista.filter((c) => c && ROTULOS_CLASSIFICACAO.includes(c.rotulo)).map((c) => {
    const evid = (Array.isArray(c.evidencias) ? c.evidencias : []).slice(0, 6).map((e: Record<string, unknown>) => {
      const u = urlLimpa(e?.url);
      const verificada = !!u && (vistas.has(u) || doms.has(new URL(u).host));
      return { afirmacao: String(e?.afirmacao ?? '').slice(0, 400), url: u, fonte: String(e?.fonte ?? (u ? new URL(u).host : '')).slice(0, 120), verificada };
    }).filter((e: { afirmacao: string }) => e.afirmacao);
    const ok = evid.filter((e: { verificada: boolean }) => e.verificada).length;
    let conf = Math.min(1, Math.max(0, Number(c.confianca) || 0));
    if (!ok) conf = Math.min(conf, 0.3);                 // sem fonte conferida, confiança baixa
    else if (ok < evid.length) conf = Math.min(conf, 0.7);
    return { rotulo: c.rotulo, confianca: Math.round(conf * 100) / 100, evidencias: evid, conclusao: String(c.conclusao ?? '').slice(0, 600), a_investigar: String(c.a_investigar ?? '').slice(0, 400) };
  });
}

/** Deve virar alerta? Respeita nível mínimo, empresa silenciada e assuntos configurados (crítico sempre passa). */
export function deveAlertar(m: { relevancia: string; titulo: string; resumo?: string | null; segmentos?: string[] }, cfg: { nivel_minimo_alerta: string; temas_alerta: string[] }, empresaSilenciada = false) {
  if (empresaSilenciada && m.relevancia !== 'critico') return false;
  if (!atinge(m.relevancia, cfg.nivel_minimo_alerta)) return false;
  if (!cfg.temas_alerta?.length || m.relevancia === 'critico') return true;
  const alvo = normalizar(`${m.titulo} ${m.resumo ?? ''} ${(m.segmentos ?? []).join(' ')}`);
  return cfg.temas_alerta.some((t) => normalizar(t).split(' ').filter((w) => w.length >= 3).every((w) => alvo.includes(w)));
}

/** Texto legível de uma página HTML (para detectar mudança no site). */
export function textoDaPagina(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#\d+;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 20000);
}

export const hojeSP = (agora = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(agora));
export const horaSP = (agora = Date.now()) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).format(new Date(agora)));

/** O que colocar na fila agora (decisão pura; o banco garante uma execução aberta por alvo). */
export function planejar(p: {
  agora: number; feitasHoje: number; max: number; abertas: number;
  ultimaSetor: number | null; ultimaRegulatorio: number | null; ultimaDescoberta: number | null;
  empresasVencidas: { id: string }[]; totalEmpresas: number;
}) {
  const fila: { tipo: string; empresa_id?: string }[] = [];
  let livre = Math.max(0, p.max - p.feitasHoje - p.abertas);
  const h = horaSP(p.agora), dia = 20 * 3600e3;
  const add = (x: { tipo: string; empresa_id?: string }) => { if (livre > 0) { fila.push(x); livre--; } };
  if (!p.totalEmpresas || !p.ultimaDescoberta || p.agora - p.ultimaDescoberta > 7 * 864e5) add({ tipo: 'descoberta' });
  if (h >= 7 && h < 22 && (!p.ultimaRegulatorio || p.agora - p.ultimaRegulatorio > dia)) add({ tipo: 'regulatorio' });
  if (h >= 7 && h < 22 && (!p.ultimaSetor || p.agora - p.ultimaSetor > dia)) add({ tipo: 'setor' });
  for (const e of p.empresasVencidas.slice(0, 3)) add({ tipo: 'empresa', empresa_id: e.id });
  return fila;
}
