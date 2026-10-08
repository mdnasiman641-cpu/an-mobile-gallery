import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasRole, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getAdminTaxonomy } from "@/services/admin";
import { getSiteSettings } from "@/services/settings";
import { AdminPageHeader } from "@/components/admin/page-header";
import { ProductForm } from "@/components/admin/product-form";
import type { ProductFormValues } from "@/lib/product-form-values";
import { Badge } from "@/components/ui/misc";
import { statusLabel } from "@/lib/utils";
import { AiAssistant, type AssistantProps } from "@/components/admin/ai-assistant";
import { SPEC_FIELDS, fieldSource, type Applied, type ProductAiContent, type ProductSnapshot, type TrackedField } from "@/lib/ai/product-content";
import type { Product, ProductFeature, ProductImage, ProductSpecification, ProductVariant } from "@/types";

export const metadata: Metadata = { title: "Edit product" };

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const session = await requireStaff("editor");
  const canSeeCost = hasRole(session, "admin");
  const supabase = await createClient();

  const [{ data }, taxonomy, settings, costRes, aiRes, jobRes, extRes] = await Promise.all([
    supabase
      .from("products")
      .select(
        "*, product_variants(*), product_images(*), product_specifications(*), product_features(*)",
      )
      .eq("id", id)
      .maybeSingle(),
    getAdminTaxonomy(),
    getSiteSettings(),
    canSeeCost ? supabase.from("product_costs").select("cost_price").eq("product_id", id).maybeSingle() : Promise.resolve({ data: null }),
    // AI and stock data (empty until the 0010 migration has run)
    supabase.from("ai_product_content").select("review_status, content, applied, extras, sources, model, generated_at").eq("product_id", id).maybeSingle(),
    supabase
      .from("ai_jobs")
      .select("status, error_message, fallback_used, ai_job_attempts(attempt, provider, model, status, error_code)")
      .eq("product_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("product_external_sources")
      .select("external_source, external_product_id, last_synced_at, sync_status, sync_error, external_quantity, removed_upstream")
      .eq("product_id", id)
      .order("last_synced_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!data) notFound();

  const p = data as Product & {
    product_variants: ProductVariant[];
    product_images: ProductImage[];
    product_specifications: ProductSpecification[];
    product_features: ProductFeature[];
  };
  const bySort = <T extends { sort_order: number }>(a: T, b: T) => a.sort_order - b.sort_order;

  const initial: ProductFormValues = {
    id: p.id,
    name: p.name,
    slug: p.slug,
    model: s(p.model),
    brand_id: s(p.brand_id),
    category_id: s(p.category_id),
    sku: s(p.sku),
    barcode: s(p.barcode),
    mpn: s(p.mpn),
    short_description: s(p.short_description),
    description: s(p.description),
    price: s(p.price),
    sale_price: s(p.sale_price),
    cost_price: s((costRes.data as { cost_price: number | null } | null)?.cost_price),
    stock_quantity: s(p.stock_quantity),
    low_stock_threshold: s(p.low_stock_threshold),
    condition: p.condition,
    status: p.status,
    featured: p.featured,
    is_new: p.is_new,
    is_offer: p.is_offer,
    is_best_seller: p.is_best_seller,
    warranty: s(p.warranty),
    meta_title: s(p.meta_title),
    meta_description: s(p.meta_description),
    canonical_url: s(p.canonical_url),
    variants: [...p.product_variants].sort(bySort).map((v) => ({
      key: v.id,
      id: v.id,
      sku: s(v.sku),
      storage: s(v.storage),
      ram: s(v.ram),
      color: s(v.color),
      color_hex: s(v.color_hex),
      price: s(v.price),
      sale_price: s(v.sale_price),
      stock: s(v.stock),
      image_url: s(v.image_url),
      status: v.status,
    })),
    specs: [...p.product_specifications].sort(bySort).map((x) => ({ group_name: x.group_name, name: x.name, value: x.value })),
    features: [...p.product_features].sort(bySort).map((f) => f.feature),
    images: [...p.product_images]
      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order)
      .map((i) => ({ key: i.id, id: i.id, url: i.url, storage_path: i.storage_path, alt_text: s(i.alt_text), width: i.width, height: i.height })),
  };

  // ---- AI assistant ---------------------------------------------------------
  const aiTablesReady = !aiRes.error;
  const ai = aiRes.data as {
    review_status: NonNullable<AssistantProps["reviewStatus"]>;
    content: Partial<ProductAiContent>;
    applied: Applied;
    extras: { faq?: { q: string; a: string }[]; keywords?: string[]; tags?: string[]; manual?: boolean } | null;
    sources: { url: string; title: string | null }[] | null;
    model: string | null;
    generated_at: string | null;
  } | null;
  const snapshot: ProductSnapshot = {
    name: p.name,
    short_description: p.short_description,
    description: p.description,
    meta_title: p.meta_title,
    meta_description: p.meta_description,
    model: p.model,
    brand_id: p.brand_id,
    category_id: p.category_id,
    features: initial.features,
    specs: initial.specs,
  };
  const FIELD_LABELS: [TrackedField, string][] = [
    ["name", "Title"],
    ["short_description", "Short description"],
    ["description", "Description"],
    ["features", "Highlights"],
    ["specs", "Specifications"],
    ["meta_title", "SEO title"],
    ["meta_description", "SEO description"],
    ["model", "Model"],
    ["brand_id", "Brand"],
    ["category_id", "Category"],
  ];
  const job = jobRes.data as {
    status: string;
    error_message: string | null;
    fallback_used: boolean;
    ai_job_attempts: { attempt: number; provider: string; model: string; status: string; error_code: string | null }[];
  } | null;
  const ext = extRes.data as {
    external_source: string;
    external_product_id: string;
    last_synced_at: string;
    sync_status: string;
    sync_error: string | null;
    external_quantity: number | null;
    removed_upstream: boolean;
  } | null;
  const assistant: AssistantProps = {
    productId: p.id,
    reviewStatus: ai?.review_status ?? null,
    generatedAt: ai?.generated_at ?? null,
    model: ai?.model ?? null,
    fields: FIELD_LABELS.map(([key, label]) => ({ key, label, source: fieldSource(key, snapshot, ai?.applied ?? {}) })),
    specs: SPEC_FIELDS.flatMap((f) => {
      const v = ai?.content?.specs?.[f.key];
      return v ? [{ label: f.label, value: v.value, status: v.status, source: v.source }] : [];
    }),
    sources: ai?.sources ?? [],
    extras: { faq: ai?.extras?.faq ?? [], keywords: ai?.extras?.keywords ?? [], tags: ai?.extras?.tags ?? [], manual: Boolean(ai?.extras?.manual) },
    lastJob: job
      ? {
          status: job.status,
          error: job.error_message,
          fallbackUsed: job.fallback_used,
          attempts: [...job.ai_job_attempts].sort((a, b) => a.attempt - b.attempt).map((a) => ({ attempt: a.attempt, provider: a.provider, model: a.model, status: a.status, code: a.error_code })),
        }
      : null,
    checklist: { hasImages: p.product_images.length > 0, hasPrice: Number(p.price) > 0, isPublished: p.status === "active" || p.status === "out_of_stock" },
    external: ext
      ? {
          source: ext.external_source,
          id: ext.external_product_id,
          syncedAt: ext.last_synced_at,
          status: ext.sync_status,
          error: ext.sync_error,
          quantity: ext.external_quantity,
          removed: ext.removed_upstream,
        }
      : null,
  };

  return (
    <>
      <AdminPageHeader
        title={p.name}
        description={`/products/${p.slug}`}
        back={{ href: "/admin/products", label: "Products" }}
        actions={
          <>
            {p.is_demo ? <Badge tone="warn">Demo data</Badge> : null}
            <Badge tone={p.status === "active" ? "signal" : "neutral"}>{statusLabel[p.status]}</Badge>
          </>
        }
      />
      {aiTablesReady ? <AiAssistant {...assistant} /> : null}
      <ProductForm
        key={p.updated_at}
        initial={initial}
        brands={taxonomy.brands}
        categories={taxonomy.categories}
        storeName={settings.store_name}
        canSeeCost={canSeeCost}
      />
    </>
  );
}
