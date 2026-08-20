-- =========================================================
-- Yalca — painel de IA pessoal (ia.yalca.com.br)
-- Mesmo Supabase self-hosted do resto do site (um login só em toda a
-- yalca.com.br), mas com tabelas de aprovação PRÓPRIAS (ia_profiles/
-- ia_admins) — de propósito separadas de client_profiles/admins do
-- portal da Yalca, pra um cliente do portal não ganhar acesso automático
-- a esse painel pessoal, e vice-versa.
-- =========================================================

create table if not exists ia_profiles (
  user_id uuid primary key default auth.uid() references auth.users(id),
  email text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'blocked')),
  created_at timestamptz not null default now()
);
alter table ia_profiles enable row level security;

create table if not exists ia_admins (
  user_id uuid primary key references auth.users(id)
);
alter table ia_admins enable row level security;

create or replace function ia_is_admin(uid uuid) returns boolean
language sql security definer stable as $$
  select exists(select 1 from ia_admins where user_id = uid);
$$;

drop policy if exists "ia_profiles: self ou admin le" on ia_profiles;
create policy "ia_profiles: self ou admin le" on ia_profiles
  for select using (auth.uid() = user_id or ia_is_admin(auth.uid()));

drop policy if exists "ia_profiles: self insere a propria linha" on ia_profiles;
create policy "ia_profiles: self insere a propria linha" on ia_profiles
  for insert with check (auth.uid() = user_id);

drop policy if exists "ia_profiles: admin atualiza" on ia_profiles;
create policy "ia_profiles: admin atualiza" on ia_profiles
  for update using (ia_is_admin(auth.uid()));

drop policy if exists "ia_admins: leitura admin" on ia_admins;
create policy "ia_admins: leitura admin" on ia_admins
  for select using (ia_is_admin(auth.uid()));

-- yanderson (mesma conta já usada no resto do site) já entra aprovado e admin.
insert into ia_admins (user_id)
  select id from auth.users where email = 'yanderson@protonmail.com'
  on conflict do nothing;
insert into ia_profiles (user_id, email, status)
  select id, email, 'approved' from auth.users where email = 'yanderson@protonmail.com'
  on conflict (user_id) do update set status = 'approved';
