// Cache das telas: mostra na hora o que já foi carregado (inclusive sem internet) e atualiza por trás.
// Telas de leitura vêm do banco: nenhuma chamada de IA é feita para mostrar dados.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';

export const clienteConsultas = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, gcTime: 24 * 3600_000, retry: 2, refetchOnReconnect: true },
    mutations: { retry: 1 },
  },
});
export const persistidor = createAsyncStoragePersister({ storage: AsyncStorage, key: 'dimy-cache' });
export async function limparCache() { clienteConsultas.clear(); await AsyncStorage.removeItem('dimy-cache'); }
