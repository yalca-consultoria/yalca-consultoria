-- =========================================================
-- Yalca Portal — schema do Supabase
-- Rode este script inteiro em: Supabase > SQL Editor > New query
-- Cria as tabelas e as regras de segurança (RLS) que garantem
-- que cada cliente só veja e edite os próprios dados.
-- =========================================================

-- PRODUTOS / SKUs
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  sku text not null,
  name text not null,
  marketplace text not null,
  category text default '',
  cost numeric not null default 0,
  price numeric not null default 0,
  stock integer not null default 0,
  min_stock integer not null default 0,
  units_sold_month integer not null default 0,
  status text not null default 'Ativo',
  created_at timestamptz not null default now()
);

-- LANÇAMENTOS FINANCEIROS (receitas e despesas)
create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  date date not null,
  type text not null check (type in ('receita', 'despesa')),
  category text not null default 'Outros',
  marketplace text default '-',
  description text default '',
  amount numeric not null default 0,
  created_at timestamptz not null default now()
);

-- LANÇAMENTOS FUTUROS (fluxo de caixa)
create table if not exists planned_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  date date not null,
  description text default '',
  amount numeric not null default 0,
  created_at timestamptz not null default now()
);

-- CONFIGURAÇÕES DO CLIENTE (1 linha por cliente)
create table if not exists client_settings (
  user_id uuid primary key references auth.users(id) default auth.uid(),
  client_name text not null default 'Minha Loja',
  cash_balance numeric not null default 0,
  default_tax_pct numeric not null default 6,
  default_shipping_cost numeric not null default 12,
  marketplace_fees jsonb not null default '{"Mercado Livre":14,"Amazon":15,"Shopee":16,"Shopify":4,"Nuvemshop":4}'
);

-- =========================================================
-- ROW LEVEL SECURITY — cada cliente só acessa suas próprias linhas
-- =========================================================
alter table products enable row level security;
alter table transactions enable row level security;
alter table planned_entries enable row level security;
alter table client_settings enable row level security;

create policy "products: somente do próprio cliente" on products
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "transactions: somente do próprio cliente" on transactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "planned_entries: somente do próprio cliente" on planned_entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "client_settings: somente do próprio cliente" on client_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =========================================================
-- Índices úteis
-- =========================================================
create index if not exists idx_products_user on products(user_id);
create index if not exists idx_transactions_user on transactions(user_id);
create index if not exists idx_planned_entries_user on planned_entries(user_id);
