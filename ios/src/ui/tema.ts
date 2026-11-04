// Cores do Dimy (as mesmas do app web), em versão clara e escura.
import { useColorScheme } from 'react-native';

const claro = {
  fundo: '#F4F5F7', superficie: '#FFFFFF', superficie2: '#EEF0F3', tinta: '#12161C', tintaSuave: '#6B7280', tintaFraca: '#9CA3AF',
  linha: '#E6E8EC', mar: '#0E9384', marForte: '#0B7468', marClaro: '#E1F5F2', azul: '#3B82F6', ambar: '#F59E0B', alerta: '#DC2626', verde: '#10B981',
};
const escuro: typeof claro = {
  fundo: '#0E1116', superficie: '#171B22', superficie2: '#1F242D', tinta: '#EEF1F5', tintaSuave: '#A0A8B5', tintaFraca: '#6B7480',
  linha: '#262C36', mar: '#2DD4BF', marForte: '#5EEAD4', marClaro: '#10302D', azul: '#60A5FA', ambar: '#FBBF24', alerta: '#F87171', verde: '#34D399',
};
export type Cores = typeof claro;
export function useCores(): Cores { return useColorScheme() === 'dark' ? escuro : claro; }
export const espaco = { p: 8, m: 12, g: 16, gg: 24 } as const;
export const raio = 18;
