-- 0023 · Lovable stock: one website product per phone model + memory + condition.
--
-- The Lovable inventory keeps one record per purchase batch (the same phone
-- appears many times, most batches sold out). The old per-record import
-- (stock_sync_apply) created one draft per batch or merged batches with the
-- last batch's quantity, and could link to existing products by a similar name.
--
-- New model (used only by Admin → Inventory → Lovable stock sync):
--   stock_source_batches  every source record (batch) with its quantity and group key
--   stock_source_groups   one row per group key = one website product, stock = SUM of
--                         the quantities of its batches
-- Rules enforced here:
--   * totals are computed from ALL stored batches, never from one page;
--     batches not seen in a COMPLETE full pass are marked missing (excluded
--     from the total, nothing is deleted)
--   * a group with total stock <= 0 never creates a draft
--   * a new group whose model looks like an existing website product is HELD
--     until an admin links it (explicit mapping) or chooses "create new draft";
--     existing products are never linked automatically
--   * a linked product only gets its stock_quantity changed (+ inventory log);
--     name, price, photos, text, SEO and status are never touched; never deleted
--   * orders and order items are not touched
-- Written only by the server (service role) after an admin check; staff can read.
--
-- Requires 0010 and 0022. Safe to run more than once.

begin;

create table if not exists public.stock_source_batches (
  source text not null check (source ~ '^[a-z0-9_-]{2,40}$'),
  batch_id text not null check (char_length(batch_id) between 1 and 200),
  -- '!unmapped' = record seen but not usable (kept out of every total)
  group_key text not null check (char_length(group_key) between 3 and 300),
  quantity int not null default 0 check (quantity between 0 and 100000),
  -- mapped fields only (never purchase / cost data)
  item jsonb not null default '{}'::jsonb,
  source_updated_at timestamptz,
  seen_pass timestamptz,
  missing boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (source, batch_id)
);
create index if not exists stock_source_batches_group_idx on public.stock_source_batches (source, group_key);

create table if not exists public.stock_source_groups (
  source text not null check (source ~ '^[a-z0-9_-]{2,40}$'),
  group_key text not null check (char_length(group_key) between 3 and 300),
  product_id uuid references public.products (id) on delete set null,
  -- explicit admin decision for a held group: 'linked' (to product_id) or 'create' (new draft)
  link_decision text check (link_decision in ('linked', 'create')),
  linked_by uuid references auth.users (id) on delete set null,
  linked_at timestamptz,
  name text,
  total_quantity int not null default 0,
  batch_count int not null default 0,
  reference_price numeric(12, 2),
  status text check (status in ('created', 'updated', 'unchanged', 'skipped_zero', 'held_match', 'has_variants', 'pending')),
  match_candidates jsonb not null default '[]'::jsonb,
  last_synced_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (source, group_key)
);
create index if not exists stock_source_groups_product_idx on public.stock_source_groups (product_id);
-- one website product belongs to at most one group of a source
create unique index if not exists stock_source_groups_one_product on public.stock_source_groups (source, product_id) where product_id is not null;

alter table public.stock_source_batches enable row level security;
alter table public.stock_source_groups enable row level security;
drop policy if exists "stock_source_batches: staff read" on public.stock_source_batches;
create policy "stock_source_batches: staff read" on public.stock_source_batches for select to authenticated using ((select public.is_staff()));
drop policy if exists "stock_source_groups: staff read" on public.stock_source_groups;
create policy "stock_source_groups: staff read" on public.stock_source_groups for select to authenticated using ((select public.is_staff()));

revoke all on table public.stock_source_batches, public.stock_source_groups from anon, authenticated;
grant select on table public.stock_source_batches, public.stock_source_groups to authenticated;
grant all on table public.stock_source_batches, public.stock_source_groups to service_role;

-- Normalised text for "does this product name contain the model" (letters and digits only).
create or replace function public.stock_norm(p text)
returns text language sql immutable set search_path = '' as $$
  select regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '', 'g');
$$;

-- 1 · Stage one click's records. Usable records: upsert quantity / group / item.
--     Unusable records (p_seen_ids): only marked as seen (an earlier quantity is kept;
--     a new one is stored under '!unmapped', which is never counted).
--     Returns how many records have been seen in this pass so far.
create or replace function public.stock_source_stage(p_source text, p_pass timestamptz, p_items jsonb, p_seen_ids jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if p_source !~ '^[a-z0-9_-]{2,40}$' or p_pass is null then raise exception 'invalid arguments'; end if;

  insert into public.stock_source_batches as b (source, batch_id, group_key, quantity, item, source_updated_at, seen_pass, missing, updated_at)
  select p_source, x.id, x.group_key, greatest(0, least(100000, coalesce(x.quantity, 0))), coalesce(x.item, '{}'::jsonb), x.source_updated_at, p_pass, false, now()
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as x(id text, group_key text, quantity int, item jsonb, source_updated_at timestamptz)
  where x.id is not null and x.group_key is not null
  on conflict (source, batch_id) do update set
    group_key = excluded.group_key,
    quantity = excluded.quantity,
    item = excluded.item,
    source_updated_at = excluded.source_updated_at,
    seen_pass = excluded.seen_pass,
    missing = false,
    updated_at = now();

  insert into public.stock_source_batches as b (source, batch_id, group_key, quantity, seen_pass, missing)
  select p_source, s.id, '!unmapped', 0, p_pass, false
  from jsonb_array_elements_text(coalesce(p_seen_ids, '[]'::jsonb)) as s(id)
  where s.id is not null and char_length(s.id) between 1 and 200
  on conflict (source, batch_id) do update set seen_pass = excluded.seen_pass, missing = false;

  select count(*) into v_count from public.stock_source_batches where source = p_source and seen_pass = p_pass;
  return v_count;
end;
$$;

-- 2 · Read-only: existing website products a group might be (for the preview and the hold rule).
--     Same condition, same brand when the brand is known, and the product name contains the model.
--     Products already linked to another group of this source are not offered.
create or replace function public.stock_source_candidates(p_source text, p_groups jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(g.key, g.matches), '{}'::jsonb)
  from (
    select x.key, coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'status', p.status, 'stock', p.stock_quantity) order by p.name)
      from public.products p
      where p.condition = x.condition
        and char_length(public.stock_norm(x.model)) >= 2
        and position(public.stock_norm(x.model) in public.stock_norm(p.name)) > 0
        and (x.brand is null
             or not exists (select 1 from public.brands b where lower(b.name) = lower(x.brand))
             or p.brand_id = (select b.id from public.brands b where lower(b.name) = lower(x.brand) limit 1))
        and not exists (
          select 1 from public.stock_source_groups sg
          where sg.source = p_source and sg.product_id = p.id and sg.group_key <> x.key)
    ), '[]'::jsonb) as matches
    from jsonb_to_recordset(coalesce(p_groups, '[]'::jsonb)) as x(key text, model text, brand text, condition text)
  ) g;
$$;

-- 3 · Apply the totals. p_full: a complete full pass (batches not seen in it become "missing").
--     p_create_limit: test mode, create at most this many drafts and change nothing else.
create or replace function public.stock_source_finalize(p_source text, p_pass timestamptz, p_full boolean, p_create_limit int)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  g record;
  v_grp public.stock_source_groups;
  v_rep jsonb;
  v_product_id uuid;
  v_old int;
  v_has_variants boolean;
  v_status text;
  v_brand_id uuid;
  v_candidates jsonb;
  v_created int := 0; v_updated int := 0; v_unchanged int := 0; v_zero int := 0; v_held int := 0; v_variants int := 0;
  v_changed uuid[] := '{}';
  v_job uuid;
  v_test boolean := p_create_limit is not null;
begin
  if p_source !~ '^[a-z0-9_-]{2,40}$' then raise exception 'invalid source'; end if;
  if p_full and p_pass is not null and not v_test then
    update public.stock_source_batches set missing = true, updated_at = now()
      where source = p_source and seen_pass is distinct from p_pass and not missing;
  end if;

  -- every group that has batches, plus groups whose batches all moved to another group (total 0)
  for g in
    select k.group_key, coalesce(a.total, 0) as total, coalesce(a.batches, 0) as batches, a.rep
    from (
      select distinct group_key from public.stock_source_batches where source = p_source and group_key <> '!unmapped'
      union
      select group_key from public.stock_source_groups where source = p_source
    ) k
    left join lateral (
      select coalesce(sum(b.quantity) filter (where not b.missing), 0)::int as total,
             count(*) filter (where not b.missing)::int as batches,
             (array_agg(b.item order by b.missing, b.source_updated_at desc nulls last, b.batch_id))[1] as rep
      from public.stock_source_batches b
      where b.source = p_source and b.group_key = k.group_key
    ) a on true
    order by k.group_key
  loop
    select * into v_grp from public.stock_source_groups where source = p_source and group_key = g.group_key for update;
    v_rep := coalesce(g.rep, '{}'::jsonb);
    v_product_id := v_grp.product_id;
    if v_product_id is not null and not exists (select 1 from public.products where id = v_product_id) then v_product_id := null; end if;
    v_candidates := coalesce(v_grp.match_candidates, '[]'::jsonb);
    v_status := null;

    if v_product_id is not null then
      if v_test then continue; end if;
      select exists (select 1 from public.product_variants where product_id = v_product_id and status = 'active') into v_has_variants;
      select stock_quantity into v_old from public.products where id = v_product_id for update;
      if v_has_variants then
        v_status := 'has_variants'; v_variants := v_variants + 1;
      elsif v_old is distinct from g.total then
        update public.products set stock_quantity = g.total where id = v_product_id;
        insert into public.inventory (product_id, change, stock_after, reason, note)
          values (v_product_id, g.total - coalesce(v_old, 0), g.total, 'adjustment', 'Stock sync from ' || p_source || ' (' || g.batches || ' batch(es))');
        v_status := 'updated'; v_updated := v_updated + 1; v_changed := v_changed || v_product_id;
      else
        v_status := 'unchanged'; v_unchanged := v_unchanged + 1;
      end if;
    elsif g.total <= 0 then
      if v_test then continue; end if;
      v_status := 'skipped_zero'; v_zero := v_zero + 1;
    else
      if v_grp.link_decision is distinct from 'create' then
        v_candidates := coalesce(public.stock_source_candidates(p_source, jsonb_build_array(jsonb_build_object(
          'key', g.group_key, 'model', coalesce(v_rep ->> 'match_model', v_rep ->> 'model'), 'brand', v_rep ->> 'website_brand', 'condition', v_rep ->> 'condition'))) -> g.group_key, '[]'::jsonb);
      end if;
      if v_grp.link_decision is distinct from 'create' and jsonb_array_length(v_candidates) > 0 then
        if v_test then continue; end if;
        v_status := 'held_match'; v_held := v_held + 1;
      else
        if v_test and v_created >= p_create_limit then continue; end if;
        select id into v_brand_id from public.brands where lower(name) = lower(coalesce(v_rep ->> 'website_brand', '')) limit 1;
        insert into public.products (name, slug, model, brand_id, condition, status, price, stock_quantity, is_demo)
        values (left(v_rep ->> 'name', 200), public.slugify(v_rep ->> 'name'), nullif(v_rep ->> 'model', ''), v_brand_id,
                coalesce(nullif(v_rep ->> 'condition', ''), 'new'), 'draft', 0, g.total, false)
        returning id into v_product_id;
        if nullif(v_rep ->> 'ram', '') is not null then
          insert into public.product_specifications (product_id, group_name, name, value, sort_order) values (v_product_id, 'Memory', 'RAM', v_rep ->> 'ram', 0);
        end if;
        if nullif(v_rep ->> 'storage', '') is not null then
          insert into public.product_specifications (product_id, group_name, name, value, sort_order) values (v_product_id, 'Memory', 'Storage', v_rep ->> 'storage', 1);
        end if;
        insert into public.inventory (product_id, change, stock_after, reason, note)
          values (v_product_id, g.total, g.total, 'initial', 'Imported from ' || p_source || ' (' || g.batches || ' batch(es))');
        insert into public.ai_product_content (product_id, review_status, applied)
          values (v_product_id, 'pending', jsonb_strip_nulls(jsonb_build_object('name', left(v_rep ->> 'name', 200), 'model', nullif(v_rep ->> 'model', ''), 'brand_id', v_brand_id)))
          on conflict (product_id) do nothing;
        insert into public.ai_jobs (product_id, task_type, trigger) values (v_product_id, 'full', 'import') on conflict do nothing returning id into v_job;
        v_status := 'created'; v_created := v_created + 1;
      end if;
    end if;

    insert into public.stock_source_groups as s (source, group_key, product_id, name, total_quantity, batch_count, reference_price, status, match_candidates, last_synced_at, updated_at)
    values (p_source, g.group_key, v_product_id, left(v_rep ->> 'name', 200), g.total, g.batches,
            nullif(v_rep ->> 'sale_price', '')::numeric, v_status, case when v_status = 'held_match' then v_candidates else '[]'::jsonb end, now(), now())
    on conflict (source, group_key) do update set
      product_id = excluded.product_id, name = coalesce(excluded.name, s.name), total_quantity = excluded.total_quantity, batch_count = excluded.batch_count,
      reference_price = excluded.reference_price, status = excluded.status, match_candidates = excluded.match_candidates,
      last_synced_at = now(), updated_at = now();

    -- the source facts shown on the product page and used as AI context (one row per group)
    if v_product_id is not null then
      insert into public.product_external_sources as x (product_id, external_source, external_product_id, payload, payload_hash,
        external_sale_price, external_quantity, removed_upstream, last_synced_at, sync_status, sync_error)
      values (v_product_id, p_source, 'group:' || g.group_key, v_rep || jsonb_build_object('batches', g.batches, 'total_quantity', g.total),
        md5(v_rep::text), nullif(v_rep ->> 'sale_price', '')::numeric, g.total, false, now(),
        case v_status when 'created' then 'imported' when 'updated' then 'updated' else 'unchanged' end, null)
      on conflict (external_source, external_product_id) do update set
        product_id = excluded.product_id, payload = excluded.payload, payload_hash = excluded.payload_hash,
        external_sale_price = excluded.external_sale_price, external_quantity = excluded.external_quantity,
        last_synced_at = now(), sync_status = excluded.sync_status, sync_error = null;
    end if;
  end loop;

  return jsonb_build_object('created', v_created, 'updated', v_updated, 'unchanged', v_unchanged, 'skipped_zero', v_zero,
    'held', v_held, 'has_variants', v_variants, 'changed_product_ids', to_jsonb(v_changed));
end;
$$;

revoke execute on function public.stock_source_stage(text, timestamptz, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.stock_source_candidates(text, jsonb) from public, anon, authenticated;
revoke execute on function public.stock_source_finalize(text, timestamptz, boolean, int) from public, anon, authenticated;
grant execute on function public.stock_source_stage(text, timestamptz, jsonb, jsonb) to service_role;
grant execute on function public.stock_source_candidates(text, jsonb) to service_role;
grant execute on function public.stock_source_finalize(text, timestamptz, boolean, int) to service_role;

commit;

notify pgrst, 'reload schema';
