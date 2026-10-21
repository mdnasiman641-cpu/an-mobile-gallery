-- 0021 · Fix: "permission denied for table storefront_header" when publishing
-- the menu (Admin → Settings → Header & Navigation).
--
-- Cause: the nav column (migration 0020) exists, but signed-in users were not
-- granted UPDATE on it. Migration 0018 allows updates column by column
-- (bar, messages, outlets, updated_at, updated_by), so without this grant the
-- menu can be read but not saved.
--
-- What this does: grants UPDATE on the header columns to signed-in users
-- again (idempotent), and reloads the API schema cache.
-- What it does NOT do: change any data, table, policy or other permission.
-- Row-level security still lets ONLY admins change the row
-- ("storefront_header: admin update" uses public.is_admin()).
--
-- Requires 0018 and 0020. Safe to run more than once.

begin;

grant update (bar, messages, outlets, nav, updated_at, updated_by) on table public.storefront_header to authenticated;

commit;

-- make the API (PostgREST) pick up the change immediately
notify pgrst, 'reload schema';

-- Check (should list nav among the UPDATE columns for authenticated):
select column_name
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'storefront_header'
  and grantee = 'authenticated' and privilege_type = 'UPDATE'
order by column_name;
