# Mapa do código (consulte a seção que precisa; não carregue tudo)

## Funções — tamanho e tipo
| Função | Bytes | Tipo | Chama IA | Mede consumo publicado |
|---|---:|---|---|---|
| app | 122k | minificado | sim | **sim** |
| worker | 58k | minificado | sim (memória, resumos) | **sim** |
| olho | 58k | TS legível + `logica.ts` | sim (web) | **sim** |
| oraculo | 55k | minificado | sim (web) | **sim** |
| agendador | 44k | minificado | sim | **sim** |
| extra | 41k | minificado | sim (Radar, perfis) | **sim** |
| gravador | 40k | minificado | sim | **sim** |
| atendente | 37k | TS legível | sim | **sim** |
| tarefas | 29k | TS legível + `regras.ts` | sim | **sim** |
| ycloud | 27k | minificado | sim (triagem, memória) | **sim** |
| agenda | 25k | minificado | não | — |
| consumo | 23k | TS legível + `logica.ts` | não | — |
| instagram | 19k | TS | sim | **sim** |
| google-oauth | 11k | minificado | não | — |
| documento | 11k | minificado | sim | **sim** |
| equipe | 7k | minificado | não | — |

## Âncoras para grep nos minificados
- Chamada à Anthropic: `api.anthropic.com/v1/messages` (1 por arquivo); retorno: `__usoIA(__j)`.
- Despacho de tarefas: worker `Dt={memory:` · extra `ct={conhecimento:`.
- Segredos: função que chama `get_app_secrets`.

## Banco
- Migrações: `supabase/migrations/AAAAMMDDHHMMSS_NNNN_nome.sql` (última: 0034). Cron documentado em `supabase/cron.sql`.
- Consumo de IA: `ia_consumo` (+ view `ia_consumo_valido`), `ia_precos`, `ia_config`, `ia_oficial`, `ia_temporizadores`.

## Testes
- Unidade: `supabase/tests/*.test.mjs` (`scripts/testes.sh`).
- Interface do app: `tools/ui/` (Playwright; ver `tools/ui/LEIAME.md`).

## App (repo segundo-cerebro-app)
- `app.js` (~4k linhas). Seções: grep `^// [A-Z]` (Navegação, Hoje, Conversa, WhatsApp, Avisos e ajustes, Oráculo…);
  Olho: `async function carregarOlho`; Configuração: `function carregarConfig`; Radar mapa: `function desenharMapa`;
  barra/teclado: `function fundoEstavel`. Estilos novos ficam no fim de `style.css` por seção comentada.
