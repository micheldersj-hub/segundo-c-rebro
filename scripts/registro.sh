#!/usr/bin/env bash
# Registra o fim de uma tarefa em docs/ESTADO.md: tarefa, arquivos alterados, testes, pendências e consumo real.
# Uso: scripts/registro.sh "o que foi feito" ["pendências/falhas"]
set -euo pipefail
cd "$(dirname "$0")/.."
TAREFA="${1:?descreva a tarefa}"; PEND="${2:-}"
ARQS=$( (git diff --name-only HEAD; git ls-files --others --exclude-standard) 2>/dev/null | sort -u | grep -v '^docs/ESTADO.md$' | tr '\n' ' ')
TESTES=$(python3 -c "import json;d=json.load(open('.cache/testes.json'));print(d['resumo'],'('+d['quando']+')')" 2>/dev/null || echo "não rodados")
HOJE=$(python3 scripts/consumo_claude.py --dias 1 2>/dev/null | grep -E '^20' | tail -1 | awk '{print "chamadas "$2", saída "$6" tokens, contexto médio "$7}')
ENTRADA="- $(date '+%d/%m %H:%M') — ${TAREFA}. Arquivos: ${ARQS:-nenhum}. Testes: ${TESTES}.${PEND:+ Pendências: $PEND.}${HOJE:+ Consumo do dia: $HOJE.}"
python3 - "$ENTRADA" <<'PY'
import sys
p='docs/ESTADO.md'; s=open(p,encoding='utf-8').read()
s=s.replace('## Histórico\n', '## Histórico\n'+sys.argv[1]+'\n',1); open(p,'w',encoding='utf-8').write(s)
PY
echo "$ENTRADA"
