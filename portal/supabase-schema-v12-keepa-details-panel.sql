-- =========================================================
-- Yalca Portal — v12: campos pro painel "Detalhes do Produto"
-- Rode este script no SQL Editor DEPOIS do v11
--
-- category_breadcrumb: trilha completa de categorias (ex: ["Saúde e
-- Bem-Estar", "Vitaminas e Suplementos"]), não só a última — usado no
-- painel de detalhes estilo Keepa. ean: primeiro código de barras
-- (EAN/UPC) do produto, já usado hoje só pra fazer a busca reversa por
-- código de barras encontrar o ASIN — agora também exibido no painel.
-- =========================================================

alter table keepa_asin_cache
  add column if not exists category_breadcrumb jsonb not null default '[]',
  add column if not exists ean text;
