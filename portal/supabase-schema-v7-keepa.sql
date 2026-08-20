-- =========================================================
-- Yalca Portal — v7: Compras & Concorrência (Keepa)
-- Rode este script no SQL Editor DEPOIS do v6
--
-- Duas ferramentas novas, mesma fonte de dados (Keepa):
--   1. "Meus Anúncios" — cliente acompanha os próprios ASINs
--      (preço, BSR, buybox, avaliação), atualizado por um job
--      agendado na VPS (não ao vivo).
--   2. "Pesquisar Produto" — cliente pesquisa um ASIN que está
--      pensando em comprar pra revender; uma Edge Function
--      consulta o Keepa sob demanda.
--
-- O orçamento de tokens do Keepa é muito apertado (plano Pro de
-- consumidor, não um plano de API dedicado), então todo o desenho
-- gira em torno de cache agressivo e deduplicação:
--   - keepa_asin_cache é chaveado só pelo ASIN (não por cliente) —
--     dois clientes acompanhando o mesmo produto usam o mesmo
--     registro, então só custa token uma vez pro sistema inteiro.
--   - Nada é consultado ao vivo quando a página abre — sempre lê
--     do cache; só a pesquisa sob demanda pode gerar uma chamada
--     real ao Keepa, e só se o cache estiver velho.
--   - Todo número "quão agressivo" fica em keepa_config, ajustável
--     sem mexer em código, porque o saldo real de tokens só vai
--     ser conhecido depois de observar o uso de verdade.
-- =========================================================

-- ---------------------------------------------------------
-- Configuração (linha única, ajustável)
-- ---------------------------------------------------------
create table if not exists keepa_config (
  id smallint primary key default 1 check (id = 1),
  daily_token_cap integer not null default 200,
  max_tracked_asins_per_client integer not null default 15,
  max_searches_per_client_per_day integer not null default 5,
  cheap_refresh_cadence_hours integer not null default 12,
  buybox_refresh_cadence_hours integer not null default 48,
  search_cache_max_age_hours integer not null default 24,
  price_alert_threshold_pct numeric not null default 5,
  updated_at timestamptz not null default now()
);
insert into keepa_config (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------
-- ASINs monitorados por cliente ("Meus Anúncios")
-- ---------------------------------------------------------
create table if not exists keepa_tracked_asins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  asin text not null check (asin ~ '^[A-Z0-9]{10}$'),
  label text default '',
  own_seller_name text default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(user_id, asin)
);

-- ---------------------------------------------------------
-- Cache compartilhado, chaveado só pelo ASIN
-- ---------------------------------------------------------
create table if not exists keepa_asin_cache (
  asin text primary key check (asin ~ '^[A-Z0-9]{10}$'),
  title text,
  image_url text,
  current_price numeric,
  bsr integer,
  category text,
  rating numeric,
  review_count integer,
  buybox_seller text,
  buybox_is_amazon boolean,
  buybox_price numeric,
  offers_count integer,
  availability_status text,
  price_history jsonb not null default '[]',
  cheap_data_updated_at timestamptz,
  buybox_data_updated_at timestamptz,
  last_synced_by text,
  last_error text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- Alertas por ASIN (gerados pelo job agendado ao comparar
-- o snapshot novo com o anterior)
-- ---------------------------------------------------------
create table if not exists keepa_asin_alerts (
  id uuid primary key default gen_random_uuid(),
  asin text not null references keepa_asin_cache(asin) on delete cascade,
  alert_type text not null check (alert_type in
    ('buybox_lost','buybox_regained','buybox_changed','price_drop','price_increase',
     'out_of_stock','back_in_stock','rating_drop')),
  message text not null,
  previous_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_keepa_alerts_asin on keepa_asin_alerts(asin, created_at desc);

-- ---------------------------------------------------------
-- Log de pesquisas sob demanda — só a Edge Function escreve
-- (usado pro limite diário de pesquisas por cliente)
-- ---------------------------------------------------------
create table if not exists keepa_search_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  asin text not null,
  resulted_in_live_call boolean not null default false,
  searched_at timestamptz not null default now()
);
create index if not exists idx_keepa_search_log_user_day on keepa_search_log(user_id, searched_at);

-- ---------------------------------------------------------
-- Saldo de tokens (auto-corrigido pelo tokensLeft real do
-- Keepa a cada chamada) e trilha de auditoria
-- ---------------------------------------------------------
create table if not exists keepa_token_budget (
  id smallint primary key default 1 check (id = 1),
  last_known_tokens_left integer,
  last_checked_at timestamptz,
  tokens_spent_today integer not null default 0,
  spend_day date not null default current_date
);
insert into keepa_token_budget (id) values (1) on conflict (id) do nothing;

create table if not exists keepa_token_usage_log (
  id uuid primary key default gen_random_uuid(),
  called_at timestamptz not null default now(),
  triggered_by text not null check (triggered_by in ('cron_cheap','cron_buybox','on_demand_search')),
  asin text,
  tokens_before integer,
  tokens_after integer,
  tokens_consumed integer,
  success boolean not null default true,
  error_message text
);

-- ---------------------------------------------------------
-- Limite de ASINs monitorados por cliente — via trigger, não
-- CHECK (Postgres não permite agregação entre linhas num CHECK)
-- e não só client-side (seria contornável direto no console).
-- security definer porque keepa_config não tem SELECT liberado
-- pro cliente comum (só admin) — não reintroduz o bug de
-- recursão do v4 porque a leitura aqui é da própria
-- keepa_tracked_asins filtrada por user_id = new.user_id, o
-- mesmo escopo que a política RLS do cliente já concede.
-- ---------------------------------------------------------
create or replace function keepa_enforce_tracked_asin_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_count integer;
  cap integer;
begin
  select max_tracked_asins_per_client into cap from keepa_config where id = 1;
  select count(*) into current_count from keepa_tracked_asins
    where user_id = new.user_id and active = true;
  if current_count >= cap then
    raise exception 'Limite de % ASINs monitorados atingido para este cliente.', cap using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_keepa_tracked_asin_cap on keepa_tracked_asins;
create trigger trg_keepa_tracked_asin_cap
before insert on keepa_tracked_asins
for each row execute function keepa_enforce_tracked_asin_cap();

-- ---------------------------------------------------------
-- RLS
-- ---------------------------------------------------------
alter table keepa_config enable row level security;
alter table keepa_tracked_asins enable row level security;
alter table keepa_asin_cache enable row level security;
alter table keepa_asin_alerts enable row level security;
alter table keepa_search_log enable row level security;
alter table keepa_token_budget enable row level security;
alter table keepa_token_usage_log enable row level security;

-- keepa_tracked_asins: dono faz CRUD, desde que aprovado (ou admin)
drop policy if exists "keepa_tracked_asins: aprovado ou admin" on keepa_tracked_asins;
create policy "keepa_tracked_asins: aprovado ou admin" on keepa_tracked_asins
  for all using (
    yalca_is_admin(auth.uid())
    or (auth.uid() = user_id and exists (select 1 from client_profiles cp where cp.user_id = auth.uid() and cp.status = 'approved'))
  )
  with check (
    yalca_is_admin(auth.uid())
    or (auth.uid() = user_id and exists (select 1 from client_profiles cp where cp.user_id = auth.uid() and cp.status = 'approved'))
  );

-- keepa_asin_cache / keepa_asin_alerts: dado público da Amazon —
-- leitura pra qualquer cliente aprovado ou admin; escrita só pelo
-- service_role (sem política de insert/update pro cliente comum)
drop policy if exists "keepa_asin_cache: leitura aprovado ou admin" on keepa_asin_cache;
create policy "keepa_asin_cache: leitura aprovado ou admin" on keepa_asin_cache
  for select using (
    yalca_is_admin(auth.uid())
    or exists (select 1 from client_profiles cp where cp.user_id = auth.uid() and cp.status = 'approved')
  );

drop policy if exists "keepa_asin_alerts: leitura aprovado ou admin" on keepa_asin_alerts;
create policy "keepa_asin_alerts: leitura aprovado ou admin" on keepa_asin_alerts
  for select using (
    yalca_is_admin(auth.uid())
    or exists (select 1 from client_profiles cp where cp.user_id = auth.uid() and cp.status = 'approved')
  );

-- keepa_search_log: cliente só lê as próprias linhas (pra UI
-- mostrar "X de Y pesquisas usadas hoje"); só a Edge Function escreve
drop policy if exists "keepa_search_log: le a propria" on keepa_search_log;
create policy "keepa_search_log: le a propria" on keepa_search_log
  for select using (auth.uid() = user_id);

-- keepa_config / keepa_token_budget: só admin lê; ninguém do lado
-- do cliente escreve (só service_role, que ignora RLS)
drop policy if exists "keepa_config: leitura admin" on keepa_config;
create policy "keepa_config: leitura admin" on keepa_config
  for select using (yalca_is_admin(auth.uid()));

drop policy if exists "keepa_token_budget: leitura admin" on keepa_token_budget;
create policy "keepa_token_budget: leitura admin" on keepa_token_budget
  for select using (yalca_is_admin(auth.uid()));

-- keepa_token_usage_log: sem política pro cliente nesta v1 (só
-- acessível via SQL direto/service_role) — é log interno de custo.

create index if not exists idx_keepa_tracked_user on keepa_tracked_asins(user_id);
create index if not exists idx_keepa_cache_cheap_age on keepa_asin_cache(cheap_data_updated_at);
