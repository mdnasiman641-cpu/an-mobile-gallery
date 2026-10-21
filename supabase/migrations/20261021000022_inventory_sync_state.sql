-- 0022 · Lovable inventory pull sync (Admin → Inventory → "Sync Lovable Stock Now").
--
-- Reuses the existing stock import (migration 0010: product_external_sources,
-- sync_runs, stock_sync_apply). This adds only one small table that remembers,
-- per source:
--   * a run lock (so two admins can't sync at the same time),
--   * where an unfinished full sync stopped (next page),
--   * the checkpoint for incremental sync (only moved after a complete pass),
--   * the last result shown in the admin.
-- Written only by the server (service role) after an admin check; staff can read it.
-- No product, order or other data is changed by this migration.
--
-- Requires 0010. Safe to run more than once.

begin;

create table if not exists public.stock_sync_state (
  source text primary key check (source ~ '^[a-z0-9_-]{2,40}$'),
  running_token uuid,
  running_since timestamptz,
  resume_page int check (resume_page is null or resume_page between 1 and 100000),
  full_pass_started_at timestamptz,
  checkpoint timestamptz,
  incremental_supported boolean,
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  last_summary jsonb not null default '{}'::jsonb,
  last_error text check (last_error is null or char_length(last_error) <= 500),
  contract jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.stock_sync_state enable row level security;

drop policy if exists "stock_sync_state: staff read" on public.stock_sync_state;
create policy "stock_sync_state: staff read" on public.stock_sync_state for select to authenticated
  using ((select public.is_staff()));

revoke all on table public.stock_sync_state from anon, authenticated;
grant select on table public.stock_sync_state to authenticated;
grant all on table public.stock_sync_state to service_role;

commit;

notify pgrst, 'reload schema';
