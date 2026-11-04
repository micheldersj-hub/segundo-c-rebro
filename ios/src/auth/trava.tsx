// Face ID: ao abrir o app e ao voltar depois de 1 minuto em segundo plano, pede a biometria antes de mostrar os dados.
import * as LocalAuthentication from 'expo-local-authentication';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, StyleSheet, View } from 'react-native';

import { Botao, Texto } from '@/ui/base';
import { useCores } from '@/ui/tema';

const LIMITE_MS = 60_000;

export function TravaBiometrica({ ativa, children }: { ativa: boolean; children: ReactNode }) {
  const c = useCores();
  const [travado, setTravado] = useState(ativa);
  const saiuEm = useRef<number | null>(null);

  async function destravar() {
    const temHardware = await LocalAuthentication.hasHardwareAsync();
    const cadastrado = temHardware && (await LocalAuthentication.isEnrolledAsync());
    if (!cadastrado) { setTravado(false); return; }   // aparelho sem Face ID/Touch ID: o código do iPhone já protege
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'Abrir o Dimy', fallbackLabel: 'Usar código' });
    if (r.success) setTravado(false);
  }

  useEffect(() => { if (ativa && travado) void destravar(); }, [ativa]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (e) => {
      if (e !== 'active') { saiuEm.current ??= Date.now(); return; }
      if (ativa && saiuEm.current && Date.now() - saiuEm.current > LIMITE_MS) { setTravado(true); void destravar(); }
      saiuEm.current = null;
    });
    return () => sub.remove();
  }, [ativa]);

  return (
    <View style={{ flex: 1 }}>
      {children}
      {ativa && travado ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: c.fundo, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 }]}>
          <Texto tipo="titulo">Dimy</Texto>
          <Texto tipo="dica">Protegido com Face ID</Texto>
          <Botao titulo="Desbloquear" aoTocar={() => void destravar()} />
        </View>
      ) : null}
    </View>
  );
}
