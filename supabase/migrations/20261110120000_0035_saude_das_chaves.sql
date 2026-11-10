-- 0035: saúde das chaves dos serviços (Anthropic, OpenAI, YCloud, Meta, Google, chave de administrador da Anthropic).
-- Motivo: em 07/11 as chaves da Anthropic e da OpenAI venceram (criadas em 08/10 com validade de 30 dias) e o sistema
-- ficou 3 dias sem IA sem ninguém saber; a memória ainda gastou crédito tentando de novo a cada 2 min.
-- Aditiva: tabela e funções novas, um cron novo; set_app_secret passa a aceitar o nome com ou sem "sc_" (antes, com "sc_",
-- gravava "sc_sc_..." e a chave nova não era usada).

create table if not exists public.chaves_saude (
  servico        text primary key,              -- anthropic | openai | ycloud | meta | google | anthropic_admin
  ok             boolean not null,
  desde          timestamptz not null default now(),   -- quando entrou no estado atual
  verificado_em  timestamptz not null default now(),
  detalhe        text,                                 -- texto simples para a tela (sem segredo)
  expira_em      timestamptz,                          -- quando o fornecedor informa a validade
  saldo          numeric,                              -- YCloud (USD)
  falhas_seguidas int not null default 0
);
alter table public.chaves_saude enable row level security;   -- só o servidor (service_role) lê e escreve
revoke all on public.chaves_saude from anon, authenticated;

-- A memória só chama a IA quando as duas chaves que ela usa (Anthropic e OpenAI) estão boas.
-- Estado com mais de 30 min sem verificação não trava nada (se o monitor parar, o sistema segue como antes).
create or replace function public.ia_disponivel() returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from chaves_saude
     where servico in ('anthropic', 'openai') and not ok and verificado_em > now() - interval '30 minutes');
$$;
revoke all on function public.ia_disponivel() from public, anon, authenticated;
grant execute on function public.ia_disponivel() to service_role;

-- Chave voltou: devolve uma tentativa às mensagens que falharam por chave recusada/vencida (últimos 14 dias).
-- Só refaz a memória (episódios e fatos); não responde ninguém (decisão do dono em 09/11).
create or replace function public.recuperar_falhas_chave() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update raw_events set attempts = 0
   where not processed and created_at > now() - interval '14 days'
     and (error ilike '%invalid x-api-key%' or error ilike '%authentication_error%' or error ilike '%api key has expired%'
          or error ilike '%incorrect api key%' or error ilike '%invalid_api_key%' or error ilike '%Embeddings 401%' or error ilike '%Claude 401%');
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.recuperar_falhas_chave() from public, anon, authenticated;
grant execute on function public.recuperar_falhas_chave() to service_role;

-- Gravar segredo: aceita "OPENAI_API_KEY" ou "sc_OPENAI_API_KEY" (sempre grava sc_OPENAI_API_KEY).
create or replace function public.set_app_secret(secret_name text, secret_value text) returns void
language plpgsql security definer set search_path = '' as $$
declare existing uuid; nome text := 'sc_' || regexp_replace(trim(secret_name), '^(sc_)+', '', 'i');
begin
  select id into existing from vault.secrets where name = nome;
  if existing is null then
    perform vault.create_secret(trim(secret_value), nome);
  else
    perform vault.update_secret(existing, trim(secret_value));
  end if;
end $$;

-- Verificação a cada 10 min (função "consumo", sem IA: só chamadas de conferência que não gastam crédito).
create or replace function public.chaves_verificar() returns void
language plpgsql security definer set search_path = public as $$
declare s jsonb;
begin
  s := get_app_secrets();
  perform net.http_post(url := (s->>'sc_PROJECT_URL') || '/functions/v1/consumo/chaves-verificar',
    headers := jsonb_build_object('x-cron-secret', s->>'sc_CRON_SECRET', 'Content-Type', 'application/json'),
    body := '{}'::jsonb, timeout_milliseconds := 30000);
end $$;
revoke all on function public.chaves_verificar() from public, anon, authenticated;
-- agendado depois do deploy da função: select cron.schedule('sc-chaves', '3,13,23,33,43,53 * * * *', 'select public.chaves_verificar()');
