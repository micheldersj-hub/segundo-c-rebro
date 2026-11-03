# Segundo Cérebro (backend Supabase) — regras permanentes

Projeto `mavjbevuhzalkqyxaajw`. App (frontend) em `micheldersj-hub/segundo-cerebro-app`.
Antes de agir: leia `docs/ESTADO.md` (o que já foi feito e o que está pendente). Para achar código: `docs/MAPA.md`.

## Regras do dono
- Não enviar WhatsApp em nome dele fora do fluxo do agendador/atendente sem pedir. WhatsApp e contatos são só do administrador (`ehDono`).
- Segredos só no Vault (`sc_`, RPC `get_app_secrets`, gravar com `set_app_secret`); nunca em arquivo, log ou frontend.
- Banco: migração nova e aditiva em `supabase/migrations/`. DELETE/DROP só com aprovação do dono.

## Funções (Edge Functions)
- Todas `verify_jwt = false` (auth própria: JWT de membro, `x-app-key` ou `x-cron-secret`).
- `functions/*/index.ts` minificados = bundle publicado (fonte original perdido). Patch cirúrgico + `node --check` numa cópia `.mjs`.
- Publicar: workflow `Publicar funções` (GitHub Actions, sem colar código) quando o segredo `SUPABASE_ACCESS_TOKEN` existir no GitHub;
  senão MCP `deploy_edge_function` (cola o arquivo inteiro: caro, use só para arquivos pequenos ou urgência).
- Medição de consumo: bloco `__usoIA` no fim de cada função que chama a Anthropic (ver `docs/ESTADO.md` para quais já estão publicadas).

## Economia de contexto (obrigatório)
- Não leia bundle inteiro: `grep -o '.\{200\}TRECHO.\{300\}'` ou Read com offset/limit. Mapa de tamanhos em `docs/MAPA.md`.
- Testes: `scripts/testes.sh` (reaproveita o resultado se os arquivos testados não mudaram).
- Teste de servidor: `net.http_*` via SQL; leia só as colunas/trechos necessários de `net._http_response`.
- Ao terminar uma tarefa: `scripts/registro.sh "<tarefa>" "<pendências>"` e commit. Não repita relatórios longos no chat.
- Subagentes só para buscas amplas ou revisão independente de algo grande.
- Versão do app: `VERSAO` (app.js), `CACHE` (sw.js), `?v=` (index.html).
