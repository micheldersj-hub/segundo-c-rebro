import { hojeSP, rotuloDia, saudacao, somaDias } from '@/lib/datas';
import { ErroApi, erroAmigavel } from '@/lib/erros';

describe('erroAmigavel', () => {
  it('falta de crédito vira instrução simples', () => expect(erroAmigavel(new Error('Claude 400: Your credit balance is too low'))).toMatch(/sem crédito/));
  it('sem conexão', () => expect(erroAmigavel(new ErroApi('Sem conexão', 0))).toMatch(/Sem conexão/));
  it('nunca mostra JSON', () => expect(erroAmigavel(new Error('{"type":"error"}'))).not.toMatch(/[{}]/));
  it('mensagem do servidor passa', () => expect(erroAmigavel(new ErroApi('Escreva a tarefa.', 400))).toBe('Escreva a tarefa.'));
});

describe('datas no fuso de São Paulo', () => {
  it('hojeSP usa o fuso -03:00', () => expect(hojeSP(new Date('2026-11-04T02:30:00Z'))).toBe('2026-11-03'));
  it('somaDias atravessa o mês', () => expect(somaDias('2026-10-31', 1)).toBe('2026-11-01'));
  it('rótulos relativos', () => {
    expect(rotuloDia('2026-11-03', '2026-11-03')).toBe('Hoje');
    expect(rotuloDia('2026-11-04', '2026-11-03')).toBe('Amanhã');
    expect(rotuloDia('2026-11-02', '2026-11-03')).toBe('Ontem');
  });
  it('saudação pelo horário e primeiro nome', () => expect(saudacao('Michelder Silva', new Date('2026-11-03T12:00:00Z'))).toBe('Bom dia, Michelder'));
});
