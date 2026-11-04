// Mensagens em português simples, sem JSON nem termos técnicos (mesma regra do app web).
export const SEM_CREDITO = /credit balance|purchase credits|insufficient.{0,20}(credit|quota)/i;

export class ErroApi extends Error {
  constructor(mensagem: string, readonly status: number) { super(mensagem); }
}

export function erroAmigavel(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  if (SEM_CREDITO.test(msg)) return 'O Dimy está sem crédito de IA. Veja em Mais › Configurações como resolver.';
  if (e instanceof ErroApi && e.status === 0) return 'Sem conexão. Vou tentar de novo quando a internet voltar.';
  if (/network request failed|failed to fetch|abort/i.test(msg)) return 'Sem conexão. Vou tentar de novo quando a internet voltar.';
  if (/^\s*[{[]/.test(msg) || /\b(4\d\d|5\d\d)\b.*[{]/.test(msg)) return 'Um serviço não respondeu. Tente de novo em instantes.';
  return msg || 'Algo deu errado. Tente de novo.';
}
