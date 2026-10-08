-- =====================================================================
-- 0010 · Homepage Management, AI product assistant, stock-system sync
--
--   1. homepage_sections / homepage_section_items  (public read, staff write)
--   2. ai_settings, ai_models, ai_model_health      (admin only; API keys are
--      never readable through the browser's database roles)
--   3. ai_jobs, ai_job_attempts, ai_product_content (staff read; jobs are
--      written by server code with the service role)
--   4. product_external_sources, sync_runs          (stock-system links)
--   5. product_cards_by_ids()                       (manual homepage picks)
--   6. Guard: a product can only be public with a price above 0
--
-- Existing tables, data and RLS policies are not changed.
-- =====================================================================

-- 1 · Homepage -------------------------------------------------------------

create table public.homepage_sections (
  key text primary key check (key in (
    'hero', 'deals', 'trust', 'categories', 'exchange', 'emi', 'offers', 'featured',
    'new_arrivals', 'used', 'refurbished', 'accessories', 'best_sellers', 'brands',
    'promotions', 'reviews', 'why', 'footer_promo'
  )),
  position int not null default 0,
  is_enabled boolean not null default true,
  title text check (title is null or char_length(title) <= 120),
  subtitle text check (subtitle is null or char_length(subtitle) <= 240),
  description text check (description is null or char_length(description) <= 1000),
  image_url text,
  button_text text check (button_text is null or char_length(button_text) <= 60),
  button_url text check (button_url is null or char_length(button_url) <= 500),
  mode text not null default 'auto' check (mode in ('auto', 'manual')),
  item_limit int check (item_limit is null or item_limit between 1 and 24),
  config jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.homepage_section_items (
  id uuid primary key default gen_random_uuid(),
  section_key text not null references public.homepage_sections (key) on delete cascade,
  item_type text not null check (item_type in ('product', 'category', 'brand', 'banner')),
  item_id uuid not null,
  position int not null default 0,
  created_at timestamptz not null default now(),
  unique (section_key, item_type, item_id)
);
create index homepage_section_items_section_idx on public.homepage_section_items (section_key, position);

create trigger homepage_sections_updated_at before update on public.homepage_sections
  for each row execute function public.set_updated_at();

-- Starting layout = the current homepage. Empty titles use the built-in text.
insert into public.homepage_sections (key, position, is_enabled, mode, item_limit) values
  ('hero', 1, true, 'auto', null),
  ('deals', 2, true, 'auto', 4),
  ('trust', 3, true, 'auto', null),
  ('categories', 4, true, 'auto', 6),
  ('exchange', 5, true, 'auto', null),
  ('emi', 6, true, 'auto', null),
  ('offers', 7, true, 'auto', 10),
  ('brands', 8, true, 'auto', 12),
  ('featured', 9, true, 'auto', 10),
  ('promotions', 10, true, 'auto', 3),
  ('new_arrivals', 11, true, 'auto', 10),
  ('used', 12, true, 'auto', 10),
  ('refurbished', 13, false, 'auto', 10),
  ('accessories', 14, true, 'auto', 10),
  ('best_sellers', 15, true, 'auto', 10),
  ('reviews', 16, true, 'auto', 6),
  ('why', 17, true, 'auto', null),
  ('footer_promo', 18, true, 'auto', null)
on conflict (key) do nothing;

alter table public.homepage_sections enable row level security;
alter table public.homepage_section_items enable row level security;

create policy "homepage_sections: public read" on public.homepage_sections for select to anon, authenticated using (true);
create policy "homepage_sections: staff write" on public.homepage_sections for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
create policy "homepage_section_items: public read" on public.homepage_section_items for select to anon, authenticated using (true);
create policy "homepage_section_items: staff write" on public.homepage_section_items for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

-- 2 · AI models ------------------------------------------------------------

create table public.ai_settings (
  id int primary key default 1 check (id = 1),
  routing_strategy text not null default 'priority'
    check (routing_strategy in ('priority', 'lowest_cost', 'best_quality', 'balanced')),
  -- null = try each eligible model once
  max_attempts int check (max_attempts is null or max_attempts between 1 and 20),
  updated_at timestamptz not null default now()
);
insert into public.ai_settings (id) values (1) on conflict (id) do nothing;

create table public.ai_models (
  id uuid primary key default gen_random_uuid(),
  provider_name text not null check (char_length(provider_name) between 1 and 80),
  display_name text not null check (char_length(display_name) between 1 and 80),
  provider_type text not null check (provider_type in ('gemini', 'openai', 'openai_compatible')),
  api_base_url text not null check (api_base_url ~ '^https://'),
  model_name text not null check (char_length(model_name) between 1 and 120),
  -- AES-GCM ciphertext (server-side key). Not readable by anon/authenticated.
  api_key_ciphertext text,
  api_key_hint text check (api_key_hint is null or char_length(api_key_hint) <= 8),
  is_enabled boolean not null default true,
  priority int not null default 100 check (priority between 1 and 10000),
  timeout_ms int not null default 45000 check (timeout_ms between 1000 and 120000),
  max_retries int not null default 0 check (max_retries between 0 and 3),
  rpm_limit int check (rpm_limit is null or rpm_limit > 0),
  rpd_limit int check (rpd_limit is null or rpd_limit > 0),
  cost_input_per_million numeric(12, 4) check (cost_input_per_million is null or cost_input_per_million >= 0),
  cost_output_per_million numeric(12, 4) check (cost_output_per_million is null or cost_output_per_million >= 0),
  quality_score int check (quality_score is null or quality_score between 1 and 10),
  capabilities text[] not null default '{text}' check (capabilities <@ array[
    'text', 'vision', 'structured_output', 'json', 'product_analysis', 'seo', 'research', 'long_context', 'image_analysis'
  ]::text[]),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_models_priority_idx on public.ai_models (is_enabled, priority);
create trigger ai_models_updated_at before update on public.ai_models
  for each row execute function public.set_updated_at();

create table public.ai_model_health (
  model_id uuid primary key references public.ai_models (id) on delete cascade,
  status text not null default 'HEALTHY' check (status in (
    'HEALTHY', 'DEGRADED', 'RATE_LIMITED', 'QUOTA_EXCEEDED', 'AUTH_ERROR', 'TIMEOUT', 'PROVIDER_ERROR', 'DISABLED'
  )),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  consecutive_failures int not null default 0,
  last_error_code text,
  last_error_message text check (last_error_message is null or char_length(last_error_message) <= 300),
  cooldown_until timestamptz,
  total_requests int not null default 0,
  successful_requests int not null default 0,
  failed_requests int not null default 0,
  -- local rate-limit counters (RPM / RPD)
  minute_window_start timestamptz,
  minute_count int not null default 0,
  day_window date,
  day_count int not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.ai_settings enable row level security;
alter table public.ai_models enable row level security;
alter table public.ai_model_health enable row level security;

create policy "ai_settings: admin all" on public.ai_settings for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "ai_models: admin all" on public.ai_models for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "ai_model_health: admin read" on public.ai_model_health for select to authenticated
  using ((select public.is_admin()));
create policy "ai_model_health: admin reset" on public.ai_model_health for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- Browser roles may write an API key but never read it back. Only the
-- service role (server code) can read api_key_ciphertext.
revoke all on table public.ai_models from anon, authenticated;
grant select (
  id, provider_name, display_name, provider_type, api_base_url, model_name, api_key_hint, is_enabled,
  priority, timeout_ms, max_retries, rpm_limit, rpd_limit, cost_input_per_million, cost_output_per_million,
  quality_score, capabilities, created_by, created_at, updated_at
) on public.ai_models to authenticated;
grant insert, update, delete on public.ai_models to authenticated;
revoke all on table public.ai_settings, public.ai_model_health from anon;

-- 3 · AI jobs and generated content ---------------------------------------

create table public.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  task_type text not null check (task_type in ('full', 'verify', 'seo', 'description', 'faq', 'improve', 'test')),
  status text not null default 'pending' check (status in ('pending', 'processing', 'succeeded', 'failed')),
  replace_manual boolean not null default false,
  trigger text not null default 'manual' check (trigger in ('manual', 'import', 'retry')),
  attempts int not null default 0,
  fallback_used boolean not null default false,
  final_model_id uuid references public.ai_models (id) on delete set null,
  final_provider text,
  final_model text,
  error_code text,
  error_message text check (error_message is null or char_length(error_message) <= 1000),
  requested_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);
create index ai_jobs_status_idx on public.ai_jobs (status, created_at);
create index ai_jobs_product_idx on public.ai_jobs (product_id, created_at desc);
-- one queued/running job per product: the same product is never sent twice at once
create unique index ai_jobs_one_active_per_product on public.ai_jobs (product_id) where status in ('pending', 'processing');

create table public.ai_job_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.ai_jobs (id) on delete cascade,
  attempt int not null,
  model_id uuid references public.ai_models (id) on delete set null,
  provider text not null,
  model text not null,
  status text not null check (status in ('success', 'failed', 'skipped')),
  error_code text,
  http_status int,
  duration_ms int,
  started_at timestamptz not null,
  completed_at timestamptz
);
create index ai_job_attempts_job_idx on public.ai_job_attempts (job_id, attempt);

create table public.ai_product_content (
  product_id uuid primary key references public.products (id) on delete cascade,
  review_status text not null default 'pending'
    check (review_status in ('pending', 'processing', 'ready', 'needs_verification', 'failed')),
  -- latest AI output (all fields, with VERIFIED / LIKELY / UNKNOWN / NEEDS_VERIFICATION)
  content jsonb not null default '{}'::jsonb,
  -- the exact values AI last wrote into the product, to tell AI vs manual edits apart
  applied jsonb not null default '{}'::jsonb,
  -- FAQ, keywords, tags (no product columns for these)
  extras jsonb not null default '{}'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  input_hash text,
  model text,
  generated_at timestamptz,
  updated_at timestamptz not null default now()
);
create trigger ai_product_content_updated_at before update on public.ai_product_content
  for each row execute function public.set_updated_at();

alter table public.ai_jobs enable row level security;
alter table public.ai_job_attempts enable row level security;
alter table public.ai_product_content enable row level security;

create policy "ai_jobs: staff read" on public.ai_jobs for select to authenticated using ((select public.is_staff()));
create policy "ai_job_attempts: staff read" on public.ai_job_attempts for select to authenticated using ((select public.is_staff()));
create policy "ai_product_content: staff all" on public.ai_product_content for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
revoke all on table public.ai_jobs, public.ai_job_attempts, public.ai_product_content from anon;

-- 4 · Stock-system links ---------------------------------------------------

create table public.product_external_sources (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products (id) on delete set null,
  external_source text not null check (external_source ~ '^[a-z0-9_-]{2,40}$'),
  external_product_id text not null check (char_length(external_product_id) between 1 and 200),
  external_sku text,
  payload jsonb not null default '{}'::jsonb,
  payload_hash text,
  -- reference only; never copied into the website's selling price
  external_sale_price numeric(12, 2),
  external_quantity int,
  removed_upstream boolean not null default false,
  last_synced_at timestamptz not null default now(),
  sync_status text not null default 'imported'
    check (sync_status in ('imported', 'linked', 'updated', 'unchanged', 'skipped', 'failed', 'removed_upstream')),
  sync_error text check (sync_error is null or char_length(sync_error) <= 500),
  created_at timestamptz not null default now(),
  unique (external_source, external_product_id)
);
create index product_external_sources_product_idx on public.product_external_sources (product_id);

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  trigger text not null check (trigger in ('webhook', 'manual')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  imported int not null default 0,
  updated int not null default 0,
  skipped int not null default 0,
  failed int not null default 0,
  error text check (error is null or char_length(error) <= 500)
);
create index sync_runs_started_idx on public.sync_runs (source, started_at desc);

alter table public.product_external_sources enable row level security;
alter table public.sync_runs enable row level security;
create policy "product_external_sources: staff read" on public.product_external_sources for select to authenticated
  using ((select public.is_staff()));
create policy "sync_runs: staff read" on public.sync_runs for select to authenticated using ((select public.is_staff()));
revoke all on table public.product_external_sources, public.sync_runs from anon;

-- 5 · Product cards by id (manual homepage selections) ---------------------

create or replace function public.product_cards_by_ids(p_ids uuid[])
returns table (
  id uuid, slug text, name text, brand_name text, brand_slug text, category_slug text,
  price numeric, sale_price numeric, stock_quantity int, low_stock_threshold int,
  condition text, status text, featured boolean, is_new boolean, is_offer boolean, is_best_seller boolean,
  image_url text, image_alt text, rating_avg numeric, rating_count int,
  ram_options text[], storage_options text[], created_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select p.id, p.slug, p.name, b.name, b.slug, c.slug,
         p.price, p.sale_price, p.stock_quantity, p.low_stock_threshold,
         p.condition, p.status, p.featured, p.is_new, p.is_offer, p.is_best_seller,
         img.url, img.alt_text, p.rating_avg, p.rating_count,
         p.ram_options, p.storage_options, p.created_at
  from unnest(p_ids[1:60]) with ordinality as wanted(pid, ord)
  join public.products p on p.id = wanted.pid
  left join public.brands b on b.id = p.brand_id
  left join public.categories c on c.id = p.category_id
  left join lateral (
    select i.url, i.alt_text from public.product_images i
    where i.product_id = p.id
    order by i.is_primary desc, i.sort_order asc
    limit 1
  ) img on true
  where p.status in ('active', 'out_of_stock')
  order by wanted.ord;
$$;
revoke execute on function public.product_cards_by_ids(uuid[]) from public;
grant execute on function public.product_cards_by_ids(uuid[]) to anon, authenticated;

-- 6 · A public product must have a price ------------------------------------
-- Imported drafts start at price 0; this stops them (or anything else) from
-- going live before a selling price is entered. Existing rows are not checked.
alter table public.products
  add constraint products_public_needs_price check (status not in ('active', 'out_of_stock') or price > 0) not valid;

-- 7 · Stock-system sync (one call per batch; server/service role only) -----
--
-- p_items: array of normalized products
--   { id, name, brand, model, model_number, sku, ram, storage, condition,
--     color, category, quantity, sale_price, notes, removed }
-- Rules:
--   * matched by external id → SKU → model number → brand + model + storage + condition
--   * several possible matches → nothing is created; reported for manual linking
--   * new items become DRAFT products with price 0 (never published here)
--   * quantity is synced only for products without variants
--   * price from the stock system is stored for reference, never applied
--   * items removed upstream are flagged, the product is never deleted
create or replace function public.stock_sync_apply(p_source text, p_trigger text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_item jsonb;
  v_link public.product_external_sources;
  v_product_id uuid;
  v_matches uuid[];
  v_has_variants boolean;
  v_old_qty int;
  v_qty int;
  v_hash text;
  v_brand_id uuid;
  v_condition text;
  v_ext_id text;
  v_name text;
  v_status text;
  v_error text;
  v_imported int := 0;
  v_updated int := 0;
  v_skipped int := 0;
  v_failed int := 0;
  v_results jsonb := '[]'::jsonb;
  v_new_jobs uuid[] := '{}';
  v_job_id uuid;
  v_run_id uuid;
begin
  if p_source !~ '^[a-z0-9_-]{2,40}$' then raise exception 'invalid source'; end if;
  insert into public.sync_runs (source, trigger) values (p_source, p_trigger) returning id into v_run_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_ext_id := nullif(btrim(v_item ->> 'id'), '');
    v_name := nullif(btrim(v_item ->> 'name'), '');
    v_status := null; v_error := null; v_product_id := null; v_job_id := null;
    begin
      if v_ext_id is null or v_name is null or char_length(v_name) < 2 then
        raise exception 'id and name are required';
      end if;
      v_qty := greatest(coalesce((v_item ->> 'quantity')::int, 0), 0);
      v_condition := case lower(coalesce(v_item ->> 'condition', ''))
        when 'used' then 'used' when 'refurbished' then 'refurbished' else 'new' end;
      v_hash := md5((v_item - 'quantity')::text);

      select * into v_link from public.product_external_sources
        where external_source = p_source and external_product_id = v_ext_id for update;

      if v_link.id is not null and v_link.product_id is not null and exists (select 1 from public.products where id = v_link.product_id) then
        v_product_id := v_link.product_id;
        v_status := 'unchanged';
      else
        -- find an existing product before creating anything
        v_matches := null;
        if nullif(v_item ->> 'sku', '') is not null then
          select array_agg(id) into v_matches from public.products where lower(sku) = lower(v_item ->> 'sku');
        end if;
        if v_matches is null and nullif(v_item ->> 'model_number', '') is not null then
          select array_agg(id) into v_matches from public.products
            where lower(mpn) = lower(v_item ->> 'model_number') or lower(model) = lower(v_item ->> 'model_number');
        end if;
        if v_matches is null and nullif(v_item ->> 'brand', '') is not null and nullif(v_item ->> 'model', '') is not null then
          select array_agg(p.id) into v_matches
          from public.products p join public.brands b on b.id = p.brand_id
          where lower(b.name) = lower(v_item ->> 'brand')
            and (lower(p.model) = lower(v_item ->> 'model') or lower(p.name) like '%' || lower(v_item ->> 'model') || '%')
            and p.condition = v_condition
            and (nullif(v_item ->> 'storage', '') is null
                 or upper(regexp_replace(v_item ->> 'storage', '\s+', '', 'g')) = any (p.storage_options)
                 or lower(p.name) like '%' || lower(regexp_replace(v_item ->> 'storage', '\s+', '', 'g')) || '%');
        end if;

        if cardinality(v_matches) > 1 then
          v_status := 'skipped';
          v_error := 'Matches ' || cardinality(v_matches) || ' existing products; link it manually.';
        elsif cardinality(v_matches) = 1 then
          v_product_id := v_matches[1];
          v_status := 'linked';
        else
          -- new draft product (price 0 until the admin enters one)
          select id into v_brand_id from public.brands where lower(name) = lower(coalesce(v_item ->> 'brand', '')) limit 1;
          insert into public.products (name, slug, model, mpn, sku, brand_id, condition, status, price, stock_quantity, is_demo)
          values (
            left(v_name, 200),
            public.slugify(v_name),
            nullif(v_item ->> 'model', ''),
            nullif(v_item ->> 'model_number', ''),
            case when nullif(v_item ->> 'sku', '') is not null
                      and not exists (select 1 from public.products where lower(sku) = lower(v_item ->> 'sku'))
                 then v_item ->> 'sku' end,
            v_brand_id,
            v_condition,
            'draft',
            0,
            v_qty,
            false
          )
          returning id into v_product_id;
          if nullif(v_item ->> 'ram', '') is not null then
            insert into public.product_specifications (product_id, group_name, name, value, sort_order)
            values (v_product_id, 'Memory', 'RAM', v_item ->> 'ram', 0);
          end if;
          if nullif(v_item ->> 'storage', '') is not null then
            insert into public.product_specifications (product_id, group_name, name, value, sort_order)
            values (v_product_id, 'Memory', 'Storage', v_item ->> 'storage', 1);
          end if;
          if v_qty > 0 then
            insert into public.inventory (product_id, change, stock_after, reason, note)
            values (v_product_id, v_qty, v_qty, 'initial', 'Imported from ' || p_source);
          end if;
          -- imported values count as AI-replaceable, not as manual edits
          insert into public.ai_product_content (product_id, review_status, applied)
          values (v_product_id, 'pending', jsonb_strip_nulls(jsonb_build_object(
            'name', left(v_name, 200),
            'model', nullif(v_item ->> 'model', ''),
            'brand_id', v_brand_id,
            'specs', (select coalesce(jsonb_agg(jsonb_build_object('group_name', group_name, 'name', name, 'value', value) order by sort_order), '[]'::jsonb)
                      from public.product_specifications where product_id = v_product_id)
          )))
          on conflict (product_id) do nothing;
          insert into public.ai_jobs (product_id, task_type, trigger) values (v_product_id, 'full', 'import')
            on conflict do nothing returning id into v_job_id;
          if v_job_id is not null then v_new_jobs := v_new_jobs || v_job_id; end if;
          v_status := 'imported';
          if nullif(v_item ->> 'condition', '') is null then
            v_error := 'Condition not provided by the stock system; saved as New. Check before publishing.';
          end if;
        end if;
      end if;

      -- stock and metadata for linked / existing products
      if v_product_id is not null and v_status in ('unchanged', 'linked') then
        select exists (select 1 from public.product_variants where product_id = v_product_id and status = 'active') into v_has_variants;
        select stock_quantity into v_old_qty from public.products where id = v_product_id;
        if coalesce((v_item ->> 'removed')::boolean, false) then
          v_status := 'removed_upstream';
        elsif v_has_variants then
          if v_old_qty is distinct from v_qty then
            v_error := 'Has storage/colour options: update stock per option in Admin.';
          end if;
        elsif v_old_qty is distinct from v_qty then
          update public.products set stock_quantity = v_qty where id = v_product_id;
          insert into public.inventory (product_id, change, stock_after, reason, note)
          values (v_product_id, v_qty - coalesce(v_old_qty, 0), v_qty, 'adjustment', 'Stock sync from ' || p_source);
          if v_status = 'unchanged' then v_status := 'updated'; end if;
        end if;
        -- product details changed upstream: ask for a review instead of re-running AI automatically
        if v_status <> 'linked' and v_link.payload_hash is not null and v_link.payload_hash <> v_hash then
          update public.ai_product_content set review_status = 'needs_verification' where product_id = v_product_id;
          if v_status = 'unchanged' then v_status := 'updated'; end if;
        end if;
      end if;

      insert into public.product_external_sources as s (
        product_id, external_source, external_product_id, external_sku, payload, payload_hash,
        external_sale_price, external_quantity, removed_upstream, last_synced_at, sync_status, sync_error
      ) values (
        v_product_id, p_source, v_ext_id, nullif(v_item ->> 'sku', ''), v_item, v_hash,
        nullif(v_item ->> 'sale_price', '')::numeric, v_qty, coalesce((v_item ->> 'removed')::boolean, false), now(), v_status, v_error
      )
      on conflict (external_source, external_product_id) do update set
        product_id = coalesce(excluded.product_id, s.product_id),
        external_sku = excluded.external_sku,
        payload = excluded.payload,
        payload_hash = excluded.payload_hash,
        external_sale_price = excluded.external_sale_price,
        external_quantity = excluded.external_quantity,
        removed_upstream = excluded.removed_upstream,
        last_synced_at = now(),
        sync_status = excluded.sync_status,
        sync_error = excluded.sync_error;

      case v_status
        when 'imported' then v_imported := v_imported + 1;
        when 'updated', 'linked', 'removed_upstream' then v_updated := v_updated + 1;
        else v_skipped := v_skipped + 1;
      end case;
    exception when others then
      v_failed := v_failed + 1;
      v_status := 'failed';
      v_error := left(sqlerrm, 300);
      if v_ext_id is not null then
        insert into public.product_external_sources (external_source, external_product_id, payload, sync_status, sync_error)
        values (p_source, v_ext_id, coalesce(v_item, '{}'::jsonb), 'failed', v_error)
        on conflict (external_source, external_product_id) do update set sync_status = 'failed', sync_error = excluded.sync_error, last_synced_at = now();
      end if;
    end;
    v_results := v_results || jsonb_build_object('id', v_ext_id, 'status', v_status, 'product_id', v_product_id, 'error', v_error);
  end loop;

  update public.sync_runs set finished_at = now(), imported = v_imported, updated = v_updated, skipped = v_skipped, failed = v_failed
    where id = v_run_id;

  return jsonb_build_object(
    'run_id', v_run_id, 'imported', v_imported, 'updated', v_updated, 'skipped', v_skipped, 'failed', v_failed,
    'job_ids', to_jsonb(v_new_jobs), 'items', v_results
  );
end;
$$;
revoke execute on function public.stock_sync_apply(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.stock_sync_apply(text, text, jsonb) to service_role;
