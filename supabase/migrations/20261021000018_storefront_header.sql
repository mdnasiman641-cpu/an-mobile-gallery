-- 0018 · Storefront header: announcement bar (sliding messages / offers) and
-- Locations (up to 10 outlets). Admin → Settings.
--
-- One row (id = 1):
--   bar      jsonb  display settings (master visibility, animation, colours…)
--   messages jsonb  ordered list of messages / offers (with optional schedule)
--   outlets  jsonb  ordered list of outlets (max 10)
-- The app validates every field (lib/header-config.ts); the checks below are
-- a second line of defence.
--
-- Nothing from the old hard-coded header text is copied in: the bar starts
-- OFF with no messages and no outlets. Public visitors can read this row
-- (it is what the header shows); only admins can change it.
--
-- Safe to run more than once. Run in the Supabase SQL editor.

begin;

create table if not exists public.storefront_header (
  id smallint primary key default 1 check (id = 1),
  bar jsonb not null default '{}'::jsonb check (jsonb_typeof(bar) = 'object'),
  messages jsonb not null default '[]'::jsonb
    check (jsonb_typeof(messages) = 'array' and jsonb_array_length(messages) <= 30),
  outlets jsonb not null default '[]'::jsonb
    check (jsonb_typeof(outlets) = 'array' and jsonb_array_length(outlets) <= 10),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

comment on table public.storefront_header is
  'Header announcement bar + Locations dropdown (Admin → Settings). Single row id = 1. Max 30 messages, max 10 outlets.';

insert into public.storefront_header (id, bar, messages, outlets)
values (1, '{"enabled": false}'::jsonb, '[]'::jsonb, '[]'::jsonb)
on conflict (id) do nothing;

alter table public.storefront_header enable row level security;

drop policy if exists "storefront_header: public read" on public.storefront_header;
create policy "storefront_header: public read" on public.storefront_header
  for select to anon, authenticated using (true);

drop policy if exists "storefront_header: admin update" on public.storefront_header;
create policy "storefront_header: admin update" on public.storefront_header
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- no insert / delete from the API: the single row exists from this migration
revoke all on table public.storefront_header from anon, authenticated;
grant select on table public.storefront_header to anon, authenticated;
grant update (bar, messages, outlets, updated_at, updated_by) on table public.storefront_header to authenticated;

commit;
