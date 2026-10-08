import type { AiRequest, AiSource } from "@/lib/ai/types";

/**
 * AI product content: prompt, strict clean-up of the model's answer, and the
 * rules for writing it into a product.
 *
 * Hard rules enforced in code (not only in the prompt):
 *  - no prices, discounts, EMI, costs, ratings or reviews are ever written;
 *  - a spec value is written to the product only if VERIFIED or LIKELY;
 *    unknown values become "Not Available" / "Needs Verification" and stay in
 *    the AI panel for the admin to check;
 *  - without any source evidence nothing can be VERIFIED (capped at LIKELY),
 *    except values that came from the stock system itself;
 *  - fields the admin edited by hand are never overwritten unless the admin
 *    confirmed "Regenerate and replace my edits".
 */

export const VERIFICATION = ["VERIFIED", "LIKELY", "UNKNOWN", "NEEDS_VERIFICATION"] as const;
export type Verification = (typeof VERIFICATION)[number];

export const SPEC_FIELDS = [
  { key: "ram", group: "Memory", label: "RAM", core: true },
  { key: "storage", group: "Memory", label: "Storage", core: true },
  { key: "display", group: "Display", label: "Display", core: true },
  { key: "processor", group: "Performance", label: "Processor", core: true },
  { key: "rear_camera", group: "Camera", label: "Rear camera", core: false },
  { key: "front_camera", group: "Camera", label: "Front camera", core: false },
  { key: "battery", group: "Battery", label: "Battery", core: true },
  { key: "charging", group: "Battery", label: "Charging", core: false },
  { key: "os", group: "Software", label: "Operating system", core: true },
  { key: "network", group: "Connectivity", label: "Network", core: true },
  { key: "sim", group: "Connectivity", label: "SIM", core: false },
  { key: "colors", group: "Design", label: "Colours", core: false },
] as const;
export type SpecKey = (typeof SPEC_FIELDS)[number]["key"];

export interface SpecValue {
  value: string;
  status: Verification;
  source: string | null;
}

export interface ProductAiContent {
  title: string | null;
  short_title: string | null;
  short_description: string | null;
  description: string | null;
  highlights: string[];
  model: string | null;
  condition: SpecValue | null;
  specs: Partial<Record<SpecKey, SpecValue>>;
  seo: { title: string | null; description: string | null; keywords: string[] };
  suggested_brand: string | null;
  suggested_category: string | null;
  faq: { q: string; a: string }[];
  tags: string[];
  search_attributes: string[];
  review_summary: string | null;
}

/** What the AI is told about the product (never prices or costs). */
export interface ProductAiInput {
  name: string;
  brand: string | null;
  model: string | null;
  sku: string | null;
  mpn: string | null;
  condition: string;
  stockQuantity: number;
  shortDescription: string | null;
  description: string | null;
  specs: { name: string; value: string }[];
  features: string[];
  /** Facts from the stock system (trusted, shown as VERIFIED). */
  stock: { ram?: string | null; storage?: string | null; condition?: string | null; color?: string | null; model?: string | null; notes?: string | null } | null;
  brandOptions: string[];
  categoryOptions: string[];
  approvedReviews: { rating: number; title: string | null; body: string }[];
}

export type ContentTask = "full" | "verify" | "seo" | "description" | "faq" | "improve";

const NA = "Not Available";
const NV = "Needs Verification";

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+\n/g, "\n").trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

function strList(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const s = str(x, maxLen);
    if (s && !out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

// Sentences that mention money or ratings are dropped from generated text.
const PRICE_OR_RATING =
  /(৳|\btk\.?\b|\btaka\b|\bbdt\b|\$|€|£|\bprice[sd]?\b|\bpric(?:e|ing)\b|\bcost[s]?\b|\bdiscount|\bemi\b|\binstal?ments?\b|\bdown ?payment|\boffer price|\b\d(?:\.\d)?\s*(?:\/|out of)\s*5\b|\bstars?\b|\bratings?\b|\breviews?\b|customers? (?:love|say|rave))/i;

export function stripPriceAndRatingSentences(text: string | null): string | null {
  if (!text) return text;
  const lines = text.split("\n").map((line) => {
    const parts = line.match(/[^.!?]+[.!?]*\s*/g) ?? [line];
    return parts.filter((p) => !PRICE_OR_RATING.test(p)).join("").trimEnd();
  });
  const out = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return out || null;
}

function verification(v: unknown): Verification {
  const s = String(v ?? "").toUpperCase().replace(/[\s-]+/g, "_");
  return (VERIFICATION as readonly string[]).includes(s) ? (s as Verification) : "UNKNOWN";
}

function specValue(raw: unknown, hasEvidence: boolean): SpecValue {
  const obj = (raw && typeof raw === "object" ? raw : { value: raw }) as { value?: unknown; status?: unknown; source?: unknown; source_url?: unknown };
  let value = str(obj.value, 200);
  let status = verification(obj.status);
  const source = str(obj.source ?? obj.source_url, 500);
  if (!value || /^(n\/?a|unknown|not available|needs verification|none|-)$/i.test(value)) {
    value = null;
    if (status === "VERIFIED" || status === "LIKELY") status = "UNKNOWN";
  }
  if (status === "VERIFIED" && !hasEvidence && !source) status = "LIKELY";
  if (!value) return { value: status === "NEEDS_VERIFICATION" ? NV : NA, status, source };
  return { value, status, source: source && /^https?:\/\//.test(source) ? source : null };
}

/** Clean and constrain a model answer. Unknown keys are dropped. */
export function sanitizeContent(raw: Record<string, unknown>, input: ProductAiInput, sources: AiSource[]): ProductAiContent {
  const hasEvidence = sources.length > 0;
  const specsRaw = (raw.specs && typeof raw.specs === "object" ? raw.specs : {}) as Record<string, unknown>;
  const specs: Partial<Record<SpecKey, SpecValue>> = {};
  for (const f of SPEC_FIELDS) if (f.key in specsRaw) specs[f.key] = specValue(specsRaw[f.key], hasEvidence);

  // Facts from the stock system win and count as verified.
  const stock = input.stock;
  if (stock?.ram) specs.ram = { value: stock.ram, status: "VERIFIED", source: "stock" };
  if (stock?.storage) specs.storage = { value: stock.storage, status: "VERIFIED", source: "stock" };
  if (stock?.color && !specs.colors) specs.colors = { value: stock.color, status: "VERIFIED", source: "stock" };
  const conditionSource = stock?.condition ?? input.condition;

  const seoRaw = (raw.seo && typeof raw.seo === "object" ? raw.seo : {}) as Record<string, unknown>;
  const faq = Array.isArray(raw.faq)
    ? (raw.faq as unknown[])
        .map((x) => {
          const o = (x ?? {}) as { q?: unknown; a?: unknown; question?: unknown; answer?: unknown };
          const q = str(o.q ?? o.question, 200);
          const a = stripPriceAndRatingSentences(str(o.a ?? o.answer, 600));
          return q && a ? { q, a } : null;
        })
        .filter((x): x is { q: string; a: string } => x !== null)
        .slice(0, 8)
    : [];

  const pick = (v: unknown, options: string[]) => {
    const s = str(v, 80);
    return s ? (options.find((o) => o.toLowerCase() === s.toLowerCase()) ?? s) : null;
  };

  return {
    title: str(raw.title, 200),
    short_title: str(raw.short_title, 80),
    short_description: stripPriceAndRatingSentences(str(raw.short_description, 500)),
    description: stripPriceAndRatingSentences(str(raw.description, 6000)),
    highlights: strList(raw.highlights, 6, 120).filter((h) => !PRICE_OR_RATING.test(h)),
    model: str(raw.model, 80) ?? input.model,
    condition: { value: conditionSource, status: "VERIFIED", source: "stock" },
    specs,
    seo: {
      title: str(seoRaw.title, 70),
      description: stripPriceAndRatingSentences(str(seoRaw.description, 160)),
      keywords: strList(seoRaw.keywords, 12, 40),
    },
    suggested_brand: pick(raw.suggested_brand, input.brandOptions),
    suggested_category: pick(raw.suggested_category, input.categoryOptions),
    faq,
    tags: strList(raw.tags, 12, 30),
    search_attributes: strList(raw.search_attributes, 16, 60),
    // A summary is only allowed when real, approved reviews exist.
    review_summary: input.approvedReviews.length ? stripPriceAndRatingSentences(str(raw.review_summary, 600)) : null,
  };
}

export function needsVerification(c: ProductAiContent): boolean {
  return SPEC_FIELDS.filter((f) => f.core).some((f) => {
    const s = c.specs[f.key]?.status;
    return s !== "VERIFIED" && s !== "LIKELY";
  });
}

const SYSTEM = `You write product content for AN MOBILE GALLERY, a mobile phone shop in Bangladesh.
Rules you must follow:
- Never invent specifications. If you are not sure of a value, set "status": "UNKNOWN" (or "NEEDS_VERIFICATION" if you have a guess that must be checked) and leave "value" empty.
- "VERIFIED" only when the value comes from the stock data provided or an official/reliable source you can cite in "source". "LIKELY" when it is widely documented for this exact model but you have no source at hand.
- Never mention or estimate prices, discounts, EMI, costs, offers, ratings, stars or customer reviews.
- Never claim warranty terms, stock levels or delivery promises.
- Write plain, clear English for Bangladeshi shoppers. No hype, no emojis.
- Reply with ONE JSON object only.`;

const SCHEMA = `{
  "title": "full product title, e.g. Samsung Galaxy S25 Ultra 12GB/256GB",
  "short_title": "e.g. Galaxy S25 Ultra",
  "short_description": "one or two sentences, max 300 characters",
  "description": "2-4 short paragraphs; use '- ' bullet lines for key points",
  "highlights": ["3 to 6 short highlights"],
  "model": "model name or number if known",
  "specs": {
    "ram": {"value": "", "status": "VERIFIED|LIKELY|UNKNOWN|NEEDS_VERIFICATION", "source": "url or null"},
    "storage": {...}, "display": {...}, "processor": {...}, "rear_camera": {...}, "front_camera": {...},
    "battery": {...}, "charging": {...}, "os": {...}, "network": {...}, "sim": {...}, "colors": {...}
  },
  "seo": {"title": "max 60 characters", "description": "max 155 characters", "keywords": ["..."]},
  "suggested_brand": "one of the brand options or null",
  "suggested_category": "one of the category options or null",
  "faq": [{"q": "", "a": ""}],
  "tags": ["short tags"],
  "search_attributes": ["e.g. 5G, 12GB RAM, 256GB"],
  "review_summary": "only if reviews are provided, else null"
}`;

const TASK_NOTES: Record<ContentTask, string> = {
  full: "Generate all fields.",
  verify: "Check every specification against official or reliable sources and cite them in \"source\". Return the full JSON; keep text fields short.",
  seo: "Focus on seo.title, seo.description and seo.keywords. Other fields may be brief.",
  description: "Focus on short_description, description and highlights.",
  faq: "Focus on faq (4-6 useful questions a buyer would ask about this exact phone, answered only from known facts).",
  improve: "Improve the existing title, descriptions and highlights: clearer, better structured, same facts. Do not add facts that are not in the input.",
};

export function buildRequest(input: ProductAiInput, task: ContentTask, research: boolean): AiRequest {
  const facts = {
    product_name: input.name,
    brand: input.brand,
    model: input.model,
    sku: input.sku,
    model_number: input.mpn,
    condition: input.condition,
    in_stock_units: input.stockQuantity,
    stock_system_data: input.stock,
    existing_short_description: input.shortDescription,
    existing_description: input.description?.slice(0, 3000) ?? null,
    existing_specifications: input.specs.slice(0, 40),
    existing_highlights: input.features.slice(0, 10),
    brand_options: input.brandOptions.slice(0, 60),
    category_options: input.categoryOptions.slice(0, 60),
    customer_reviews: input.approvedReviews.length ? input.approvedReviews.slice(0, 15) : "none — do not summarise reviews",
  };
  return {
    task: task === "verify" ? "verify" : task === "seo" ? "seo" : task === "full" ? "product_content" : task === "faq" ? "faq" : task === "improve" ? "improve" : "description",
    system: SYSTEM,
    prompt: `Task: ${TASK_NOTES[task]}\n\nProduct facts (JSON):\n${JSON.stringify(facts, null, 1)}\n\nReturn JSON in exactly this shape:\n${SCHEMA}`,
    json: true,
    research,
    maxOutputTokens: 4096,
  };
}

// ---------------------------------------------------------------------------
// Writing AI output into the product, respecting manual edits
// ---------------------------------------------------------------------------

export const TRACKED_FIELDS = ["name", "short_description", "description", "meta_title", "meta_description", "model", "brand_id", "category_id", "features", "specs"] as const;
export type TrackedField = (typeof TRACKED_FIELDS)[number];

export interface ProductSnapshot {
  name: string;
  short_description: string | null;
  description: string | null;
  meta_title: string | null;
  meta_description: string | null;
  model: string | null;
  brand_id: string | null;
  category_id: string | null;
  features: string[];
  specs: { group_name: string; name: string; value: string }[];
}

export type Applied = Partial<Record<TrackedField, unknown>>;

export const TASK_FIELDS: Record<ContentTask, TrackedField[]> = {
  full: [...TRACKED_FIELDS],
  verify: ["specs"],
  seo: ["meta_title", "meta_description"],
  description: ["short_description", "description", "features"],
  faq: [],
  improve: ["name", "short_description", "description", "features"],
};

function norm(v: unknown): string {
  if (Array.isArray(v)) return JSON.stringify(v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x).trim())));
  return v === null || v === undefined ? "" : String(v).trim();
}

function isEmptyValue(v: unknown): boolean {
  return Array.isArray(v) ? v.length === 0 : norm(v) === "";
}

/**
 * A field counts as manually edited when it differs from what AI last wrote,
 * or — if AI never wrote it — when it already has content.
 */
export function fieldSource(field: TrackedField, current: ProductSnapshot, applied: Applied): "ai" | "manual" | "empty" {
  const cur = current[field];
  if (field in applied) return norm(cur) === norm(applied[field]) ? "ai" : isEmptyValue(cur) ? "empty" : "manual";
  return isEmptyValue(cur) ? "empty" : "manual";
}

export function specsFromContent(c: ProductAiContent): { group_name: string; name: string; value: string }[] {
  const out: { group_name: string; name: string; value: string }[] = [];
  for (const f of SPEC_FIELDS) {
    const s = c.specs[f.key];
    if (s && (s.status === "VERIFIED" || s.status === "LIKELY") && s.value !== NA && s.value !== NV) out.push({ group_name: f.group, name: f.label, value: s.value });
  }
  if (c.condition?.value) out.push({ group_name: "General", name: "Condition", value: c.condition.value.charAt(0).toUpperCase() + c.condition.value.slice(1) });
  return out;
}

export interface MergePlan {
  update: Partial<Omit<ProductSnapshot, "features" | "specs">>;
  features: string[] | null;
  specs: { group_name: string; name: string; value: string }[] | null;
  applied: Applied;
  keptManual: TrackedField[];
}

export function planMerge(
  task: ContentTask,
  content: ProductAiContent,
  current: ProductSnapshot,
  applied: Applied,
  ids: { brandId: string | null; categoryId: string | null },
  replaceManual: boolean,
): MergePlan {
  const proposed: Partial<Record<TrackedField, unknown>> = {
    name: content.title,
    short_description: content.short_description,
    description: content.description,
    meta_title: content.seo.title,
    meta_description: content.seo.description,
    model: content.model,
    brand_id: ids.brandId,
    category_id: ids.categoryId,
    features: content.highlights.length ? content.highlights : null,
    specs: specsFromContent(content).length ? specsFromContent(content) : null,
  };
  const plan: MergePlan = { update: {}, features: null, specs: null, applied: { ...applied }, keptManual: [] };
  for (const field of TASK_FIELDS[task]) {
    const value = proposed[field];
    if (value === null || value === undefined || (typeof value === "string" && value.length < 2)) continue;
    if (field === "name" && typeof value === "string" && value.length > 200) continue;
    if (!replaceManual && fieldSource(field, current, applied) === "manual") {
      plan.keptManual.push(field);
      continue;
    }
    if (norm(value) === norm(current[field])) {
      plan.applied[field] = value;
      continue;
    }
    if (field === "features") plan.features = value as string[];
    else if (field === "specs") plan.specs = value as ProductSnapshot["specs"];
    else (plan.update as Record<string, unknown>)[field] = value;
    plan.applied[field] = value;
  }
  return plan;
}
