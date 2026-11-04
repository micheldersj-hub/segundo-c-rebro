import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { ProvedorSessao, useSessao } from '@/auth/sessao';
import { TravaBiometrica } from '@/auth/trava';
import { clienteConsultas, persistidor } from '@/lib/consultas';

SplashScreen.preventAutoHideAsync();

function Navegacao() {
  const { carregando, sessao } = useSessao();
  useEffect(() => { if (!carregando) SplashScreen.hideAsync(); }, [carregando]);
  if (carregando) return null;
  return (
    <TravaBiometrica ativa={!!sessao}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={!!sessao}>
          <Stack.Screen name="(abas)" />
        </Stack.Protected>
        <Stack.Protected guard={!sessao}>
          <Stack.Screen name="entrar" />
        </Stack.Protected>
      </Stack>
    </TravaBiometrica>
  );
}

export default function Raiz() {
  const esquema = useColorScheme();
  return (
    <PersistQueryClientProvider client={clienteConsultas} persistOptions={{ persister: persistidor, maxAge: 24 * 3600_000 }}>
      <ThemeProvider value={esquema === 'dark' ? DarkTheme : DefaultTheme}>
        <ProvedorSessao>
          <Navegacao />
        </ProvedorSessao>
      </ThemeProvider>
    </PersistQueryClientProvider>
  );
}
