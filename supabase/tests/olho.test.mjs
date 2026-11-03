import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carregar } from './carregar.mjs';
const L = await carregar('olho/logica.ts');

test('normaliza acentos e pontuação', () => {
  assert.equal(L.normalizar('  Split  de Pagamentos — Ação!'), 'split de pagamentos acao');
  assert.equal(L.slug('PagBank (PagSeguro)'), 'pagbank-pagseguro');
});
test('similaridade e duplicidade de títulos', () => {
  assert.ok(L.similaridade('Stone lança split de recebíveis para clínicas', 'Stone lança split de recebíveis para clínicas médicas') > 0.7);
  assert.ok(L.similaridade('Cielo reduz taxas do débito', 'Banco Central publica resolução do Pix') < 0.1);
  assert.equal(L.ehDuplicado('InfinitePay anuncia conta PJ com rendimento', ['InfinitePay anuncia nova conta PJ com rendimento automático']), true);
  assert.equal(L.ehDuplicado('Getnet fecha parceria com ERP', ['InfinitePay anuncia conta PJ']), false);
});
test('URL limpa remove rastreadores e âncoras', () => {
  assert.equal(L.urlLimpa('https://www.exemplo.com.br/noticia/?utm_source=x&id=3#topo'), 'https://exemplo.com.br/noticia?id=3');
  assert.equal(L.urlLimpa('javascript:alert(1)'), null);
  assert.equal(L.urlLimpa('não é url'), null);
});
test('chave de movimento: mesma notícia gera mesma chave', () => {
  const a = L.chaveMovimento('Stone', 'Stone lança TapTon 2', 'https://stone.com.br/blog/tapton?utm_medium=a');
  const b = L.chaveMovimento('Stone', 'Stone lança TapTon 2', 'https://www.stone.com.br/blog/tapton/');
  assert.equal(a, b);
  assert.notEqual(a, L.chaveMovimento('Stone', 'Stone muda taxa do crédito', 'https://stone.com.br/blog/taxas'));
});
test('data válida rejeita futuro distante e formato errado', () => {
  assert.equal(L.dataValida('2026-10-20'), '2026-10-20');
  assert.equal(L.dataValida('20/10/2026'), null);
  assert.equal(L.dataValida('2099-01-01'), null);
});
test('diff de perfil detecta mudança real e ignora vazio/reescrita', () => {
  const antes = { produtos: ['Maquininha', 'Link de pagamento'], taxas_condicoes: 'Débito 1,99%' };
  const depois = { produtos: ['Maquininha', 'Link de pagamento', 'Conta PJ'], taxas_condicoes: 'Débito 1,99%', publico_alvo: '' };
  const d = L.diffPerfil(antes, depois);
  assert.equal(d.length, 1);
  assert.equal(d[0].campo, 'produtos');
});
test('evidência só é verificada se a URL veio da pesquisa', () => {
  const c = L.conferirEvidencias([
    { rotulo: 'Modelo White Label', confianca: 0.9, evidencias: [{ afirmacao: 'Usa plataforma de terceiro', url: 'https://inventado.com/x' }] },
    { rotulo: 'Dependência de parceiros', confianca: 0.8, evidencias: [{ afirmacao: 'Conta operada por banco parceiro', url: 'https://www.empresa.com.br/faq' }] },
    { rotulo: 'Fraudulenta', confianca: 1, evidencias: [] },
  ], ['https://empresa.com.br/sobre']);
  assert.equal(c.length, 2, 'rótulo fora da lista é descartado');
  assert.equal(c[0].evidencias[0].verificada, false);
  assert.ok(c[0].confianca <= 0.3, 'sem fonte conferida a confiança cai');
  assert.equal(c[1].evidencias[0].verificada, true, 'mesmo domínio conta como conferido');
});
test('alertas respeitam nível mínimo, silêncio e assuntos', () => {
  const cfg = { nivel_minimo_alerta: 'medio', temas_alerta: [] };
  assert.equal(L.deveAlertar({ relevancia: 'baixo', titulo: 'x' }, cfg), false);
  assert.equal(L.deveAlertar({ relevancia: 'alto', titulo: 'x' }, cfg), true);
  assert.equal(L.deveAlertar({ relevancia: 'alto', titulo: 'x' }, cfg, true), false);
  assert.equal(L.deveAlertar({ relevancia: 'critico', titulo: 'x' }, cfg, true), true);
  const cfg2 = { nivel_minimo_alerta: 'medio', temas_alerta: ['split'] };
  assert.equal(L.deveAlertar({ relevancia: 'alto', titulo: 'Nova conta PJ' }, cfg2), false);
  assert.equal(L.deveAlertar({ relevancia: 'alto', titulo: 'Novo Split de pagamentos' }, cfg2), true);
});
test('texto da página ignora scripts e estilos', () => {
  assert.equal(L.textoDaPagina('<html><style>a{}</style><script>x()</script><h1>Taxa 0%</h1>&nbsp;<p>Pix</p></html>'), 'Taxa 0% Pix');
});
test('planejamento respeita o limite diário e o horário', () => {
  const base = { feitasHoje: 0, max: 5, abertas: 0, ultimaSetor: null, ultimaRegulatorio: null, ultimaDescoberta: null, empresasVencidas: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], totalEmpresas: 4 };
  const meioDia = Date.parse('2026-11-03T15:00:00Z'); // 12h em SP
  const f = L.planejar({ ...base, agora: meioDia });
  assert.equal(f.length, 5);
  assert.deepEqual(f.slice(0, 3).map((x) => x.tipo), ['descoberta', 'regulatorio', 'setor']);
  const madrugada = Date.parse('2026-11-03T06:00:00Z'); // 3h em SP
  assert.ok(!L.planejar({ ...base, agora: madrugada }).some((x) => x.tipo === 'setor'));
  assert.equal(L.planejar({ ...base, agora: meioDia, feitasHoje: 5 }).length, 0, 'limite diário atingido');
});

test('mesmaEmpresa: une variações do mesmo nome sem juntar marcas diferentes', () => {
  assert.equal(L.mesmaEmpresa('PagBank', 'PagBank (PagSeguro)'), true);
  assert.equal(L.mesmaEmpresa('Stone', 'Stone (inclui Ton e Pagar.me)'), true);
  assert.equal(L.mesmaEmpresa('Getnet Santander', 'Getnet (Santander)'), true);
  assert.equal(L.mesmaEmpresa('Rede Payments', 'Rede (Itaú)'), false);   // "rede" é curto demais para unir
  assert.equal(L.mesmaEmpresa('Cielo', 'Cielo Pay'), true);
  assert.equal(L.mesmaEmpresa('Asaas', 'Dock'), false);
  assert.equal(L.mesmaEmpresa('', 'Dock'), false);
});
