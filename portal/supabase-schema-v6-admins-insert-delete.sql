-- =========================================================
-- Yalca Portal — v6: permite promover/remover admin pela UI
-- Rode este script no SQL Editor DEPOIS do v5
--
-- Bug: a tabela "admins" nunca teve política de INSERT nem
-- DELETE (só SELECT, adicionada no v2/v5). Com RLS habilitado
-- e sem política, toda tentativa de INSERT/DELETE é negada por
-- padrão — então os botões "Tornar admin" e "Remover admin" do
-- painel administrativo falhavam silenciosamente (o app mostra
-- um alert() com o erro, mas nada muda no banco).
--
-- Corrigido: qualquer admin (via a função yalca_is_admin, que
-- já existe desde o v5 e evita a recursão) pode promover um
-- cliente aprovado a admin, ou remover o acesso de outro admin.
-- =========================================================

drop policy if exists "admin promove novo admin" on admins;
create policy "admin promove novo admin" on admins
  for insert with check (yalca_is_admin(auth.uid()));

drop policy if exists "admin remove outro admin" on admins;
create policy "admin remove outro admin" on admins
  for delete using (yalca_is_admin(auth.uid()));
