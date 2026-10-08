-- =====================================================================
-- 0009 · Fixes from the pre-deployment audit
--   1. Reviews: moderation is forced only for signed-in customers, so the
--      owner can import reviews through the SQL Editor / service role.
--   2. Storage: listing files in the "media" bucket is staff-only. Public
--      image URLs keep working because the bucket itself is public.
--   3. place_order(): a guest using a registered customer's phone number no
--      longer overwrites that customer's saved address, and a signed-in
--      customer never gets attached to another account's customer record.
-- =====================================================================

-- 1 ------------------------------------------------------------------------
create or replace function public.reviews_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and not public.is_staff() then
    new.status := 'pending';
    new.user_id := (select auth.uid());
  end if;
  new.is_verified_purchase := new.user_id is not null and exists (
    select 1
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.user_id = new.user_id
      and o.status = 'delivered'
      and oi.product_id = new.product_id
  );
  return new;
end;
$$;

-- 2 ------------------------------------------------------------------------
drop policy if exists "media: public read" on storage.objects;
create policy "media: staff read" on storage.objects for select to authenticated
  using (bucket_id = 'media' and (select public.is_staff()));

-- 3 ------------------------------------------------------------------------
create or replace function public.place_order(p_order jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text := btrim(coalesce(p_order ->> 'customer_name', ''));
  v_phone text := regexp_replace(coalesce(p_order ->> 'phone', ''), '[\s()-]', '', 'g');
  v_email text := nullif(lower(btrim(coalesce(p_order ->> 'email', ''))), '');
  v_address text := btrim(coalesce(p_order ->> 'address', ''));
  v_city text := nullif(btrim(coalesce(p_order ->> 'city', '')), '');
  v_area text := nullif(btrim(coalesce(p_order ->> 'area', '')), '');
  v_zone text := coalesce(p_order ->> 'delivery_zone', 'inside_dhaka');
  v_note text := nullif(left(btrim(coalesce(p_order ->> 'note', '')), 500), '');
  v_payment text := coalesce(p_order ->> 'payment_method', 'cod');
  v_coupon_code text := nullif(upper(btrim(coalesce(p_order ->> 'coupon_code', ''))), '');
  v_items jsonb := p_order -> 'items';
  v_settings public.site_settings;
  v_customer_id uuid;
  v_customer_user uuid;
  v_order_id uuid;
  v_order_number text;
  v_item jsonb;
  v_product public.products;
  v_variant public.product_variants;
  v_qty int;
  v_unit numeric;
  v_label text;
  v_image text;
  v_sku text;
  v_new_stock int;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_delivery numeric := 0;
  v_coupon public.coupons;
  v_coupon_result record;
begin
  -- ---- validation ----------------------------------------------------
  if char_length(v_name) < 2 or char_length(v_name) > 100 then
    raise exception 'Please enter your full name.' using errcode = 'P0001';
  end if;
  v_phone := regexp_replace(v_phone, '^\+?88', '');
  if v_phone !~ '^01[3-9][0-9]{8}$' then
    raise exception 'Please enter a valid Bangladeshi mobile number (01XXXXXXXXX).' using errcode = 'P0001';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Please enter a valid email address or leave it empty.' using errcode = 'P0001';
  end if;
  if v_zone not in ('inside_dhaka', 'outside_dhaka', 'store_pickup') then
    raise exception 'Please choose a delivery area.' using errcode = 'P0001';
  end if;
  if v_zone <> 'store_pickup' and char_length(v_address) < 5 then
    raise exception 'Please enter your full delivery address.' using errcode = 'P0001';
  end if;
  if v_zone = 'store_pickup' and v_address = '' then
    v_address := 'Store pickup';
  end if;
  if v_payment <> 'cod' then
    raise exception 'Only Cash on Delivery is available right now.' using errcode = 'P0001';
  end if;
  if v_items is null or jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    raise exception 'Your cart is empty.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(v_items) > 20 then
    raise exception 'Too many different items in one order. Please split it into two orders.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.orders
      where phone = v_phone and status = 'pending' and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'You have several pending orders. Please wait for us to confirm them or call the shop.' using errcode = 'P0001';
  end if;

  select * into v_settings from public.site_settings where id = 1;

  -- ---- customer ------------------------------------------------------
  if v_uid is not null then
    -- signed-in: own record, else claim a guest record with this phone,
    -- never a record that belongs to another account
    select id into v_customer_id from public.customers where user_id = v_uid;
    if v_customer_id is null then
      update public.customers set user_id = v_uid
        where phone = v_phone and user_id is null
        returning id into v_customer_id;
    end if;
    if v_customer_id is null then
      insert into public.customers (user_id, full_name, phone, email, address, city, area)
      values (v_uid, v_name,
              case when exists (select 1 from public.customers c2 where c2.phone = v_phone) then null else v_phone end,
              v_email, v_address, v_city, v_area)
      returning id into v_customer_id;
    end if;
  else
    -- guest: group orders by phone number
    select id, user_id into v_customer_id, v_customer_user from public.customers where phone = v_phone;
    if v_customer_id is null then
      insert into public.customers (full_name, phone, email, address, city, area)
      values (v_name, v_phone, v_email, v_address, v_city, v_area)
      returning id into v_customer_id;
    end if;
  end if;

  -- Saved details are refreshed only by the account owner or for guest-only
  -- records, so a guest typing someone's number can't overwrite their profile.
  if v_uid is not null or v_customer_user is null then
    update public.customers
      set full_name = case when full_name = '' then v_name else full_name end,
          phone = coalesce(phone, case when not exists (select 1 from public.customers c2 where c2.phone = v_phone) then v_phone end),
          email = coalesce(email, v_email),
          address = case when v_zone = 'store_pickup' then address else v_address end,
          city = coalesce(v_city, city),
          area = coalesce(v_area, area)
      where id = v_customer_id;
  end if;

  -- ---- order header --------------------------------------------------
  v_order_number := 'AMG-' || to_char(now() at time zone 'Asia/Dhaka', 'YYMMDD') || '-' || nextval('public.order_number_seq');
  insert into public.orders (
    order_number, customer_id, user_id, customer_name, phone, email, address, city, area,
    delivery_zone, note, payment_method
  ) values (
    v_order_number, v_customer_id, v_uid, v_name, v_phone, v_email, v_address, v_city, v_area,
    v_zone, v_note, v_payment
  ) returning id into v_order_id;

  -- ---- items ---------------------------------------------------------
  for v_item in select * from jsonb_array_elements(v_items) loop
    begin
      v_qty := (v_item ->> 'quantity')::int;
    exception when others then
      v_qty := 0;
    end;
    if v_qty is null or v_qty < 1 or v_qty > 10 then
      raise exception 'Quantity must be between 1 and 10 for each item.' using errcode = 'P0001';
    end if;

    select * into v_product from public.products
      where id = nullif(v_item ->> 'product_id', '')::uuid
      for update;
    if v_product.id is null or v_product.status <> 'active' then
      raise exception 'An item in your cart is no longer available. Please review your cart.' using errcode = 'P0001';
    end if;

    v_image := (select url from public.product_images where product_id = v_product.id order by is_primary desc, sort_order limit 1);

    if nullif(v_item ->> 'variant_id', '') is not null then
      select * into v_variant from public.product_variants
        where id = (v_item ->> 'variant_id')::uuid and product_id = v_product.id and status = 'active'
        for update;
      if v_variant.id is null then
        raise exception 'The selected option of % is no longer available.', v_product.name using errcode = 'P0001';
      end if;
      if v_variant.stock < v_qty then
        raise exception 'Only % left of % (%).', v_variant.stock, v_product.name,
          concat_ws(' / ', v_variant.storage, v_variant.color) using errcode = 'P0001';
      end if;
      v_unit := coalesce(v_variant.sale_price, v_variant.price);
      v_label := nullif(concat_ws(' / ',
        v_variant.storage,
        case when v_variant.ram is not null and v_variant.ram <> '' then v_variant.ram || ' RAM' end,
        v_variant.color), '');
      v_sku := coalesce(v_variant.sku, v_product.sku);
      v_image := coalesce(v_variant.image_url, v_image);
      update public.product_variants set stock = stock - v_qty where id = v_variant.id
        returning stock into v_new_stock;
    else
      if exists (select 1 from public.product_variants where product_id = v_product.id and status = 'active') then
        raise exception 'Please choose an option (storage/colour) for %.', v_product.name using errcode = 'P0001';
      end if;
      if v_product.stock_quantity < v_qty then
        raise exception 'Only % left of %.', v_product.stock_quantity, v_product.name using errcode = 'P0001';
      end if;
      v_unit := coalesce(v_product.sale_price, v_product.price);
      v_label := null;
      v_sku := v_product.sku;
      v_variant := null;
      update public.products set stock_quantity = stock_quantity - v_qty where id = v_product.id
        returning stock_quantity into v_new_stock;
    end if;

    insert into public.inventory (product_id, variant_id, change, stock_after, reason, order_id, created_by)
    values (v_product.id, v_variant.id, -v_qty, v_new_stock, 'sale', v_order_id, v_uid);

    insert into public.order_items (
      order_id, product_id, variant_id, product_name, product_slug, variant_label, sku, image_url,
      unit_price, quantity, line_total
    ) values (
      v_order_id, v_product.id, v_variant.id, v_product.name, v_product.slug, v_label, v_sku, v_image,
      v_unit, v_qty, v_unit * v_qty
    );

    perform set_config('app.counters_only', 'on', true);
    update public.products set sales_count = sales_count + v_qty where id = v_product.id;
    perform set_config('app.counters_only', 'off', true);

    v_subtotal := v_subtotal + v_unit * v_qty;
    v_variant := null;
  end loop;

  -- ---- coupon --------------------------------------------------------
  if v_coupon_code is not null then
    select * into v_coupon from public.coupons where code = v_coupon_code for update;
    select * into v_coupon_result from public.coupon_discount(v_coupon, v_subtotal);
    if v_coupon_result.discount is null then
      raise exception '%', v_coupon_result.message using errcode = 'P0001';
    end if;
    v_discount := v_coupon_result.discount;
    update public.coupons set used_count = used_count + 1 where id = v_coupon.id;
  end if;

  -- ---- delivery ------------------------------------------------------
  v_delivery := case v_zone
    when 'store_pickup' then 0
    when 'outside_dhaka' then coalesce(v_settings.delivery_charge_outside_dhaka, 0)
    else coalesce(v_settings.delivery_charge_inside_dhaka, 0)
  end;
  if coalesce(v_settings.free_delivery_threshold, 0) > 0 and v_subtotal - v_discount >= v_settings.free_delivery_threshold then
    v_delivery := 0;
  end if;

  update public.orders
    set subtotal = v_subtotal,
        discount = v_discount,
        delivery_charge = v_delivery,
        total = v_subtotal - v_discount + v_delivery,
        coupon_id = v_coupon.id,
        coupon_code = v_coupon.code
    where id = v_order_id;

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'subtotal', v_subtotal,
    'discount', v_discount,
    'delivery_charge', v_delivery,
    'total', v_subtotal - v_discount + v_delivery
  );
end;
$$;

grant execute on function public.place_order(jsonb) to anon, authenticated;
