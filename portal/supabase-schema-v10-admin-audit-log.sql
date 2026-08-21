-- =========================================================
-- Yalca Portal — v10: trilha de auditoria das ações do admin
-- Rode este script no SQL Editor DEPOIS do v9
--
-- Até agora, bloquear/reativar/excluir cliente, promover/remover
-- admin e editar observações internas não deixavam nenhum
-- registro de QUEM fez e QUANDO. Se um cliente contestar ter
-- sido bloqueado ou excluído, não havia como investigar.
--
-- admin_audit_log é só-inserção (nenhuma política de update/delete
-- pro cliente comum nem pro admin — nem para o próprio Supabase
-- Studio via anon/authenticated) e só admins podem ler.
-- =========================================================

create table if not exists admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id),
  action text not null check (action in
    ('approve_client','block_client','delete_client','promote_admin','remove_admin','edit_notes')),
  target_user_id uuid,
  details jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_admin_audit_log_target on admin_audit_log(target_user_id, created_at desc);
create index if not exists idx_admin_audit_log_created on admin_audit_log(created_at desc);

alter table admin_audit_log enable row level security;

-- Leitura: só admin.
drop policy if exists "admin_audit_log: leitura admin" on admin_audit_log;
create policy "admin_audit_log: leitura admin" on admin_audit_log
  for select using (yalca_is_admin(auth.uid()));

-- Inserção: só admin, e só em nome de si mesmo (actor_user_id = auth.uid())
-- — impede um admin de registrar uma ação em nome de outro.
drop policy if exists "admin_audit_log: insercao admin" on admin_audit_log;
create policy "admin_audit_log: insercao admin" on admin_audit_log
  for insert with check (yalca_is_admin(auth.uid()) and actor_user_id = auth.uid());

-- Sem política de update/delete — o log é imutável por design.
