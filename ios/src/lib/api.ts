// Cliente único das funções do Dimy. Mesmo contrato do app web: JSON, sessão do Supabase no cabeçalho.
import { rotaPara } from './config';
import { ErroApi } from './erros';

export type Metodo = 'GET' | 'POST';
type ObterToken = () => Promise<string | null>;
type AoExpirar = () => void;

let obterToken: ObterToken = async () => null;
let aoExpirar: AoExpirar = () => {};
export function configurarApi(o: { obterToken: ObterToken; aoExpirar: AoExpirar }) { obterToken = o.obterToken; aoExpirar = o.aoExpirar; }

export async function api<T = unknown>(caminho: string, opcoes: { metodo?: Metodo; corpo?: unknown; tempoMs?: number } = {}): Promise<T> {
  const { metodo = opcoes.corpo === undefined ? 'GET' : 'POST', corpo, tempoMs = 30000 } = opcoes;
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = await obterToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (corpo !== undefined) headers['content-type'] = 'application/json';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), tempoMs);
  let res: Response;
  try {
    res = await fetch(rotaPara(caminho).url, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo), signal: ctrl.signal });
  } catch {
    throw new ErroApi('Sem conexão', 0);
  } finally {
    clearTimeout(timer);
  }
  const dados = (await res.json().catch(() => ({}))) as { erro?: string; error?: string };
  if (res.status === 401) { aoExpirar(); throw new ErroApi(dados.erro || 'Sessão expirada. Entre de novo.', 401); }
  if (!res.ok) throw new ErroApi(dados.erro || dados.error || `Erro ${res.status}`, res.status);
  return dados as T;
}
