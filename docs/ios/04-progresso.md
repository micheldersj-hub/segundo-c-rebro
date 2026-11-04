# Dimy iOS — progresso (branch `ios-dev`, pasta `ios/`)

Verificação automática a cada envio: GitHub Actions "iOS — verificação" (TypeScript estrito, Jest, config do Expo, expo-doctor,
compilação do pacote JavaScript para iOS). Última: **verde** (29 testes, 20/20 checagens do Expo, pacote iOS gerado).
Base: Expo SDK 58, React Native 0.88, Expo Router (abas nativas). Dependências só pelo workflow "iOS — dependências".

| Item da matriz | Situação |
|---|---|
| Login (mesma conta do Supabase), sessão no Keychain em pedaços, saída limpa o cache | feito, testado (unidade) |
| Face ID ao abrir e ao voltar após 1 min | feito; validar no aparelho |
| Cliente da API (mesmas rotas do web), erros em português, 401 → sair | feito, testado (unidade) |
| Cache em disco + modo sem internet + indicador de sincronização | feito; validar no aparelho |
| 1 Hoje (agenda, lembretes, aguardando, avisos, dúvidas) | feito; validar com dados reais |
| 6 Tarefas (dia, criar, avançar etapa, menu, adiar, atrasadas) | feito (parcial: falta detalhe/subtarefas/projetos/lixeira/sugestões) |
| Abas Dimy, Olho, Mais | **em desenvolvimento** (marcadas no código; não vão para TestFlight assim) |
| Demais itens 2–26 | a fazer |
| Push nativo (backend: push_dispositivos + push-ios) | a fazer |

Pendências do dono: criar a conta Apple Developer (no nome dele) e uma conta Expo gratuita — necessárias para push no aparelho e TestFlight.
