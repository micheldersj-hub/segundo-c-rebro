# Dimy iOS — Fase 1: Auditoria do sistema atual (03/11/2026)

Fontes: repositórios `segundo-c-rebro` (backend) e `segundo-cerebro-app` (PWA), banco e logs do projeto Supabase `mavjbevuhzalkqyxaajw`.

## Arquitetura
```
iPhone (PWA no Safari, GitHub Pages)  ──HTTPS/JSON──▶  Supabase Edge Functions (Deno)  ──▶  Postgres (+pgvector, pg_cron, pg_net, Vault)
                                                            │  Anthropic (Claude Sonnet 5.5 / Haiku 4.5), OpenAI (Whisper, embeddings)
WhatsApp (YCloud) / Instagram / Google ──webhooks/OAuth──▶  │  Google Agenda e Gmail, YCloud, Web Push (VAPID)
pg_cron (22 rotinas) ──────────────────────────────────────▶ funções (memória, Radar, Olho de Deus, resumos, alertas…)
```
- **O cérebro é todo servidor.** O app só mostra dados e envia comandos; nenhuma regra de negócio importante roda no celular.
- **Frontend atual:** `index.html` + `app.js` (272 KB, módulo único) + `style.css` + `sw.js`. Usa `fetch` direto nas funções, sem framework.

## Backend (Edge Functions)
| Função | Papel |
|---|---|
| app | API principal: hoje, chat/voz do Dimy (38 ferramentas), avisos, push, contatos, agenda, lembretes, Radar |
| tarefas | Tarefas 2.0 (funil por dia, projetos, subtarefas, histórico, lixeira, sugestões) |
| olho | Olho de Deus (empresas, movimentos, alertas, execuções, config, descoberta) |
| oraculo | Dossiês de empresas, pesquisa por voz, empresas próximas |
| gravador | Gravação de reuniões em partes, transcrição, falantes, ata, perguntas |
| documento | Análise de arquivos anexados (PDF, imagem, planilha, áudio, vídeo) |
| agendador / agenda | Reuniões pelo WhatsApp; página pública de horários |
| atendente | Respostas automáticas no WhatsApp com rascunhos para aprovação |
| extra | Perfis dos contatos, Radar diário, envio de arquivos (WhatsApp/e-mail) |
| worker | Rotinas: memória, lembretes, alarmes, plano da manhã, resumos, Google sync |
| ycloud / instagram | Webhooks de entrada (triagem e memória) |
| consumo | Crédito de IA, temporizadores, alertas |
| equipe / google-oauth | Convites e login da equipe; conexão Google |

## API usada pelo app (contrato que o iOS vai reutilizar, sem mudanças)
60 rotas HTTP/JSON. Principais: `GET /hoje`, `POST /chat`, `POST /voz` (áudio→texto), `GET/POST /tarefas…` (19 rotas),
`/olho/*` (14), `/dossies/*`, `/gravacoes/*` (12), `/contatos/*`, `/agenda`, `/lembretes`, `/avisos`, `/radar/*`, `/consumo/*`,
`/equipe/*`, `/push/*`, `/status`. Lista completa: `grep -oE "api\(\`?['\`]/[^'\`]*" app.js` no repositório do app.
- `GET /hoje` é **determinístico** (agenda, lembretes, avisos, pendências): não chama IA.

## Autenticação e acesso
- Supabase Auth (e-mail e senha; convite por link com `verifyOtp`); sessão JWT renovada automaticamente.
- Chave antiga `x-app-key` (legado, só dono). Cron usa `x-cron-secret`.
- Papéis em `membros` (admin/membro); WhatsApp e contatos só para o administrador (`ehDono`). Dados pessoais isolados por `user_id`.
- Segredos no Vault (`sc_*`). A chave anônima do Supabase no app é pública por design.

## Banco (52 tabelas; volumes aproximados)
- Memória: `raw_events` (680) → `episodes` (635) e `facts` (252) com embeddings (pgvector 1024), `entities`, `patterns`, `skills`, `reflections`, `pending_questions`.
- Histórico: `conversation_turns`, `notifications` (129), `tarefa_historico`, `olho_execucoes`, `radar_edicoes`, `agendador_decisoes`.
- WhatsApp: `wa_messages` (16.936), `contacts` (526), `contato_perfil` (370).
- Tarefas: `tarefas`, `tarefa_subtarefas`, `tarefa_sugestoes`. Olho: `olho_empresas`, `olho_movimentos`, `olho_alertas`, `olho_snapshots`, `olho_config`.
- Arquivos: buckets `gravacoes` e `exportes`. Consumo de IA: `ia_*`.

## Integrações externas
Anthropic, OpenAI (Whisper e embeddings), Google Agenda e Gmail (OAuth), YCloud (WhatsApp Business), Instagram, Web Push (VAPID), GitHub Pages.

## Automações (pg_cron, 22 rotinas)
Memória (2 min), Olho de Deus (2 min, hoje desligado), atendente (30 s), agendador (10 s), lembretes e alarmes (1 min), Google (15 min),
perfis (3 min), resumo de contatos (30 min), sugestão de tarefas (20 min), Radar (seg–sáb 6h20), plano (7h), resumo (22h), semana, mês,
consumo de IA (30 min), recuperação de falta de crédito (30 min), limpezas.

## Recursos do iPhone usados hoje pelo PWA
Microfone (voz e gravação de reuniões), síntese de voz, câmera/fotos, localização (empresas por perto), vibração, compartilhar,
área de transferência, manter tela ligada, notificações Web Push, PDF/planilha gerados no aparelho (jsPDF, xlsx).

## Consumo de IA em operação (dados reais, 03/11 9h45→20h30)
| Rotina | Chamadas | US$ | Observação |
|---|---:|---:|---|
| WhatsApp recebido (ycloud: triagem + memória) | 454 | 0,91 | 169 mensagens → ~2,7 chamadas/mensagem; 13% triviais ("ok", "obrigado") |
| Perfis dos contatos | 73 | 0,44 | entrada média 3,9 mil tokens |
| Memória (worker) | 23 | 0,05 | |
| Resumo do dia | 1 | 0,02 | Sonnet |

## Riscos e restrições encontrados
- Funções minificadas (fonte original perdido): mudanças no backend devem ser cirúrgicas e aditivas.
- Push atual é Web Push (Safari). App nativo precisa de APNs: exige acréscimo no backend (não substitui nada).
- Gravação longa de reunião com tela bloqueada exige modo de áudio em segundo plano do iOS.
- Compilar iOS exige macOS: será feito em nuvem (EAS Build). TestFlight exige conta Apple Developer (paga).
