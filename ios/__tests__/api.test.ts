import { api, configurarApi } from '@/lib/api';
import { ErroApi } from '@/lib/erros';

const respostas: { status: number; corpo: unknown }[] = [];
const chamadas: { url: string; init: RequestInit }[] = [];
globalThis.fetch = jest.fn(async (url: string, init: RequestInit) => {
  chamadas.push({ url, init });
  const r = respostas.shift() ?? { status: 200, corpo: {} };
  return { ok: r.status < 400, status: r.status, json: async () => r.corpo } as Response;
}) as unknown as typeof fetch;

describe('cliente da API', () => {
  const expirou = jest.fn();
  beforeEach(() => { chamadas.length = 0; respostas.length = 0; expirou.mockReset(); configurarApi({ obterToken: async () => 'jwt-teste', aoExpirar: expirou }); });

  it('GET com sessão no cabeçalho', async () => {
    respostas.push({ status: 200, corpo: { ok: 1 } });
    expect(await api('/hoje')).toEqual({ ok: 1 });
    expect(chamadas[0].url).toMatch(/functions\/v1\/app\/hoje$/);
    expect((chamadas[0].init.headers as Record<string, string>).authorization).toBe('Bearer jwt-teste');
    expect(chamadas[0].init.method).toBe('GET');
  });
  it('POST com corpo vira JSON', async () => {
    await api('/tarefas', { corpo: { titulo: 'Ligar' } });
    expect(chamadas[0].init.method).toBe('POST');
    expect(chamadas[0].init.body).toBe('{"titulo":"Ligar"}');
  });
  it('erro do servidor vira mensagem dele', async () => {
    respostas.push({ status: 400, corpo: { erro: 'Escreva a tarefa.' } });
    await expect(api('/tarefas', { corpo: {} })).rejects.toThrow('Escreva a tarefa.');
  });
  it('401 avisa que a sessão expirou', async () => {
    respostas.push({ status: 401, corpo: { erro: 'Sessão expirada.' } });
    await expect(api('/hoje')).rejects.toBeInstanceOf(ErroApi);
    expect(expirou).toHaveBeenCalled();
  });
  it('falha de rede vira ErroApi status 0', async () => {
    (globalThis.fetch as jest.Mock).mockImplementationOnce(async () => { throw new TypeError('Network request failed'); });
    await expect(api('/hoje')).rejects.toMatchObject({ status: 0 });
  });
});
