// Endereços públicos do backend do Dimy. A chave anônima do Supabase é pública por design (só permite entrar);
// todos os dados passam pelas funções do servidor, que conferem a sessão. Nenhuma chave de IA fica no app.
export const SUPABASE_URL = 'https://mavjbevuhzalkqyxaajw.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1hdmpiZXZ1aHphbGtxeXhhYWp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA5ODg5OTQsImV4cCI6MjEwNjU2NDk5NH0.BGSKd3B2B0m2MuDUmdJHEVOPS6l551axEP7DVAxfidA';
export const FUNCOES = `${SUPABASE_URL}/functions/v1`;

/** Mesma regra do app web: o prefixo do caminho decide qual função atende. */
export function rotaPara(caminho: string): { url: string } {
  const p = caminho.startsWith('/') ? caminho : `/${caminho}`;
  const regras: [RegExp, string, boolean][] = [
    [/^\/equipe/, 'equipe', true],
    [/^\/(gravacoes|voz)/, 'gravador', false],
    [/^\/exportar/, 'extra', false],
    [/^\/documento/, 'documento', false],
    [/^\/rascunhos/, 'agendador', false],
    [/^\/atendente/, 'atendente', false],
    [/^\/tarefas/, 'tarefas', true],
    [/^\/olho/, 'olho', true],
    [/^\/consumo/, 'consumo', true],
    [/^\/(dossies|local|proximas)/, 'oraculo', false],
  ];
  for (const [re, funcao, tiraPrefixo] of regras) {
    if (re.test(p)) {
      const resto = tiraPrefixo ? p.replace(new RegExp(`^/${funcao}`), '') : p;
      return { url: `${FUNCOES}/${funcao}${resto}` };
    }
  }
  return { url: `${FUNCOES}/app${p}` };
}
