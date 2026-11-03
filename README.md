# Segundo Cérebro (Dimy): servidor

Código do servidor do Segundo Cérebro: o assistente **Dimy**, o **Oráculo**, o **Gravador**, o **Agendador** do WhatsApp,
o **Radar** e a memória. Tudo roda no Supabase (projeto `mavjbevuhzalkqyxaajw`).

O aplicativo (a tela do iPhone) fica em outro repositório, público: `micheldersj-hub/segundo-cerebro-app`.

> **Nenhuma senha ou chave fica neste repositório.** Todas estão no cofre (Vault) do Supabase, com o prefixo `sc_`,
> e as funções leem de lá na hora em que rodam.

## O que tem aqui

| Pasta | Conteúdo |
|---|---|
| `supabase/functions/` | As 13 funções que estão no ar (código exato publicado em 01/11/2026) |
| `supabase/migrations/` | As migrações do banco (0001–0030), na ordem em que foram aplicadas |
| `supabase/cron.sql` | As 17 tarefas automáticas (lembretes, alarmes, memória, Oráculo, Radar…) |

## As funções

| Função | Para que serve |
|---|---|
| `app` | Conversa com o Dimy (texto e voz), agenda, lembretes, avisos, Radar, contatos do WhatsApp |
| `worker` | Tarefas automáticas: memória, lembretes, alarmes da agenda, plano da manhã, resumo do dia/semana/mês, sincronização do Google |
| `ycloud` | Recebe as mensagens do WhatsApp Business (YCloud) |
| `agendador` | Marca reuniões pelo WhatsApp; quando não tem certeza, deixa rascunho para aprovação |
| `atendente` | Bot de IA do WhatsApp: responde clientes e prospects se o Michelder não responder (10 min no expediente, ~1 min fora), nunca cita valores; na dúvida deixa rascunho. Código TypeScript legível. Liga/desliga em `atendente_config` ou nos Ajustes do app |
| `tarefas` | Tarefas em funil (A fazer → Fazendo → Feito) por dia; adiar para o próximo dia útil. Tarefas 2.0: prazo, projeto, área, empresa, repetição, subtarefas, anotações, histórico (gatilho `tarefas_auditar` no banco), lixeira com restauração e exclusão confirmada, sugestões a partir das conversas (`/sugerir`, cron `sc-tarefas-sugerir`; nunca cria sozinho). Código TypeScript legível + `regras.ts` testado |
| `olho` | **Olho de Deus**: inteligência de mercado. Fila em etapas (pesquisar → extrair → analisar → gravar), cron `sc-olho` a cada 2 min; descoberta semanal de empresas, regulação e setor 1×/dia, cada empresa a cada 72 h. Perfil com 14 itens, classificação promessa × comprovação com evidências conferidas, alertas por nível, push a partir de "alto", memória do Dimy, sugestões de tarefa. Código legível + `logica.ts` testado |
| `agenda` | Página pública em que o contato escolhe um horário livre (link com token) |
| `oraculo` | Dossiê de empresas (cadastro, mercado, risco, sócios, abordagem), pesquisa por voz e empresas próximas |
| `gravador` | Gravação de reuniões, ligações e notas: transcrição, quem falou, ata e perguntas |
| `documento` | Botão de anexar: o Dimy lê PDF, imagem, planilha, texto, áudio e vídeo |
| `extra` | Base de conhecimento dos contatos, Radar diário e envio de arquivos (WhatsApp/e-mail) |
| `consumo` | **Configuração / crédito de IA**: consumo medido de cada chamada à Anthropic (`ia_consumo`, preços em `ia_precos`), saldo estimado (o dono informa o saldo; "Conferir saldo" calibra), ritmo diário, dias restantes, temporizadores das rotinas (`ia_temporizadores` → altera o cron), modos Completo/Equilibrado/Econômico/Mínimo, avisos e economia automática (cron `sc-consumo`), relatório oficial opcional com chave de administrador da Anthropic (no Vault). Código legível + `logica.ts` testado |
| `equipe` | Acesso da equipe de vendas (convites e links de entrada) |
| `google-oauth` | Conexão com Google Agenda e Gmail |
| `instagram` | Webhook do Instagram (DMs e comentários) |
| `ycloud-ajuste` | Ajuste dos eventos do webhook da YCloud (uso administrativo) |

## Importante sobre o código das funções

Os arquivos em `supabase/functions/*/index.ts` são **exatamente o que está publicado**. É o código já empacotado
(compactado em um arquivo por função). O código-fonte original, separado em módulos, ficava num ambiente de trabalho
temporário que foi substituído em 01/11/2026. Por isso o backup foi feito a partir do servidor.

Na prática:
- Para corrigir algo, edite o `index.ts` da função e publique de novo. É o que tem sido feito.
- Publicar: `supabase functions deploy <nome> --no-verify-jwt` (todas usam `verify_jwt = false`, porque fazem a própria autenticação).

## Segredos (só os nomes; os valores ficam no Vault)

`ADMIN_SECRET`, `ANTHROPIC_API_KEY`, `APP_KEY`, `CRON_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `IG_VERIFY_TOKEN`,
`META_APP_ID`, `META_APP_SECRET`, `OPENAI_API_KEY`, `OWNER_WHATSAPP_NUMBER`, `PROJECT_URL`, `TOKEN_ENCRYPTION_KEY`,
`VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`, `WA_ACCESS_TOKEN`, `WA_BUSINESS_ACCOUNT_ID`, `WA_NUMERO`,
`WA_PHONE_NUMBER_ID`, `WA_PROVIDER`, `WA_VERIFY_TOKEN`, `YCLOUD_API_KEY`, `YCLOUD_WEBHOOK_SECRET`.

Para criar ou trocar um segredo (no SQL do Supabase): `select set_app_secret('NOME', 'valor');`. O prefixo `sc_` é colocado sozinho.

## Funções desativadas (podem ser apagadas no painel)

`whatsapp` (substituída pela `ycloud`), `gravador-teste` e `oraculo-teste` respondem só "desativada" e não fazem nada.
Para tirá-las da lista: Supabase → Edge Functions → função → Delete.
