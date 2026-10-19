-- =====================================================================
-- 0015 · Analytics & ad tracking (GTM, GA4, Meta Pixel / Conversions API,
--        Google Ads), consent settings, server-side event outbox
--
-- Adds only new tables and functions. No existing table, row or function is
-- changed. Safe to run once; re-running fails on "already exists" without
-- changing anything.
--
-- Security model
--  * Configuration tables: admins only (RLS). Secrets (Meta CAPI access token,
--    GA4 Measurement Protocol API secret) are stored only as AES-GCM ciphertext
--    made by the website's server; the encryption key is in the Worker's
--    private R2 bucket (same key store as the AI provider keys), never here.
--  * The storefront reads public IDs through tracking_public_config() (IDs
--    that end up in page HTML anyway; never secrets or test codes).
--  * Server-side delivery runs without the service-role key: the Worker holds
--    a random "server key" (in its private R2 bucket) whose SHA-256 is stored
--    in tracking_settings.server_key_hash. The tracking_* server functions
--    below work only when called with that key.
--  * Event rows contain no names, addresses or raw phone numbers. Meta
--    matching data (hashed, only when the visitor allowed advertising) is kept
--    in the row only until it is delivered, and at most 7 days.
-- =====================================================================

-- ---- settings (one row) -----------------------------------------------------
create table public.tracking_settings (
  id smallint primary key default 1 check (id = 1),
  consent_banner_enabled boolean not null default true,
  -- a category switched off here is never granted: its tags never load
  consent_analytics_enabled boolean not null default true,
  consent_advertising_enabled boolean not null default true,
  -- used until the visitor chooses (and always when the banner is off)
  consent_default_analytics text not null default 'denied' check (consent_default_analytics in ('denied', 'granted')),
  consent_default_advertising text not null default 'denied' check (consent_default_advertising in ('denied', 'granted')),
  -- changing it asks every visitor again
  consent_policy_version text not null default '1' check (consent_policy_version ~ '^[A-Za-z0-9._-]{1,20}$'),
  -- when an order counts as a Purchase (see docs/ANALYTICS-AND-TRACKING.md)
  purchase_trigger text not null default 'order_placed' check (purchase_trigger in ('order_placed')),
  -- event name -> routing (which destinations get it); validated by the server
  routes jsonb not null default '{}'::jsonb check (jsonb_typeof(routes) = 'object' and pg_column_size(routes) < 20000),
  server_key_hash text check (server_key_hash is null or server_key_hash ~ '^[0-9a-f]{64}$'),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create trigger tracking_settings_updated_at before update on public.tracking_settings
  for each row execute function public.set_updated_at();
insert into public.tracking_settings (id) values (1) on conflict (id) do nothing;

-- ---- destinations (any number of accounts per kind) --------------------------
create table public.tracking_destinations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('gtm', 'ga4', 'meta', 'google_ads')),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  is_enabled boolean not null default false,
  is_default boolean not null default false,
  public_id text not null,
  conversion_label text check (conversion_label is null or conversion_label ~ '^[A-Za-z0-9_-]{4,64}$'),
  server_container_url text check (server_container_url is null or server_container_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]{2,5})?(/[^\s]*)?$'),
  business_id text check (business_id is null or business_id ~ '^[0-9]{5,25}$'),
  ad_account_id text check (ad_account_id is null or ad_account_id ~ '^(act_)?[0-9]{5,25}$'),
  browser_enabled boolean not null default true,
  server_enabled boolean not null default false,
  ga4_browser_delivery text not null default 'gtag' check (ga4_browser_delivery in ('gtag', 'gtm')),
  debug_mode boolean not null default false,
  enhanced_conversions boolean not null default false,
  advanced_matching boolean not null default false,
  test_event_code text check (test_event_code is null or test_event_code ~ '^[A-Za-z0-9]{3,40}$'),
  secret_ciphertext text check (secret_ciphertext is null or char_length(secret_ciphertext) < 2000),
  secret_hint text check (secret_hint is null or char_length(secret_hint) <= 12),
  secret_updated_at timestamptz,
  verification_status text not null default 'unverified' check (verification_status in ('unverified', 'connected', 'error')),
  verification_method text check (verification_method is null or verification_method in ('api', 'test_event', 'manual')),
  verification_message text check (verification_message is null or char_length(verification_message) <= 500),
  verified_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_code text check (last_error_code is null or char_length(last_error_code) <= 60),
  failed_count int not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tracking_destinations_id_format check (
    (kind = 'gtm' and public_id ~ '^GTM-[A-Z0-9]{4,12}$')
    or (kind = 'ga4' and public_id ~ '^G-[A-Z0-9]{4,16}$')
    or (kind = 'meta' and public_id ~ '^[0-9]{6,20}$')
    or (kind = 'google_ads' and public_id ~ '^AW-[0-9]{6,15}$')
  )
);
create unique index tracking_destinations_one_default on public.tracking_destinations (kind) where is_default;
create unique index tracking_destinations_unique_id on public.tracking_destinations (kind, upper(public_id));
create trigger tracking_destinations_updated_at before update on public.tracking_destinations
  for each row execute function public.set_updated_at();

-- ---- server-side event outbox -----------------------------------------------
create table public.tracking_outbox (
  id bigint generated always as identity primary key,
  event_id text not null check (char_length(event_id) between 8 and 100),
  event_name text not null check (event_name ~ '^[a-z_]{3,40}$'),
  destination_id uuid not null references public.tracking_destinations (id) on delete cascade,
  channel text not null check (channel in ('meta_capi', 'ga4_mp')),
  transaction_id text check (transaction_id is null or char_length(transaction_id) <= 60),
  is_test boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'processing', 'delivered', 'failed')),
  attempts int not null default 0,
  next_retry_at timestamptz not null default now(),
  locked_until timestamptz,
  payload jsonb check (payload is null or pg_column_size(payload) < 16000),
  last_error_code text check (last_error_code is null or char_length(last_error_code) <= 60),
  last_error_message text check (last_error_message is null or char_length(last_error_message) <= 300),
  response_summary text check (response_summary is null or char_length(response_summary) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  delivered_at timestamptz,
  constraint tracking_outbox_once unique (event_id, destination_id, channel)
);
create index tracking_outbox_due_idx on public.tracking_outbox (next_retry_at) where status in ('pending', 'processing');
create index tracking_outbox_created_idx on public.tracking_outbox (created_at desc);
create trigger tracking_outbox_updated_at before update on public.tracking_outbox
  for each row execute function public.set_updated_at();

-- ---- one row per order that was reported as a purchase (idempotency) ---------
create table public.tracking_conversions (
  order_id uuid primary key references public.orders (id) on delete cascade,
  transaction_id text not null unique,
  purchase_event_id text not null unique,
  value numeric(12, 2) not null,
  currency text not null default 'BDT' check (currency ~ '^[A-Z]{3}$'),
  consent_analytics boolean not null,
  consent_advertising boolean not null,
  ga_client_id text check (ga_client_id is null or ga_client_id ~ '^[0-9]{1,20}\.[0-9]{1,20}$'),
  ga_session_id text check (ga_session_id is null or ga_session_id ~ '^[0-9]{1,20}$'),
  -- GA4 properties the purchase was sent to (browser or server): a refund goes only there
  ga4_destinations uuid[] not null default '{}',
  refund_event_id text unique,
  refunded_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---- audit log of configuration changes (field names only, never values) ----
create table public.tracking_audit_log (
  id bigint generated always as identity primary key,
  actor uuid references auth.users (id) on delete set null,
  action text not null check (char_length(action) <= 60),
  target text check (target is null or char_length(target) <= 120),
  details jsonb not null default '{}'::jsonb check (pg_column_size(details) < 4000),
  created_at timestamptz not null default now()
);
create index tracking_audit_log_created_idx on public.tracking_audit_log (created_at desc);

-- ---- RLS ---------------------------------------------------------------------
alter table public.tracking_settings enable row level security;
alter table public.tracking_destinations enable row level security;
alter table public.tracking_outbox enable row level security;
alter table public.tracking_conversions enable row level security;
alter table public.tracking_audit_log enable row level security;

create policy "tracking_settings: admin read" on public.tracking_settings for select to authenticated
  using ((select public.is_admin()));
create policy "tracking_settings: admin update" on public.tracking_settings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "tracking_destinations: admin read" on public.tracking_destinations for select to authenticated
  using ((select public.is_admin()));
create policy "tracking_destinations: admin insert" on public.tracking_destinations for insert to authenticated
  with check ((select public.is_admin()));
create policy "tracking_destinations: admin update" on public.tracking_destinations for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "tracking_destinations: admin delete" on public.tracking_destinations for delete to authenticated
  using ((select public.is_admin()));

create policy "tracking_outbox: admin read" on public.tracking_outbox for select to authenticated
  using ((select public.is_admin()));
create policy "tracking_conversions: admin read" on public.tracking_conversions for select to authenticated
  using ((select public.is_admin()));
create policy "tracking_audit_log: admin read" on public.tracking_audit_log for select to authenticated
  using ((select public.is_admin()));
create policy "tracking_audit_log: admin insert" on public.tracking_audit_log for insert to authenticated
  with check ((select public.is_admin()) and actor = (select auth.uid()));

revoke all on table public.tracking_settings, public.tracking_destinations, public.tracking_outbox,
  public.tracking_conversions, public.tracking_audit_log from anon;
revoke insert, delete on table public.tracking_settings from authenticated;
revoke insert, update, delete on table public.tracking_outbox, public.tracking_conversions from authenticated;
revoke update, delete on table public.tracking_audit_log from authenticated;

-- ---- internal: is this the Worker's server key? (not callable) ----------------
create or replace function public.tracking_key_ok(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_key is not null
    and char_length(p_key) between 32 and 200
    and exists (
      select 1 from public.tracking_settings
      where id = 1 and server_key_hash is not null
        and server_key_hash = encode(extensions.digest(convert_to(p_key, 'UTF8'), 'sha256'), 'hex')
    );
$$;
revoke execute on function public.tracking_key_ok(text) from public, anon, authenticated;

create or replace function public.tracking_require_key(p_key text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.tracking_key_ok(p_key) then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function public.tracking_require_key(text) from public, anon, authenticated;

-- ---- public: what the storefront needs (IDs only, never secrets) -------------
create or replace function public.tracking_public_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'consent', jsonb_build_object(
      'banner', s.consent_banner_enabled,
      'analytics', s.consent_analytics_enabled,
      'advertising', s.consent_advertising_enabled,
      'defaultAnalytics', s.consent_default_analytics,
      'defaultAdvertising', s.consent_default_advertising,
      'version', s.consent_policy_version
    ),
    'routes', s.routes,
    'destinations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'kind', d.kind,
        'publicId', d.public_id,
        'isDefault', d.is_default,
        'conversionLabel', case when d.kind = 'google_ads' then d.conversion_label end,
        'ga4Delivery', case when d.kind = 'ga4' then d.ga4_browser_delivery end,
        'debug', d.debug_mode,
        'enhanced', case when d.kind = 'google_ads' then d.enhanced_conversions else false end,
        'serverCopy', d.kind = 'meta' and d.server_enabled and d.secret_ciphertext is not null
      ) order by d.kind, d.is_default desc, d.created_at)
      from public.tracking_destinations d
      where d.is_enabled and d.browser_enabled
    ), '[]'::jsonb)
  )
  from public.tracking_settings s
  where s.id = 1;
$$;
revoke execute on function public.tracking_public_config() from public;
grant execute on function public.tracking_public_config() to anon, authenticated;

-- ---- server: full configuration incl. ciphertext (server key required) -------
create or replace function public.tracking_server_config(p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform public.tracking_require_key(p_key);
  select jsonb_build_object(
    'consent', jsonb_build_object(
      'banner', s.consent_banner_enabled,
      'analytics', s.consent_analytics_enabled,
      'advertising', s.consent_advertising_enabled,
      'defaultAnalytics', s.consent_default_analytics,
      'defaultAdvertising', s.consent_default_advertising,
      'version', s.consent_policy_version
    ),
    'routes', s.routes,
    'purchaseTrigger', s.purchase_trigger,
    'destinations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'kind', d.kind,
        'name', d.name,
        'publicId', d.public_id,
        'isDefault', d.is_default,
        'browserEnabled', d.browser_enabled,
        'serverEnabled', d.server_enabled,
        'ga4Delivery', d.ga4_browser_delivery,
        'debug', d.debug_mode,
        'advancedMatching', d.advanced_matching,
        'testEventCode', d.test_event_code,
        'secretCiphertext', d.secret_ciphertext
      ) order by d.kind, d.is_default desc, d.created_at)
      from public.tracking_destinations d
      where d.is_enabled
    ), '[]'::jsonb)
  ) into v
  from public.tracking_settings s
  where s.id = 1;
  return v;
end;
$$;
revoke execute on function public.tracking_server_config(text) from public;
grant execute on function public.tracking_server_config(text) to anon, authenticated;

-- ---- server: real order data for the Purchase event --------------------------
create or replace function public.tracking_order_snapshot(p_key text, p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  perform public.tracking_require_key(p_key);
  select * into v_order from public.orders where id = p_order_id;
  -- only fresh orders (the purchase is reported right after checkout)
  if v_order.id is null or v_order.created_at < now() - interval '1 hour' then
    return null;
  end if;
  return jsonb_build_object(
    'orderId', v_order.id,
    'orderNumber', v_order.order_number,
    'status', v_order.status,
    'isDemo', v_order.is_demo,
    'subtotal', v_order.subtotal,
    'discount', v_order.discount,
    'deliveryCharge', v_order.delivery_charge,
    'total', v_order.total,
    'couponCode', v_order.coupon_code,
    'createdAt', v_order.created_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'productId', i.product_id,
        'variantId', i.variant_id,
        'name', i.product_name,
        'variantLabel', i.variant_label,
        'quantity', i.quantity,
        'unitPrice', i.unit_price,
        'brand', b.name,
        'category', c.name
      ) order by i.created_at, i.id)
      from public.order_items i
      left join public.products p on p.id = i.product_id
      left join public.brands b on b.id = p.brand_id
      left join public.categories c on c.id = p.category_id
      where i.order_id = v_order.id
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.tracking_order_snapshot(text, uuid) from public;
grant execute on function public.tracking_order_snapshot(text, uuid) to anon, authenticated;

-- ---- server: record a conversion and queue its server events ----------------
-- p_conversion: null, or the purchase record (inserted once per order; a
--   second call for the same order queues nothing and returns duplicate=true).
-- p_events: [{event_id, event_name, destination_id, channel, transaction_id, is_test, payload}]
create or replace function public.tracking_enqueue(p_key text, p_conversion jsonb, p_events jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e jsonb;
  v_id bigint;
  v_ids bigint[] := '{}';
  v_inserted int;
begin
  perform public.tracking_require_key(p_key);
  if p_events is not null and (jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 12) then
    raise exception 'Invalid events.' using errcode = 'P0001';
  end if;

  if p_conversion is not null then
    insert into public.tracking_conversions (
      order_id, transaction_id, purchase_event_id, value, currency,
      consent_analytics, consent_advertising, ga_client_id, ga_session_id, ga4_destinations
    )
    select o.id, o.order_number, p_conversion ->> 'purchase_event_id', o.total,
           coalesce(p_conversion ->> 'currency', 'BDT'),
           coalesce((p_conversion ->> 'consent_analytics')::boolean, false),
           coalesce((p_conversion ->> 'consent_advertising')::boolean, false),
           nullif(p_conversion ->> 'ga_client_id', ''),
           nullif(p_conversion ->> 'ga_session_id', ''),
           coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p_conversion -> 'ga4_destinations', '[]'::jsonb)) x), '{}')
    from public.orders o
    where o.id = (p_conversion ->> 'order_id')::uuid
      and o.order_number = p_conversion ->> 'transaction_id'
    on conflict do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted = 0 then
      return jsonb_build_object('duplicate', true, 'ids', '[]'::jsonb);
    end if;
  end if;

  for v_e in select * from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) loop
    v_id := null;
    insert into public.tracking_outbox (event_id, event_name, destination_id, channel, transaction_id, is_test, payload)
    select v_e ->> 'event_id', v_e ->> 'event_name', d.id, v_e ->> 'channel', nullif(v_e ->> 'transaction_id', ''),
           coalesce((v_e ->> 'is_test')::boolean, false), v_e -> 'payload'
    from public.tracking_destinations d
    where d.id = (v_e ->> 'destination_id')::uuid and d.is_enabled and d.server_enabled
      and ((v_e ->> 'channel' = 'meta_capi' and d.kind = 'meta') or (v_e ->> 'channel' = 'ga4_mp' and d.kind = 'ga4'))
    on conflict on constraint tracking_outbox_once do nothing
    returning id into v_id;
    if v_id is not null then
      v_ids := v_ids || v_id;
    end if;
  end loop;
  return jsonb_build_object('duplicate', false, 'ids', to_jsonb(v_ids));
end;
$$;
revoke execute on function public.tracking_enqueue(text, jsonb, jsonb) from public;
grant execute on function public.tracking_enqueue(text, jsonb, jsonb) to anon, authenticated;

-- ---- server: claim due events for delivery (safe with concurrent workers) ----
create or replace function public.tracking_claim(p_key text, p_ids bigint[], p_limit int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform public.tracking_require_key(p_key);
  -- housekeeping (bounded): nothing older than 7 days is sent; matching data is dropped
  update public.tracking_outbox set status = 'failed', last_error_code = 'EXPIRED', payload = null, locked_until = null
    where id in (select id from public.tracking_outbox where status in ('pending', 'processing') and created_at < now() - interval '7 days' limit 50);
  update public.tracking_outbox set payload = null
    where id in (select id from public.tracking_outbox where payload is not null and status = 'failed' and created_at < now() - interval '7 days' limit 50);

  with due as (
    select id from public.tracking_outbox
    where (status = 'pending' or (status = 'processing' and locked_until < now()))
      and next_retry_at <= now()
      and attempts < 5
      and payload is not null
      and (p_ids is null or id = any (p_ids))
    order by next_retry_at
    limit least(greatest(coalesce(p_limit, 5), 1), 20)
    for update skip locked
  ), claimed as (
    update public.tracking_outbox o
      set status = 'processing', locked_until = now() + interval '2 minutes', attempts = o.attempts + 1
      from due where o.id = due.id
      returning o.id, o.event_id, o.event_name, o.destination_id, o.channel, o.transaction_id, o.is_test, o.payload, o.attempts, o.created_at
  )
  select coalesce(jsonb_agg(to_jsonb(claimed)), '[]'::jsonb) into v from claimed;
  return v;
end;
$$;
revoke execute on function public.tracking_claim(text, bigint[], int) from public;
grant execute on function public.tracking_claim(text, bigint[], int) to anon, authenticated;

-- ---- server: result of one delivery attempt ---------------------------------
-- p_outcome: delivered | retry (transient error) | failed (permanent error)
create or replace function public.tracking_report(
  p_key text, p_id bigint, p_outcome text, p_code text, p_message text, p_summary text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.tracking_outbox;
  v_final boolean;
begin
  perform public.tracking_require_key(p_key);
  select * into v_row from public.tracking_outbox where id = p_id for update;
  if v_row.id is null or v_row.status <> 'processing' then
    return 'ignored'; -- already reported (or never claimed): never changes a delivered event
  end if;

  if p_outcome = 'delivered' then
    update public.tracking_outbox
      set status = 'delivered', delivered_at = now(), payload = null, locked_until = null,
          last_error_code = null, last_error_message = null, response_summary = left(p_summary, 300)
      where id = p_id;
    update public.tracking_destinations set last_success_at = now() where id = v_row.destination_id;
    return 'delivered';
  end if;

  v_final := p_outcome = 'failed' or v_row.attempts >= 5;
  update public.tracking_outbox
    set status = case when v_final then 'failed' else 'pending' end,
        locked_until = null,
        -- 1 min, 5 min, 25 min, 2 h (capped at 6 h)
        next_retry_at = now() + least(interval '1 minute' * power(5, greatest(v_row.attempts - 1, 0)), interval '6 hours'),
        last_error_code = left(p_code, 60),
        last_error_message = left(p_message, 300),
        response_summary = left(p_summary, 300)
    where id = p_id;
  update public.tracking_destinations
    set last_error_at = now(), last_error_code = left(p_code, 60),
        failed_count = failed_count + case when v_final then 1 else 0 end
    where id = v_row.destination_id;
  return case when v_final then 'failed' else 'retry' end;
end;
$$;
revoke execute on function public.tracking_report(text, bigint, text, text, text, text) from public;
grant execute on function public.tracking_report(text, bigint, text, text, text, text) to anon, authenticated;

-- ---- server: health of events sent directly (not through the outbox) --------
create or replace function public.tracking_health(p_key text, p_destination_id uuid, p_ok boolean, p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.tracking_require_key(p_key);
  if p_ok then
    update public.tracking_destinations set last_success_at = now() where id = p_destination_id;
  else
    update public.tracking_destinations set last_error_at = now(), last_error_code = left(p_code, 60), failed_count = failed_count + 1
      where id = p_destination_id;
  end if;
end;
$$;
revoke execute on function public.tracking_health(text, uuid, boolean, text) from public;
grant execute on function public.tracking_health(text, uuid, boolean, text) to anon, authenticated;

-- ---- server: start a refund once per order (cancelled or refunded orders) ----
create or replace function public.tracking_begin_refund(p_key text, p_order_id uuid, p_event_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv public.tracking_conversions;
begin
  perform public.tracking_require_key(p_key);
  update public.tracking_conversions c
    set refund_event_id = p_event_id, refunded_at = now()
    where c.order_id = p_order_id and c.refund_event_id is null
      and exists (select 1 from public.orders o where o.id = c.order_id and (o.status = 'cancelled' or o.payment_status = 'refunded'))
    returning * into v_conv;
  if v_conv.order_id is null then
    return null;
  end if;
  return to_jsonb(v_conv);
end;
$$;
revoke execute on function public.tracking_begin_refund(text, uuid, text) from public;
grant execute on function public.tracking_begin_refund(text, uuid, text) to anon, authenticated;

-- ---- server: retry failed events again (admin "Retry" button) ---------------
create or replace function public.tracking_requeue(p_key text, p_ids bigint[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  perform public.tracking_require_key(p_key);
  update public.tracking_outbox
    set status = 'pending', attempts = 0, next_retry_at = now(), locked_until = null
    where id = any (p_ids) and status = 'failed' and payload is not null and created_at > now() - interval '7 days';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.tracking_requeue(text, bigint[]) from public;
grant execute on function public.tracking_requeue(text, bigint[]) to anon, authenticated;

-- ---- admin: delivery numbers for the overview ---------------------------------
create or replace function public.tracking_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'byDestination', coalesce((
      select jsonb_agg(jsonb_build_object('destinationId', destination_id, 'channel', channel, 'status', status, 'count', n, 'last', last))
      from (
        select destination_id, channel, status, count(*) as n, max(coalesce(delivered_at, updated_at)) as last
        from public.tracking_outbox where not is_test group by destination_id, channel, status
      ) t
    ), '[]'::jsonb),
    'testEvents', (select count(*) from public.tracking_outbox where is_test),
    'purchases', (select count(*) from public.tracking_conversions),
    'purchasesWithAdConsent', (select count(*) from public.tracking_conversions where consent_advertising),
    'refunds', (select count(*) from public.tracking_conversions where refund_event_id is not null),
    'lastPurchaseAt', (select max(created_at) from public.tracking_conversions)
  );
end;
$$;
revoke execute on function public.tracking_stats() from public, anon;
grant execute on function public.tracking_stats() to authenticated;
