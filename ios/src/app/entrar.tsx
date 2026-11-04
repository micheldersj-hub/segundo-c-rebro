import { useState } from 'react';
import { KeyboardAvoidingView, Platform, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSessao } from '@/auth/sessao';
import { Botao, Texto } from '@/ui/base';
import { espaco, useCores } from '@/ui/tema';

export default function Entrar() {
  const c = useCores();
  const { entrar } = useSessao();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const campo = { backgroundColor: c.superficie, color: c.tinta, borderRadius: 14, padding: 14, fontSize: 16 } as const;

  async function enviar() {
    setErro(''); setEnviando(true);
    try { await entrar(email, senha); } catch (e) { setErro((e as Error).message); } finally { setEnviando(false); }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.fundo }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'center', padding: espaco.gg, gap: espaco.m }}>
        <Texto tipo="titulo">Dimy</Texto>
        <Texto tipo="dica">Entre com o mesmo e-mail e senha do Segundo Cérebro.</Texto>
        <View style={{ gap: espaco.p, marginTop: espaco.g }}>
          <TextInput style={campo} placeholder="E-mail" placeholderTextColor={c.tintaFraca} autoCapitalize="none" autoCorrect={false}
            keyboardType="email-address" textContentType="username" autoComplete="email" value={email} onChangeText={setEmail} accessibilityLabel="E-mail" />
          <TextInput style={campo} placeholder="Senha" placeholderTextColor={c.tintaFraca} secureTextEntry textContentType="password"
            autoComplete="current-password" value={senha} onChangeText={setSenha} onSubmitEditing={enviar} accessibilityLabel="Senha" />
        </View>
        {erro ? <Texto style={{ color: c.alerta }} accessibilityRole="alert">{erro}</Texto> : null}
        <Botao titulo={enviando ? 'Entrando…' : 'Entrar'} aoTocar={enviar} desativado={enviando || !email || !senha} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
