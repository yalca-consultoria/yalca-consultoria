-- =========================================================
-- Yalca Portal — v3: observações internas por cliente
-- Rode no SQL Editor depois do v1 e do v2.
-- Não precisa de política nova: a coluna já fica protegida
-- pela mesma regra que só deixa administradores atualizarem
-- client_profiles.
-- =========================================================

alter table client_profiles add column if not exists admin_notes text default '';
