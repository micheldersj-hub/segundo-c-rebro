// EM DESENVOLVIMENTO (Fase 4): esta aba ainda não está pronta e não deve ir para o TestFlight assim.
import { Stack } from 'expo-router';

import { Tela, Texto } from '@/ui/base';

export default function Aba() {
  return (
    <>
      <Stack.Screen options={{ title: 'Dimy' }} />
      <Tela><Texto tipo="dica">Em desenvolvimento.</Texto></Tela>
    </>
  );
}
