const mockCofre = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'x',
  getItemAsync: jest.fn(async (k: string) => mockCofre.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => { mockCofre.set(k, v); }),
  deleteItemAsync: jest.fn(async (k: string) => { mockCofre.delete(k); }),
}));
import { armazenamentoSeguro } from '@/lib/armazenamento-seguro';

describe('armazenamento no Keychain', () => {
  beforeEach(() => mockCofre.clear());
  it('valor curto em um item', async () => {
    await armazenamentoSeguro.setItem('sb-sessao', 'abc');
    expect(await armazenamentoSeguro.getItem('sb-sessao')).toBe('abc');
  });
  it('sessão grande dividida em pedaços e remontada', async () => {
    const grande = 'x'.repeat(5000) + 'fim';
    await armazenamentoSeguro.setItem('dimy-sessao', grande);
    expect([...mockCofre.keys()].filter((k) => k.startsWith('dimy-sessao.')).length).toBeGreaterThan(2);
    expect(await armazenamentoSeguro.getItem('dimy-sessao')).toBe(grande);
  });
  it('remover apaga todos os pedaços', async () => {
    await armazenamentoSeguro.setItem('dimy-sessao', 'y'.repeat(4000));
    await armazenamentoSeguro.removeItem('dimy-sessao');
    expect(mockCofre.size).toBe(0);
  });
  it('trocar valor grande por pequeno não deixa sobra', async () => {
    await armazenamentoSeguro.setItem('k', 'z'.repeat(4000));
    await armazenamentoSeguro.setItem('k', 'curto');
    expect(await armazenamentoSeguro.getItem('k')).toBe('curto');
    expect([...mockCofre.keys()]).toEqual(['k']);
  });
});
