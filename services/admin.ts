import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Brand, Category } from "@/types";

/** Lookups for admin forms (staff see inactive brands/categories too). */
export async function getAdminTaxonomy() {
  const supabase = await createClient();
  const [brands, categories] = await Promise.all([
    supabase.from("brands").select("id, name, slug, is_active").order("sort_order").order("name"),
    supabase.from("categories").select("id, name, slug, parent_id, is_active").order("sort_order").order("name"),
  ]);
  return {
    brands: (brands.data ?? []) as Pick<Brand, "id" | "name" | "slug" | "is_active">[],
    categories: (categories.data ?? []) as Pick<Category, "id" | "name" | "slug" | "parent_id" | "is_active">[],
  };
}

/** Escape user input for PostgREST ilike/or() filters. */
export function escapeFilter(value: string): string {
  return value.replace(/[%,()\\*]/g, " ").trim().slice(0, 80);
}
