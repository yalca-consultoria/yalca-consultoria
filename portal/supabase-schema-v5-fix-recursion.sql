-- =========================================================
-- Yalca Portal — v5: corrige recursão infinita na política
-- de "admins" introduzida pelo v4
-- Rode este script no SQL Editor DEPOIS do v4
--
-- Bug do v4: a política nova fazia "admins" consultar a
-- própria tabela "admins" dentro do USING. O Postgres não
-- consegue resolver isso (para avaliar a política ele precisa
-- reavaliar a política) e retorna:
--   42P17: infinite recursion detected in policy for relation "admins"
--
-- Correção padrão: mover a checagem para uma função
-- SECURITY DEFINER. Uma função assim roda com os privilégios
-- do dono (bypassa RLS internamente), então a subquery dentro
-- dela não reaciona a política — quebrando a recursão.
-- =========================================================

create or replace function yalca_is_admin(uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists(select 1 from admins where user_id = uid);
$$;

drop policy if exists "admin ve todas as linhas" on admins;
create policy "admin ve todas as linhas" on admins
  for select using (yalca_is_admin(auth.uid()));
