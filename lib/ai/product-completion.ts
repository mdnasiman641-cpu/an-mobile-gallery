import { stripPriceAndRatingSentences, VERIFICATION, type Verification } from "@/lib/ai/product-content";
import { normalizeAnswer, PHONE_SPECS } from "@/lib/ai/spec-catalog";
import { slugify } from "@/lib/slug";
import type { AiRequest, AiSource } from "@/lib/ai/types";

/**
 * "Complete with AI" for the product form.
 *
 * The admin types four things — product name, selling price, RAM and
 * storage — and AI suggests everything else. Rules enforced in CODE (not only
 * in the prompt):
 *  - the AI never receives the price, and its answer can't contain one: the
 *    form values it can fill have no price, discount, EMI, cost, stock,
 *    images, status, name, condition or variant fields at all;
 *  - RAM and storage always stay exactly as the admin typed them;
 *  - a specification is filled only when VERIFIED or LIKELY; unknown values
 *    stay empty and are listed as "Needs verification";
 *  - identifiers (MPN, barcode/GTIN) and warranty are filled only when
 *    VERIFIED from a web source during this run (and a barcode must also pass
 *    the GTIN check digit), so they are never invented;
 *  - sentences about prices, offers, ratings or reviews are removed;
 *  - fields the admin edited are never replaced without confirmation.
 * This module is plain logic (no secrets), shared by the server action and the form.
 */

export const COMPLETION_SECTIONS = ["basic", "specs", "description", "seo", "faq"] as const;
export type CompletionSection = (typeof COMPLETION_SECTIONS)[number];

export const SECTION_LABELS: Record<CompletionSection, string> = {
  basic: "Basic information",
  specs: "Specifications",
  description: "Description",
  seo: "SEO",
  faq: "FAQ",
};

/** Specifications AI is asked for, in display order (lib/ai/spec-catalog.ts). RAM and storage come from the admin. */
export const COMPLETION_SPECS = PHONE_SPECS.map((p) => ({ key: p.key, group: p.group, label: p.label }));
export type CompletionSpecKey = string;

/** Spec rows the admin owns (typed in the quick fields). AI never writes these. */
export const RAM_SPEC = { group_name: "Memory", name: "RAM" } as const;
export const STORAGE_SPEC = { group_name: "Memory", name: "Storage" } as const;
export function isProtectedSpec(name: string): boolean {
  return /^\s*(ram|memory|storage|rom|internal storage|internal memory|storage \/ rom|rom \/ storage)\s*$/i.test(name);
}

export interface Guess {
  value: string | null;
  status: Verification;
  source: string | null;
}

export interface CompletionSpec extends Guess {
  key: string;
  group: string;
  label: string;
}

export interface CompletionInput {
  name: string;
  ram: string;
  storage: string;
  condition: string;
  /** Currently selected brand / category / model in the form (may be empty). */
  brand: string | null;
  category: string | null;
  model: string | null;
  brandOptions: string[];
  categoryOptions: string[];
  sections: CompletionSection[];
}

export interface ProductCompletion {
  sections: CompletionSection[];
  brand: { name: string; id: string | null } | null;
  category: { name: string; id: string | null } | null;
  model: Guess | null;
  mpn: Guess | null;
  barcode: Guess | null;
  warranty: Guess | null;
  specs: CompletionSpec[];
  shortDescription: string | null;
  description: string | null;
  highlights: string[];
  seo: { title: string | null; description: string | null; keywords: string[]; slug: string | null };
  faq: { q: string; a: string }[];
  sources: AiSource[];
  /** True when the model searched the web during this run. */
  researched: boolean;
}

/** One Complete with AI run, as returned to the form and cached on the product. */
export interface CompletionRun {
  completion: ProductCompletion;
  /** "Provider / model" that produced the answer */
  usedModel: string;
  /** Models actually called, in order (failed ones first). */
  chain: string[];
  /** Models skipped without a call (cooldown, limits, key rejected). */
  skipped: string[];
  fallbackUsed: boolean;
  createdAt: string;
  /** Field-level outcome of this run (older cached runs don't have it; the form recomputes it). */
  check?: CompletionCheck;
  /** Why no web research happened, when it didn't. */
  researchNote?: string | null;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const SYSTEM = `You complete product listings for AN MOBILE GALLERY, a mobile phone shop in Bangladesh.
Rules you must follow:
- Identify the EXACT device first: brand, official model name and the variant given by the shop (RAM / storage). Do not mix it up with similar models (Pro / Plus / Ultra / Lite, 4G vs 5G, a different year) or regional versions.
- When you can search the web: prefer the manufacturer's official product or specification page, then official support pages, then reliable specification databases. Use a source only if it is about this exact model and variant, and put its URL in "source". Never invent or guess a URL.
- "VERIFIED": confirmed by a source you cite in "source". "LIKELY": widely documented for this exact model, no source at hand. "NEEDS_VERIFICATION": your best guess, put it in "value". "UNKNOWN": you don't know — leave "value" empty.
- Fill every specification you know for this exact model. Leave a field empty only when you don't know it or it doesn't apply (e.g. no telephoto camera). For NFC, wireless charging, memory card and water resistance write "No" when the phone doesn't have it.
- RAM and storage are given by the shop and are final. Do not change or question them.
- Condition is given by the shop. Write the text for that condition (a used phone is not "brand new").
- Never mention, estimate or invent prices, discounts, EMI, offers, costs, stock, delivery, return policy, ratings, stars, reviews, testimonials or customer names.
- Model numbers, MPN, barcodes (GTIN/EAN/UPC) and warranty: only when VERIFIED with a source URL. Otherwise leave them empty.
- Every text (descriptions, highlights, SEO, FAQ) must be about this exact model and variant, based on the specifications. Name the model in the short description, description, SEO title and SEO description. No keyword stuffing.
- FAQ answers may only use facts you are confident about. Do not write FAQs about price, EMI, warranty, stock or delivery.
- Write plain, clear English for Bangladeshi shoppers in your own words. Do not copy text from websites. No hype, no emojis.
- Reply with ONE JSON object only, no markdown, no text before or after it.`;

const g = `{"value": "", "status": "VERIFIED|LIKELY|UNKNOWN|NEEDS_VERIFICATION", "source": "url or null"}`;
const SPEC_GUIDE = PHONE_SPECS.map((s) => `- ${s.key}: ${s.label} (${s.group}) — ${s.hint}`).join("\n");
const SCHEMA = `{
  "brand": "one of brand_options if it matches, otherwise the real brand name, or null",
  "category": "one of category_options, or null",
  "model": ${g},
  "model_number": ${g},
  "barcode": ${g},
  "warranty": ${g},
  "specs": {"<spec key from the list below>": ${g}, "...": "one entry per spec key"},
  "other_specs": [{"name": "another useful specification", "group": "Display|Performance|Camera|Battery|Connectivity|Physical|Features", "value": "", "status": "...", "source": null}],
  "short_description": "one or two sentences, 120-300 characters, names the model",
  "description": "3-5 short paragraphs, then '## Main features' with '- ' bullet lines, then '## Why buy it' with '- ' bullet lines",
  "highlights": ["4 to 6 short key highlights"],
  "seo": {"title": "max 60 characters, brand + model + variant", "description": "120-155 characters", "keywords": ["5 to 12 relevant search keywords"]},
  "faq": [{"q": "", "a": ""}]
}`;

const SECTION_NOTES: Record<CompletionSection, string> = {
  basic: "brand, category, model, model_number, barcode, warranty",
  specs: "specs and other_specs",
  description: "short_description, description, highlights",
  seo: "seo",
  faq: "faq (4-6 useful questions a buyer would ask about this exact phone)",
};

const nullableString = { type: ["string", "null"] };
const guessSchema = {
  type: "object",
  properties: { value: nullableString, status: { type: "string", enum: [...VERIFICATION] }, source: nullableString },
  required: ["value", "status", "source"],
};
/** The answer shape as JSON Schema (used where the provider supports schema-constrained output). */
export const COMPLETION_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    brand: nullableString,
    category: nullableString,
    model: guessSchema,
    model_number: guessSchema,
    barcode: guessSchema,
    warranty: guessSchema,
    specs: { type: "object", properties: Object.fromEntries(PHONE_SPECS.map((s) => [s.key, guessSchema])) },
    other_specs: {
      type: "array",
      items: { type: "object", properties: { name: { type: "string" }, group: { type: "string" }, value: nullableString, status: { type: "string" }, source: nullableString }, required: ["name", "value", "status"] },
    },
    short_description: nullableString,
    description: nullableString,
    highlights: { type: "array", items: { type: "string" } },
    seo: { type: "object", properties: { title: nullableString, description: nullableString, keywords: { type: "array", items: { type: "string" } } } },
    faq: { type: "array", items: { type: "object", properties: { q: { type: "string" }, a: { type: "string" } }, required: ["q", "a"] } },
  },
  required: ["brand", "category", "model", "specs", "short_description", "description", "highlights", "seo", "faq"],
};

export function buildCompletionRequest(input: CompletionInput): AiRequest {
  const all = input.sections.length === COMPLETION_SECTIONS.length;
  const facts = {
    product_name: input.name,
    ram: input.ram,
    storage: input.storage,
    condition: input.condition,
    brand_selected: input.brand,
    category_selected: input.category,
    model_entered: input.model,
    brand_options: input.brandOptions.slice(0, 80),
    category_options: input.categoryOptions.slice(0, 80),
  };
  const focus = all ? "Fill in every field." : `Only these parts are needed: ${input.sections.map((s) => SECTION_NOTES[s]).join("; ")}. Leave other fields empty.`;
  return {
    task: "product_content",
    system: SYSTEM,
    prompt: `Research this phone and complete its listing. ${focus}\n\nShop data (JSON):\n${JSON.stringify(facts, null, 1)}\n\nReturn JSON in exactly this shape:\n${SCHEMA}\n\nSpecification keys:\n${SPEC_GUIDE}`,
    json: true,
    jsonSchema: { name: "product_listing", schema: COMPLETION_JSON_SCHEMA },
    research: true,
    // a full listing is a long answer (and may include a web search)
    minTimeoutMs: 90_000,
  };
}

// ---------------------------------------------------------------------------
// Clean-up of the model's answer
// ---------------------------------------------------------------------------

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).replace(/\s+\n/g, "\n").trim();
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

const MONEY_OR_REVIEWS = /(৳|\btk\.?\b|\btaka\b|\bbdt\b|\$|€|£|\bpric(?:e|es|ed|ing)\b|\bcosts?\b|\bdiscount|\bemi\b|\binstal?ments?\b|\boffers?\b|\bratings?\b|\breviews?\b|\bstars?\b|\btestimonials?\b)/i;
const NOT_A_VALUE = /^(n\/?a|unknown|not available|needs verification|none|null|-|tbd|tba)$/i;

function status(v: unknown): Verification {
  const s = String(v ?? "").toUpperCase().replace(/[\s-]+/g, "_");
  return (VERIFICATION as readonly string[]).includes(s) ? (s as Verification) : "UNKNOWN";
}

const isUrl = (s: string | null): s is string => Boolean(s && /^https?:\/\/[^\s]+$/i.test(s));

/**
 * One guessed value. Without web research in this run nothing can be
 * VERIFIED (it is capped at LIKELY), whatever the model claims.
 */
function guess(raw: unknown, researched: boolean, max = 200): Guess {
  const o = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : { value: raw, status: raw ? "LIKELY" : "UNKNOWN" }) as { value?: unknown; status?: unknown; source?: unknown; source_url?: unknown };
  let value = str(Array.isArray(o.value) ? o.value.filter((x) => typeof x === "string").join(", ") : o.value, max);
  let st = status(o.status);
  const source = str(o.source ?? o.source_url, 500);
  if (!value || NOT_A_VALUE.test(value) || MONEY_OR_REVIEWS.test(value)) {
    value = null;
    if (st === "VERIFIED" || st === "LIKELY") st = "UNKNOWN";
  }
  if (st === "VERIFIED" && !(researched && isUrl(source))) st = "LIKELY";
  return { value, status: value ? st : st === "NEEDS_VERIFICATION" ? "NEEDS_VERIFICATION" : "UNKNOWN", source: isUrl(source) ? source : null };
}

/** GTIN-8/12/13/14 check digit. */
export function validGtin(code: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return false;
  const digits = code.split("").map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

const squashName = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "").replace(/(inc|ltd|co|corp|corporation|electronics|mobile|mobiles)$/, "");
const singular = (v: string) => v.replace(/(ies)$/, "y").replace(/s$/, "");
/** "Apple Inc." → Apple, "smartphone" → Smartphones; never a loose guess between unrelated names. */
function matchOption(name: string | null, options: { id: string; name: string }[]) {
  if (!name) return null;
  const n = squashName(name);
  if (!n) return null;
  return (
    options.find((o) => o.name.trim().toLowerCase() === name.trim().toLowerCase()) ??
    options.find((o) => squashName(o.name) === n) ??
    options.find((o) => singular(squashName(o.name)) === singular(n)) ??
    null
  );
}

const BAD_FAQ = /\b(price|cost|emi|instal?ment|discount|offer|warranty|guarantee|stock|available|availability|deliver|shipping|rating|review)\b/i;

export function sanitizeCompletion(
  answer: Record<string, unknown>,
  input: CompletionInput,
  sources: AiSource[],
  taxonomy: { brands: { id: string; name: string }[]; categories: { id: string; name: string }[] },
): ProductCompletion {
  const raw = normalizeAnswer(answer);
  const researched = sources.length > 0;
  const want = new Set(input.sections);

  const brandName = str(raw.brand, 80);
  const brand = brandName && !MONEY_OR_REVIEWS.test(brandName) ? (() => {
    const m = matchOption(brandName, taxonomy.brands);
    return m ? { name: m.name, id: m.id } : { name: brandName, id: null };
  })() : null;
  const categoryName = str(raw.category, 80);
  // Categories must be one the shop already has; anything else is only a suggestion.
  const category = categoryName ? (() => {
    const m = matchOption(categoryName, taxonomy.categories);
    return m ? { name: m.name, id: m.id } : { name: categoryName, id: null };
  })() : null;

  const specsRaw = (raw.specs && typeof raw.specs === "object" ? raw.specs : {}) as Record<string, unknown>;
  const specs: CompletionSpec[] = COMPLETION_SPECS.map((f) => ({ key: f.key, group: f.group, label: f.label, ...guess(specsRaw[f.key], researched) }));
  if (Array.isArray(raw.other_specs)) {
    const taken = new Set(COMPLETION_SPECS.map((s) => s.label.toLowerCase()));
    for (const o of raw.other_specs.slice(0, 16)) {
      const name = str((o as { name?: unknown } | null)?.name, 60);
      if (!name || taken.has(name.toLowerCase()) || isProtectedSpec(name) || MONEY_OR_REVIEWS.test(name)) continue;
      taken.add(name.toLowerCase());
      const group = str((o as { group?: unknown } | null)?.group, 40);
      specs.push({ key: `other:${name.toLowerCase()}`, group: group && !MONEY_OR_REVIEWS.test(group) ? group : "Other", label: name, ...guess(o, researched) });
      if (specs.length >= COMPLETION_SPECS.length + 12) break;
    }
  }

  const identifier = (v: unknown, extra: (value: string) => boolean = () => true): Guess | null => {
    const gss = guess(v, researched, 80);
    if (!gss.value) return gss.status === "NEEDS_VERIFICATION" ? gss : null;
    // Identifiers are only kept when verified from a source during this run.
    if (gss.status !== "VERIFIED" || !extra(gss.value)) return { value: gss.value, status: "NEEDS_VERIFICATION", source: gss.source };
    return gss;
  };

  const seoRaw = (raw.seo && typeof raw.seo === "object" ? raw.seo : {}) as Record<string, unknown>;
  const faq = Array.isArray(raw.faq)
    ? raw.faq
        .map((x) => {
          const o = (x ?? {}) as { q?: unknown; a?: unknown; question?: unknown; answer?: unknown };
          const q = str(o.q ?? o.question, 200);
          const a = stripPriceAndRatingSentences(str(o.a ?? o.answer, 600));
          return q && a && !BAD_FAQ.test(q) ? { q, a } : null;
        })
        .filter((x): x is { q: string; a: string } => x !== null)
        .slice(0, 8)
    : [];

  const description = stripPriceAndRatingSentences(str(raw.description, 6000));
  const shortDescription = stripPriceAndRatingSentences(str(raw.short_description, 500));

  return {
    sections: input.sections,
    brand: want.has("basic") ? brand : null,
    category: want.has("basic") ? category : null,
    model: want.has("basic") ? guess(raw.model, researched, 80) : null,
    mpn: want.has("basic") ? identifier(raw.model_number) : null,
    barcode: want.has("basic") ? identifier(raw.barcode, (v) => validGtin(v.replace(/[\s-]/g, ""))) : null,
    warranty: want.has("basic") ? identifier(raw.warranty) : null,
    specs: want.has("specs") ? specs : [],
    shortDescription: want.has("description") ? shortDescription : null,
    description: want.has("description") ? description : null,
    highlights: want.has("description") ? strList(raw.highlights, 6, 120).filter((h) => !MONEY_OR_REVIEWS.test(h)) : [],
    seo: want.has("seo")
      ? {
          title: str(seoRaw.title, 70),
          description: stripPriceAndRatingSentences(str(seoRaw.description, 160)),
          keywords: strList(seoRaw.keywords, 15, 40).filter((k) => !MONEY_OR_REVIEWS.test(k)),
          slug: suggestSlug(input.name, brand?.name ?? input.brand, input.ram, input.storage),
        }
      : { title: null, description: null, keywords: [], slug: null },
    faq: want.has("faq") ? faq : [],
    sources: sources.slice(0, 20),
    researched,
  };
}

/** Regenerating some sections keeps the other sections of the previous result. */
export function mergeSections(prev: ProductCompletion, next: ProductCompletion): ProductCompletion {
  const has = (s: ProductCompletion["sections"][number]) => next.sections.includes(s);
  return {
    sections: Array.from(new Set([...prev.sections, ...next.sections])),
    brand: has("basic") ? next.brand : prev.brand,
    category: has("basic") ? next.category : prev.category,
    model: has("basic") ? next.model : prev.model,
    mpn: has("basic") ? next.mpn : prev.mpn,
    barcode: has("basic") ? next.barcode : prev.barcode,
    warranty: has("basic") ? next.warranty : prev.warranty,
    specs: has("specs") ? next.specs : prev.specs,
    shortDescription: has("description") ? next.shortDescription : prev.shortDescription,
    description: has("description") ? next.description : prev.description,
    highlights: has("description") ? next.highlights : prev.highlights,
    seo: has("seo") ? next.seo : prev.seo,
    faq: has("faq") ? next.faq : prev.faq,
    sources: next.sources.length ? next.sources : prev.sources,
    researched: next.researched || prev.researched,
  };
}

// ---------------------------------------------------------------------------
// Deterministic suggestions (no AI)
// ---------------------------------------------------------------------------

function compactSize(v: string): string {
  const m = /(\d+(?:\.\d+)?)\s*(tb|gb|mb)?/i.exec(v);
  return m ? `${m[1]}${(m[2] ?? "GB").toUpperCase()}` : v.replace(/\s+/g, "");
}

export function suggestSlug(name: string, brand: string | null, ram: string, storage: string): string {
  const lower = name.toLowerCase();
  const parts = [brand && !lower.includes(brand.toLowerCase()) ? brand : "", name];
  const r = compactSize(ram);
  const s = compactSize(storage);
  if (r && !lower.replace(/\s/g, "").includes(r.toLowerCase())) parts.push(r);
  if (s && !lower.replace(/\s/g, "").includes(s.toLowerCase())) parts.push(s);
  return slugify(parts.filter(Boolean).join(" "));
}

/** An internal SKU suggestion, e.g. XIA-REDMI15-6-128. Only filled in when the admin clicks "Use". */
export function suggestSku(name: string, brand: string | null, ram: string, storage: string): string {
  const num = (v: string) => (/(\d+(?:\.\d+)?)\s*(tb)?/i.exec(v)?.[0] ?? "").replace(/\s+/g, "").toUpperCase();
  const b = (brand ?? "").replace(/[^a-z0-9]/gi, "").slice(0, 3).toUpperCase();
  let n = name;
  if (brand) n = n.replace(new RegExp(brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "");
  n = n.replace(/\d+\s*(gb|tb)\b/gi, "").replace(/[^a-z0-9]/gi, "").slice(0, 14).toUpperCase();
  return [b, n, num(ram), num(storage)].filter(Boolean).join("-").slice(0, 60);
}

// ---------------------------------------------------------------------------
// Into the form
// ---------------------------------------------------------------------------

export interface SpecRow {
  group_name: string;
  name: string;
  value: string;
}

/** The only form fields AI can fill. (No name, price, stock, images, status, condition, SKU or variants.) */
export interface AiFormValues {
  brand_id?: string;
  category_id?: string;
  model?: string;
  mpn?: string;
  barcode?: string;
  warranty?: string;
  short_description?: string;
  description?: string;
  features?: string[];
  meta_title?: string;
  meta_description?: string;
  slug?: string;
  specs?: SpecRow[];
}
export type AiField = keyof AiFormValues;
export type FormContent = Required<{ [K in AiField]: NonNullable<AiFormValues[K]> }>;

export const AI_FIELDS: AiField[] = ["brand_id", "category_id", "model", "mpn", "barcode", "warranty", "short_description", "description", "features", "meta_title", "meta_description", "slug", "specs"];

export const FIELD_LABELS: Record<AiField, string> = {
  brand_id: "Brand",
  category_id: "Category",
  model: "Model",
  mpn: "MPN",
  barcode: "Barcode",
  warranty: "Warranty",
  short_description: "Short description",
  description: "Full description",
  features: "Key features",
  meta_title: "Meta title",
  meta_description: "Meta description",
  slug: "URL slug",
  specs: "Specifications",
};

export const SECTION_FIELDS: Record<CompletionSection, AiField[]> = {
  basic: ["brand_id", "category_id", "model", "mpn", "barcode", "warranty"],
  specs: ["specs"],
  description: ["short_description", "description", "features"],
  seo: ["meta_title", "meta_description", "slug"],
  faq: [],
};

const usable = (gss: Guess | null) => (gss && gss.value && (gss.status === "VERIFIED" || gss.status === "LIKELY") ? gss.value : undefined);
const verifiedOnly = (gss: Guess | null) => (gss && gss.value && gss.status === "VERIFIED" ? gss.value : undefined);

/** What AI proposes for the form. Fields it can't support are simply absent. */
export function completionToForm(c: ProductCompletion): AiFormValues {
  const out: AiFormValues = {};
  if (c.brand?.id) out.brand_id = c.brand.id;
  if (c.category?.id) out.category_id = c.category.id;
  out.model = usable(c.model);
  out.mpn = verifiedOnly(c.mpn);
  const barcode = verifiedOnly(c.barcode)?.replace(/[\s-]/g, "");
  out.barcode = barcode && validGtin(barcode) ? barcode : undefined;
  out.warranty = verifiedOnly(c.warranty);
  out.short_description = c.shortDescription ?? undefined;
  out.description = c.description ?? undefined;
  out.features = c.highlights.length ? c.highlights : undefined;
  out.meta_title = c.seo.title ?? undefined;
  out.meta_description = c.seo.description ?? undefined;
  out.slug = c.seo.slug ?? undefined;
  const specs = c.specs
    .filter((s) => s.value && (s.status === "VERIFIED" || s.status === "LIKELY") && !isProtectedSpec(s.label))
    .map((s) => ({ group_name: s.group, name: s.label, value: s.value as string }));
  out.specs = specs.length ? specs : undefined;
  for (const k of AI_FIELDS) if (out[k] === undefined) delete out[k];
  return out;
}

/** Values that need the admin's attention (unknown or unverified). */
export function needsReview(c: ProductCompletion): { label: string; value: string | null; status: Verification }[] {
  const list: { label: string; value: string | null; status: Verification }[] = [];
  const add = (label: string, gss: Guess | null, need: "usable" | "verified") => {
    if (!gss) return;
    const ok = need === "verified" ? gss.status === "VERIFIED" : gss.status === "VERIFIED" || gss.status === "LIKELY";
    if (!ok && (gss.value || need === "usable")) list.push({ label, value: gss.value, status: gss.value ? "NEEDS_VERIFICATION" : gss.status });
  };
  if (c.sections.includes("basic")) {
    add("Model", c.model, "usable");
    add("MPN", c.mpn, "verified");
    add("Barcode (GTIN)", c.barcode, "verified");
    add("Warranty", c.warranty, "verified");
  }
  for (const s of c.specs) if (!isProtectedSpec(s.label)) add(s.label, s, "usable");
  return list;
}

const norm = (v: unknown): string =>
  Array.isArray(v) ? JSON.stringify(v.map((x) => (typeof x === "string" ? x.trim() : JSON.stringify(x)))) : v === undefined || v === null ? "" : String(v).trim();
const isEmpty = (v: unknown) => (Array.isArray(v) ? v.length === 0 : norm(v) === "");
const specKey = (name: string) => name.trim().toLowerCase();

/** Where a field's current value came from: AI (unchanged since), the admin, or nobody. */
export function fieldOrigin(field: Exclude<AiField, "specs">, current: FormContent, ai: AiFormValues): "ai" | "manual" | "empty" {
  const cur = current[field];
  if (isEmpty(cur)) return "empty";
  return ai[field] !== undefined && norm(ai[field]) === norm(cur) ? "ai" : "manual";
}

export function specOrigin(row: SpecRow, ai: AiFormValues): "ai" | "manual" | "empty" {
  if (!row.value.trim()) return "empty";
  const hit = ai.specs?.find((s) => specKey(s.name) === specKey(row.name));
  return hit && hit.value.trim() === row.value.trim() ? "ai" : "manual";
}

/** Manually edited fields that applying `proposed` would replace (ask before replacing these). */
export function manualConflicts(current: FormContent, ai: AiFormValues, proposed: AiFormValues): string[] {
  const out: string[] = [];
  for (const f of AI_FIELDS) {
    const value = proposed[f];
    if (value === undefined) continue;
    if (f === "specs") {
      const names = (value as SpecRow[])
        .filter((p) => !isProtectedSpec(p.name))
        .map((p) => current.specs.find((r) => specKey(r.name) === specKey(p.name)))
        .filter((r): r is SpecRow => Boolean(r) && specOrigin(r as SpecRow, ai) === "manual" && (r as SpecRow).value.trim() !== "")
        .map((r) => r.name);
      const changed = names.filter((n) => {
        const p = (value as SpecRow[]).find((x) => specKey(x.name) === specKey(n));
        const r = current.specs.find((x) => specKey(x.name) === specKey(n));
        return p && r && p.value.trim() !== r.value.trim();
      });
      if (changed.length) out.push(`${FIELD_LABELS.specs}: ${changed.join(", ")}`);
      continue;
    }
    if (fieldOrigin(f, current, ai) === "manual" && norm(current[f]) !== norm(value)) out.push(FIELD_LABELS[f]);
  }
  return out;
}

export interface MergeResult {
  patch: Partial<FormContent>;
  ai: AiFormValues;
  applied: string[];
  keptManual: string[];
}

/**
 * Apply AI values to the form. Empty and AI-filled fields are updated;
 * fields the admin edited are kept unless `replaceManual` (the admin confirmed).
 * RAM / storage rows are never touched.
 */
export function mergeIntoForm(current: FormContent, ai: AiFormValues, proposed: AiFormValues, replaceManual: boolean): MergeResult {
  const patch: Partial<FormContent> = {};
  const nextAi: AiFormValues = { ...ai };
  const applied: string[] = [];
  const keptManual: string[] = [];
  for (const f of AI_FIELDS) {
    const value = proposed[f];
    if (value === undefined) continue;
    if (f === "specs") {
      const rows = current.specs.map((r) => ({ ...r }));
      const aiSpecs = [...(ai.specs ?? [])];
      let changed = false;
      for (const p of value as SpecRow[]) {
        if (isProtectedSpec(p.name)) continue;
        const i = rows.findIndex((r) => specKey(r.name) === specKey(p.name));
        if (i >= 0) {
          if (rows[i].value.trim() === p.value.trim()) {
            // same value: now counts as AI
          } else if (specOrigin(rows[i], ai) === "manual" && !replaceManual) {
            keptManual.push(`${FIELD_LABELS.specs}: ${rows[i].name}`);
            continue;
          } else {
            rows[i] = { group_name: rows[i].group_name || p.group_name, name: rows[i].name, value: p.value };
            changed = true;
          }
        } else {
          // insert after the last row of the same group, else at the end
          const lastOfGroup = rows.map((r) => r.group_name.toLowerCase()).lastIndexOf(p.group_name.toLowerCase());
          rows.splice(lastOfGroup >= 0 ? lastOfGroup + 1 : rows.length, 0, { ...p });
          changed = true;
        }
        const j = aiSpecs.findIndex((s) => specKey(s.name) === specKey(p.name));
        if (j >= 0) aiSpecs[j] = { ...p };
        else aiSpecs.push({ ...p });
      }
      nextAi.specs = aiSpecs;
      if (changed) {
        patch.specs = rows;
        applied.push(FIELD_LABELS.specs);
      }
      continue;
    }
    const origin = fieldOrigin(f, current, ai);
    if (origin === "manual" && !replaceManual && norm(current[f]) !== norm(value)) {
      keptManual.push(FIELD_LABELS[f]);
      continue;
    }
    (nextAi as Record<string, unknown>)[f] = value;
    if (norm(current[f]) !== norm(value)) {
      (patch as Record<string, unknown>)[f] = value;
      applied.push(FIELD_LABELS[f]);
    }
  }
  return { patch, ai: nextAi, applied, keptManual };
}

/** Clear everything AI filled that the admin hasn't changed since. Edited fields stay. */
export function removeAiContent(current: FormContent, ai: AiFormValues, fields: AiField[] = AI_FIELDS): { patch: Partial<FormContent>; ai: AiFormValues; removed: string[] } {
  const patch: Partial<FormContent> = {};
  const nextAi: AiFormValues = { ...ai };
  const removed: string[] = [];
  for (const f of fields) {
    if (f === "specs") {
      const keep = current.specs.filter((r) => isProtectedSpec(r.name) || specOrigin(r, ai) !== "ai");
      if (keep.length !== current.specs.length) {
        patch.specs = keep;
        removed.push(FIELD_LABELS.specs);
      }
      delete nextAi.specs;
      continue;
    }
    if (fieldOrigin(f, current, ai) === "ai") {
      (patch as Record<string, unknown>)[f] = Array.isArray(current[f]) ? [] : "";
      removed.push(FIELD_LABELS[f]);
    }
    delete nextAi[f];
  }
  return { patch, ai: nextAi, removed };
}

/** Read the RAM / storage typed by the admin from the spec rows. */
export function quickSpec(specs: SpecRow[], which: "ram" | "storage"): string {
  const names = which === "ram" ? /^(ram|memory)$/i : /^(storage|rom|internal storage|internal memory)$/i;
  return specs.find((s) => names.test(s.name.trim()))?.value ?? "";
}

/** Set RAM / storage in the spec rows (creates the row under Memory if missing). */
export function withQuickSpec(specs: SpecRow[], which: "ram" | "storage", value: string): SpecRow[] {
  const names = which === "ram" ? /^(ram|memory)$/i : /^(storage|rom|internal storage|internal memory)$/i;
  const i = specs.findIndex((s) => names.test(s.name.trim()));
  if (i >= 0) return specs.map((s, n) => (n === i ? { ...s, value } : s));
  const row = which === "ram" ? { ...RAM_SPEC, value } : { ...STORAGE_SPEC, value };
  // RAM first, then Storage, at the top of the list
  const ramAt = specs.findIndex((s) => /^(ram|memory)$/i.test(s.name.trim()));
  return which === "storage" && ramAt >= 0 ? [...specs.slice(0, ramAt + 1), row, ...specs.slice(ramAt + 1)] : [row, ...specs];
}

/** Only the fields of the given sections. */
export function pickSections(values: AiFormValues, sections: CompletionSection[]): AiFormValues {
  const keep = new Set(sections.flatMap((s) => SECTION_FIELDS[s]));
  const out: AiFormValues = {};
  for (const f of AI_FIELDS) if (keep.has(f) && values[f] !== undefined) (out as Record<string, unknown>)[f] = values[f];
  return out;
}

/** AI values that are not in the form yet (empty field / missing spec row). */
export function unappliedFields(current: FormContent, proposed: AiFormValues): string[] {
  const out: string[] = [];
  for (const f of AI_FIELDS) {
    const value = proposed[f];
    if (value === undefined) continue;
    if (f === "specs") {
      const missing = (value as SpecRow[]).filter((p) => !current.specs.some((r) => specKey(r.name) === specKey(p.name) && r.value.trim() !== ""));
      if (missing.length) out.push(FIELD_LABELS.specs);
    } else if (isEmpty(current[f])) out.push(FIELD_LABELS[f]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Field-level result: what was really filled (not just "the model answered")
// ---------------------------------------------------------------------------

export type FieldState = "pending" | "generating" | "success" | "partial" | "failed" | "skipped";
export type ResultField =
  | "brand"
  | "category"
  | "model"
  | "specs"
  | "short_description"
  | "description"
  | "highlights"
  | "seo_title"
  | "seo_description"
  | "keywords"
  | "faq";

export const RESULT_FIELDS: { key: ResultField; label: string; section: CompletionSection; required: boolean }[] = [
  { key: "brand", label: "Brand", section: "basic", required: true },
  { key: "model", label: "Model", section: "basic", required: true },
  { key: "category", label: "Category", section: "basic", required: false },
  { key: "specs", label: "Specifications", section: "specs", required: true },
  { key: "short_description", label: "Short description", section: "description", required: true },
  { key: "description", label: "Full description", section: "description", required: true },
  { key: "highlights", label: "Highlights", section: "description", required: true },
  { key: "seo_title", label: "SEO title", section: "seo", required: true },
  { key: "seo_description", label: "SEO description", section: "seo", required: true },
  { key: "keywords", label: "Search keywords", section: "seo", required: false },
  { key: "faq", label: "FAQ", section: "faq", required: true },
];

export interface FieldResult {
  key: ResultField;
  label: string;
  section: CompletionSection;
  required: boolean;
  state: FieldState;
  note: string | null;
}

export interface CompletionCheck {
  /** success: every requested required field is filled and passed the checks. */
  status: "success" | "partial" | "failed";
  fields: FieldResult[];
  /** Sections with required fields that came back empty (offered for "Retry failed fields"). */
  retrySections: CompletionSection[];
}

/** Enough specifications for a full listing (out of ~37 the model is asked for). */
export const SPECS_FOR_SUCCESS = 12;

/** Tokens that identify the model in a name: "Redmi 15" → ["15"], "Galaxy S25 Ultra 12GB" → ["S25"]. */
export function modelTokens(name: string): string[] {
  return name
    .split(/[^A-Za-z0-9]+/)
    .filter((t) => /\d/.test(t) && !/^\d+(gb|tb|mb)$/i.test(t) && !/^[2-5]g$/i.test(t) && !/^\d{4,}$/.test(t))
    .slice(0, 3);
}

const hasToken = (textValue: string, token: string) => new RegExp(`(^|[^a-z0-9])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(textValue);
const sizeNumber = (v: string) => /(\d+(?:\.\d+)?)\s*(gb|tb)?/i.exec(v)?.[1] ?? null;

/** Problems in a generated text: wrong model, other RAM/storage, wrong condition. */
function textProblems(value: string, facts: { name: string; ram: string; storage: string; condition: string }): string[] {
  const out: string[] = [];
  const tokens = modelTokens(facts.name);
  if (tokens.length && !tokens.some((t) => hasToken(value, t))) out.push(`doesn't name the model (${tokens.join(" ")})`);
  const ram = sizeNumber(facts.ram);
  for (const m of value.matchAll(/(\d+(?:\.\d+)?)\s*GB\s*(?:of\s+)?RAM/gi)) if (ram && m[1] !== ram) out.push(`mentions ${m[1]}GB RAM (you entered ${facts.ram})`);
  const storage = sizeNumber(facts.storage);
  for (const m of value.matchAll(/(\d+(?:\.\d+)?)\s*(GB|TB)\s*(?:of\s+)?(?:internal\s+)?(?:storage|ROM)/gi)) if (storage && m[1] !== storage) out.push(`mentions ${m[1]}${m[2].toUpperCase()} storage (you entered ${facts.storage})`);
  if (facts.condition !== "new" && /\b(brand[- ]new|new condition|out[- ]of[- ]the[- ]box|sealed)\b/i.test(value)) out.push(`describes it as new (Condition is ${facts.condition})`);
  return Array.from(new Set(out));
}

/** Judge each requested field. A run is only "success" when nothing required is missing. */
export function evaluateCompletion(c: ProductCompletion, facts: { name: string; ram: string; storage: string; condition: string }): CompletionCheck {
  const asked = new Set(c.sections);
  const fields: FieldResult[] = RESULT_FIELDS.map((f) => {
    const r = (state: FieldState, note: string | null = null): FieldResult => ({ ...f, state, note });
    if (!asked.has(f.section)) return r("skipped");
    const textField = (value: string | null, min: number): FieldResult => {
      if (!value) return r("failed", "empty");
      const problems = textProblems(value, facts);
      if (value.length < min) problems.unshift("too short");
      return problems.length ? r("partial", problems.join("; ")) : r("success");
    };
    switch (f.key) {
      case "brand":
        return c.brand?.id ? r("success") : c.brand ? r("partial", `“${c.brand.name}” isn't in your brand list`) : r("failed", "not identified");
      case "category":
        return c.category?.id ? r("success") : c.category ? r("partial", `suggested “${c.category.name}”, which isn't in your category list`) : r("failed", "no matching category");
      case "model":
        if (c.model?.value && (c.model.status === "VERIFIED" || c.model.status === "LIKELY")) return r("success");
        return c.model?.value ? r("partial", "needs verification") : r("failed", "not identified");
      case "specs": {
        const n = c.specs.filter((s) => s.value && (s.status === "VERIFIED" || s.status === "LIKELY") && !isProtectedSpec(s.label)).length;
        if (n === 0) return r("failed", "no usable specifications");
        const verified = c.specs.filter((s) => s.value && s.status === "VERIFIED").length;
        const note = `${n} filled${verified ? `, ${verified} verified from sources` : ""}`;
        return n >= SPECS_FOR_SUCCESS ? r("success", note) : r("partial", `${note} (expected at least ${SPECS_FOR_SUCCESS})`);
      }
      case "short_description":
        return textField(c.shortDescription, 40);
      case "description":
        return textField(c.description, 250);
      case "highlights":
        return c.highlights.length === 0 ? r("failed", "empty") : c.highlights.length < 3 ? r("partial", `only ${c.highlights.length}`) : r("success");
      case "seo_title":
        return textField(c.seo.title, 15);
      case "seo_description":
        return textField(c.seo.description, 50);
      case "keywords":
        return c.seo.keywords.length === 0 ? r("failed", "empty") : c.seo.keywords.length < 3 ? r("partial", `only ${c.seo.keywords.length}`) : r("success");
      case "faq":
        return c.faq.length === 0 ? r("failed", "empty") : c.faq.length < 3 ? r("partial", `only ${c.faq.length} question${c.faq.length === 1 ? "" : "s"}`) : r("success");
    }
  });
  const requested = fields.filter((f) => f.state !== "skipped");
  const required = requested.filter((f) => f.required);
  const anyUsable = requested.some((f) => f.state === "success" || f.state === "partial");
  const status: CompletionCheck["status"] = required.every((f) => f.state === "success") ? "success" : anyUsable ? "partial" : "failed";
  const retrySections = Array.from(new Set(required.filter((f) => f.state === "failed").map((f) => f.section)));
  return { status, fields, retrySections };
}

/**
 * Fill the gaps of a first answer with a follow-up answer. Nothing that was
 * already filled is replaced.
 */
export function fillGaps(prev: ProductCompletion, next: ProductCompletion): ProductCompletion {
  const usableGuess = (x: Guess | null) => Boolean(x?.value && (x.status === "VERIFIED" || x.status === "LIKELY"));
  const specs = prev.specs.map((s) => {
    if (s.value && (s.status === "VERIFIED" || s.status === "LIKELY")) return s;
    const n = next.specs.find((x) => x.key === s.key);
    return n && n.value && (n.status === "VERIFIED" || n.status === "LIKELY" || !s.value) ? n : s;
  });
  for (const n of next.specs) if (!specs.some((s) => s.key === n.key || s.label.toLowerCase() === n.label.toLowerCase())) specs.push(n);
  const urls = new Set(prev.sources.map((x) => x.url));
  return {
    sections: Array.from(new Set([...prev.sections, ...next.sections])),
    brand: prev.brand?.id ? prev.brand : (next.brand ?? prev.brand),
    category: prev.category?.id ? prev.category : (next.category ?? prev.category),
    model: usableGuess(prev.model) ? prev.model : (next.model ?? prev.model),
    mpn: prev.mpn?.status === "VERIFIED" ? prev.mpn : (next.mpn ?? prev.mpn),
    barcode: prev.barcode?.status === "VERIFIED" ? prev.barcode : (next.barcode ?? prev.barcode),
    warranty: prev.warranty?.status === "VERIFIED" ? prev.warranty : (next.warranty ?? prev.warranty),
    specs,
    shortDescription: prev.shortDescription ?? next.shortDescription,
    description: prev.description ?? next.description,
    highlights: prev.highlights.length >= 3 ? prev.highlights : next.highlights.length > prev.highlights.length ? next.highlights : prev.highlights,
    seo: {
      title: prev.seo.title ?? next.seo.title,
      description: prev.seo.description ?? next.seo.description,
      keywords: prev.seo.keywords.length >= 3 ? prev.seo.keywords : next.seo.keywords.length > prev.seo.keywords.length ? next.seo.keywords : prev.seo.keywords,
      slug: prev.seo.slug ?? next.seo.slug,
    },
    faq: prev.faq.length >= 3 ? prev.faq : next.faq.length > prev.faq.length ? next.faq : prev.faq,
    sources: [...prev.sources, ...next.sources.filter((x) => !urls.has(x.url))].slice(0, 20),
    researched: prev.researched || next.researched,
  };
}

/** "Generate all missing fields": only fields that are empty in the form (and spec rows not there yet). */
export function onlyEmptyFields(current: FormContent, proposed: AiFormValues): AiFormValues {
  const out: AiFormValues = {};
  for (const f of AI_FIELDS) {
    const value = proposed[f];
    if (value === undefined) continue;
    if (f === "specs") {
      const add = (value as SpecRow[]).filter((p) => !current.specs.some((r) => specKey(r.name) === specKey(p.name) && r.value.trim() !== ""));
      if (add.length) out.specs = add;
    } else if (isEmpty(current[f])) (out as Record<string, unknown>)[f] = value;
  }
  return out;
}

/** Sections that still have empty fields in the form (what "Generate all missing fields" asks for). */
export function missingSections(current: FormContent, faqCount: number): CompletionSection[] {
  const out: CompletionSection[] = [];
  if (!current.brand_id || !current.model.trim()) out.push("basic");
  if (current.specs.filter((r) => !isProtectedSpec(r.name) && r.value.trim()).length < SPECS_FOR_SUCCESS) out.push("specs");
  if (!current.short_description.trim() || !current.description.trim() || current.features.length === 0) out.push("description");
  if (!current.meta_title.trim() || !current.meta_description.trim()) out.push("seo");
  if (faqCount < 3) out.push("faq");
  return out;
}
