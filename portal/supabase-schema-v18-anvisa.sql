-- =========================================================
-- Yalca Portal — v18: Consulta Anvisa
-- Rode este script no SQL Editor DEPOIS do v17
--
-- Mesmo desenho geral do v7 (Keepa) — cache compartilhado, log
-- por cliente, orçamento diário — só que mais simples: a API da
-- Anvisa é gratuita, então "orçamento" aqui é só um contador de
-- requisições/dia, não uma economia de tokens variável por chamada.
--
-- Diferença de acesso deliberada: ao contrário de todas as outras
-- tabelas de dado do portal (produtos, transações, keepa_*), a
-- leitura aqui é liberada pra QUALQUER cliente autenticado, não só
-- aprovado — decisão do usuário, 2026-08-30: consulta Anvisa é
-- informação pública do órgão regulador, não expõe nada sensível do
-- negócio do próprio cliente, então faz sentido liberar mais cedo
-- no funil (mesma lógica não se aplica ao resto do portal).
--
-- Só a categoria "alimentos" está implementada nesta versão —
-- coluna `categoria` já existe em toda tabela pra as próximas
-- categorias (medicamentos, cosméticos) entrarem sem migração nova.
-- =========================================================

-- ---------------------------------------------------------
-- Configuração (linha única, ajustável)
-- ---------------------------------------------------------
create table if not exists anvisa_config (
  id smallint primary key default 1 check (id = 1),
  daily_request_cap integer not null default 500,
  max_searches_per_client_per_day integer not null default 20,
  query_cache_max_age_hours integer not null default 24,
  updated_at timestamptz not null default now()
);
insert into anvisa_config (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------
-- Cache compartilhado entre clientes, chaveado por
-- categoria + tipo de busca + valor normalizado (não por
-- cliente) — dois clientes pesquisando o mesmo CNPJ usam o
-- mesmo registro.
-- ---------------------------------------------------------
create table if not exists anvisa_query_cache (
  cache_key text primary key,
  categoria text not null,
  tipo text not null check (tipo in ('cnpj','nome','registro','processo')),
  valor text not null,
  results jsonb not null default '[]',
  fetched_at timestamptz not null default now()
);
create index if not exists idx_anvisa_cache_categoria on anvisa_query_cache(categoria);

-- ---------------------------------------------------------
-- Log de consultas por cliente — usado pro limite diário e
-- pra auditoria/depuração de erros
-- ---------------------------------------------------------
create table if not exists anvisa_query_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  categoria text not null,
  tipo text not null,
  resulted_in_live_call boolean not null default false,
  success boolean not null default true,
  error_message text,
  searched_at timestamptz not null default now()
);
create index if not exists idx_anvisa_query_log_user_day on anvisa_query_log(user_id, searched_at);

-- ---------------------------------------------------------
-- Orçamento diário de requisições (compartilhado entre todas
-- as categorias) — bem mais simples que o keepa_token_budget
-- porque a API da Anvisa não tem custo variável por chamada.
-- ---------------------------------------------------------
create table if not exists anvisa_request_budget (
  id smallint primary key default 1 check (id = 1),
  requests_spent_today integer not null default 0,
  spend_day date not null default current_date,
  last_checked_at timestamptz
);
insert into anvisa_request_budget (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------
-- RLS
-- ---------------------------------------------------------
alter table anvisa_config enable row level security;
alter table anvisa_query_cache enable row level security;
alter table anvisa_query_log enable row level security;
alter table anvisa_request_budget enable row level security;

-- anvisa_query_cache: leitura liberada pra qualquer cliente
-- autenticado (não exige aprovação — ver nota no cabeçalho);
-- escrita só via service_role (sem política de insert/update
-- pro cliente comum)
drop policy if exists "anvisa_query_cache: leitura autenticado" on anvisa_query_cache;
create policy "anvisa_query_cache: leitura autenticado" on anvisa_query_cache
  for select using (auth.uid() is not null);

-- anvisa_query_log: cliente só lê as próprias linhas (pra UI
-- mostrar "X de Y consultas usadas hoje"); só o backend escreve
drop policy if exists "anvisa_query_log: le a propria" on anvisa_query_log;
create policy "anvisa_query_log: le a propria" on anvisa_query_log
  for select using (auth.uid() = user_id);

-- anvisa_config / anvisa_request_budget: só admin lê; ninguém
-- do lado do cliente escreve (só service_role, que ignora RLS)
drop policy if exists "anvisa_config: leitura admin" on anvisa_config;
create policy "anvisa_config: leitura admin" on anvisa_config
  for select using (yalca_is_admin(auth.uid()));

drop policy if exists "anvisa_request_budget: leitura admin" on anvisa_request_budget;
create policy "anvisa_request_budget: leitura admin" on anvisa_request_budget
  for select using (yalca_is_admin(auth.uid()));
