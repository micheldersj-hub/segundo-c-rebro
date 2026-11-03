# Estado do projeto (atualize ao fim de cada tarefa; mais recente em cima)

## Pendências
- Publicar com medição de consumo: app, olho, tarefas, atendente, agendador, oraculo, gravador, instagram
  (o bloco `__usoIA` já está no repositório; usar o workflow "Publicar funções" quando o segredo existir).
- Criar o segredo `SUPABASE_ACCESS_TOKEN` no GitHub (repo segundo-c-rebro › Settings › Secrets › Actions) — só o dono.
- Olho de Deus desligado desde a falta de crédito (religar pela aba Configuração › Economia).
- Instalar o Superpowers na conta (claude.ai) para valer em toda sessão; nesta nuvem a instalação é temporária.

## Falhas conhecidas
- Saldo da Anthropic não é exposto por API: o painel usa saldo informado + gasto medido (+ calibração).
- A sessão na nuvem não alcança api.supabase.com nem *.supabase.co pelo terminal (lista de rede); só pelo MCP.

## Histórico
- 03/11 19:50 — Ambiente: Superpowers e GitHub verificados; CLAUDE.md enxuto, docs/MAPA.md, docs/ESTADO.md, scripts de testes com cache, consumo real e registro; workflows Testes e Publicar funções; testes de tela em tools/ui. Arquivos: .github/workflows/publicar-funcoes.yml .github/workflows/testes.yml .gitignore CLAUDE.md docs/MAPA.md scripts/consumo_claude.py scripts/registro.sh scripts/testes.sh tools/ui/' + (process.env.SAIDA || '/tmp') + '/ui_config_390.png tools/ui/LEIAME.md tools/ui/fx/app_radar.json tools/ui/fx/consumo_painel.json tools/ui/fx/olho_alertas.json tools/ui/fx/olho_config.json tools/ui/fx/olho_empresas.json tools/ui/fx/olho_execucoes.json tools/ui/fx/olho_movimentos.json tools/ui/fx/olho_movimentos_d9ff83c6-5efc-43c1-892d-ce3c3aa6551c.json tools/ui/fx/olho_painel.json tools/ui/fx/tarefas.json tools/ui/fx/tarefas_00000000-0000-0000-0000-000000000001_detalhe.json tools/ui/fx/tarefas_projetos.json tools/ui/fx/tarefas_sugestoes.json tools/ui/interacao_config.mjs tools/ui/teclado.mjs tools/ui/telas.mjs . Testes: 22 ok, 0 falha(s) (03/11 19:49). Pendências: segredo SUPABASE_ACCESS_TOKEN no GitHub; Superpowers na conta. Consumo do dia: chamadas 197, saída 277,631 tokens, contexto médio 379,310.
