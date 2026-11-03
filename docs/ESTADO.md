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
- 03/11 19:50 — Ambiente: Superpowers e GitHub verificados; CLAUDE.md enxuto, docs/MAPA.md, docs/ESTADO.md, scripts de testes com cache, consumo real e registro; workflows Testes e Publicar funções; testes de tela em tools/ui. Arquivos: .github/workflows/publicar-funcoes.yml .github/workflows/testes.yml .gitignore CLAUDE.md docs/MAPA.md scripts/consumo_claude.py scripts/registro.sh scripts/testes.sh tools/ui/LEIAME.md tools/ui/ (3 testes + fx/) tools/ui/teclado.mjs tools/ui/telas.mjs . Testes: 22 ok, 0 falha(s) (03/11 19:49). Pendências: segredo SUPABASE_ACCESS_TOKEN no GitHub; Superpowers na conta. Consumo do dia: chamadas 197, saída 277,631 tokens, contexto médio 379,310.
