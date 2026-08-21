-- =========================================================
-- Yalca Portal — v13: contagem oficial de ofertas
-- Rode este script no SQL Editor DEPOIS do v12
--
-- total_offer_count vem de stats.totalOfferCount (Keepa) — é a métrica
-- que realmente soma igual a offerCountFBA + offerCountFBM. O campo
-- top-level "offersCount" do produto mede outra coisa e podia aparecer
-- inconsistente na tela (ex: "9 ofertas ativas" vs "2 FBA + 5 FBM").
-- =========================================================

alter table keepa_asin_cache
  add column if not exists total_offer_count integer;
