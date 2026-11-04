# Dimy iOS — Fase 2: Matriz funcionalidade atual → app iOS

Legenda: **API** = rota existente reutilizada sem mudança. **Novo backend** = acréscimo aditivo necessário. Nada é removido do PWA.

| # | Funcionalidade atual (PWA) | API existente | Implementação no iOS | Recurso nativo | Status |
|---|---|---|---|---|---|
| 1 | Hoje (agenda, “Agora”, lembretes, aguardando resposta, perguntas) | GET /hoje, /agenda | Aba Hoje, lista nativa com puxar para atualizar | — | a fazer |
| 2 | Calendário do mês, criar/mover/apagar compromisso | /agenda… | Calendário nativo + folha de edição | — | a fazer |
| 3 | Conversa com o Dimy (texto, ações, links) | POST /chat, GET /conversa | Tela de chat nativa | teclado iOS | a fazer |
| 4 | Comando de voz (orbe, responder em voz alta) | POST /voz, /chat | Botão central; gravação + fala | expo-audio, expo-speech, háptico | a fazer |
| 5 | Anexar documento/foto/áudio para o Dimy | POST /documento | Seletor de arquivo/câmera | expo-document-picker, expo-image-picker | a fazer |
| 6 | Tarefas 2.0 (funil, prazos, projetos, subtarefas, notas, histórico, lixeira, adiar) | /tarefas… (19 rotas) | Aba Tarefas com quadro e detalhe | gestos de arrastar | a fazer |
| 7 | Sugestões de tarefas (aceitar/descartar) | /tarefas/sugestoes… | Lista na aba Tarefas | — | a fazer |
| 8 | Lembretes (criar por voz, cancelar) | /lembretes, /chat | Hoje + notificação | push | a fazer |
| 9 | WhatsApp: contatos, conversa, responder, “Dimy, responda”, silenciar, perfil | /contatos… | Lista + conversa (só administrador) | — | a fazer |
| 10 | Rascunhos do atendente/agendador (aprovar/descartar) | /rascunhos… | Cartão na conversa | — | a fazer |
| 11 | Atendimento automático e agendamento (configurações) | /atendente/config, /agendador | Configurações | — | a fazer |
| 12 | Gravar reunião (partes, fotos, falantes, ata, perguntas, tentar de novo) | /gravacoes… (12 rotas) | Aba Gravar | áudio em segundo plano, câmera, manter tela | a fazer |
| 13 | Oráculo: dossiês, pesquisar por voz, refazer, enviar, apagar | /dossies… | Tela Oráculo | — | a fazer |
| 14 | Empresas por perto | /local, /proximas | Mapa/lista | expo-location | a fazer |
| 15 | Exportar dossiê/empresas em PDF, CSV, planilha; enviar por WhatsApp/e-mail | /exportar | Gerar e compartilhar | expo-print, expo-sharing | a fazer |
| 16 | Radar (mapa neural, edição do dia, temas, histórico, pesquisar na internet) | /radar… | Tela Radar | animação nativa (Skia/SVG) | a fazer |
| 17 | Olho de Deus: visão geral, alertas, empresas, concorrentes, similares, movimentos, histórico, descobrir, ajustes | /olho/* (14 rotas) | Seção Olho de Deus completa | push | a fazer |
| 18 | Memória contextual (perguntas de conflito, ensinar/corrigir/esquecer via Dimy) | /chat (ferramentas memoria_*), /hoje.perguntas | Chat + nova tela Memória (consulta) | — | a fazer (tela de consulta precisa de rota nova de leitura) |
| 19 | Histórico de atividades | /avisos, /conversa, tarefas/detalhe, olho/execucoes | Tela Histórico unificada | — | a fazer (rota de leitura agregada nova) |
| 20 | Avisos e notificações (lidas, destino ao tocar) | /avisos, /avisos/lidas, /push/* | Aba Avisos + push nativo | APNs | **novo backend: push iOS** |
| 21 | Configuração: crédito de IA, temporizadores, alertas | /consumo/* | Tela Configurações | — | a fazer |
| 22 | Status das integrações (Claude, OpenAI, Google, WhatsApp) | GET /status | Configurações › Integrações | — | a fazer |
| 23 | Conectar Google | /status (link OAuth) | Abre navegador seguro | expo-web-browser | a fazer |
| 24 | Equipe (convidar, ativar, links) e conta (login, sair, criar senha) | /equipe…, Supabase Auth | Configurações › Equipe/Conta | — | a fazer |
| 25 | Tema claro/escuro | — | Segue o iOS (com opção manual) | — | a fazer |
| 26 | Fila offline (reenvio ao voltar) | — | Fila local criptografada + reenvio | NetInfo | a fazer |

Funcionalidades que **não** dependem do app e continuam no servidor: Olho de Deus programado, Radar diário, memória, atendente, agendador,
resumos, alarmes, perfis — rodam por pg_cron independentemente do iPhone (requisito 7 atendido pela arquitetura atual).
