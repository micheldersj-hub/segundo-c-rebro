#!/usr/bin/env bash
# Roda os testes de unidade e reaproveita o último resultado quando nada do que é testado mudou.
# Uso: scripts/testes.sh [--forcar]
set -euo pipefail
cd "$(dirname "$0")/.."
CACHE=.cache/testes.json; mkdir -p .cache
ARQS=$(ls supabase/tests/*.mjs supabase/functions/*/logica.ts supabase/functions/*/regras.ts 2>/dev/null | sort)
HASH=$(cat $ARQS | sha256sum | cut -c1-16)
if [[ "${1:-}" != "--forcar" && -f $CACHE ]] && grep -q "\"hash\": \"$HASH\"" $CACHE; then
  echo "Testes reaproveitados (código testado não mudou): $(python3 -c "import json;d=json.load(open('$CACHE'));print(d['resumo'], 'em', d['quando'])")"
  exit 0
fi
SAIDA=$(cd supabase && node --test tests/*.test.mjs 2>&1) || true
PASS=$(grep -E '^# pass' <<<"$SAIDA" | awk '{print $3}'); FAIL=$(grep -E '^# fail' <<<"$SAIDA" | awk '{print $3}')
RESUMO="$PASS ok, $FAIL falha(s)"
python3 - "$HASH" "$RESUMO" <<'PY'
import json,sys,datetime
json.dump({"hash":sys.argv[1],"resumo":sys.argv[2],"quando":datetime.datetime.now().strftime("%d/%m %H:%M")},open(".cache/testes.json","w"),indent=1)
PY
echo "Testes: $RESUMO"
if [[ "$FAIL" != "0" ]]; then grep -E "^not ok|AssertionError|Expected|actual|expected" <<<"$SAIDA" | head -20; exit 1; fi
