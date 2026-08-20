-- =========================================================
-- Yalca Portal — v8: aproveita ao máximo os dados que o Keepa
-- já devolve na consulta de produto (sem custo novo de token),
-- mais reputação de vendedor sob demanda (custo separado,
-- claramente sinalizado — 1 token por vendedor consultado)
-- Rode este script no SQL Editor DEPOIS do v7
-- =========================================================

-- ---------------------------------------------------------
-- Campos novos em keepa_asin_cache — tudo já vem na mesma
-- resposta que a busca sob demanda já paga hoje
-- (stats=180&buybox=1&offers=20&rating=1), só não estava
-- sendo lido. "offers" e "category_ranks" ficam como jsonb
-- (substituídos por inteiro a cada refresh, mesmo padrão já
-- usado em price_history) — não normaliza em tabela filha
-- porque nada no app faz query cross-ASIN em SQL.
-- ---------------------------------------------------------
alter table keepa_asin_cache add column if not exists monthly_sold integer;
alter table keepa_asin_cache add column if not exists referral_fee_pct numeric(5,2);
alter table keepa_asin_cache add column if not exists fba_pick_pack_fee numeric;
alter table keepa_asin_cache add column if not exists fba_pick_pack_fee_tax numeric;
alter table keepa_asin_cache add column if not exists fba_storage_fee numeric;
alter table keepa_asin_cache add column if not exists fba_storage_fee_tax numeric;
alter table keepa_asin_cache add column if not exists offers jsonb not null default '[]';
alter table keepa_asin_cache add column if not exists buybox_rotation_90d integer;
alter table keepa_asin_cache add column if not exists category_ranks jsonb not null default '[]';

-- ---------------------------------------------------------
-- Cache de reputação de vendedor — mesmo princípio de cache
-- compartilhado do keepa_asin_cache: um vendedor é consultado
-- uma vez e reaproveitado por qualquer cliente que peça depois,
-- inclusive "não encontrado" (pra nunca pagar duas vezes pelo
-- mesmo resultado negativo).
-- ---------------------------------------------------------
create table if not exists keepa_seller_cache (
  seller_id text primary key,
  seller_name text,
  current_rating numeric,
  current_rating_count integer,
  has_fba boolean,
  rating_breakdown jsonb,
  tracked_since_raw bigint,
  fetched_at timestamptz not null default now(),
  last_error text
);

alter table keepa_seller_cache enable row level security;

drop policy if exists "keepa_seller_cache: leitura aprovado ou admin" on keepa_seller_cache;
create policy "keepa_seller_cache: leitura aprovado ou admin" on keepa_seller_cache
  for select using (
    yalca_is_admin(auth.uid())
    or exists (select 1 from client_profiles cp where cp.user_id = auth.uid() and cp.status = 'approved')
  );

-- ---------------------------------------------------------
-- Configuração nova: teto de idade do cache de vendedor e
-- limite diário de vendedores consultados por cliente (conta
-- vendedores, não cliques — um clique pode pedir vários de uma vez)
-- ---------------------------------------------------------
alter table keepa_config add column if not exists seller_reputation_cache_max_age_days integer not null default 30;
alter table keepa_config add column if not exists max_seller_lookups_per_client_per_day integer not null default 50;

-- ---------------------------------------------------------
-- keepa_token_usage_log: precisa saber DE QUEM foi o gasto de
-- reputação de vendedor (pra aplicar o limite diário por
-- cliente) — as outras chamadas (cron, busca de produto) não
-- precisavam disso porque o teto delas é global, não por cliente.
-- ---------------------------------------------------------
alter table keepa_token_usage_log add column if not exists user_id uuid references auth.users(id);
create index if not exists idx_keepa_token_usage_user_day on keepa_token_usage_log(user_id, called_at);

alter table keepa_token_usage_log drop constraint if exists keepa_token_usage_log_triggered_by_check;
alter table keepa_token_usage_log add constraint keepa_token_usage_log_triggered_by_check
  check (triggered_by = any (array['cron_cheap','cron_buybox','on_demand_search','on_demand_seller_lookup']));
