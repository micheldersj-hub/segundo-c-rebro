// Sessão do usuário: login do Supabase (o mesmo do app web), perfil do membro e saída segura.
import type { Session } from '@supabase/supabase-js';
import { createContext, use, useEffect, useMemo, useState, type ReactNode } from 'react';

import { api, configurarApi } from '@/lib/api';
import { limparCache } from '@/lib/consultas';
import { supabase } from '@/lib/supabase';

export type Eu = { usuario: { id: string; nome: string; email: string; papel: 'admin' | 'membro' }; dono: boolean };
type Ctx = { carregando: boolean; sessao: Session | null; eu: Eu | null; entrar: (email: string, senha: string) => Promise<void>; sair: () => Promise<void> };
const SessaoCtx = createContext<Ctx | null>(null);

export function ProvedorSessao({ children }: { children: ReactNode }) {
  const [sessao, setSessao] = useState<Session | null>(null);
  const [eu, setEu] = useState<Eu | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    configurarApi({
      obterToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
      aoExpirar: () => { void supabase.auth.signOut(); },
    });
    supabase.auth.getSession().then(({ data }) => { setSessao(data.session); setCarregando(false); });
    const { data } = supabase.auth.onAuthStateChange((_ev, s) => setSessao(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!sessao) { setEu(null); return; }
    api<Eu>('/equipe/eu').then(setEu).catch(() => setEu(null));
  }, [sessao?.user.id]);

  const valor = useMemo<Ctx>(() => ({
    carregando, sessao, eu,
    async entrar(email, senha) {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: senha });
      if (error) throw new Error(/invalid/i.test(error.message) ? 'E-mail ou senha incorretos.' : 'Não consegui entrar. Tente de novo.');
    },
    async sair() { await supabase.auth.signOut(); await limparCache(); },
  }), [carregando, sessao, eu]);

  return <SessaoCtx value={valor}>{children}</SessaoCtx>;
}

export function useSessao() {
  const c = use(SessaoCtx);
  if (!c) throw new Error('useSessao fora do ProvedorSessao');
  return c;
}
