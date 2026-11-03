#!/usr/bin/env python3
"""Consumo REAL de tokens do Claude Code, lido das transcrições locais (~/.claude/projects/**/*.jsonl).
Usa o campo `usage` que a API devolve em cada resposta. Não estima nada: se não houver transcrição, diz que não há dado.
Uso: scripts/consumo_claude.py [--dias 7] [--pesados]   (--pesados lista as ferramentas que mais trouxeram texto ao contexto)
"""
import json, sys, glob, os, collections, datetime
dias = int(sys.argv[sys.argv.index('--dias') + 1]) if '--dias' in sys.argv else 7
corte = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=dias)
arquivos = glob.glob(os.path.expanduser('~/.claude/projects/**/*.jsonl'), recursive=True)
if not arquivos:
    print('Sem transcrições do Claude Code neste ambiente: não há dado real de consumo para mostrar.'); sys.exit(0)
por_dia = collections.defaultdict(collections.Counter); vistos = set()
nomes, res = {}, collections.Counter()
for f in arquivos:
    for linha in open(f, encoding='utf-8', errors='ignore'):
        try: j = json.loads(linha)
        except Exception: continue
        ts = j.get('timestamp'); m = j.get('message') if isinstance(j.get('message'), dict) else {}
        if not ts: continue
        quando = datetime.datetime.fromisoformat(ts.replace('Z', '+00:00'))
        if quando < corte: continue
        u = m.get('usage')
        if j.get('type') == 'assistant' and u and m.get('id') not in vistos:
            vistos.add(m.get('id'))   # a mesma resposta pode aparecer em várias linhas (blocos); conta uma vez
            d = por_dia[quando.astimezone().strftime('%Y-%m-%d')]
            d['chamadas'] += 1
            for k in ('input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens'): d[k] += u.get(k, 0) or 0
        for b in m.get('content') or [] if isinstance(m.get('content'), list) else []:
            if b.get('type') == 'tool_use': nomes[b['id']] = b['name']
            if b.get('type') == 'tool_result': res[nomes.get(b.get('tool_use_id'), '?')] += len(json.dumps(b.get('content') or ''))
if not por_dia:
    print(f'Nenhuma resposta com `usage` nos últimos {dias} dias.'); sys.exit(0)
print(f'{"dia":<11}{"chamadas":>9}{"entrada nova":>14}{"cache grav.":>13}{"cache lido":>14}{"saída":>10}{"contexto médio":>16}')
tot = collections.Counter()
for dia in sorted(por_dia):
    d = por_dia[dia]; tot.update(d)
    ctx = (d['input_tokens'] + d['cache_creation_input_tokens'] + d['cache_read_input_tokens']) // max(1, d['chamadas'])
    print(f'{dia:<11}{d["chamadas"]:>9}{d["input_tokens"]:>14,}{d["cache_creation_input_tokens"]:>13,}{d["cache_read_input_tokens"]:>14,}{d["output_tokens"]:>10,}{ctx:>16,}')
ctx = (tot['input_tokens'] + tot['cache_creation_input_tokens'] + tot['cache_read_input_tokens']) // max(1, tot['chamadas'])
print(f'{"total":<11}{tot["chamadas"]:>9}{tot["input_tokens"]:>14,}{tot["cache_creation_input_tokens"]:>13,}{tot["cache_read_input_tokens"]:>14,}{tot["output_tokens"]:>10,}{ctx:>16,}')
print('Obs.: tokens, não dólares. O custo depende do plano (assinatura ou API); cache lido custa ~10% da entrada nova.')
if '--pesados' in sys.argv:
    print('\nFerramentas que mais trouxeram texto ao contexto (caracteres):')
    for k, v in res.most_common(8): print(f'  {k:<45}{v:>12,}')
