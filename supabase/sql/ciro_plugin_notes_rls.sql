-- CIRO V0.8 per-user MCP example schema.
-- Review and apply as a migration with Supabase CLI in the TARGET project.
-- This is not an executed production migration; DO NOT mark RLS verified until
-- separate users have demonstrated cross-user denial.
create table if not exists public.ciro_plugin_notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  client_op_id uuid not null,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  constraint ciro_plugin_notes_owner_operation unique (owner_id, client_op_id)
);
alter table public.ciro_plugin_notes enable row level security;
alter table public.ciro_plugin_notes force row level security;
revoke all on public.ciro_plugin_notes from public, anon, authenticated;
grant select, insert on public.ciro_plugin_notes to authenticated;

drop policy if exists ciro_plugin_notes_select_self on public.ciro_plugin_notes;
create policy ciro_plugin_notes_select_self
on public.ciro_plugin_notes
for select to authenticated
using ((select auth.uid()) = owner_id);

drop policy if exists ciro_plugin_notes_insert_self on public.ciro_plugin_notes;
create policy ciro_plugin_notes_insert_self
on public.ciro_plugin_notes
for insert to authenticated
with check ((select auth.uid()) = owner_id);

-- Deliberately do not grant UPDATE/DELETE; idempotency is insert-once.
-- Independent RLS qualification: user A can read own rows only; user B cannot
-- select/insert rows owned by A; anon cannot select or insert any rows.
