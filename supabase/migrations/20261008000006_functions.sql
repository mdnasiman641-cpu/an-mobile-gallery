-- =====================================================================
-- 0006 · Search, checkout and admin functions (RPC)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Search helpers
-- ---------------------------------------------------------------------

-- "Samsung 12 GB RAM" -> 'samsung':* & '12gb':* & 'ram':*
create or replace function public.build_search_tsquery(p_query text)
returns tsquery
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_norm text;
  v_terms text;
begin
  if p_query is null or btrim(p_query) = '' then
    return null;
  end if;
  v_norm := lower(left(p_query, 200));
  -- glue units to numbers so "12 GB" matches "12GB"
  v_norm := regexp_replace(v_norm, '([0-9]+)\s*(gb|tb|mb|mp|mah|hz|w|inch)\y', '\1\2', 'g');
  v_norm := btrim(regexp_replace(v_norm, '[^a-z0-9]+', ' ', 'g'));
  if v_norm = '' then
    return null;
  end if;
  select string_agg(t || ':*', ' & ') into v_terms
  from unnest(regexp_split_to_array(v_norm, '\s+')) as t
  where t <> '';
  return to_tsquery('simple', v_terms);
end;
$$;

-- Sort key for "4GB", "512GB", "1TB" style values.
create or replace function public.capacity_sort_key(p_value text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value ~* '[0-9.]+\s*tb' then (substring(p_value from '([0-9.]+)'))::numeric * 1024
    when p_value ~ '[0-9]' then (substring(p_value from '([0-9.]+)'))::numeric
    else 0
  end;
$$;

-- ---------------------------------------------------------------------
-- Product search with filters, sorting and pagination.
-- SECURITY INVOKER: RLS decides what the caller may see.
-- ---------------------------------------------------------------------
create or replace function public.search_products(
  p_query text default null,
  p_brands text[] default null,
  p_category text default null,
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_ram text[] default null,
  p_storage text[] default null,
  p_conditions text[] default null,
  p_in_stock boolean default null,
  p_flag text default null,
  p_sort text default 'relevance',
  p_limit int default 24,
  p_offset int default 0
)
returns table (
  id uuid,
  slug text,
  name text,
  brand_name text,
  brand_slug text,
  category_slug text,
  price numeric,
  sale_price numeric,
  stock_quantity int,
  low_stock_threshold int,
  condition text,
  status text,
  featured boolean,
  is_new boolean,
  is_offer boolean,
  is_best_seller boolean,
  image_url text,
  image_alt text,
  rating_avg numeric,
  rating_count int,
  ram_options text[],
  storage_options text[],
  created_at timestamptz,
  rank real,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with recursive
  params0 as (
    select public.build_search_tsquery(p_query) as tsq,
           nullif(btrim(left(p_query, 200)), '') as q
  ),
  -- Fuzzy (typo-tolerant) matching is only used when exact search finds nothing.
  params as (
    select p0.tsq, p0.q,
           (p0.q is not null and not exists (
             select 1 from public.products x
             where x.status in ('active', 'out_of_stock')
               and p0.tsq is not null and x.search_vector @@ p0.tsq
           )) as use_fuzzy
    from params0 p0
  ),
  cat_tree as (
    select c.id from public.categories c where p_category is not null and c.slug = p_category
    union all
    select c.id from public.categories c join cat_tree t on c.parent_id = t.id
  ),
  base as (
    select
      p.*,
      b.name as b_name,
      b.slug as b_slug,
      c.slug as c_slug,
      case
        when prm.q is null then 0::real
        else (
          case when prm.tsq is not null and p.search_vector @@ prm.tsq then ts_rank_cd(p.search_vector, prm.tsq) else 0 end
          + case when prm.use_fuzzy then word_similarity(prm.q, p.name) else 0 end
        )::real
      end as rnk
    from public.products p
    cross join params prm
    left join public.brands b on b.id = p.brand_id
    left join public.categories c on c.id = p.category_id
    where p.status in ('active', 'out_of_stock')
      and (
        prm.q is null
        or (prm.tsq is not null and p.search_vector @@ prm.tsq)
        or (prm.use_fuzzy and char_length(prm.q) >= 3 and word_similarity(prm.q, p.name) >= 0.45)
      )
      and (p_brands is null or cardinality(p_brands) = 0 or b.slug = any (p_brands))
      and (p_category is null or p.category_id in (select ct.id from cat_tree ct))
      and (p_min_price is null or coalesce(p.sale_price, p.price) >= p_min_price)
      and (p_max_price is null or coalesce(p.sale_price, p.price) <= p_max_price)
      and (p_ram is null or cardinality(p_ram) = 0 or p.ram_options && p_ram)
      and (p_storage is null or cardinality(p_storage) = 0 or p.storage_options && p_storage)
      and (p_conditions is null or cardinality(p_conditions) = 0 or p.condition = any (p_conditions))
      and (
        p_in_stock is null
        or (p_in_stock and p.status = 'active' and p.stock_quantity > 0)
        or (not p_in_stock and (p.status = 'out_of_stock' or p.stock_quantity = 0))
      )
      and (
        p_flag is null
        or (p_flag = 'featured' and p.featured)
        or (p_flag = 'new' and p.is_new)
        or (p_flag = 'offer' and (p.is_offer or p.sale_price is not null))
        or (p_flag = 'best_seller' and p.is_best_seller)
        or (p_flag = 'used' and p.condition in ('used', 'refurbished'))
      )
  )
  select
    base.id,
    base.slug,
    base.name,
    base.b_name,
    base.b_slug,
    base.c_slug,
    base.price,
    base.sale_price,
    base.stock_quantity,
    base.low_stock_threshold,
    base.condition,
    base.status,
    base.featured,
    base.is_new,
    base.is_offer,
    base.is_best_seller,
    img.url,
    img.alt_text,
    base.rating_avg,
    base.rating_count,
    base.ram_options,
    base.storage_options,
    base.created_at,
    base.rnk,
    count(*) over () as total_count
  from base
  left join lateral (
    select i.url, i.alt_text
    from public.product_images i
    where i.product_id = base.id
    order by i.is_primary desc, i.sort_order asc
    limit 1
  ) img on true
  order by
    case when p_sort = 'price_asc' then coalesce(base.sale_price, base.price) end asc nulls last,
    case when p_sort = 'price_desc' then coalesce(base.sale_price, base.price) end desc nulls last,
    case when p_sort = 'newest' then base.created_at end desc nulls last,
    case when p_sort = 'popular' then base.sales_count * 5 + base.view_count end desc nulls last,
    case when coalesce(p_sort, 'relevance') = 'relevance' then base.rnk end desc nulls last,
    (base.status = 'active' and base.stock_quantity > 0) desc,
    base.featured desc,
    base.created_at desc
  limit least(greatest(coalesce(p_limit, 24), 1), 60)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- Facet values for the filter sidebar (optionally scoped to a category).
create or replace function public.get_filter_options(p_category text default null)
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with recursive cat_tree as (
    select c.id from public.categories c where p_category is not null and c.slug = p_category
    union all
    select c.id from public.categories c join cat_tree t on c.parent_id = t.id
  ),
  visible as (
    select p.*
    from public.products p
    where p.status in ('active', 'out_of_stock')
      and (p_category is null or p.category_id in (select ct.id from cat_tree ct))
  )
  select jsonb_build_object(
    'ram', coalesce((
      select jsonb_agg(v order by public.capacity_sort_key(v))
      from (select distinct unnest(ram_options) v from visible) r
    ), '[]'::jsonb),
    'storage', coalesce((
      select jsonb_agg(v order by public.capacity_sort_key(v))
      from (select distinct unnest(storage_options) v from visible) s
    ), '[]'::jsonb),
    'brands', coalesce((
      select jsonb_agg(jsonb_build_object('name', b.name, 'slug', b.slug, 'count', x.cnt) order by b.name)
      from (select brand_id, count(*) cnt from visible where brand_id is not null group by brand_id) x
      join public.brands b on b.id = x.brand_id
    ), '[]'::jsonb),
    'conditions', coalesce((select jsonb_agg(distinct condition) from visible), '[]'::jsonb),
    'price_min', (select floor(min(coalesce(sale_price, price))) from visible),
    'price_max', (select ceil(max(coalesce(sale_price, price))) from visible)
  );
$$;

-- ---------------------------------------------------------------------
-- Coupons
-- ---------------------------------------------------------------------
create or replace function public.coupon_discount(
  p_coupon public.coupons,
  p_subtotal numeric,
  out discount numeric,
  out message text
)
language plpgsql
stable
set search_path = ''
as $$
begin
  discount := null;
  if p_coupon.id is null or not p_coupon.is_active then
    message := 'This coupon code is not valid.';
  elsif p_coupon.starts_at is not null and now() < p_coupon.starts_at then
    message := 'This coupon is not active yet.';
  elsif p_coupon.ends_at is not null and now() > p_coupon.ends_at then
    message := 'This coupon has expired.';
  elsif p_coupon.usage_limit is not null and p_coupon.used_count >= p_coupon.usage_limit then
    message := 'This coupon has reached its usage limit.';
  elsif p_subtotal < p_coupon.min_order_amount then
    message := format('Add items worth ৳%s or more to use this coupon.', to_char(p_coupon.min_order_amount, 'FM999,999,990'));
  else
    if p_coupon.discount_type = 'percent' then
      discount := round(p_subtotal * p_coupon.discount_value / 100);
    else
      discount := p_coupon.discount_value;
    end if;
    if p_coupon.max_discount_amount is not null then
      discount := least(discount, p_coupon.max_discount_amount);
    end if;
    discount := least(discount, p_subtotal);
    message := 'Coupon applied.';
  end if;
end;
$$;

create or replace function public.validate_coupon(p_code text, p_subtotal numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_coupon public.coupons;
  v_result record;
begin
  select * into v_coupon from public.coupons where code = upper(btrim(coalesce(p_code, '')));
  select * into v_result from public.coupon_discount(v_coupon, coalesce(p_subtotal, 0));
  return jsonb_build_object(
    'valid', v_result.discount is not null,
    'code', v_coupon.code,
    'discount', coalesce(v_result.discount, 0),
    'message', v_result.message
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Checkout: prices, stock and totals are computed here from the database,
-- never trusted from the browser. Runs in one transaction with row locks.
-- ---------------------------------------------------------------------
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
    select id into v_customer_id from public.customers where user_id = v_uid;
  end if;
  if v_customer_id is null then
    select id, user_id into v_customer_id, v_customer_user from public.customers where phone = v_phone;
    if v_customer_id is not null and v_uid is not null and v_customer_user is null then
      update public.customers set user_id = v_uid where id = v_customer_id;
    end if;
  end if;
  if v_customer_id is null then
    insert into public.customers (user_id, full_name, phone, email, address, city, area)
    values (v_uid, v_name, v_phone, v_email, v_address, v_city, v_area)
    returning id into v_customer_id;
  else
    update public.customers
      set full_name = case when full_name = '' then v_name else full_name end,
          phone = coalesce(phone, case when not exists (select 1 from public.customers c2 where c2.phone = v_phone) then v_phone end),
          email = coalesce(email, v_email),
          address = v_address,
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

-- Guest order lookup for the confirmation page (needs number + phone).
create or replace function public.get_order_confirmation(p_order_number text, p_phone text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'order_number', o.order_number,
    'status', o.status,
    'customer_name', o.customer_name,
    'phone', o.phone,
    'address', o.address,
    'delivery_zone', o.delivery_zone,
    'subtotal', o.subtotal,
    'discount', o.discount,
    'delivery_charge', o.delivery_charge,
    'total', o.total,
    'payment_method', o.payment_method,
    'created_at', o.created_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_name', i.product_name, 'variant_label', i.variant_label,
        'quantity', i.quantity, 'unit_price', i.unit_price, 'line_total', i.line_total,
        'image_url', i.image_url, 'product_slug', i.product_slug
      ) order by i.created_at)
      from public.order_items i where i.order_id = o.id
    ), '[]'::jsonb)
  )
  from public.orders o
  where o.order_number = p_order_number
    and o.phone = regexp_replace(regexp_replace(coalesce(p_phone, ''), '[\s()-]', '', 'g'), '^\+?88', '');
$$;

-- ---------------------------------------------------------------------
-- Product views (powers "Popular" sorting and "Frequently viewed")
-- ---------------------------------------------------------------------
create or replace function public.record_product_view(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('app.counters_only', 'on', true);
  update public.products set view_count = view_count + 1
    where id = p_product_id and status in ('active', 'out_of_stock');
  perform set_config('app.counters_only', 'off', true);
end;
$$;

-- ---------------------------------------------------------------------
-- Admin: order status (restocks automatically on cancellation)
-- ---------------------------------------------------------------------
create or replace function public.admin_update_order(
  p_order_id uuid,
  p_status text,
  p_payment_status text default null,
  p_admin_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_item public.order_items;
  v_new_stock int;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if p_status not in ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled') then
    raise exception 'Unknown order status.' using errcode = 'P0001';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'Order not found.' using errcode = 'P0001';
  end if;
  if v_order.status = 'cancelled' and p_status <> 'cancelled' then
    raise exception 'A cancelled order cannot be reopened. Create a new order instead.' using errcode = 'P0001';
  end if;

  if p_status = 'cancelled' and v_order.status <> 'cancelled' then
    for v_item in select * from public.order_items where order_id = v_order.id loop
      v_new_stock := null;
      if v_item.variant_id is not null then
        update public.product_variants set stock = stock + v_item.quantity
          where id = v_item.variant_id returning stock into v_new_stock;
      end if;
      if v_new_stock is null and v_item.product_id is not null and v_item.variant_id is null then
        update public.products set stock_quantity = stock_quantity + v_item.quantity
          where id = v_item.product_id returning stock_quantity into v_new_stock;
      end if;
      if v_new_stock is not null and v_item.product_id is not null then
        insert into public.inventory (product_id, variant_id, change, stock_after, reason, order_id, created_by, note)
        values (v_item.product_id, v_item.variant_id, v_item.quantity, v_new_stock, 'order_cancelled', v_order.id,
                (select auth.uid()), 'Order ' || v_order.order_number || ' cancelled');
      end if;
      if v_item.product_id is not null then
        perform set_config('app.counters_only', 'on', true);
        update public.products set sales_count = greatest(sales_count - v_item.quantity, 0) where id = v_item.product_id;
        perform set_config('app.counters_only', 'off', true);
      end if;
    end loop;
    if v_order.coupon_id is not null then
      update public.coupons set used_count = greatest(used_count - 1, 0) where id = v_order.coupon_id;
    end if;
  end if;

  update public.orders
    set status = p_status,
        payment_status = coalesce(p_payment_status, payment_status),
        admin_note = coalesce(p_admin_note, admin_note)
    where id = v_order.id;
end;
$$;

-- ---------------------------------------------------------------------
-- Admin: stock adjustment with history
-- ---------------------------------------------------------------------
create or replace function public.admin_adjust_stock(
  p_product_id uuid,
  p_variant_id uuid,
  p_change int,
  p_reason text default 'adjustment',
  p_note text default null
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_stock int;
begin
  if not public.is_staff() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if p_reason not in ('initial', 'restock', 'return', 'adjustment', 'damage') then
    raise exception 'Unknown stock reason.' using errcode = 'P0001';
  end if;
  if p_change = 0 then
    raise exception 'Enter a quantity other than zero.' using errcode = 'P0001';
  end if;

  begin
    if p_variant_id is not null then
      update public.product_variants set stock = stock + p_change
        where id = p_variant_id and product_id = p_product_id
        returning stock into v_new_stock;
    else
      if exists (select 1 from public.product_variants where product_id = p_product_id and status = 'active') then
        raise exception 'This product has variants. Adjust the stock of each variant instead.' using errcode = 'P0001';
      end if;
      update public.products set stock_quantity = stock_quantity + p_change
        where id = p_product_id
        returning stock_quantity into v_new_stock;
    end if;
  exception when check_violation then
    raise exception 'Stock cannot go below zero.' using errcode = 'P0001';
  end;

  if v_new_stock is null then
    raise exception 'Product or variant not found.' using errcode = 'P0001';
  end if;

  insert into public.inventory (product_id, variant_id, change, stock_after, reason, note, created_by)
  values (p_product_id, p_variant_id, p_change, v_new_stock, p_reason, nullif(btrim(coalesce(p_note, '')), ''), (select auth.uid()));

  return v_new_stock;
end;
$$;

-- ---------------------------------------------------------------------
-- Admin: duplicate a product (as a draft) with all of its children
-- ---------------------------------------------------------------------
create or replace function public.duplicate_product(p_product_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new uuid;
begin
  if not public.is_staff() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  insert into public.products (
    brand_id, category_id, name, model, slug, sku, barcode, mpn, short_description, description,
    price, sale_price, stock_quantity, low_stock_threshold, condition, status, featured, is_new,
    is_offer, is_best_seller, warranty, meta_title, meta_description, is_demo
  )
  select brand_id, category_id, left(name || ' (Copy)', 200), model, '', null, null, mpn, short_description, description,
         price, sale_price, 0, low_stock_threshold, condition, 'draft', false, is_new,
         is_offer, is_best_seller, warranty, null, null, is_demo
  from public.products where id = p_product_id
  returning id into v_new;

  if v_new is null then
    raise exception 'Product not found.' using errcode = 'P0001';
  end if;

  insert into public.product_variants (product_id, sku, storage, ram, color, color_hex, price, sale_price, stock, image_url, status, sort_order)
  select v_new, null, storage, ram, color, color_hex, price, sale_price, 0, image_url, status, sort_order
  from public.product_variants where product_id = p_product_id;

  insert into public.product_images (product_id, url, storage_path, alt_text, is_primary, sort_order, width, height)
  select v_new, url, storage_path, alt_text, is_primary, sort_order, width, height
  from public.product_images where product_id = p_product_id
  order by is_primary desc;

  insert into public.product_specifications (product_id, group_name, name, value, sort_order)
  select v_new, group_name, name, value, sort_order
  from public.product_specifications where product_id = p_product_id;

  insert into public.product_features (product_id, feature, sort_order)
  select v_new, feature, sort_order
  from public.product_features where product_id = p_product_id;

  insert into public.product_costs (product_id, cost_price, supplier, internal_note)
  select v_new, cost_price, supplier, internal_note
  from public.product_costs where product_id = p_product_id;

  return v_new;
end;
$$;

-- ---------------------------------------------------------------------
-- Admin: dashboard numbers
-- ---------------------------------------------------------------------
create or replace function public.dashboard_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_catalog jsonb;
  v_sales jsonb := null;
begin
  if not public.is_staff() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'total_products', count(*) filter (where status <> 'archived'),
    'active_products', count(*) filter (where status = 'active'),
    'out_of_stock', count(*) filter (where status = 'out_of_stock' or (status = 'active' and stock_quantity = 0)),
    'low_stock', count(*) filter (where status = 'active' and stock_quantity > 0 and stock_quantity <= low_stock_threshold),
    'draft_products', count(*) filter (where status = 'draft')
  ) into v_catalog
  from public.products;

  if public.is_admin() then
    select jsonb_build_object(
      'total_orders', (select count(*) from public.orders),
      'pending_orders', (select count(*) from public.orders where status = 'pending'),
      'completed_orders', (select count(*) from public.orders where status = 'delivered'),
      'cancelled_orders', (select count(*) from public.orders where status = 'cancelled'),
      'total_customers', (select count(*) from public.customers),
      'total_sales', (select coalesce(sum(total), 0) from public.orders where status <> 'cancelled'),
      'delivered_sales', (select coalesce(sum(total), 0) from public.orders where status = 'delivered'),
      'pending_reviews', (select count(*) from public.reviews where status = 'pending'),
      'sales_by_day', (
        select jsonb_agg(jsonb_build_object('day', d.day, 'total', coalesce(s.total, 0), 'orders', coalesce(s.orders, 0)) order by d.day)
        from (
          select generate_series(
            (now() at time zone 'Asia/Dhaka')::date - 13,
            (now() at time zone 'Asia/Dhaka')::date,
            interval '1 day'
          )::date as day
        ) d
        left join (
          select (created_at at time zone 'Asia/Dhaka')::date as day, sum(total) as total, count(*) as orders
          from public.orders
          where status <> 'cancelled' and created_at >= now() - interval '15 days'
          group by 1
        ) s on s.day = d.day
      )
    ) into v_sales;
  end if;

  return v_catalog || coalesce(v_sales, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------
-- Execute permissions
-- ---------------------------------------------------------------------
revoke execute on function public.admin_update_order(uuid, text, text, text) from public, anon;
revoke execute on function public.admin_adjust_stock(uuid, uuid, int, text, text) from public, anon;
revoke execute on function public.duplicate_product(uuid) from public, anon;
revoke execute on function public.dashboard_stats() from public, anon;
grant execute on function public.admin_update_order(uuid, text, text, text) to authenticated;
grant execute on function public.admin_adjust_stock(uuid, uuid, int, text, text) to authenticated;
grant execute on function public.duplicate_product(uuid) to authenticated;
grant execute on function public.dashboard_stats() to authenticated;

grant execute on function public.search_products(text, text[], text, numeric, numeric, text[], text[], text[], boolean, text, text, int, int) to anon, authenticated;
grant execute on function public.get_filter_options(text) to anon, authenticated;
grant execute on function public.validate_coupon(text, numeric) to anon, authenticated;
grant execute on function public.place_order(jsonb) to anon, authenticated;
grant execute on function public.get_order_confirmation(text, text) to anon, authenticated;
grant execute on function public.record_product_view(uuid) to anon, authenticated;
