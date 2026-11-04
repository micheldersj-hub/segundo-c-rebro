import { type ReactNode } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, type TextProps, type ViewStyle } from 'react-native';

import { erroAmigavel } from '@/lib/erros';
import { espaco, raio, useCores } from './tema';

export function Tela({ children, atualizando, aoAtualizar }: { children: ReactNode; atualizando?: boolean; aoAtualizar?: () => void }) {
  const c = useCores();
  return (
    <ScrollView
      style={{ backgroundColor: c.fundo }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: espaco.g, gap: espaco.m, paddingBottom: 40 }}
      refreshControl={aoAtualizar ? <RefreshControl refreshing={!!atualizando} onRefresh={aoAtualizar} tintColor={c.mar} /> : undefined}>
      {children}
    </ScrollView>
  );
}

export function Texto({ tipo = 'corpo', style, ...p }: TextProps & { tipo?: 'titulo' | 'secao' | 'corpo' | 'dica' | 'pequeno' }) {
  const c = useCores();
  const base = {
    titulo: { fontSize: 28, fontWeight: '800' as const, color: c.tinta },
    secao: { fontSize: 18, fontWeight: '700' as const, color: c.tinta, marginTop: espaco.m },
    corpo: { fontSize: 16, color: c.tinta },
    dica: { fontSize: 14, color: c.tintaSuave },
    pequeno: { fontSize: 12.5, color: c.tintaSuave },
  }[tipo];
  return <Text {...p} style={[base, style]} />;
}

export function Cartao({ children, style, aoTocar, acessibilidade }: { children: ReactNode; style?: ViewStyle; aoTocar?: () => void; acessibilidade?: string }) {
  const c = useCores();
  const estilo = [{ backgroundColor: c.superficie, borderRadius: raio, padding: espaco.g, gap: 6 }, style];
  if (!aoTocar) return <View style={estilo}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={acessibilidade} onPress={aoTocar}
      style={({ pressed }) => [...estilo, pressed && { opacity: 0.7 }]}>{children}</Pressable>
  );
}

export function Botao({ titulo, aoTocar, tipo = 'primario', desativado }: { titulo: string; aoTocar: () => void; tipo?: 'primario' | 'claro' | 'perigo'; desativado?: boolean }) {
  const c = useCores();
  const fundo = tipo === 'primario' ? c.mar : tipo === 'perigo' ? c.alerta : c.superficie2;
  const cor = tipo === 'claro' ? c.tinta : '#fff';
  return (
    <Pressable accessibilityRole="button" disabled={desativado} onPress={aoTocar}
      style={({ pressed }) => [s.botao, { backgroundColor: fundo, opacity: desativado ? 0.5 : pressed ? 0.8 : 1 }]}>
      <Text style={{ color: cor, fontWeight: '700', fontSize: 16 }}>{titulo}</Text>
    </Pressable>
  );
}

export function Carregando() {
  const c = useCores();
  return <View style={{ padding: 40 }}><ActivityIndicator color={c.mar} /></View>;
}

export function Falha({ erro, aoTentar }: { erro: unknown; aoTentar?: () => void }) {
  const c = useCores();
  return (
    <Cartao style={{ borderLeftWidth: 4, borderLeftColor: c.ambar }}>
      <Texto>{erroAmigavel(erro)}</Texto>
      {aoTentar ? <Botao titulo="Tentar de novo" tipo="claro" aoTocar={aoTentar} /> : null}
    </Cartao>
  );
}

export function Vazio({ texto }: { texto: string }) {
  return <Cartao><Texto tipo="dica">{texto}</Texto></Cartao>;
}

const s = StyleSheet.create({ botao: { borderRadius: 14, paddingVertical: 13, paddingHorizontal: 18, alignItems: 'center' } });
