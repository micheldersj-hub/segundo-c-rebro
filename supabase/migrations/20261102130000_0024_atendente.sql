-- Atendente IA do WhatsApp: responde clientes e prospects quando o Michelder não responde.
-- Começa DESLIGADO (ativo = false); liga pelo app depois da simulação.

create table if not exists public.atendente_config (
  id              int primary key default 1 check (id = 1),
  ativo           boolean not null default false,
  espera_min      int not null default 10 check (espera_min between 1 and 240),   -- no expediente, espera o Michelder responder
  espera_fora_s   int not null default 60 check (espera_fora_s between 15 and 900), -- fora do expediente, junta mensagens em sequência
  max_auto_6h     int not null default 4 check (max_auto_6h between 1 and 20),    -- respostas automáticas por contato em 6 h
  conhecimento    text not null default '',
  updated_at      timestamptz not null default now()
);
alter table public.atendente_config enable row level security;

insert into public.atendente_config (id, conhecimento) values (1, $kb$
SOBRE A B2B PAY
- B2B PAY Consultoria em Pagamentos, de Belo Horizonte/MG. Responsável comercial: Michelder.
- Soluções de meios de pagamento para empresas: maquininhas de cartão, split de pagamento na origem ("split puro"),
  conta digital (BaaS), Pix e boleto, gateway de pagamento.

SPLIT PURO (carro-chefe)
- Para empresas do Simples Nacional que faturam cerca de R$ 30 mil a R$ 120 mil por mês no cartão.
- Ideia: o valor de cada venda é dividido já na origem, na hora do pagamento, entre quem tem direito a ele
  (por exemplo, a parte de parceiros ou profissionais). Assim a empresa deixa de receber e tributar dinheiro que é de
  terceiros passando pelo próprio CNPJ.
- O ganho depende do caso: o Michelder faz uma análise comparando o cenário atual (taxas da maquininha + imposto)
  com o cenário usando a estratégia da B2B PAY.

COMO O ATENDENTE DEVE CONDUZIR
- Entender o negócio: nome, empresa, segmento, cidade, quanto passa por mês no cartão, maquininha que usa hoje.
- Com esses dados, o Michelder prepara a análise e a proposta. Oferecer uma conversa/reunião com ele.
- Valores, taxas e condições comerciais: só o Michelder informa, na proposta.
$kb$) on conflict (id) do nothing;

create table if not exists public.atendente_decisoes (
  id          uuid primary key default gen_random_uuid(),
  wa_id       text not null,
  msg_ids     text[] not null default '{}',
  analise     jsonb,
  resultado   text not null,
  motivo      text,
  texto       text,
  created_at  timestamptz not null default now()
);
create index if not exists atendente_decisoes_wa on public.atendente_decisoes (wa_id, created_at desc);
alter table public.atendente_decisoes enable row level security;

alter table public.wa_messages add column if not exists atendente_status text;
create index if not exists wa_messages_atendente_idx on public.wa_messages (created_at)
  where direction = 'in' and atendente_status is null;
-- Tudo o que já chegou antes do atendente existir fica fora (ele só olha mensagens novas).
update public.wa_messages set atendente_status = 'antigo' where direction = 'in' and atendente_status is null;

alter table public.agendador_rascunhos add column if not exists origem text not null default 'agendador';

-- Varredura leve: só chama a função quando há mensagem nova pendente.
create or replace function public.atendente_varrer() returns void
language plpgsql security definer set search_path = public as $$
declare s jsonb;
begin
  if not (select ativo from atendente_config where id = 1) then return; end if;
  if not exists (
    select 1 from wa_messages
    where direction = 'in' and atendente_status is null and not from_history
      and created_at > now() - interval '1 day' and created_at < now() - interval '15 seconds'
  ) then return; end if;
  s := get_app_secrets();
  perform net.http_post(
    url := (s->>'sc_PROJECT_URL') || '/functions/v1/atendente/varrer',
    body := '{}'::jsonb,
    headers := jsonb_build_object('x-cron-secret', s->>'sc_CRON_SECRET', 'Content-Type', 'application/json'),
    timeout_milliseconds := 90000);
end $$;
revoke all on function public.atendente_varrer() from public, anon, authenticated;

select cron.schedule('sc-atendente', '30 seconds', 'select public.atendente_varrer()');
