// Guarda a sessão no Keychain do iOS (expo-secure-store). O Keychain limita o tamanho de cada item, então valores
// grandes são divididos em pedaços. Nada de sessão em armazenamento comum.
import * as SecureStore from 'expo-secure-store';

const PEDACO = 1800;
const chaveSegura = (k: string) => k.replace(/[^A-Za-z0-9._-]/g, '_');

export const armazenamentoSeguro = {
  async getItem(chave: string): Promise<string | null> {
    const k = chaveSegura(chave);
    const n = await SecureStore.getItemAsync(`${k}.n`);
    if (n === null) return SecureStore.getItemAsync(k);
    const partes: string[] = [];
    for (let i = 0; i < Number(n); i++) {
      const p = await SecureStore.getItemAsync(`${k}.${i}`);
      if (p === null) return null;
      partes.push(p);
    }
    return partes.join('');
  },
  async setItem(chave: string, valor: string): Promise<void> {
    const k = chaveSegura(chave);
    await this.removeItem(chave);
    const opcoes = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
    if (valor.length <= PEDACO) { await SecureStore.setItemAsync(k, valor, opcoes); return; }
    const n = Math.ceil(valor.length / PEDACO);
    for (let i = 0; i < n; i++) await SecureStore.setItemAsync(`${k}.${i}`, valor.slice(i * PEDACO, (i + 1) * PEDACO), opcoes);
    await SecureStore.setItemAsync(`${k}.n`, String(n), opcoes);
  },
  async removeItem(chave: string): Promise<void> {
    const k = chaveSegura(chave);
    const n = await SecureStore.getItemAsync(`${k}.n`);
    if (n !== null) {
      for (let i = 0; i < Number(n); i++) await SecureStore.deleteItemAsync(`${k}.${i}`);
      await SecureStore.deleteItemAsync(`${k}.n`);
    }
    await SecureStore.deleteItemAsync(k);
  },
};
