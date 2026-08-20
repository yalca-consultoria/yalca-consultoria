-- =========================================================
-- Yalca Portal — v7: área do cliente 2.0
-- Rode este script no SQL Editor DEPOIS dos anteriores (v1 a v6).
--
-- Tudo aqui é OPCIONAL: o painel detecta automaticamente se
-- estas colunas existem e funciona sem elas (só esconde os
-- recursos novos). Rodando o script, o cliente ganha:
--   • metas mensais de faturamento e lucro
--   • custos fixos e ponto de equilíbrio
--   • margem alvo usada na reprecificação
--   • parâmetros de reposição de estoque
--   • frete e comissão por produto (não só o padrão da loja)
--   • lançamentos futuros recorrentes
-- =========================================================

-- ---------- Configurações da loja ----------
alter table client_settings add column if not exists monthly_revenue_goal numeric not null default 0;
alter table client_settings add column if not exists monthly_profit_goal  numeric not null default 0;
alter table client_settings add column if not exists fixed_costs_monthly  numeric not null default 0;
alter table client_settings add column if not exists target_margin_pct    numeric not null default 20;
alter table client_settings add column if not exists stock_lead_time_days integer not null default 15;
alter table client_settings add column if not exists stock_cover_days     integer not null default 30;

-- Taxas customizadas da calculadora de precificação (por cliente).
alter table client_settings add column if not exists pricing_overrides jsonb;

-- ---------- Produtos ----------
-- Nulo = usa o padrão da loja (default_shipping_cost / marketplace_fees).
alter table products add column if not exists shipping_cost numeric;
alter table products add column if not exists fee_pct       numeric;

-- ---------- Lançamentos futuros ----------
-- 0 = evento único. N = repete pelos próximos N meses.
alter table planned_entries add column if not exists repeat_months integer not null default 0;

-- ---------- Índices de leitura ----------
create index if not exists idx_transactions_user_date on transactions(user_id, date);
create index if not exists idx_products_user_marketplace on products(user_id, marketplace);
create index if not exists idx_planned_entries_user_date on planned_entries(user_id, date);
