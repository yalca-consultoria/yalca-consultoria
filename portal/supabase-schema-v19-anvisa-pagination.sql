-- =========================================================
-- Yalca Portal — v19: paginação real na Consulta Anvisa
-- Rode este script no SQL Editor DEPOIS do v18
--
-- Guarda o total de páginas/resultados junto com o cache da página 1,
-- pra UI poder mostrar "12 resultados, mostrando 10" e pedir a página
-- seguinte sem precisar adivinhar. Achado testando a API real: o
-- parâmetro "size" precisa ir na raiz do corpo da requisição, não
-- dentro de "filter" — sem isso a Anvisa sempre volta 10 por página
-- (default dela) e não expõe o total pro cliente saber que tem mais.
-- =========================================================

alter table anvisa_query_cache add column if not exists total_elements integer;
alter table anvisa_query_cache add column if not exists total_pages integer;
