-- =========================================================
-- Yalca Portal — v14: "Meus Anúncios" via vitrine do vendedor
-- Rode este script no SQL Editor DEPOIS do v13
--
-- Antes, o cliente adicionava ASIN por ASIN à mão. Agora o ADMIN cadastra
-- o seller ID (código do vendedor) da Amazon do cliente uma única vez, e
-- o sistema sincroniza a vitrine inteira (todos os produtos daquele
-- vendedor) via Keepa (/seller com storefront=1 — barato, não custa token
-- extra por ASIN retornado, só o custo normal de 1 lookup de vendedor).
-- Os ASINs da vitrine viram linhas em keepa_tracked_asins (mesma tabela
-- de sempre), e o refresh de preço/BSR de cada um continua no cron
-- horário já existente, budget-aware.
-- =========================================================

alter table client_profiles
  add column if not exists amazon_seller_id text;

-- Novo valor de triggered_by pro log de uso de tokens (mesmo padrão do v8,
-- que já tinha estendido essa constraint pra 'on_demand_seller_lookup').
alter table keepa_token_usage_log drop constraint if exists keepa_token_usage_log_triggered_by_check;
alter table keepa_token_usage_log add constraint keepa_token_usage_log_triggered_by_check
  check (triggered_by = any (array['cron_cheap','cron_buybox','on_demand_search','on_demand_seller_lookup','seller_storefront_sync']));

-- ---------------------------------------------------------
-- Métricas de desempenho do vendedor (vitrine), uma linha por cliente
-- ---------------------------------------------------------
create table if not exists keepa_seller_metrics (
  user_id uuid primary key references auth.users(id),
  seller_id text not null,
  seller_name text,
  business_name text,
  address text,
  trade_number text,
  current_rating integer,
  current_rating_count integer,
  has_fba boolean,
  buybox_new_ownership_pct integer,
  buybox_used_ownership_pct integer,
  avg_buybox_competitors numeric,
  tracked_since timestamptz,
  total_storefront_asins integer,
  category_stats jsonb not null default '[]',
  brand_stats jsonb not null default '[]',
  last_synced_at timestamptz not null default now(),
  last_error text
);

alter table keepa_seller_metrics enable row level security;

drop policy if exists "keepa_seller_metrics: le a propria ou admin" on keepa_seller_metrics;
create policy "keepa_seller_metrics: le a propria ou admin" on keepa_seller_metrics
  for select using (auth.uid() = user_id or yalca_is_admin(auth.uid()));

-- Sem política de insert/update/delete pro cliente/admin comum — só o
-- endpoint do backend (service_role, via /keepa-sync-storefront) escreve.

-- Novo tipo de ação no log de auditoria do admin (mesmo padrão do v10).
alter table admin_audit_log drop constraint if exists admin_audit_log_action_check;
alter table admin_audit_log add constraint admin_audit_log_action_check
  check (action in ('approve_client','block_client','delete_client','promote_admin','remove_admin','edit_notes','set_seller_id'));
