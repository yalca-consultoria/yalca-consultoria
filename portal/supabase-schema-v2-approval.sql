-- =========================================================
-- Yalca Portal — v2: autoatendimento + aprovação de clientes
-- Rode este script no SQL Editor DEPOIS do supabase-schema.sql
-- (aquele já criou products/transactions/planned_entries/client_settings)
-- =========================================================

-- Perfil de cada cliente (guarda o status de aprovação)
create table if not exists client_profiles (
  user_id uuid primary key references auth.users(id) default auth.uid(),
  email text not null,
  store_name text default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'blocked')),
  created_at timestamptz not null default now()
);

-- Lista de administradores (só a Yalca deve estar aqui — você adiciona manualmente)
create table if not exists admins (
  user_id uuid primary key references auth.users(id)
);

alter table client_profiles enable row level security;
alter table admins enable row level security;

-- Um cliente pode criar e ver o PRÓPRIO perfil, mas nunca alterar o status sozinho
drop policy if exists "cliente cria o proprio perfil" on client_profiles;
create policy "cliente cria o proprio perfil" on client_profiles
  for insert with check (auth.uid() = user_id);

drop policy if exists "cliente ve o proprio perfil" on client_profiles;
create policy "cliente ve o proprio perfil" on client_profiles
  for select using (auth.uid() = user_id);

-- Administradores veem e atualizam o perfil de qualquer cliente
drop policy if exists "admin ve todos os perfis" on client_profiles;
create policy "admin ve todos os perfis" on client_profiles
  for select using (exists (select 1 from admins a where a.user_id = auth.uid()));

drop policy if exists "admin atualiza qualquer perfil" on client_profiles;
create policy "admin atualiza qualquer perfil" on client_profiles
  for update using (exists (select 1 from admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from admins a where a.user_id = auth.uid()));

-- Cada admin só enxerga a própria linha na tabela admins (o suficiente para os checks acima)
drop policy if exists "admin ve a propria linha" on admins;
create policy "admin ve a propria linha" on admins
  for select using (auth.uid() = user_id);

-- =========================================================
-- Atualiza as regras das tabelas de dados: só quem está
-- APROVADO (ou é administrador) consegue ler/gravar
-- =========================================================
drop policy if exists "products: somente do próprio cliente" on products;
drop policy if exists "products: aprovado ou admin" on products;
create policy "products: aprovado ou admin" on products
  for all using (
    exists (select 1 from admins a where a.user_id = auth.uid())
    or (auth.uid() = user_id and exists (select 1 from client_profiles cp where cp.user_id = auth.uid() and cp.status = 'approved'))
  )
  with check (
    exists (select 1 from admins a where a.user_id = auth.uid())
    or (auth.uid() = user_id and exists (select 1 from client_profiles cp where cp.user_id = auth.uid() and cp.status = 'approved'))
  );

drop policy if exists "transactions: somente do próprio cliente" on transactions;
drop policy if exists "transactions: aprovado ou admin" on transactions;
create policy "transactions: aprovado ou admin" on transactions
  for all using (
    exists (select 1 from admins a where a.user_id = auth.uid())
    or (auth.uid() = user_id and exists (select 1 from client_profiles cp where cp.user_id = auth.uid() and cp.status = 'approved'))
  )
  with check (
    exists (select 1 from admins a where a.user_id = auth.uid())
    or (auth.uid() = user_id and exists (select 1 from client_profiles cp where cp.user_id = auth.uid() and cp.status = 'approved'))
  );

drop policy if exists "planned_entries: somente do próprio cliente" on planned_entries;
drop policy if exists "planned_entries: aprovado ou admin" on planned_entries;
create policy "planned_entries: aprovado ou admin" on planned_entries
  for all using (
    exists (select 1 from admins a where a.user_id = auth.uid())
    or (auth.uid() = user_id and exists (select 1 from client_profiles cp where cp.user_id = auth.uid() and cp.status = 'approved'))
  )
  with check (
    exists (select 1 from admins a where a.user_id = auth.uid())
    or (auth.uid() = user_id and exists (select 1 from client_profiles cp where cp.user_id = auth.uid() and cp.status = 'approved'))
  );

drop policy if exists "client_settings: somente do próprio cliente" on client_settings;
drop policy if exists "client_settings: aprovado ou admin" on client_settings;
create policy "client_settings: aprovado ou admin" on client_settings
  for all using (
    exists (select 1 from admins a where a.user_id = auth.uid())
    or (auth.uid() = user_id and exists (select 1 from client_profiles cp where cp.user_id = auth.uid() and cp.status = 'approved'))
  )
  with check (
    exists (select 1 from admins a where a.user_id = auth.uid())
    or (auth.uid() = user_id and exists (select 1 from client_profiles cp where cp.user_id = auth.uid() and cp.status = 'approved'))
  );

-- =========================================================
-- IMPORTANTE — depois de rodar este script, transforme o SEU
-- usuário em administrador (troque o e-mail abaixo pelo seu):
--
--   insert into admins (user_id)
--   select id from auth.users where email = 'seu-email-de-teste@aqui.com';
--
-- =========================================================
