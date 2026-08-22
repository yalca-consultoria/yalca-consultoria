-- =========================================================
-- Yalca Portal — v17: limite por rodada do cron de "Meus Anúncios"
-- Rode este script no SQL Editor DEPOIS do v16
--
-- Antes, o cron só respeitava o limite DIÁRIO (keepa_config.daily_token_cap)
-- — uma única rodada horária podia gastar a cota inteira do dia de uma vez
-- (ex: 15 produtos vencidos ao mesmo tempo), deixando zero saldo pras
-- pesquisas ao vivo do cliente no resto do dia. Esse novo limite faz o
-- cron carregar "Meus Anúncios" aos poucos, espalhado pelas 24 rodadas do
-- dia, sempre sobrando cota pra pesquisa.
-- =========================================================

alter table keepa_config
  add column if not exists max_tokens_per_cron_run integer not null default 20;
