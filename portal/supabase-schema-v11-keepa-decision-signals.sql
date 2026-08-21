-- =========================================================
-- Yalca Portal — v11: mais sinais de decisão na Pesquisa de Produto
-- Rode este script no SQL Editor DEPOIS do v10
--
-- Campos novos vindos direto do Product Object oficial do Keepa
-- (github.com/keepacom/api_backend), até então não capturados:
--   - returnRate: taxa de devolução do produto (risco de margem que o
--     preço sozinho não mostra).
--   - isRedirectASIN: o anúncio foi fundido/descontinuado e redirecionado
--     — sinal crítico pra não comprar estoque pra esse ASIN.
--   - parentAsin / variations: o produto compete junto com outras
--     variações (cor/tamanho).
--   - competitivePriceThreshold / suggestedLowerPrice: só vêm quando a
--     Amazon SUPRIME a buybox por preço fora da faixa — o sinal mais
--     direto que existe de "esse preço planejado está errado".
--   - offerCountFBA / offerCountFBM: divisão real da concorrência (10
--     ofertas FBA disputando buybox é bem diferente de 10 FBM).
--   - deltaPercent90_monthlySold: tendência (crescendo ou murchando).
--   - buyBoxIsUnqualified / buyBoxIsMAP: ganhar a buybox "não qualificado"
--     é sinal de disputa de preço instável ali.
-- =========================================================

alter table keepa_asin_cache
  add column if not exists return_rate text,
  add column if not exists is_redirect_asin boolean not null default false,
  add column if not exists parent_asin text,
  add column if not exists variations_count integer,
  add column if not exists competitive_price_threshold numeric,
  add column if not exists suggested_lower_price numeric,
  add column if not exists offer_count_fba integer,
  add column if not exists offer_count_fbm integer,
  add column if not exists delta_pct_90_monthly_sold integer,
  add column if not exists buybox_is_unqualified boolean,
  add column if not exists buybox_is_map boolean;
