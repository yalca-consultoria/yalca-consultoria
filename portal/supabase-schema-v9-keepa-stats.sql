-- =========================================================
-- Yalca Portal — v9: estatísticas comparativas (stats.*) e
-- ficha técnica do produto — tudo já vem na mesma resposta
-- que a busca sob demanda já paga hoje (stats=180&buybox=1&
-- offers=20&rating=1), zero custo novo de token. Rode este
-- script no SQL Editor DEPOIS do v8.
--
-- price_history muda de FORMA (de array único pra objeto
-- {amazon,new,buybox}, uma série por linha do gráfico) — como
-- é só cache, não precisa migrar linhas antigas: zeramos a
-- tabela e ela se repopula sozinha no próximo refresh/busca.
-- =========================================================

alter table keepa_asin_cache add column if not exists bsr_history jsonb not null default '[]';
alter table keepa_asin_cache add column if not exists brand text;
alter table keepa_asin_cache add column if not exists listed_since timestamptz;
alter table keepa_asin_cache add column if not exists package_weight_kg numeric;
alter table keepa_asin_cache add column if not exists package_length_cm numeric;
alter table keepa_asin_cache add column if not exists package_width_cm numeric;
alter table keepa_asin_cache add column if not exists package_height_cm numeric;

alter table keepa_asin_cache add column if not exists price_avg_30 numeric;
alter table keepa_asin_cache add column if not exists price_avg_90 numeric;
alter table keepa_asin_cache add column if not exists price_avg_180 numeric;
alter table keepa_asin_cache add column if not exists price_lowest_ever jsonb;
alter table keepa_asin_cache add column if not exists price_highest_ever jsonb;
alter table keepa_asin_cache add column if not exists is_lowest_ever boolean;
alter table keepa_asin_cache add column if not exists is_lowest_90d boolean;
alter table keepa_asin_cache add column if not exists out_of_stock_pct_30 integer;
alter table keepa_asin_cache add column if not exists out_of_stock_pct_90 integer;
alter table keepa_asin_cache add column if not exists sales_rank_drops_30 integer;
alter table keepa_asin_cache add column if not exists sales_rank_drops_90 integer;
alter table keepa_asin_cache add column if not exists sales_rank_drops_180 integer;
alter table keepa_asin_cache add column if not exists buybox_stats jsonb not null default '[]';

-- price_history muda de forma (array -> objeto); linhas antigas em cache
-- ficariam com o formato errado até o próximo refresh natural — como é
-- puro cache e não há uso real em produção ainda (KEEPA_MOCK=true), é
-- mais simples zerar do que escrever código defensivo pras duas formas.
truncate table keepa_asin_cache;

-- ---------------------------------------------------------
-- keepa_seller_cache: total de produtos ativos do vendedor —
-- sinal de legitimidade (loja de verdade vs. conta nova/pequena).
-- ---------------------------------------------------------
alter table keepa_seller_cache add column if not exists total_storefront_asins integer;
