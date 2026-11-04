import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import { armazenamentoSeguro } from './armazenamento-seguro';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storage: armazenamentoSeguro, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false, storageKey: 'dimy-sessao' },
});

// No celular a renovação automática do login só deve rodar com o app aberto.
AppState.addEventListener('change', (estado) => {
  if (estado === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
