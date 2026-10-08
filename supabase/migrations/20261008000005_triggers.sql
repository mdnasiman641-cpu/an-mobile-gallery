-- =====================================================================
-- 0005 · Role helpers and automation triggers
-- =====================================================================

-- ---------------------------------------------------------------------
-- Role helpers (SECURITY DEFINER so RLS policies can call them cheaply)
-- ---------------------------------------------------------------------
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users
    where user_id = (select auth.uid()) and is_active
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users
    where user_id = (select auth.uid()) and is_active and role in ('super_admin', 'admin')
  );
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users
    where user_id = (select auth.uid()) and is_active and role = 'super_admin'
  );
$$;

-- ---------------------------------------------------------------------
-- New auth account -> public.users profile (+ customer record)
-- ---------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := coalesce(new.raw_user_meta_data ->> 'full_name', '');
  v_phone text := nullif(new.raw_user_meta_data ->> 'phone', '');
begin
  insert into public.users (id, email, full_name, phone)
  values (new.id, new.email, v_name, v_phone)
  on conflict (id) do nothing;

  begin
    if v_phone is not null and exists (select 1 from public.customers where phone = v_phone and user_id is null) then
      update public.customers set user_id = new.id, email = coalesce(email, new.email)
      where phone = v_phone and user_id is null;
      -- earlier guest orders with this phone now show in the new account
      update public.orders set user_id = new.id
      where user_id is null and customer_id = (select id from public.customers where user_id = new.id);
    else
      insert into public.customers (user_id, full_name, phone, email)
      values (new.id, v_name, v_phone, new.email)
      on conflict do nothing;
    end if;
  exception when others then
    -- never block sign-up because of the customer mirror
    null;
  end;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------
-- Products: derived fields + full-text search vector
-- Runs before every insert/update of a product. Child-table triggers
-- below "touch" the product so this recomputes when variants/specs change.
-- ---------------------------------------------------------------------
create or replace function public.products_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_brand text;
  v_category text;
  v_specs text;
  v_variants text;
  v_has_variants boolean;
  v_min record;
begin
  -- Counter-only updates (views, sales, ratings) skip the expensive recompute.
  if tg_op = 'UPDATE' and coalesce(current_setting('app.counters_only', true), '') = 'on' then
    return new;
  end if;

  new.updated_at := now();

  if new.status = 'active' and new.published_at is null then
    new.published_at := now();
  end if;

  select exists (select 1 from public.product_variants where product_id = new.id and status = 'active')
    into v_has_variants;

  if v_has_variants then
    -- base stock = sum of active variants; base price = cheapest variant
    select coalesce(sum(stock), 0)::int into new.stock_quantity
      from public.product_variants where product_id = new.id and status = 'active';

    select price, sale_price into v_min
      from public.product_variants
      where product_id = new.id and status = 'active'
      order by coalesce(sale_price, price) asc, sort_order asc
      limit 1;
    new.price := v_min.price;
    new.sale_price := v_min.sale_price;

    select coalesce(array_agg(distinct ram) filter (where ram is not null and ram <> ''), '{}'),
           coalesce(array_agg(distinct storage) filter (where storage is not null and storage <> ''), '{}'),
           coalesce(array_agg(distinct color) filter (where color is not null and color <> ''), '{}')
      into new.ram_options, new.storage_options, new.color_options
      from public.product_variants where product_id = new.id and status = 'active';
  else
    new.color_options := '{}';
    new.ram_options := '{}';
    new.storage_options := '{}';
  end if;

  -- products without variant data fall back to their RAM / Storage specs
  if cardinality(new.ram_options) = 0 then
    select coalesce(array_agg(distinct upper(regexp_replace(value, '\s+', '', 'g'))), '{}') into new.ram_options
      from public.product_specifications
      where product_id = new.id and lower(name) = 'ram';
  end if;
  if cardinality(new.storage_options) = 0 then
    select coalesce(array_agg(distinct upper(regexp_replace(value, '\s+', '', 'g'))), '{}') into new.storage_options
      from public.product_specifications
      where product_id = new.id and lower(name) in ('storage', 'rom', 'internal storage');
  end if;
  new.ram_options := array(select upper(regexp_replace(x, '\s+', '', 'g')) from unnest(new.ram_options) x);
  new.storage_options := array(select upper(regexp_replace(x, '\s+', '', 'g')) from unnest(new.storage_options) x);

  select name into v_brand from public.brands where id = new.brand_id;
  select name into v_category from public.categories where id = new.category_id;
  select string_agg(name || ' ' || value, ' ') into v_specs
    from public.product_specifications where product_id = new.id;
  select string_agg(concat_ws(' ', sku, storage, ram, color), ' ') into v_variants
    from public.product_variants where product_id = new.id and status = 'active';

  new.search_vector :=
      setweight(to_tsvector('simple', coalesce(new.name, '') || ' ' || coalesce(new.model, '') || ' ' || coalesce(v_brand, '')), 'A')
   || setweight(to_tsvector('simple', coalesce(new.sku, '') || ' ' || coalesce(v_category, '') || ' ' || coalesce(v_variants, '') || ' ' || new.condition), 'B')
   || setweight(to_tsvector('simple', coalesce(v_specs, '')), 'C')
   || setweight(to_tsvector('simple', coalesce(new.short_description, '') || ' ' || left(coalesce(new.description, ''), 4000)), 'D');

  return new;
end;
$$;

create trigger products_before_write
  before insert or update on public.products
  for each row execute function public.products_before_write();

-- Child tables "touch" the parent product so derived fields recompute.
create or replace function public.touch_parent_product()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.products set updated_at = now() where id = old.product_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.product_id is distinct from old.product_id) then
    update public.products set updated_at = now() where id = new.product_id;
  end if;
  return null;
end;
$$;

create trigger variants_touch_product
  after insert or update or delete on public.product_variants
  for each row execute function public.touch_parent_product();

create trigger specs_touch_product
  after insert or update or delete on public.product_specifications
  for each row execute function public.touch_parent_product();

-- Renaming a brand or category refreshes the search text of its products.
create or replace function public.touch_products_of_taxonomy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.name is distinct from old.name then
    if tg_table_name = 'brands' then
      update public.products set updated_at = now() where brand_id = new.id;
    else
      update public.products set updated_at = now() where category_id = new.id;
    end if;
  end if;
  return null;
end;
$$;

create trigger brands_touch_products after update of name on public.brands
  for each row execute function public.touch_products_of_taxonomy();
create trigger categories_touch_products after update of name on public.categories
  for each row execute function public.touch_products_of_taxonomy();

-- ---------------------------------------------------------------------
-- Slug changes -> permanent redirects (old URLs keep working)
-- ---------------------------------------------------------------------
create or replace function public.record_slug_redirect()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity text := case tg_table_name when 'products' then 'product' when 'brands' then 'brand' else 'category' end;
begin
  if new.slug is distinct from old.slug then
    -- the new slug is live again, so it must not redirect anywhere
    delete from public.slug_redirects where entity = v_entity and old_slug = new.slug;
    -- collapse chains: anything that pointed at the old slug now points at the new one
    update public.slug_redirects set new_slug = new.slug where entity = v_entity and new_slug = old.slug;
    insert into public.slug_redirects (entity, old_slug, new_slug)
    values (v_entity, old.slug, new.slug)
    on conflict (entity, old_slug) do update set new_slug = excluded.new_slug;
  end if;
  return null;
end;
$$;

create trigger products_slug_redirect after update of slug on public.products
  for each row execute function public.record_slug_redirect();
create trigger brands_slug_redirect after update of slug on public.brands
  for each row execute function public.record_slug_redirect();
create trigger categories_slug_redirect after update of slug on public.categories
  for each row execute function public.record_slug_redirect();

-- ---------------------------------------------------------------------
-- Product images: keep exactly one primary image
-- ---------------------------------------------------------------------
create or replace function public.product_images_primary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_primary then
    update public.product_images set is_primary = false
      where product_id = new.product_id and id <> new.id and is_primary;
  elsif not exists (select 1 from public.product_images where product_id = new.product_id and is_primary and id <> new.id) then
    new.is_primary := true;
  end if;
  return new;
end;
$$;

create trigger product_images_primary
  before insert or update of is_primary on public.product_images
  for each row execute function public.product_images_primary();

-- When the primary image is deleted, promote the next one.
create or replace function public.product_images_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_primary then
    update public.product_images set is_primary = true
    where id = (
      select id from public.product_images
      where product_id = old.product_id
      order by sort_order, created_at
      limit 1
    );
  end if;
  return null;
end;
$$;

create trigger product_images_after_delete
  after delete on public.product_images
  for each row execute function public.product_images_after_delete();

-- ---------------------------------------------------------------------
-- Reviews: force moderation + verified-purchase flag + rating aggregate
-- ---------------------------------------------------------------------
create or replace function public.reviews_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_staff() then
    new.status := 'pending';
    new.user_id := (select auth.uid());
  end if;
  new.is_verified_purchase := exists (
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

create trigger reviews_before_insert
  before insert on public.reviews
  for each row execute function public.reviews_before_insert();

create or replace function public.refresh_product_rating()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product uuid := coalesce(new.product_id, old.product_id);
begin
  perform set_config('app.counters_only', 'on', true);
  update public.products p
  set rating_avg = coalesce(r.avg_rating, 0),
      rating_count = coalesce(r.cnt, 0)
  from (
    select round(avg(rating)::numeric, 2) as avg_rating, count(*)::int as cnt
    from public.reviews
    where product_id = v_product and status = 'approved'
  ) r
  where p.id = v_product;
  perform set_config('app.counters_only', 'off', true);
  return null;
end;
$$;

create trigger reviews_refresh_rating
  after insert or update or delete on public.reviews
  for each row execute function public.refresh_product_rating();
