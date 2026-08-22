-- =========================================================
-- Yalca Portal — v15: cor/tamanho e desconto ativo
-- Rode este script no SQL Editor DEPOIS do v14
--
-- Campos identificados como essenciais na exportação completa do Keepa
-- (arquivo do cliente, 2026-08-22) que já vinham no mesmo request de
-- sempre (stats=180&buybox=1&offers=20&rating=1) sem custo extra de
-- token — só não estavam sendo guardados:
--   - color / size: distingue variações (cor/tamanho) na lista de
--     produtos monitorados, útil quando o mesmo título tem várias
--     variações cadastradas.
--   - saving_basis / saving_pct: preço "riscado" (de/por) e o %, quando
--     a Amazon está com desconto ativo no produto agora.
-- total_offer_count já existe desde o v13.
-- =========================================================

alter table keepa_asin_cache
  add column if not exists color text,
  add column if not exists size text,
  add column if not exists saving_basis numeric,
  add column if not exists saving_pct integer;
