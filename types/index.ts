// Shared domain types. They mirror the tables in supabase/migrations.

export type ProductCondition = "new" | "used" | "refurbished";
export type ProductStatus = "active" | "draft" | "out_of_stock" | "archived";
export type OrderStatus = "pending" | "confirmed" | "processing" | "shipped" | "delivered" | "cancelled";
export type PaymentStatus = "unpaid" | "paid" | "partially_paid" | "refunded";
export type DeliveryZone = "inside_dhaka" | "outside_dhaka" | "store_pickup";
export type ReviewStatus = "pending" | "approved" | "rejected";
export type StaffRole = "super_admin" | "admin" | "editor";
export type Availability = "in_stock" | "low_stock" | "out_of_stock";

export interface Brand {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  description: string | null;
  meta_title: string | null;
  meta_description: string | null;
  is_featured: boolean;
  is_active: boolean;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
}

export interface Category {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  meta_title: string | null;
  meta_description: string | null;
  is_featured: boolean;
  is_active: boolean;
  sort_order: number;
  updated_at?: string;
}

export interface CategoryNode extends Category {
  children: CategoryNode[];
}

/** Row returned by the search_products() RPC — used for every product card. */
export interface ProductCard {
  id: string;
  slug: string;
  name: string;
  brand_name: string | null;
  brand_slug: string | null;
  category_slug: string | null;
  price: number;
  sale_price: number | null;
  stock_quantity: number;
  low_stock_threshold: number;
  condition: ProductCondition;
  status: ProductStatus;
  featured: boolean;
  is_new: boolean;
  is_offer: boolean;
  is_best_seller: boolean;
  image_url: string | null;
  image_alt: string | null;
  rating_avg: number;
  rating_count: number;
  ram_options: string[];
  storage_options: string[];
  created_at: string;
  total_count?: number;
}

export interface ProductImage {
  id: string;
  product_id: string;
  url: string;
  storage_path: string | null;
  alt_text: string | null;
  is_primary: boolean;
  sort_order: number;
  width: number | null;
  height: number | null;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  sku: string | null;
  storage: string | null;
  ram: string | null;
  color: string | null;
  color_hex: string | null;
  price: number;
  sale_price: number | null;
  stock: number;
  image_url: string | null;
  status: "active" | "inactive";
  sort_order: number;
}

export interface ProductSpecification {
  id: string;
  product_id: string;
  group_name: string;
  name: string;
  value: string;
  sort_order: number;
}

export interface ProductFeature {
  id: string;
  product_id: string;
  feature: string;
  sort_order: number;
}

export interface Product {
  id: string;
  brand_id: string | null;
  category_id: string | null;
  name: string;
  model: string | null;
  slug: string;
  sku: string | null;
  barcode: string | null;
  mpn: string | null;
  short_description: string | null;
  description: string | null;
  price: number;
  sale_price: number | null;
  stock_quantity: number;
  low_stock_threshold: number;
  condition: ProductCondition;
  status: ProductStatus;
  featured: boolean;
  is_new: boolean;
  is_offer: boolean;
  is_best_seller: boolean;
  warranty: string | null;
  meta_title: string | null;
  meta_description: string | null;
  canonical_url: string | null;
  ram_options: string[];
  storage_options: string[];
  color_options: string[];
  rating_avg: number;
  rating_count: number;
  view_count: number;
  sales_count: number;
  published_at: string | null;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProductDetail extends Product {
  brand: Pick<Brand, "id" | "name" | "slug" | "logo_url"> | null;
  category: Pick<Category, "id" | "name" | "slug" | "parent_id"> | null;
  images: ProductImage[];
  variants: ProductVariant[];
  specifications: ProductSpecification[];
  features: ProductFeature[];
}

export interface Review {
  id: string;
  product_id: string;
  user_id: string | null;
  customer_name: string;
  rating: number;
  title: string | null;
  body: string;
  status: ReviewStatus;
  is_verified_purchase: boolean;
  created_at: string;
}

export interface Banner {
  id: string;
  title: string;
  subtitle: string | null;
  image_url: string;
  mobile_image_url: string | null;
  button_text: string | null;
  button_url: string | null;
  placement: "hero" | "promo";
  is_active: boolean;
  sort_order: number;
  starts_at: string | null;
  ends_at: string | null;
}

export interface Page {
  id: string;
  slug: string;
  title: string;
  content: string;
  meta_title: string | null;
  meta_description: string | null;
  is_published: boolean;
  updated_at: string;
}

export interface SiteSettings {
  store_name: string;
  store_name_bn: string | null;
  tagline: string | null;
  tagline_bn: string | null;
  logo_url: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  address_bn: string | null;
  map_url: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  youtube_url: string | null;
  tiktok_url: string | null;
  opening_hours: string | null;
  delivery_charge_inside_dhaka: number;
  delivery_charge_outside_dhaka: number;
  free_delivery_threshold: number;
  currency: string;
  currency_symbol: string;
  return_days: number;
  return_policy: string | null;
  shipping_note: string | null;
}

export interface SeoSettings {
  site_title: string;
  site_description: string;
  default_keywords: string | null;
  default_og_image: string | null;
  google_site_verification: string | null;
  facebook_domain_verification: string | null;
  twitter_handle: string | null;
  organization_name: string | null;
  organization_legal_name: string | null;
  organization_logo: string | null;
  organization_founding_year: number | null;
}

export interface Coupon {
  id: string;
  code: string;
  description: string | null;
  discount_type: "percent" | "fixed";
  discount_value: number;
  min_order_amount: number;
  max_discount_amount: number | null;
  starts_at: string | null;
  ends_at: string | null;
  usage_limit: number | null;
  used_count: number;
  is_active: boolean;
  is_demo: boolean;
  created_at: string;
}

export interface Order {
  id: string;
  order_number: string;
  customer_id: string | null;
  user_id: string | null;
  customer_name: string;
  phone: string;
  email: string | null;
  address: string;
  city: string | null;
  area: string | null;
  delivery_zone: DeliveryZone;
  note: string | null;
  subtotal: number;
  discount: number;
  delivery_charge: number;
  total: number;
  coupon_code: string | null;
  payment_method: string;
  payment_status: PaymentStatus;
  status: OrderStatus;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string | null;
  variant_id: string | null;
  product_name: string;
  product_slug: string | null;
  variant_label: string | null;
  sku: string | null;
  image_url: string | null;
  unit_price: number;
  quantity: number;
  line_total: number;
}

export interface FilterOptions {
  ram: string[];
  storage: string[];
  brands: { name: string; slug: string; count: number }[];
  conditions: ProductCondition[];
  price_min: number | null;
  price_max: number | null;
}

/** Cart line stored in the browser. Prices are display-only; the server re-prices at checkout. */
export interface CartItem {
  key: string; // productId:variantId
  productId: string;
  variantId: string | null;
  slug: string;
  name: string;
  variantLabel: string | null;
  image: string | null;
  price: number;
  quantity: number;
  maxQuantity: number;
}

export interface ActionResult<T = undefined> {
  ok: boolean;
  message?: string;
  data?: T;
  fieldErrors?: Record<string, string>;
}
