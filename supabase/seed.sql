-- =====================================================================
-- Seed data
--
-- STARTER DATA (kept): brands and categories — real structure for the store.
-- DEMO DATA (is_demo = true): products, banners and a coupon used only for
-- testing. Prices and stock are illustrative. Remove all demo rows with:
--     supabase/scripts/delete-demo-data.sql
-- No reviews or orders are seeded: reviews must come from real customers.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Starter brands
-- ---------------------------------------------------------------------
insert into public.brands (name, slug, is_featured, sort_order, description) values
  ('Apple',   'apple',   true, 1,  'iPhone and Apple accessories.'),
  ('Samsung', 'samsung', true, 2,  'Galaxy S, Galaxy A and Galaxy Z series phones.'),
  ('Xiaomi',  'xiaomi',  true, 3,  'Xiaomi, Redmi and POCO phones and accessories.'),
  ('OnePlus', 'oneplus', true, 4,  'OnePlus flagship and Nord series phones.'),
  ('Google',  'google',  true, 5,  'Google Pixel phones.'),
  ('Realme',  'realme',  true, 6,  'Realme number series, Narzo and C series phones.'),
  ('Oppo',    'oppo',    false, 7, 'Oppo Reno, F and A series phones.'),
  ('Vivo',    'vivo',    false, 8, 'Vivo V, Y and T series phones.'),
  ('Tecno',   'tecno',   false, 9, 'Tecno Camon, Spark and Pova phones.'),
  ('Infinix', 'infinix', false, 10, 'Infinix Note, Hot and Zero phones.'),
  ('Itel',    'itel',    false, 11, 'Itel smartphones and feature phones.')
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------
-- Starter categories (parent/child)
-- ---------------------------------------------------------------------
insert into public.categories (name, slug, is_featured, sort_order, description) values
  ('Smartphones',    'smartphones',    true,  1, 'New smartphones from every major brand.'),
  ('Used Phones',    'used-phones',    true,  2, 'Checked used and refurbished phones with clear condition notes.'),
  ('Feature Phones', 'feature-phones', false, 3, 'Button phones with long battery life.'),
  ('Accessories',    'accessories',    true,  4, 'Chargers, cables, earbuds and cases.')
on conflict (slug) do nothing;

insert into public.categories (name, slug, parent_id, is_featured, sort_order, description)
select v.name, v.slug, p.id, v.featured, v.sort_order, v.description
from (values
  ('iPhone',         'iphone',         'smartphones', true, 1, 'Official and unofficial iPhones.'),
  ('Android Phones', 'android-phones', 'smartphones', true, 2, 'Samsung, Xiaomi, OnePlus, Realme and more.')
) as v(name, slug, parent_slug, featured, sort_order, description)
join public.categories p on p.slug = v.parent_slug
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------
-- DEMO products
-- ---------------------------------------------------------------------
create or replace function pg_temp.demo_product(p jsonb)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
  v jsonb;
  i int := 0;
begin
  insert into public.products (
    brand_id, category_id, name, model, slug, sku, short_description, description,
    price, sale_price, stock_quantity, low_stock_threshold, condition, status,
    featured, is_new, is_offer, is_best_seller, warranty, is_demo
  ) values (
    (select id from public.brands where slug = p ->> 'brand'),
    (select id from public.categories where slug = p ->> 'category'),
    p ->> 'name', p ->> 'model', '', p ->> 'sku', p ->> 'short', p ->> 'description',
    (p ->> 'price')::numeric, nullif(p ->> 'sale', '')::numeric, coalesce((p ->> 'stock')::int, 0), 2,
    coalesce(p ->> 'condition', 'new'), 'active',
    coalesce((p ->> 'featured')::boolean, false), coalesce((p ->> 'new')::boolean, false),
    coalesce((p ->> 'offer')::boolean, false), coalesce((p ->> 'best')::boolean, false),
    p ->> 'warranty', true
  ) returning id into v_id;

  insert into public.product_images (product_id, url, alt_text, is_primary, sort_order)
  select v_id, img ->> 'url', p ->> 'name' || ' — ' || (img ->> 'alt'), ord = 1, ord
  from jsonb_array_elements(p -> 'images') with ordinality as t(img, ord);

  for v in select * from jsonb_array_elements(coalesce(p -> 'variants', '[]'::jsonb)) loop
    i := i + 1;
    insert into public.product_variants (product_id, sku, storage, ram, color, color_hex, price, sale_price, stock, sort_order)
    values (v_id, v ->> 'sku', v ->> 'storage', v ->> 'ram', v ->> 'color', v ->> 'hex',
            (v ->> 'price')::numeric, nullif(v ->> 'sale', '')::numeric, (v ->> 'stock')::int, i);
  end loop;

  insert into public.product_specifications (product_id, group_name, name, value, sort_order)
  select v_id, s ->> 0, s ->> 1, s ->> 2, ord
  from jsonb_array_elements(p -> 'specs') with ordinality as t(s, ord);

  insert into public.product_features (product_id, feature, sort_order)
  select v_id, f #>> '{}', ord
  from jsonb_array_elements(coalesce(p -> 'features', '[]'::jsonb)) with ordinality as t(f, ord);

  return v_id;
end;
$$;

select pg_temp.demo_product($json${
  "brand": "apple", "category": "iphone", "name": "Apple iPhone 15 Pro Max", "model": "A3106", "sku": "DEMO-IP15PM",
  "short": "Titanium design, A17 Pro chip and a 5x telephoto camera.",
  "description": "The iPhone 15 Pro Max has a titanium frame, the A17 Pro chip and a 48MP main camera with a 5x telephoto lens.\n\n## In the box\n\n- iPhone 15 Pro Max\n- USB-C charge cable\n\n## Good to know\n\nThis is a demo listing for testing. Check the latest price before publishing.",
  "price": 158000, "condition": "new", "featured": true, "best": true, "warranty": "1 year brand warranty",
  "images": [{"url": "/demo/phone-titanium.svg", "alt": "front and back"}, {"url": "/demo/phone-black.svg", "alt": "Black Titanium"}],
  "variants": [
    {"sku": "DEMO-IP15PM-256-NT", "storage": "256GB", "ram": "8GB", "color": "Natural Titanium", "hex": "#B9B3A9", "price": 158000, "sale": 152500, "stock": 4},
    {"sku": "DEMO-IP15PM-256-BT", "storage": "256GB", "ram": "8GB", "color": "Black Titanium", "hex": "#3B3B3D", "price": 158000, "stock": 2},
    {"sku": "DEMO-IP15PM-512-NT", "storage": "512GB", "ram": "8GB", "color": "Natural Titanium", "hex": "#B9B3A9", "price": 182000, "stock": 1},
    {"sku": "DEMO-IP15PM-512-BL", "storage": "512GB", "ram": "8GB", "color": "Blue Titanium", "hex": "#3F4A5A", "price": 182000, "stock": 0}
  ],
  "specs": [
    ["Display", "Size", "6.7 inch"], ["Display", "Type", "Super Retina XDR OLED, 120Hz ProMotion"],
    ["Platform", "Processor", "Apple A17 Pro"], ["Platform", "OS", "iOS"],
    ["Memory", "RAM", "8GB"], ["Memory", "Storage", "256GB / 512GB / 1TB"],
    ["Camera", "Rear camera", "48MP main + 12MP ultra wide + 12MP 5x telephoto"], ["Camera", "Front camera", "12MP"],
    ["Battery", "Battery", "4441mAh"], ["Connectivity", "Network", "5G"], ["Connectivity", "Port", "USB-C"]
  ],
  "features": ["Titanium frame", "Action button", "5x optical zoom telephoto", "USB-C with USB 3 speeds"]
}$json$::jsonb);

select pg_temp.demo_product($json${
  "brand": "apple", "category": "iphone", "name": "Apple iPhone 16", "model": "A3287", "sku": "DEMO-IP16",
  "short": "A18 chip, Camera Control button and a 48MP Fusion camera.",
  "description": "iPhone 16 brings the A18 chip, a dedicated Camera Control button and the Action button.\n\nThis is a demo listing for testing.",
  "price": 125000, "new": true, "featured": true, "warranty": "1 year brand warranty",
  "images": [{"url": "/demo/phone-blue.svg", "alt": "Ultramarine"}],
  "variants": [
    {"sku": "DEMO-IP16-128-UM", "storage": "128GB", "ram": "8GB", "color": "Ultramarine", "hex": "#5C6FD6", "price": 125000, "stock": 3},
    {"sku": "DEMO-IP16-128-BK", "storage": "128GB", "ram": "8GB", "color": "Black", "hex": "#2B2B2E", "price": 125000, "stock": 5},
    {"sku": "DEMO-IP16-256-BK", "storage": "256GB", "ram": "8GB", "color": "Black", "hex": "#2B2B2E", "price": 140000, "stock": 2}
  ],
  "specs": [
    ["Display", "Size", "6.1 inch"], ["Display", "Type", "Super Retina XDR OLED"],
    ["Platform", "Processor", "Apple A18"], ["Platform", "OS", "iOS"],
    ["Memory", "RAM", "8GB"], ["Memory", "Storage", "128GB / 256GB / 512GB"],
    ["Camera", "Rear camera", "48MP Fusion + 12MP ultra wide"], ["Camera", "Front camera", "12MP"],
    ["Battery", "Battery", "3561mAh"], ["Connectivity", "Network", "5G"]
  ],
  "features": ["Camera Control button", "Action button", "Apple Intelligence ready"]
}$json$::jsonb);

select pg_temp.demo_product($json${
  "brand": "apple", "category": "used-phones", "name": "Apple iPhone 13 128GB (Used)", "model": "A2633", "sku": "DEMO-IP13-USED",
  "short": "Used, fully checked. Battery health 88%. No repairs.",
  "description": "Pre-owned iPhone 13 in good condition with light marks on the frame. Face ID, cameras, speakers and charging tested.\n\nThis is a demo listing for testing.",
  "price": 54000, "sale": 52000, "stock": 2, "condition": "used", "offer": true, "warranty": "30 days shop warranty",
  "images": [{"url": "/demo/phone-green.svg", "alt": "front and back"}],
  "specs": [
    ["Display", "Size", "6.1 inch"], ["Platform", "Processor", "Apple A15 Bionic"],
    ["Memory", "RAM", "4GB"], ["Memory", "Storage", "128GB"],
    ["Camera", "Rear camera", "12MP + 12MP"], ["Battery", "Battery health", "88%"],
    ["Condition", "Cosmetic", "Light marks on frame, screen clean"]
  ],
  "features": ["Battery health 88%", "Face ID working", "No repairs or part replacements"]
}$json$::jsonb);

select pg_temp.demo_product($json${
  "brand": "samsung", "category": "android-phones", "name": "Samsung Galaxy S25 Ultra", "model": "SM-S938B", "sku": "DEMO-S25U",
  "short": "Snapdragon 8 Elite for Galaxy, 200MP camera and built-in S Pen.",
  "description": "Galaxy S25 Ultra pairs a 6.9 inch display with a 200MP main camera and the S Pen.\n\nThis is a demo listing for testing.",
  "price": 165000, "new": true, "featured": true, "warranty": "1 year brand warranty",
  "images": [{"url": "/demo/phone-silver.svg", "alt": "Titanium Silverblue"}],
  "variants": [
    {"sku": "DEMO-S25U-12-256-SB", "storage": "256GB", "ram": "12GB", "color": "Titanium Silverblue", "hex": "#9BA7B4", "price": 165000, "sale": 158000, "stock": 3},
    {"sku": "DEMO-S25U-12-256-BK", "storage": "256GB", "ram": "12GB", "color": "Titanium Black", "hex": "#2E3033", "price": 165000, "stock": 2},
    {"sku": "DEMO-S25U-12-512-BK", "storage": "512GB", "ram": "12GB", "color": "Titanium Black", "hex": "#2E3033", "price": 185000, "stock": 1}
  ],
  "specs": [
    ["Display", "Size", "6.9 inch"], ["Display", "Type", "Dynamic AMOLED 2X, 120Hz"],
    ["Platform", "Processor", "Snapdragon 8 Elite for Galaxy"], ["Platform", "OS", "Android 15, One UI 7"],
    ["Memory", "RAM", "12GB"], ["Memory", "Storage", "256GB / 512GB"],
    ["Camera", "Rear camera", "200MP + 50MP + 50MP + 10MP"], ["Camera", "Front camera", "12MP"],
    ["Battery", "Battery", "5000mAh, 45W"], ["Connectivity", "Network", "5G"]
  ],
  "features": ["Built-in S Pen", "5x periscope zoom", "Titanium frame"]
}$json$::jsonb);

select pg_temp.demo_product($json${
  "brand": "samsung", "category": "android-phones", "name": "Samsung Galaxy A55 5G", "model": "SM-A556E", "sku": "DEMO-A55",
  "short": "Metal frame, 120Hz Super AMOLED and IP67 water resistance.",
  "description": "A mid-range Galaxy with a metal frame and a bright 120Hz screen.\n\nThis is a demo listing for testing.",
  "price": 47999, "offer": true, "warranty": "1 year brand warranty",
  "images": [{"url": "/demo/phone-blue.svg", "alt": "Awesome Navy"}],
  "variants": [
    {"sku": "DEMO-A55-8-128-NV", "storage": "128GB", "ram": "8GB", "color": "Awesome Navy", "hex": "#2F3A56", "price": 47999, "sale": 44999, "stock": 6},
    {"sku": "DEMO-A55-8-256-IB", "storage": "256GB", "ram": "8GB", "color": "Awesome Iceblue", "hex": "#A9C6E0", "price": 52999, "stock": 3}
  ],
  "specs": [
    ["Display", "Size", "6.6 inch"], ["Display", "Type", "Super AMOLED, 120Hz"],
    ["Platform", "Processor", "Exynos 1480"], ["Platform", "OS", "Android, One UI"],
    ["Memory", "RAM", "8GB"], ["Memory", "Storage", "128GB / 256GB"],
    ["Camera", "Rear camera", "50MP + 12MP + 5MP"], ["Battery", "Battery", "5000mAh, 25W"]
  ],
  "features": ["IP67 water and dust resistance", "Metal frame"]
}$json$::jsonb);

select pg_temp.demo_product($json${
  "brand": "xiaomi", "category": "android-phones", "name": "Xiaomi Redmi Note 14 Pro", "model": "24116RACCG", "sku": "DEMO-RN14P",
  "short": "200MP camera, 120Hz AMOLED and 45W fast charging.",
  "description": "Redmi Note 14 Pro offers a 200MP main camera and a large battery at a mid-range price.\n\nThis is a demo listing for testing.",
  "price": 36999, "best": true, "warranty": "1 year brand warranty",
  "images": [{"url": "/demo/phone-purple.svg", "alt": "Lavender Purple"}],
  "variants": [
    {"sku": "DEMO-RN14P-8-256-BK", "storage": "256GB", "ram": "8GB", "color": "Midnight Black", "hex": "#25262A", "price": 36999, "stock": 8},
    {"sku": "DEMO-RN14P-12-512-PL", "storage": "512GB", "ram": "12GB", "color": "Lavender Purple", "hex": "#B7A5D8", "price": 42999, "stock": 4}
  ],
  "specs": [
    ["Display", "Size", "6.67 inch"], ["Display", "Type", "AMOLED, 120Hz"],
    ["Platform", "Processor", "MediaTek Dimensity 7300-Ultra"], ["Platform", "OS", "Android, HyperOS"],
    ["Memory", "RAM", "8GB / 12GB"], ["Memory", "Storage", "256GB / 512GB"],
    ["Camera", "Rear camera", "200MP + 8MP + 2MP"], ["Battery", "Battery", "5110mAh, 45W"]
  ],
  "features": ["200MP main camera", "IP68 rating"]
}$json$::jsonb);

select pg_temp.demo_product($json${
  "brand": "xiaomi", "category": "android-phones", "name": "Xiaomi 14T 12/256GB", "model": "2406APNFAG", "sku": "DEMO-X14T",
  "short": "Leica-tuned cameras and a 144Hz AMOLED display.",
  "description": "Xiaomi 14T has a Leica-tuned triple camera and 67W charging.\n\nThis is a demo listing for testing.",
  "price": 64999, "stock": 3, "warranty": "1 year brand warranty",
  "images": [{"url": "/demo/phone-black.svg", "alt": "Titan Black"}],
  "specs": [
    ["Display", "Size", "6.67 inch"], ["Display", "Type", "AMOLED, 144Hz"],
    ["Platform", "Processor", "MediaTek Dimensity 8300-Ultra"],
    ["Memory", "RAM", "12GB"], ["Memory", "Storage", "256GB"],
    ["Camera", "Rear camera", "50MP + 50MP + 12MP"], ["Battery", "Battery", "5000mAh, 67W"]
  ],
  "features": ["Leica-tuned cameras", "67W HyperCharge"]
}$json$::jsonb);

select pg_temp.demo_product($json${
  "brand": "oneplus", "category": "android-phones", "name": "OnePlus 13", "model": "CPH2649", "sku": "DEMO-OP13",
  "short": "Snapdragon 8 Elite, Hasselblad cameras and a 6000mAh battery.",
  "description": "OnePlus 13 combines a flagship chip with a very large battery and 100W charging.\n\nThis is a demo listing for testing.",
  "price": 105000, "new": true, "warranty": "1 year brand warranty",
  "images": [{"url": "/demo/phone-blue.svg", "alt": "Midnight Ocean"}],
  "variants": [
    {"sku": "DEMO-OP13-12-256-BL", "storage": "256GB", "ram": "12GB", "color": "Midnight Ocean", "hex": "#24365A", "price": 105000, "stock": 2},
    {"sku": "DEMO-OP13-16-512-BK", "storage": "512GB", "ram": "16GB", "color": "Black Eclipse", "hex": "#1F2023", "price": 120000, "stock": 1}
  ],
  "specs": [
    ["Display", "Size", "6.82 inch"], ["Display", "Type", "LTPO AMOLED, 120Hz"],
    ["Platform", "Processor", "Snapdragon 8 Elite"], ["Memory", "RAM", "12GB / 16GB"],
    ["Memory", "Storage", "256GB / 512GB"], ["Camera", "Rear camera", "50MP + 50MP + 50MP"],
    ["Battery", "Battery", "6000mAh, 100W"]
  ],
  "features": ["Hasselblad camera tuning", "100W wired charging"]
}$json$::jsonb);

select pg_temp.demo_product($json${
  "brand": "oneplus", "category": "android-phones", "name": "OnePlus Nord CE4 Lite 5G", "model": "CPH2619", "sku": "DEMO-NCE4L",
  "short": "5500mAh battery with 80W charging and a 120Hz AMOLED.",
  "description": "A budget 5G phone with a big battery and very fast charging.\n\nThis is a demo listing for testing.",
  "price": 26999, "sale": 24999, "stock": 9, "offer": true, "warranty": "1 year brand warranty",
  "images": [{"url": "/demo/phone-silver.svg", "alt": "Super Silver"}],
  "specs": [
    ["Display", "Size", "6.67 inch"], ["Display", "Type", "AMOLED, 120Hz"],
    ["Platform", "Processor", "Snapdragon 695"], ["Memory", "RAM", "8GB"], ["Memory", "Storage", "256GB"],
    ["Camera", "Rear camera", "50MP + 2MP"], ["Battery", "Battery", "5500mAh, 80W"]
  ],
  "features": ["80W SUPERVOOC charging", "Reverse wired charging"]
}$json$::jsonb);

select pg_temp.demo_product($json${
  "brand": "realme", "category": "android-phones", "name": "Realme 13 Pro+ 5G", "model": "RMX5001", "sku": "DEMO-R13PP",
  "short": "50MP periscope telephoto and curved AMOLED display.",
  "description": "Realme 13 Pro+ focuses on portrait photography with a periscope telephoto camera.\n\nThis is a demo listing for testing.",
  "price": 49999, "stock": 4, "warranty": "1 year brand warranty",
  "images": [{"url": "/demo/phone-green.svg", "alt": "Emerald Green"}],
  "specs": [
    ["Display", "Size", "6.7 inch"], ["Display", "Type", "Curved AMOLED, 120Hz"],
    ["Platform", "Processor", "Snapdragon 7s Gen 2"], ["Memory", "RAM", "12GB"], ["Memory", "Storage", "512GB"],
    ["Camera", "Rear camera", "50MP + 50MP periscope + 8MP"], ["Battery", "Battery", "5200mAh, 80W"]
  ],
  "features": ["3x periscope telephoto", "80W charging"]
}$json$::jsonb);

select pg_temp.demo_product($json${
  "brand": "realme", "category": "android-phones", "name": "Realme C67", "model": "RMX3890", "sku": "DEMO-RC67",
  "short": "108MP camera and 33W charging on a budget.",
  "description": "An affordable everyday phone with a 108MP main camera.\n\nThis is a demo listing for testing.",
  "price": 19999, "sale": 18499, "stock": 12, "offer": true, "best": true, "warranty": "1 year brand warranty",
  "images": [{"url": "/demo/phone-black.svg", "alt": "Black Rock"}],
  "specs": [
    ["Display", "Size", "6.72 inch"], ["Display", "Type", "IPS LCD, 90Hz"],
    ["Platform", "Processor", "Snapdragon 685"], ["Memory", "RAM", "8GB"], ["Memory", "Storage", "128GB"],
    ["Camera", "Rear camera", "108MP + 2MP"], ["Battery", "Battery", "5000mAh, 33W"]
  ]
}$json$::jsonb);

select pg_temp.demo_product($json${
  "brand": "google", "category": "used-phones", "name": "Google Pixel 8 128GB (Refurbished)", "model": "GKWS6", "sku": "DEMO-PX8-REF",
  "short": "Refurbished, new battery fitted, 3 months shop warranty.",
  "description": "Professionally refurbished Pixel 8 with a new battery. Screen and body in excellent condition.\n\nThis is a demo listing for testing.",
  "price": 58000, "stock": 1, "condition": "refurbished", "warranty": "3 months shop warranty",
  "images": [{"url": "/demo/phone-silver.svg", "alt": "Hazel"}],
  "specs": [
    ["Display", "Size", "6.2 inch"], ["Display", "Type", "OLED, 120Hz"],
    ["Platform", "Processor", "Google Tensor G3"], ["Memory", "RAM", "8GB"], ["Memory", "Storage", "128GB"],
    ["Camera", "Rear camera", "50MP + 12MP"], ["Battery", "Battery", "4575mAh (new)"]
  ],
  "features": ["New battery fitted", "7 years of OS updates from launch"]
}$json$::jsonb);

select pg_temp.demo_product($json${
  "brand": "samsung", "category": "used-phones", "name": "Samsung Galaxy S23 256GB (Used)", "model": "SM-S911B", "sku": "DEMO-S23-USED",
  "short": "Used, excellent condition, original box included.",
  "description": "Pre-owned Galaxy S23 with original box and cable. Screen has no scratches.\n\nThis is a demo listing for testing.",
  "price": 62000, "stock": 0, "condition": "used", "warranty": "30 days shop warranty",
  "images": [{"url": "/demo/phone-green.svg", "alt": "Green"}],
  "specs": [
    ["Display", "Size", "6.1 inch"], ["Platform", "Processor", "Snapdragon 8 Gen 2 for Galaxy"],
    ["Memory", "RAM", "8GB"], ["Memory", "Storage", "256GB"], ["Battery", "Battery", "3900mAh"]
  ]
}$json$::jsonb);

select pg_temp.demo_product($json${
  "brand": "xiaomi", "category": "accessories", "name": "Redmi Buds 6 Active", "model": "M2420E1", "sku": "DEMO-RB6A",
  "short": "Wireless earbuds with up to 30 hours of total playback.",
  "description": "Lightweight true wireless earbuds with Bluetooth 5.4.\n\nThis is a demo listing for testing.",
  "price": 2499, "sale": 2199, "stock": 20, "offer": true, "warranty": "6 months brand warranty",
  "images": [{"url": "/demo/earbuds.svg", "alt": "earbuds with case"}],
  "specs": [["Audio", "Driver", "14.2mm"], ["Connectivity", "Bluetooth", "5.4"], ["Battery", "Playback", "Up to 30 hours with case"]]
}$json$::jsonb);

-- ---------------------------------------------------------------------
-- DEMO banners & coupon
-- ---------------------------------------------------------------------
insert into public.banners (title, subtitle, image_url, button_text, button_url, placement, sort_order, is_demo) values
  ('New Galaxy S25 Ultra in stock', 'Official warranty. Cash on delivery across Bangladesh.', '/demo/banner-1.svg', 'See the S25 Ultra', '/brands/samsung', 'hero', 1, true),
  ('Checked used iPhones', 'Every phone tested, battery health stated.', '/demo/banner-2.svg', 'Browse used phones', '/categories/used-phones', 'hero', 2, true),
  ('Earbuds and chargers', 'Accessories from ৳499', '/demo/banner-3.svg', 'Shop accessories', '/categories/accessories', 'promo', 1, true);

insert into public.coupons (code, description, discount_type, discount_value, min_order_amount, is_demo)
values ('WELCOME500', 'Demo: ৳500 off orders above ৳10,000', 'fixed', 500, 10000, true)
on conflict (code) do nothing;

-- Store contact details are left empty on purpose: fill them in Admin → Settings.
