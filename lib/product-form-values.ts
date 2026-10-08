import type { ProductCondition, ProductStatus } from "@/types";

/**
 * Product editor form shape and defaults.
 * Plain data and types only (no React, no browser APIs), so it can be used by
 * Server Components (the new/edit product pages) and by the client-side
 * ProductForm alike. Do not add "use client" here.
 */

export interface ProductFormValues {
  id?: string;
  name: string;
  slug: string;
  model: string;
  brand_id: string;
  category_id: string;
  sku: string;
  barcode: string;
  mpn: string;
  short_description: string;
  description: string;
  price: string;
  sale_price: string;
  cost_price: string;
  stock_quantity: string;
  low_stock_threshold: string;
  condition: ProductCondition;
  status: ProductStatus;
  featured: boolean;
  is_new: boolean;
  is_offer: boolean;
  is_best_seller: boolean;
  warranty: string;
  meta_title: string;
  meta_description: string;
  canonical_url: string;
  variants: VariantRow[];
  specs: { group_name: string; name: string; value: string }[];
  features: string[];
  images: ImageRow[];
}

export interface VariantRow {
  key: string;
  id?: string;
  sku: string;
  storage: string;
  ram: string;
  color: string;
  color_hex: string;
  price: string;
  sale_price: string;
  stock: string;
  image_url: string;
  status: "active" | "inactive";
}

export interface ImageRow {
  key: string;
  id?: string;
  url: string;
  storage_path: string | null;
  alt_text: string;
  width: number | null;
  height: number | null;
}

export function emptyProductValues(): ProductFormValues {
  return {
    name: "",
    slug: "",
    model: "",
    brand_id: "",
    category_id: "",
    sku: "",
    barcode: "",
    mpn: "",
    short_description: "",
    description: "",
    price: "",
    sale_price: "",
    cost_price: "",
    stock_quantity: "0",
    low_stock_threshold: "3",
    condition: "new",
    status: "draft",
    featured: false,
    is_new: true,
    is_offer: false,
    is_best_seller: false,
    warranty: "",
    meta_title: "",
    meta_description: "",
    canonical_url: "",
    variants: [],
    specs: [],
    features: [],
    images: [],
  };
}
