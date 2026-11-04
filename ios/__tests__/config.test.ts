import { rotaPara } from '@/lib/config';

const F = 'https://mavjbevuhzalkqyxaajw.supabase.co/functions/v1';
describe('rotaPara (mesmas regras do app web)', () => {
  it.each([
    ['/hoje', `${F}/app/hoje`],
    ['/tarefas?dia=2026-11-03', `${F}/tarefas?dia=2026-11-03`],
    ['/tarefas/abc/adiar', `${F}/tarefas/abc/adiar`],
    ['/olho/painel', `${F}/olho/painel`],
    ['/consumo/painel', `${F}/consumo/painel`],
    ['/equipe/eu', `${F}/equipe/eu`],
    ['/gravacoes/1', `${F}/gravador/gravacoes/1`],
    ['/voz', `${F}/gravador/voz`],
    ['/dossies', `${F}/oraculo/dossies`],
    ['/rascunhos?wa=1', `${F}/agendador/rascunhos?wa=1`],
    ['/atendente/config', `${F}/atendente/atendente/config`],
    ['/documento', `${F}/documento/documento`],
  ])('%s → %s', (caminho, url) => expect(rotaPara(caminho).url).toBe(url));
});
