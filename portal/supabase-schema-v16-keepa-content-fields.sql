-- =========================================================
-- Yalca Portal — v16: descrição, ficha técnica e sinalizadores de risco
-- Rode este script no SQL Editor DEPOIS do v15
--
-- Mais campos identificados na exportação completa do Keepa (arquivo do
-- cliente, "Grupo Fenelon", 2026-08-22) que vêm no mesmo request de sempre
-- (stats=180&buybox=1&offers=20&rating=1), sem custo extra de token:
--   - description / features: conteúdo descritivo do anúncio (texto +
--     bullets), útil pro popup de detalhe de cada produto monitorado.
--   - manufacturer / model / number_of_items: ficha técnica.
--   - list_price: preço de lista (MSRP), referência de desconto diferente
--     da média de 90 dias.
--   - batteries_required / batteries_included / is_adult_product: sinais
--     de risco logístico/regulatório na hora de decidir revender.
-- =========================================================

alter table keepa_asin_cache
  add column if not exists description text,
  add column if not exists features jsonb,
  add column if not exists manufacturer text,
  add column if not exists model text,
  add column if not exists number_of_items integer,
  add column if not exists list_price numeric,
  add column if not exists batteries_required boolean,
  add column if not exists batteries_included boolean,
  add column if not exists is_adult_product boolean;
