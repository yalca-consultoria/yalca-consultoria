-- =========================================================
-- Yalca Portal — v20: adiciona "marca" como tipo de busca válido
-- Rode este script no SQL Editor DEPOIS do v19
--
-- Bug real (2026-08-30): ao adicionar "marca" como novo tipo de busca
-- no código, esqueci de atualizar o CHECK constraint de
-- anvisa_query_cache.tipo — a busca na Anvisa funcionava (dado real
-- voltava certinho), mas salvar no cache falhava com violação de
-- constraint, e como não estava num try/catch isolado, derrubava a
-- resposta inteira com "Erro interno" mesmo tendo o resultado em mãos.
-- =========================================================

alter table anvisa_query_cache drop constraint if exists anvisa_query_cache_tipo_check;
alter table anvisa_query_cache add constraint anvisa_query_cache_tipo_check
  check (tipo in ('cnpj','nome','marca','registro','processo'));
