# Notas para quem mantém este repositório

- Projeto Supabase: `mavjbevuhzalkqyxaajw`. Todas as funções usam `verify_jwt = false` (autenticação própria: JWT de membro, `x-app-key` ou `x-cron-secret`).
- `supabase/functions/*/index.ts` é o bundle publicado (minificado). O fonte modular foi perdido em 01/11/2026. Edite o bundle
  diretamente, com mudanças cirúrgicas: os nomes minificados são locais a cada arquivo. Depois do patch, `node --check` numa cópia `.mjs`.
- Publicar pelo MCP do Supabase (`deploy_edge_function`, entrypoint `index.ts`, `verify_jwt: false`) ou pelo CLI `supabase functions deploy <nome> --no-verify-jwt`.
- Segredos: nunca em arquivo. Vault com prefixo `sc_`, lidos pela RPC `get_app_secrets` (só `service_role`). Gravar com `set_app_secret`.
- Testes no servidor: `net.http_post`/`net.http_get` (pg_net) com cabeçalhos tirados do Vault dentro do próprio SQL; ler o resultado em `net._http_response`.
- Mudanças no banco: migração nova e aditiva em `supabase/migrations/`. Evite DELETE/DROP sem aprovação do dono.
- Regras do dono: não enviar WhatsApp em nome dele fora do fluxo do agendador sem pedir; WhatsApp e base de contatos são só do administrador (`ehDono`).
- O app (frontend) fica em `micheldersj-hub/segundo-cerebro-app` (GitHub Pages); a versão fica em `VERSAO` (app.js), `CACHE` (sw.js) e `?v=` (index.html).
