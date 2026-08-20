-- =========================================================
-- Yalca Portal — v4: corrige a política da tabela admins
-- Rode este script no SQL Editor DEPOIS do v1/v2/v3
--
-- Bug: a política original só deixava cada admin ver a
-- PRÓPRIA linha em "admins" ("o suficiente para os checks
-- das outras tabelas" — mas não é suficiente para a tela
-- "Administradores" do painel, que precisa listar todos os
-- administradores). Corrigido para qualquer admin ver todas
-- as linhas.
-- =========================================================

drop policy if exists "admin ve a propria linha" on admins;
create policy "admin ve todas as linhas" on admins
  for select using (
    exists (select 1 from admins a where a.user_id = auth.uid())
  );
