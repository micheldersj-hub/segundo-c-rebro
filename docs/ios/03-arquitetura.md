# Dimy iOS — Fase 3: Arquitetura e decisão de tecnologia

## Decisão: React Native com Expo (TypeScript), build na nuvem pelo EAS
| Critério | Expo + RN (TS) | Swift nativo | Por que pesa |
|---|---|---|---|
| Integração com o backend atual | supabase-js oficial roda no RN; mesmas 60 rotas JSON | Supabase Swift SDK também existe | empate |
| Recursos nativos necessários (áudio em 2º plano, push APNs, Face ID, Keychain, câmera, localização, PDF, compartilhar, háptico) | todos têm módulo Expo oficial | todos nativos | empate |
| Compilar sem Mac | EAS Build compila iOS na nuvem | exige Mac com Xcode (não temos) | **decisivo** |
| Manutenção | mesma linguagem do resto do Dimy (TypeScript/JS: app.js, funções Deno) | linguagem nova, só para iOS | Expo |
| Custo e atualizações | atualizações de JS por EAS Update sem nova revisão da Apple | toda mudança passa pela App Store | Expo |
| Desempenho | listas, gestos e animações nativos (Reanimated, Skia); suficiente para um app de dados | máximo | Swift ganha, sem impacto prático aqui |

Conclusão: Swift só compensaria se houvesse processamento pesado no aparelho, o que não há (o cérebro é o servidor). Expo atende a todos os
recursos com menor custo e sem exigir Mac. **Não é uma WebView**: telas, listas, navegação e gestos são componentes nativos.

## Estrutura do app
- Repositório próprio `dimy-ios` (Expo Router, TypeScript estrito, ESLint, testes Jest + React Native Testing Library).
- Abas no padrão iOS: **Hoje · Tarefas · (Dimy, botão central de voz) · Olho · Mais** — Mais leva a WhatsApp, Gravar, Oráculo, Radar,
  Memória, Histórico, Avisos, Configurações, Integrações, Equipe e Conta.
- Camada `api/` com cliente único (mesmo contrato do PWA), tipos TypeScript por rota, tratamento de erro amigável (sem JSON na tela).
- Dados: TanStack Query (cache em memória e em disco, revalidação ao voltar ao app, reenvio automático), fila de envios offline.

## Segurança
- Login Supabase Auth (e-mail e senha). Sessão guardada no **Keychain** (expo-secure-store), nunca em texto simples.
- **Face ID** para abrir o app (opcional, ligado por padrão), bloqueio ao ir para segundo plano.
- Nenhuma chave de IA no app: tudo passa pelas funções (como hoje). Só a chave anônima pública do Supabase vai no app.
- HTTPS obrigatório (ATS do iOS); cache local criptografado; logs sem conteúdo de mensagens ou tokens.

## Acréscimos no backend (aditivos; nada existente é substituído)
1. **Push nativo**: tabela `push_dispositivos` (token Expo/APNs por usuário) + função `push-ios` disparada por gatilho em `notifications`
   (cada aviso que hoje vira Web Push também vai ao iPhone). Deduplicação: mesmo tipo+título em 10 min não repete; `collapseId` do iOS.
   Usa o serviço de push da Expo (gratuito) com chave APNs da sua conta Apple.
2. **Leitura de Memória e Histórico**: rota de consulta (fatos, episódios, perguntas; linha do tempo unificada) — hoje só acessível pelo chat.
3. **Sincronização incremental**: parâmetro `desde=` nas leituras novas; o app pede só o que mudou.

## Otimização financeira (Fase 6) — mirar onde os dados mostram gasto
- WhatsApp recebido: 2,7 chamadas de IA por mensagem. Plano: pular IA em mensagens triviais (regra fixa), juntar mensagens seguidas do
  mesmo contato numa única leitura de memória, reaproveitar a triagem. Meta: reduzir pela metade essa rotina, sem perder memória útil.
- Perfis dos contatos: atualizar só quando houver mensagens novas relevantes desde o último perfil.
- App iOS: telas de leitura vêm do banco (cache + incremental), sem IA. IA só no chat, voz, Oráculo, Olho e resumos.
- Tokens de **desenvolvimento** (Claude Code: `scripts/consumo_claude.py`) e de **operação** do Dimy (aba Configuração/`ia_consumo`)
  continuam medidos separadamente.

## Testes (Fase 7)
Jest (lógica e cliente da API), testes de componente, testes contra o backend real com usuário de teste isolado, e testes no aparelho
via TestFlight (iPhone SE, 13/14, 15/16 Pro Max). Relatório por funcionalidade da matriz; nada marcado sem teste executado.

## Compilação e distribuição (Fase 8) — exige sua autorização
- **Apple Developer Program**: US$ 99/ano, no seu nome ou da B2B PAY (empresa exige número D-U-N-S). Obrigatório para TestFlight e IPA.
- **Conta Expo** (gratuita). O plano gratuito do EAS tem builds limitadas por mês e fila mais lenta; planos pagos são opcionais.
- Identificador sugerido: `br.com.b2bpay.dimy`, nome "Dimy". Ícone e tela de abertura a partir da identidade atual.

## Limitações deste ambiente
- Esta sessão não alcança o npm agora (rede bloqueada pela lista de domínios): para criar e testar o projeto Expo aqui, é preciso liberar
  `registry.npmjs.org` em claude.ai › Settings › Capabilities. Alternativa: desenvolvimento e testes pelo GitHub Actions.
- Testes no iPhone real só depois da conta Apple (TestFlight).
