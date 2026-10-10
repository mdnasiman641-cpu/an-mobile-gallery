-- =====================================================================
-- 0014 · Courier shipments and customer order tracking
--
--  * shipments: one ACTIVE shipment per order (database-enforced). A wrong
--    shipment is corrected by cancelling it (it stays in the history) and
--    creating a new one. A consignment ID can't be active on two orders.
--  * shipment_events: status history (who / when / source). Staff notes
--    never leave the admin panel.
--  * Order status follows the shipment: creating a shipment marks a
--    confirmed / processing order "shipped"; only a "delivered" shipment
--    update (by an admin or a verified courier webhook) marks the order
--    delivered; cancelling a shipment returns the order to "processing".
--    Totals, stock and payment status are never changed here.
--  * courier_settings: Pathao API settings. Secrets are stored only as
--    AES-GCM ciphertext (key in the Worker's private R2 bucket, like the AI
--    keys) and the webhook secret only as a SHA-256 hash.
--  * track_order(order_number, phone): what a customer may see about their
--    own order, with a per-phone and per-order limit on failed lookups.
-- All tables are admin-only (RLS). Writes happen only through the
-- functions below. No existing data is changed.
-- =====================================================================

-- ---- shipments --------------------------------------------------------------
create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  courier text not null check (courier ~ '^[a-z0-9_]{2,30}$'),
  courier_name text not null check (char_length(courier_name) between 2 and 60),
  source text not null default 'manual' check (source in ('manual', 'api')),
  consignment_id text check (consignment_id is null or char_length(consignment_id) between 1 and 80),
  tracking_reference text check (tracking_reference is null or char_length(tracking_reference) between 1 and 120),
  tracking_url text check (tracking_url is null or (tracking_url ~ '^https://[^[:space:]]+$' and char_length(tracking_url) <= 500)),
  status text not null default 'created' check (status in (
    'pending', 'created', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered',
    'failed_delivery', 'on_hold', 'returned', 'cancelled')),
  is_active boolean not null default true,
  shipped_at timestamptz not null default now(),
  cod_amount numeric(12, 2) check (cod_amount is null or cod_amount >= 0),
  courier_fee numeric(12, 2) check (courier_fee is null or courier_fee >= 0),
  note text check (note is null or char_length(note) <= 1000),
  provider_status text check (provider_status is null or char_length(provider_status) <= 60),
  last_error text check (last_error is null or char_length(last_error) <= 500),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index shipments_one_active_per_order on public.shipments (order_id) where is_active;
create unique index shipments_active_consignment on public.shipments (courier, consignment_id)
  where is_active and consignment_id is not null;
create index shipments_order_idx on public.shipments (order_id, created_at desc);
create trigger shipments_updated_at before update on public.shipments
  for each row execute function public.set_updated_at();

create table public.shipment_events (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments (id) on delete cascade,
  status text not null check (status in (
    'pending', 'created', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered',
    'failed_delivery', 'on_hold', 'returned', 'cancelled')),
  source text not null default 'manual' check (source in ('manual', 'api', 'webhook')),
  provider_status text check (provider_status is null or char_length(provider_status) <= 60),
  -- staff-only; never returned to customers
  note text check (note is null or char_length(note) <= 500),
  occurred_at timestamptz not null default now(),
  -- webhook replay protection: the same courier event is stored once
  dedupe_key text unique check (dedupe_key is null or char_length(dedupe_key) <= 200),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index shipment_events_shipment_idx on public.shipment_events (shipment_id, occurred_at desc);

-- ---- courier settings (Pathao) ----------------------------------------------
create table public.courier_settings (
  provider text primary key check (provider in ('pathao')),
  is_enabled boolean not null default false,
  environment text not null default 'live' check (environment in ('live', 'sandbox')),
  client_id text check (client_id is null or char_length(client_id) <= 200),
  client_secret_ciphertext text,
  client_secret_hint text,
  store_id bigint check (store_id is null or store_id > 0),
  webhook_secret_hash text check (webhook_secret_hash is null or webhook_secret_hash ~ '^[0-9a-f]{64}$'),
  default_delivery_type int not null default 48 check (default_delivery_type in (12, 24, 48)),
  default_item_type int not null default 2 check (default_item_type in (1, 2, 3)),
  default_weight numeric(6, 2) not null default 0.5 check (default_weight between 0.1 and 50),
  token_ciphertext text,
  token_expires_at timestamptz,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create trigger courier_settings_updated_at before update on public.courier_settings
  for each row execute function public.set_updated_at();

-- ---- failed tracking lookups (rate limit) -----------------------------------
create table public.order_tracking_failures (
  id bigint generated always as identity primary key,
  phone text,
  order_number text,
  created_at timestamptz not null default now()
);
create index order_tracking_failures_phone_idx on public.order_tracking_failures (phone, created_at desc);
create index order_tracking_failures_order_idx on public.order_tracking_failures (order_number, created_at desc);

-- ---- RLS --------------------------------------------------------------------
alter table public.shipments enable row level security;
alter table public.shipment_events enable row level security;
alter table public.courier_settings enable row level security;
alter table public.order_tracking_failures enable row level security;

create policy "shipments: admin read" on public.shipments for select to authenticated
  using ((select public.is_admin()));
create policy "shipment_events: admin read" on public.shipment_events for select to authenticated
  using ((select public.is_admin()));
create policy "courier_settings: admin read" on public.courier_settings for select to authenticated
  using ((select public.is_admin()));
create policy "courier_settings: admin insert" on public.courier_settings for insert to authenticated
  with check ((select public.is_admin()));
create policy "courier_settings: admin update" on public.courier_settings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
-- order_tracking_failures: no policies (functions only)

revoke all on table public.shipments, public.shipment_events, public.courier_settings, public.order_tracking_failures from anon;
revoke insert, update, delete on table public.shipments, public.shipment_events from authenticated;
revoke all on table public.order_tracking_failures from authenticated;

-- ---- internal: apply a status change (no permission check; not callable) ----
create or replace function public.shipment_apply_status(
  p_shipment_id uuid,
  p_status text,
  p_source text,
  p_note text,
  p_occurred_at timestamptz,
  p_provider_status text,
  p_dedupe_key text,
  p_actor uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ship public.shipments;
  v_order public.orders;
begin
  if p_status not in ('created', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered',
                      'failed_delivery', 'on_hold', 'returned', 'cancelled') then
    raise exception 'Unknown shipment status.' using errcode = 'P0001';
  end if;
  if p_dedupe_key is not null and exists (select 1 from public.shipment_events where dedupe_key = p_dedupe_key) then
    return 'duplicate';
  end if;

  select * into v_ship from public.shipments where id = p_shipment_id for update;
  if v_ship.id is null then
    raise exception 'Shipment not found.' using errcode = 'P0001';
  end if;
  if not v_ship.is_active then
    raise exception 'This shipment was cancelled or replaced and can no longer be updated.' using errcode = 'P0001';
  end if;
  if v_ship.status in ('delivered', 'returned') then
    raise exception 'This shipment is already %. Its status can no longer change.', v_ship.status using errcode = 'P0001';
  end if;

  select * into v_order from public.orders where id = v_ship.order_id for update;

  insert into public.shipment_events (shipment_id, status, source, provider_status, note, occurred_at, dedupe_key, created_by)
  values (v_ship.id, p_status, p_source, p_provider_status, nullif(left(btrim(coalesce(p_note, '')), 500), ''),
          coalesce(p_occurred_at, now()), p_dedupe_key, p_actor);

  update public.shipments
    set status = p_status,
        provider_status = coalesce(p_provider_status, provider_status),
        is_active = p_status <> 'cancelled'
    where id = v_ship.id;

  -- keep the order status consistent (never touches totals, stock or payment)
  if v_order.status <> 'cancelled' then
    if p_status = 'delivered' then
      update public.orders set status = 'delivered' where id = v_order.id;
    elsif p_status = 'cancelled' then
      if v_order.status = 'shipped' then
        update public.orders set status = 'processing' where id = v_order.id;
      end if;
    elsif v_order.status in ('confirmed', 'processing') then
      update public.orders set status = 'shipped' where id = v_order.id;
    end if;
  end if;
  return 'ok';
end;
$$;
revoke execute on function public.shipment_apply_status(uuid, text, text, text, timestamptz, text, text, uuid) from public, anon, authenticated;

-- ---- admin: create a shipment -------------------------------------------------
create or replace function public.admin_create_shipment(
  p_order_id uuid,
  p_courier text,
  p_courier_name text,
  p_consignment_id text default null,
  p_tracking_reference text default null,
  p_tracking_url text default null,
  p_shipped_at timestamptz default null,
  p_cod_amount numeric default null,
  p_note text default null,
  p_source text default 'manual'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_id uuid;
  v_consignment text := nullif(btrim(coalesce(p_consignment_id, '')), '');
  v_reference text := nullif(btrim(coalesce(p_tracking_reference, '')), '');
  v_pending boolean := p_source = 'api';
begin
  if not (select public.is_admin()) then
    raise exception 'Only admins can create shipments.' using errcode = '42501';
  end if;
  if p_source not in ('manual', 'api') then
    raise exception 'Unknown shipment source.' using errcode = 'P0001';
  end if;
  if not v_pending and v_consignment is null and v_reference is null then
    raise exception 'Enter the consignment ID or a tracking reference.' using errcode = 'P0001';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'Order not found.' using errcode = 'P0001';
  end if;
  if v_order.status = 'pending' then
    raise exception 'Confirm the order before creating a shipment.' using errcode = 'P0001';
  end if;
  if v_order.status in ('cancelled', 'delivered') then
    raise exception 'This order is % and can''t be shipped.', v_order.status using errcode = 'P0001';
  end if;
  if exists (select 1 from public.shipments where order_id = v_order.id and is_active) then
    raise exception 'This order already has an active shipment. Cancel it first to create a corrected one.' using errcode = 'P0001';
  end if;

  begin
    insert into public.shipments (order_id, courier, courier_name, source, consignment_id, tracking_reference, tracking_url,
                                  status, shipped_at, cod_amount, note, created_by)
    values (v_order.id, lower(btrim(p_courier)), btrim(p_courier_name), p_source, v_consignment, v_reference,
            nullif(btrim(coalesce(p_tracking_url, '')), ''),
            case when v_pending then 'pending' else 'created' end,
            coalesce(p_shipped_at, now()), p_cod_amount, nullif(left(btrim(coalesce(p_note, '')), 1000), ''),
            (select auth.uid()))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'This order already has an active shipment, or that consignment ID is already used by another active shipment.' using errcode = 'P0001';
  end;

  insert into public.shipment_events (shipment_id, status, source, note, created_by)
  values (v_id, case when v_pending then 'pending' else 'created' end, p_source,
          case when v_pending then 'Sending to the courier' else 'Shipment created' end, (select auth.uid()));

  if not v_pending and v_order.status in ('confirmed', 'processing') then
    update public.orders set status = 'shipped' where id = v_order.id;
  end if;
  return v_id;
end;
$$;

-- ---- admin: record the courier's answer for an API shipment ------------------
create or replace function public.admin_complete_api_shipment(
  p_shipment_id uuid,
  p_ok boolean,
  p_consignment_id text default null,
  p_courier_fee numeric default null,
  p_provider_status text default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ship public.shipments;
begin
  if not (select public.is_admin()) then
    raise exception 'Only admins can update shipments.' using errcode = '42501';
  end if;
  select * into v_ship from public.shipments where id = p_shipment_id for update;
  if v_ship.id is null or v_ship.status <> 'pending' then
    raise exception 'This shipment is not waiting for the courier.' using errcode = 'P0001';
  end if;
  if p_ok then
    begin
      update public.shipments
        set consignment_id = nullif(btrim(coalesce(p_consignment_id, '')), ''),
            courier_fee = p_courier_fee, provider_status = p_provider_status, last_error = null
        where id = v_ship.id;
    exception when unique_violation then
      raise exception 'That consignment ID is already used by another active shipment.' using errcode = 'P0001';
    end;
    perform public.shipment_apply_status(v_ship.id, 'created', 'api', 'Created with the courier API', now(), p_provider_status, null, (select auth.uid()));
  else
    update public.shipments
      set status = 'cancelled', is_active = false, last_error = left(coalesce(p_error, 'Courier request failed'), 500)
      where id = v_ship.id;
    insert into public.shipment_events (shipment_id, status, source, note, created_by)
    values (v_ship.id, 'cancelled', 'api', left('Courier request failed: ' || coalesce(p_error, 'unknown error'), 500), (select auth.uid()));
  end if;
end;
$$;

-- ---- admin: status update ----------------------------------------------------
create or replace function public.admin_update_shipment_status(
  p_shipment_id uuid,
  p_status text,
  p_note text default null,
  p_occurred_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'Only admins can update shipments.' using errcode = '42501';
  end if;
  if p_occurred_at is not null and p_occurred_at > now() + interval '10 minutes' then
    raise exception 'The time can''t be in the future.' using errcode = 'P0001';
  end if;
  perform public.shipment_apply_status(p_shipment_id, p_status, 'manual', p_note, p_occurred_at, null, null, (select auth.uid()));
end;
$$;

-- ---- admin: correct details (audited) ------------------------------------------
create or replace function public.admin_correct_shipment(
  p_shipment_id uuid,
  p_consignment_id text,
  p_tracking_reference text,
  p_tracking_url text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ship public.shipments;
begin
  if not (select public.is_admin()) then
    raise exception 'Only admins can correct shipments.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Give a short reason for the correction.' using errcode = 'P0001';
  end if;
  select * into v_ship from public.shipments where id = p_shipment_id for update;
  if v_ship.id is null or not v_ship.is_active then
    raise exception 'Only an active shipment can be corrected.' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(p_consignment_id, '')), '') is null and nullif(btrim(coalesce(p_tracking_reference, '')), '') is null then
    raise exception 'Enter the consignment ID or a tracking reference.' using errcode = 'P0001';
  end if;
  begin
    update public.shipments
      set consignment_id = nullif(btrim(coalesce(p_consignment_id, '')), ''),
          tracking_reference = nullif(btrim(coalesce(p_tracking_reference, '')), ''),
          tracking_url = nullif(btrim(coalesce(p_tracking_url, '')), '')
      where id = v_ship.id;
  exception when unique_violation then
    raise exception 'That consignment ID is already used by another active shipment.' using errcode = 'P0001';
  end;
  insert into public.shipment_events (shipment_id, status, source, note, created_by)
  values (v_ship.id, v_ship.status, 'manual',
          left('Details corrected (was ' || coalesce(v_ship.consignment_id, v_ship.tracking_reference, '-') || '): ' || btrim(p_reason), 500),
          (select auth.uid()));
end;
$$;

-- ---- courier webhook (verified by the shared webhook secret) -----------------
create or replace function public.courier_webhook_apply(
  p_provider text,
  p_secret text,
  p_consignment_id text,
  p_merchant_order_id text,
  p_status text,
  p_provider_status text,
  p_occurred_at timestamptz,
  p_courier_fee numeric,
  p_dedupe_key text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_ship public.shipments;
begin
  select webhook_secret_hash into v_hash from public.courier_settings where provider = p_provider and is_enabled;
  if v_hash is null or p_secret is null
     or encode(extensions.digest(convert_to(p_secret, 'UTF8'), 'sha256'), 'hex') <> v_hash then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  select s.* into v_ship from public.shipments s
    where s.courier = p_provider and s.is_active
      and (s.consignment_id = nullif(btrim(coalesce(p_consignment_id, '')), '')
           or (s.consignment_id is null and exists (select 1 from public.orders o where o.id = s.order_id and o.order_number = p_merchant_order_id)))
    limit 1;
  if v_ship.id is null then
    return 'unknown_shipment';
  end if;
  if p_courier_fee is not null and p_courier_fee >= 0 then
    update public.shipments set courier_fee = p_courier_fee where id = v_ship.id;
  end if;
  if p_status is null then
    -- informational event (e.g. order.updated): keep the provider status only
    update public.shipments set provider_status = coalesce(left(p_provider_status, 60), provider_status) where id = v_ship.id;
    return 'recorded';
  end if;
  if v_ship.status = p_status then
    return 'unchanged';
  end if;
  if v_ship.status in ('delivered', 'returned') then
    return 'final';
  end if;
  return public.shipment_apply_status(v_ship.id, p_status, 'webhook', null, p_occurred_at, left(p_provider_status, 60), p_dedupe_key, null);
end;
$$;

-- ---- customer tracking ----------------------------------------------------------
create or replace function public.track_order(p_order_number text, p_phone text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number text := upper(btrim(coalesce(p_order_number, '')));
  v_phone text := regexp_replace(regexp_replace(coalesce(p_phone, ''), '[\s()-]', '', 'g'), '^\+?88', '');
  v_uid uuid := (select auth.uid());
  v_order public.orders;
  v_ship public.shipments;
begin
  if v_number !~ '^[A-Z]{2,6}-[0-9]{6}-[0-9]{1,10}$' then
    raise exception 'Enter the order number exactly as shown in your confirmation (e.g. AMG-261010-1001).' using errcode = 'P0001';
  end if;
  if p_phone is not null and v_phone !~ '^01[3-9][0-9]{8}$' then
    raise exception 'Enter the mobile number used for the order (01XXXXXXXXX).' using errcode = 'P0001';
  end if;
  if p_phone is null and v_uid is null then
    raise exception 'Enter the mobile number used for the order.' using errcode = 'P0001';
  end if;

  -- limit wrong guesses (old rows are cleaned up as we go)
  delete from public.order_tracking_failures where created_at < now() - interval '2 days';
  if p_phone is not null and (
       (select count(*) from public.order_tracking_failures where phone = v_phone and created_at > now() - interval '1 hour') >= 10
       or (select count(*) from public.order_tracking_failures where order_number = v_number and created_at > now() - interval '1 hour') >= 5) then
    raise exception 'Too many attempts. Please try again in an hour, or call the shop.' using errcode = 'P0001';
  end if;

  select * into v_order from public.orders o
    where o.order_number = v_number
      and (case when p_phone is not null then o.phone = v_phone else o.user_id = v_uid end);
  if v_order.id is null then
    if p_phone is not null then
      insert into public.order_tracking_failures (phone, order_number) values (v_phone, v_number);
    end if;
    return null; -- same answer whether the order or the phone was wrong
  end if;

  select * into v_ship from public.shipments s where s.order_id = v_order.id
    order by s.is_active desc, s.created_at desc limit 1;

  return jsonb_build_object(
    'order_number', v_order.order_number,
    'status', v_order.status,
    'placed_at', v_order.created_at,
    'updated_at', v_order.updated_at,
    'total', v_order.total,
    'delivery_zone', v_order.delivery_zone,
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', i.product_name, 'variant', i.variant_label, 'quantity', i.quantity) order by i.product_name)
                       from public.order_items i where i.order_id = v_order.id), '[]'::jsonb),
    'shipment', case when v_ship.id is null or v_ship.status = 'pending' then null else jsonb_build_object(
      'courier_name', v_ship.courier_name,
      'consignment_id', v_ship.consignment_id,
      'tracking_reference', v_ship.tracking_reference,
      'tracking_url', v_ship.tracking_url,
      'status', v_ship.status,
      'active', v_ship.is_active,
      'shipped_at', v_ship.shipped_at,
      'events', coalesce((select jsonb_agg(jsonb_build_object('status', e.status, 'at', e.occurred_at) order by e.occurred_at desc)
                          from public.shipment_events e where e.shipment_id = v_ship.id and e.status <> 'pending'), '[]'::jsonb)
    ) end
  );
end;
$$;

revoke execute on function public.admin_create_shipment(uuid, text, text, text, text, text, timestamptz, numeric, text, text) from public, anon;
revoke execute on function public.admin_complete_api_shipment(uuid, boolean, text, numeric, text, text) from public, anon;
revoke execute on function public.admin_update_shipment_status(uuid, text, text, timestamptz) from public, anon;
revoke execute on function public.admin_correct_shipment(uuid, text, text, text, text) from public, anon;
grant execute on function public.admin_create_shipment(uuid, text, text, text, text, text, timestamptz, numeric, text, text) to authenticated;
grant execute on function public.admin_complete_api_shipment(uuid, boolean, text, numeric, text, text) to authenticated;
grant execute on function public.admin_update_shipment_status(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.admin_correct_shipment(uuid, text, text, text, text) to authenticated;
grant execute on function public.courier_webhook_apply(text, text, text, text, text, text, timestamptz, numeric, text) to anon, authenticated;
grant execute on function public.track_order(text, text) to anon, authenticated;
