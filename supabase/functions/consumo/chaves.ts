// Saúde das chaves dos serviços — lógica pura (sem rede), testada em supabase/tests/chaves.test.mjs.
// A função "consumo" faz as chamadas de conferência e usa estas regras para decidir estado, avisos e recuperação.

export type Leitura = { ok: boolean | null; detalhe: string; expira_em?: string | null; saldo?: number | null };
export type Estado = { servico: string; ok: boolean; desde: string; verificado_em: string; detalhe: string | null; expira_em: string | null; saldo: number | null; falhas_seguidas: number };
export type Aviso = { chave: string; titulo: string; corpo: string; urgente?: boolean };

export const SERVICOS: Record<string, { nome: string; essencial: boolean; troca: boolean; onde: string }> = {
  anthropic: { nome: 'Claude (Anthropic)', essencial: true, troca: true, onde: 'console.anthropic.com → Settings → API Keys → Create Key, validade "Never"' },
  openai: { nome: 'OpenAI (memória e áudio)', essencial: true, troca: true, onde: 'platform.openai.com/api-keys → Create new secret key' },
  ycloud: { nome: 'WhatsApp comercial (YCloud)', essencial: true, troca: true, onde: 'YCloud → Developers → API Keys' },
  meta: { nome: 'WhatsApp (Meta)', essencial: false, troca: false, onde: '' },
  google: { nome: 'Gmail e Agenda (Google)', essencial: true, troca: false, onde: 'Reconecte o Google no app' },
  anthropic_admin: { nome: 'Chave de administrador (validade e custo oficial)', essencial: false, troca: false, onde: 'console.anthropic.com → Settings → Admin Keys, validade "Never"' },
};

// Respostas de conferência → estado. ok=null: resposta inconclusiva (fora do ar, tempo esgotado) — não muda o estado na hora.
export function lerAnthropic(status: number, corpo: string): Leitura {
  if (status === 200) return { ok: true, detalhe: 'Funcionando' };
  if (status === 401 || status === 403) return { ok: false, detalhe: 'A Anthropic recusou a chave (vencida, apagada ou desativada).' };
  return { ok: null, detalhe: `A Anthropic não respondeu direito (${status || 'sem resposta'}).` };
}
export function lerOpenAI(status: number, corpo: string): Leitura {
  if (status === 200) return { ok: true, detalhe: 'Funcionando' };
  const m = (() => { try { return JSON.parse(corpo)?.error ?? {}; } catch { return {}; } })();
  if (status === 401) return { ok: false, detalhe: /expired/i.test(m.message ?? '') ? 'A chave da OpenAI venceu.' : 'A OpenAI recusou a chave (apagada ou errada).' };
  if (status === 429 && /quota|billing/i.test(`${m.code} ${m.type} ${m.message}`)) return { ok: false, detalhe: 'A conta da OpenAI está sem crédito.' };
  if (status === 403) return { ok: false, detalhe: 'A chave da OpenAI não tem permissão para a memória (embeddings).' };
  return { ok: null, detalhe: `A OpenAI não respondeu direito (${status || 'sem resposta'}).` };
}
export function lerYCloud(status: number, corpo: string): Leitura {
  if (status === 200) {
    let saldo: number | null = null;
    try { const j = JSON.parse(corpo); saldo = Number.isFinite(+j.amount) ? +j.amount : null; } catch { /* sem saldo */ }
    return { ok: true, detalhe: 'Funcionando', saldo };
  }
  if (status === 401 || status === 403) return { ok: false, detalhe: 'A YCloud recusou a chave (apagada ou trocada).' };
  return { ok: null, detalhe: `A YCloud não respondeu direito (${status || 'sem resposta'}).` };
}
// Meta debug_token: expires_at 0 = nunca vence (token de usuário do sistema).
export function lerMeta(status: number, corpo: string): Leitura {
  if (status !== 200) return status === 400 || status === 401 ? { ok: false, detalhe: 'A Meta recusou o token do WhatsApp.' } : { ok: null, detalhe: `A Meta não respondeu direito (${status || 'sem resposta'}).` };
  let d: any = {};
  try { d = JSON.parse(corpo).data ?? {}; } catch { /* */ }
  if (!d.is_valid) return { ok: false, detalhe: 'O token do WhatsApp (Meta) não é mais válido.' };
  const exp = Number(d.expires_at) > 0 ? new Date(Number(d.expires_at) * 1000).toISOString() : null;
  return { ok: true, detalhe: exp ? 'Funcionando' : 'Funcionando (não vence)', expira_em: exp };
}
// Google: o acesso é renovado sozinho a cada hora; se a renovação parou há mais de 3 h, a conexão caiu.
export function lerGoogle(atualizado: string | null, agora = Date.now()): Leitura {
  if (!atualizado) return { ok: false, detalhe: 'O Google não está conectado.' };
  const h = (agora - Date.parse(atualizado)) / 36e5;
  return h <= 3 ? { ok: true, detalhe: 'Funcionando (renova sozinho)' } : { ok: false, detalhe: `O Google parou de renovar o acesso há ${Math.floor(h)} h. Reconecte o Google no app.` };
}
// Admin API da Anthropic: acha a chave em uso pela dica parcial ("sk-ant-api03-R2D...igAA") e lê a validade.
export function dicaBate(dica: string, chave: string) {
  const [ini, fim] = String(dica ?? '').split('...');
  return !!ini && !!fim && chave.startsWith(ini) && chave.endsWith(fim);
}
export function validadeDaChave(lista: any[], chave: string): { achou: boolean; expira_em: string | null } {
  const k = (lista ?? []).find((x) => x?.partial_key_hint && dicaBate(x.partial_key_hint, chave));
  return k ? { achou: true, expira_em: k.expires_at ?? null } : { achou: false, expira_em: null };
}

// Próximo estado: falha clara (401) muda na hora; resposta inconclusiva só derruba depois de 3 seguidas (30 min).
export function proximoEstado(antes: Estado | null, l: Leitura, servico: string, agora = new Date().toISOString()): Estado {
  const base = antes ?? { servico, ok: true, desde: agora, verificado_em: agora, detalhe: null, expira_em: null, saldo: null, falhas_seguidas: 0 };
  if (l.ok === null) {
    const n = base.falhas_seguidas + 1;
    const cai = n >= 3 && base.ok;
    return { ...base, ok: cai ? false : base.ok, desde: cai ? agora : base.desde, verificado_em: agora, falhas_seguidas: n, detalhe: cai ? l.detalhe : base.detalhe };
  }
  return {
    ...base, ok: l.ok, desde: l.ok === base.ok && antes ? base.desde : agora, verificado_em: agora, detalhe: l.detalhe, falhas_seguidas: 0,
    expira_em: l.expira_em !== undefined ? l.expira_em : base.expira_em, saldo: l.saldo !== undefined ? l.saldo : base.saldo,
  };
}

const dataBR = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
// Avisos devidos nesta verificação. "dados" guarda o que já foi avisado (não repete).
export function avisosDasChaves(antes: Estado | null, depois: Estado, dados: Record<string, string>, agora = Date.now(), usado = true): Aviso[] {
  const s = SERVICOS[depois.servico] ?? { nome: depois.servico, essencial: false, troca: false, onde: '' };
  if (!usado) return [];
  const out: Aviso[] = [];
  const caiu = antes?.ok !== false && depois.ok === false, voltou = antes?.ok === false && depois.ok === true;
  if (caiu) out.push({ chave: `caiu:${depois.servico}:${depois.desde}`, urgente: s.essencial, titulo: `${s.nome} parou`,
    corpo: `${depois.detalhe ?? 'A conexão caiu.'} ${s.troca ? 'Toque para trocar a chave em Configuração › Conexões.' : s.onde ? `${s.onde}.` : ''} Enquanto isso, nada se perde: as mensagens esperam e são processadas quando voltar.`.trim() });
  if (voltou) out.push({ chave: `voltou:${depois.servico}:${depois.desde}`, titulo: `${s.nome} voltou`, corpo: 'A conexão voltou a funcionar. O que ficou parado está sendo processado.' });
  if (depois.ok && depois.expira_em) {
    const dias = (Date.parse(depois.expira_em) - agora) / 864e5;
    for (const lim of [1, 3, 7]) {
      const k = `vence:${depois.servico}:${depois.expira_em}:${lim}`;
      if (dias > 0 && dias <= lim && !dados[k]) {
        out.push({ chave: k, urgente: lim === 1, titulo: `Chave ${s.nome} vence ${lim === 1 ? 'amanhã' : `em ${Math.ceil(dias)} dias`}`,
          corpo: `Ela vence em ${dataBR(depois.expira_em)}. Crie outra sem validade (${s.onde}) e troque em Configuração › Conexões, antes de vencer.` });
        break;   // um aviso por vez (o mais próximo)
      }
    }
  }
  if (depois.servico === 'ycloud' && depois.ok && depois.saldo !== null && depois.saldo !== undefined && depois.saldo <= 0.25) {
    const k = `saldo:ycloud:${new Date(agora).toISOString().slice(0, 10)}`;
    if (!dados[k]) out.push({ chave: k, titulo: 'Saldo da YCloud quase zerado', corpo: `O saldo está em US$ ${depois.saldo.toFixed(2).replace('.', ',')}. Mensagens que a Meta cobra (modelos) podem falhar. Recarregue no painel da YCloud.` });
  }
  return out.filter((a) => !dados[a.chave]);
}

// Formato da chave antes de testar (evita gravar texto errado no cofre).
export function formatoValido(servico: string, chave: string): string | null {
  if (/\s/.test(chave)) return 'A chave não pode ter espaços. Copie de novo.';
  if (servico === 'anthropic') return /^sk-ant-(?!admin)[a-z0-9]+-[\w-]{20,}$/.test(chave) ? null : chave.startsWith('sk-ant-admin') ? 'Essa é uma chave de administrador. Aqui vai a chave de API comum (sk-ant-api…).' : 'Essa não parece uma chave da Anthropic (começa com sk-ant-).';
  if (servico === 'openai') return /^sk-[\w-]{20,}$/.test(chave) ? null : 'Essa não parece uma chave da OpenAI (começa com sk-).';
  if (servico === 'ycloud') return /^[\w-]{16,}$/.test(chave) ? null : 'Essa não parece uma chave da YCloud.';
  return 'Esse serviço não aceita troca de chave por aqui.';
}
export const NOME_SEGREDO: Record<string, string> = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', ycloud: 'YCLOUD_API_KEY' };
