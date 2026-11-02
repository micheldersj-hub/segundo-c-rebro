-- Migração 0020_radar (aplicada em 2026-10-30).
-- Exportada do histórico de migrações do Supabase.

create table if not exists public.radar_temas (
  id uuid primary key default gen_random_uuid(),
  tema text not null unique,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.radar_temas enable row level security;
create table if not exists public.radar_edicoes (
  id uuid primary key default gen_random_uuid(),
  dia date not null,
  status text not null default 'pesquisando',
  conteudo jsonb,
  fontes text[] not null default '{}',
  erro text,
  created_at timestamptz not null default now()
);
alter table public.radar_edicoes enable row level security;
insert into public.radar_temas (tema) values
 ('Meios de pagamento e maquininhas no Brasil (Stone, PagBank, Cielo, Rede, Getnet, InfinitePay, Mercado Pago)'),
 ('Pix, Pix Automático e regras do Banco Central para pagamentos'),
 ('Split de pagamento, subadquirência e Banking as a Service'),
 ('Reforma tributária, split payment do IVA e Simples Nacional'),
 ('Varejo, comércio e pequenas empresas em Belo Horizonte'),
 ('Fintechs, crédito para PMEs e antecipação de recebíveis')
on conflict (tema) do nothing;
select cron.schedule('sc-radar', '20 9 * * 1-6', $$select public.invoke_worker('radar')$$);
select cron.schedule('sc-conhecimento', '*/5 * * * *', $$select public.invoke_worker('conhecimento')$$);
