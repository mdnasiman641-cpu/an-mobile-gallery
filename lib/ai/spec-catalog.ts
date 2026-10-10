/**
 * Smartphone specifications AI can fill, and tolerant reading of AI answers.
 *
 * Shared by "Complete with AI" (product form) and the AI Assistant jobs.
 * Plain logic, no secrets — safe on the server and in the browser.
 *
 * Models answer the same request in many shapes: specs as an object, a list,
 * or nested by group; "shortDescription" instead of "short_description"; the
 * whole listing wrapped in {"product": …}; descriptions as an array of
 * paragraphs. Before this module those answers were read as empty fields while
 * the run still reported success. normalizeAnswer() maps every shape we know
 * onto one canonical object; anything it can't place is reported as missing.
 */

export interface PhoneSpec {
  key: string;
  group: string;
  label: string;
  /** Short guidance for the model (what belongs in this field). */
  hint: string;
  /** Other names models use for this spec (matched case/punctuation-insensitively). */
  aliases: string[];
  /** Essential for a listing; a missing core value puts AI content into "Needs verification". */
  core: boolean;
}

/**
 * Display order = group order. RAM and storage are not here: the admin types
 * them and AI never writes them. Labels of older entries are unchanged so
 * existing products' rows still match (no duplicates).
 */
export const PHONE_SPECS: PhoneSpec[] = [
  { key: "os", group: "General", label: "Operating system", hint: "OS and version at launch, e.g. Android 15, HyperOS 2", aliases: ["os", "operating system", "software", "platform os", "ui"], core: true },
  { key: "release_date", group: "General", label: "Release date", hint: "month and year of release, only if known", aliases: ["release date", "launch date", "released", "announced", "launch", "release"], core: false },

  { key: "display_type", group: "Display", label: "Display", hint: "panel type, e.g. 6.67-inch AMOLED or Dynamic AMOLED 2X", aliases: ["display", "display type", "screen type", "panel", "panel type", "screen technology"], core: true },
  { key: "display_size", group: "Display", label: "Size", hint: "diagonal in inches, e.g. 6.9 inches", aliases: ["size", "display size", "screen size", "screen", "diagonal"], core: false },
  { key: "resolution", group: "Display", label: "Resolution", hint: "pixels, e.g. 2400 x 1080 (FHD+)", aliases: ["resolution", "display resolution", "screen resolution"], core: false },
  { key: "refresh_rate", group: "Display", label: "Refresh rate", hint: "e.g. 120Hz", aliases: ["refresh rate", "refresh"], core: false },
  { key: "display_protection", group: "Display", label: "Screen protection", hint: "e.g. Corning Gorilla Glass 5", aliases: ["screen protection", "display protection", "protection", "glass", "cover glass"], core: false },

  { key: "chipset", group: "Performance", label: "Chipset", hint: "e.g. Snapdragon 8 Elite, Helio G99", aliases: ["chipset", "chip", "soc", "platform", "processor chipset", "system on chip"], core: false },
  { key: "processor", group: "Performance", label: "Processor", hint: "CPU cores and clock speeds", aliases: ["processor", "cpu", "cpu details", "cores"], core: false },
  { key: "gpu", group: "Performance", label: "GPU", hint: "graphics, e.g. Adreno 830", aliases: ["gpu", "graphics", "graphics processor"], core: false },
  { key: "expandable_storage", group: "Memory", label: "Expandable storage", hint: "memory card support, e.g. microSD up to 1TB, or No", aliases: ["expandable storage", "memory card", "card slot", "microsd", "micro sd", "memory card slot", "external storage"], core: false },

  { key: "rear_camera", group: "Camera", label: "Rear camera", hint: "rear setup summary, e.g. 50MP + 8MP + 2MP", aliases: ["rear camera", "rear cameras", "back camera", "main cameras", "camera", "cameras", "rear camera setup"], core: false },
  { key: "main_camera", group: "Camera", label: "Main camera", hint: "main sensor, e.g. 200MP, f/1.7, OIS", aliases: ["main camera", "primary camera", "wide camera", "main", "main sensor"], core: false },
  { key: "ultrawide_camera", group: "Camera", label: "Ultrawide camera", hint: "only if the phone has one", aliases: ["ultrawide camera", "ultra wide camera", "ultrawide", "ultra wide"], core: false },
  { key: "telephoto_camera", group: "Camera", label: "Telephoto camera", hint: "only if the phone has one, e.g. 50MP 5x periscope", aliases: ["telephoto camera", "telephoto", "zoom camera", "periscope", "periscope camera"], core: false },
  { key: "front_camera", group: "Camera", label: "Front camera", hint: "selfie camera, e.g. 12MP", aliases: ["front camera", "selfie camera", "selfie", "front"], core: false },
  { key: "video_recording", group: "Camera", label: "Video recording", hint: "max video, e.g. 4K@60fps", aliases: ["video recording", "video", "rear video", "video resolution"], core: false },

  { key: "battery", group: "Battery", label: "Battery", hint: "capacity, e.g. 5000 mAh", aliases: ["battery", "battery capacity", "capacity"], core: true },
  { key: "charging", group: "Battery", label: "Charging", hint: "wired charging speed, e.g. 45W", aliases: ["charging", "charging speed", "fast charging", "wired charging"], core: false },
  { key: "wireless_charging", group: "Battery", label: "Wireless charging", hint: "e.g. 15W, or No", aliases: ["wireless charging", "wireless"], core: false },

  { key: "network", group: "Connectivity", label: "Network", hint: "supported generations, e.g. 2G, 3G, 4G LTE, 5G", aliases: ["network", "network technology", "networks", "cellular", "mobile network", "2g 3g 4g 5g", "bands"], core: true },
  { key: "sim", group: "Connectivity", label: "SIM", hint: "e.g. Dual Nano-SIM, eSIM", aliases: ["sim", "sim configuration", "sim card", "dual sim", "sim slots"], core: false },
  { key: "wifi", group: "Connectivity", label: "Wi-Fi", hint: "e.g. Wi-Fi 6 (802.11ax)", aliases: ["wifi", "wi fi", "wlan", "wireless lan"], core: false },
  { key: "bluetooth", group: "Connectivity", label: "Bluetooth", hint: "version, e.g. 5.3", aliases: ["bluetooth", "bt"], core: false },
  { key: "nfc", group: "Connectivity", label: "NFC", hint: "Yes or No", aliases: ["nfc"], core: false },
  { key: "usb", group: "Connectivity", label: "USB", hint: "connector, e.g. USB Type-C 2.0", aliases: ["usb", "usb connector", "port", "charging port", "connector", "usb port"], core: false },
  { key: "gps", group: "Connectivity", label: "GPS", hint: "e.g. GPS, GLONASS, Galileo, BeiDou", aliases: ["gps", "navigation", "positioning", "location"], core: false },

  { key: "dimensions", group: "Physical", label: "Dimensions", hint: "e.g. 162.8 x 77.6 x 8.2 mm", aliases: ["dimensions", "body dimensions", "size and weight dimensions"], core: false },
  { key: "weight", group: "Physical", label: "Weight", hint: "e.g. 218 g", aliases: ["weight", "mass"], core: false },
  { key: "materials", group: "Physical", label: "Build", hint: "e.g. glass front, aluminium frame, plastic back", aliases: ["build", "materials", "material", "body material", "frame", "design materials"], core: false },
  { key: "water_resistance", group: "Physical", label: "Water / dust resistance", hint: "IP rating, e.g. IP68, or None", aliases: ["water resistance", "water dust resistance", "ip rating", "ingress protection", "dust resistance", "water and dust resistance"], core: false },
  { key: "colors", group: "Physical", label: "Colours", hint: "official colour names", aliases: ["colours", "colors", "colour", "color", "colour options", "color options", "available colours", "available colors"], core: false },

  { key: "fingerprint", group: "Features", label: "Fingerprint sensor", hint: "e.g. under-display (optical) or side-mounted", aliases: ["fingerprint", "fingerprint sensor", "fingerprint scanner"], core: false },
  { key: "face_unlock", group: "Features", label: "Face unlock", hint: "e.g. Yes (2D)", aliases: ["face unlock", "face id", "face recognition"], core: false },
  { key: "sensors", group: "Features", label: "Sensors", hint: "e.g. accelerometer, gyro, proximity, compass", aliases: ["sensors", "sensor"], core: false },
  { key: "audio", group: "Features", label: "Audio", hint: "e.g. stereo speakers, no 3.5mm jack", aliases: ["audio", "speakers", "loudspeaker", "headphone jack", "3.5mm jack", "sound"], core: false },
];

export const SPEC_GROUP_ORDER = ["General", "Display", "Performance", "Memory", "Camera", "Battery", "Connectivity", "Physical", "Features", "Other"];

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

const LOOKUP = new Map<string, string>();
for (const s of PHONE_SPECS) {
  for (const name of [s.key, s.label, ...s.aliases]) {
    const k = squash(name);
    if (k && !LOOKUP.has(k)) LOOKUP.set(k, s.key);
  }
}

/** Canonical spec key for a name/key the model used, or null. */
export function matchSpecKey(name: string): string | null {
  return LOOKUP.get(squash(name)) ?? null;
}

/** RAM / storage rows belong to the admin (quick fields, filters, variants). */
export function isMemorySizeName(name: string): boolean {
  return /^\s*(ram|memory|storage|rom|internal storage|internal memory|storage \/ rom|rom \/ storage)\s*$/i.test(name);
}

// ---------------------------------------------------------------------------
// Tolerant answer normalisation
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === "object" && !Array.isArray(v);

const KNOWN = [
  "brand", "category", "model", "model_number", "barcode", "warranty", "specs", "other_specs",
  "short_description", "description", "highlights", "seo", "faq",
  "title", "short_title", "suggested_brand", "suggested_category", "tags", "search_attributes", "review_summary",
];

const ALIASES: Record<string, string[]> = {
  brand: ["brand_name", "brandName", "manufacturer"],
  category: ["category_name", "categoryName", "category_suggestion"],
  model: ["model_name", "modelName", "official_model_name", "official_model"],
  model_number: ["modelNumber", "model_no", "mpn", "model_code"],
  barcode: ["gtin", "ean", "upc"],
  specs: ["specifications", "specification", "spec", "technical_specifications", "tech_specs"],
  other_specs: ["otherSpecs", "additional_specs", "extra_specs", "additional_specifications"],
  short_description: ["shortDescription", "short_desc", "summary", "intro", "short"],
  description: ["full_description", "fullDescription", "long_description", "longDescription", "product_description", "body"],
  highlights: ["key_features", "keyFeatures", "features", "highlight", "key_highlights", "keyHighlights"],
  seo: ["seo_data", "seoData", "meta"],
  faq: ["faqs", "FAQ", "FAQs", "questions", "frequently_asked_questions"],
  suggested_brand: ["suggestedBrand"],
  suggested_category: ["suggestedCategory"],
  search_attributes: ["searchAttributes"],
  review_summary: ["reviewSummary"],
  short_title: ["shortTitle"],
};

const FLAT_SEO = ["seo_title", "meta_title", "seoTitle", "metaTitle", "seo_description", "meta_description", "seoDescription", "metaDescription", "keywords", "search_keywords", "seo_keywords"];

function known(o: Obj): number {
  let n = 0;
  for (const k of Object.keys(o)) if (KNOWN.includes(k) || FLAT_SEO.includes(k) || Object.values(ALIASES).some((a) => a.includes(k))) n++;
  return n;
}

/** Some models wrap the answer: {"product": {...}} / {"listing": {...}} / {"data": {...}}. */
function unwrap(raw: Obj): Obj {
  let cur = raw;
  for (let i = 0; i < 2; i++) {
    const own = known(cur);
    // the inner object that looks most like a listing, if it looks more like one than the outer object
    // (never into a part of the listing itself, e.g. "seo" or "specs")
    const best = Object.entries(cur)
      .filter(([k, v]) => isObj(v) && known({ [k]: true }) === 0)
      .map(([, v]) => ({ v: v as Obj, n: known(v as Obj) }))
      .sort((a, b) => b.n - a.n)[0];
    if (!best || best.n === 0 || best.n <= own) return cur;
    cur = best.v;
  }
  return cur;
}

function text(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return null;
}

/** ["para 1", "para 2"] → "para 1\n\npara 2"; {text: "..."} → "...". */
function joinText(v: unknown): unknown {
  if (Array.isArray(v)) {
    const parts = v.map((x) => text(x) ?? (isObj(x) ? text(x.text ?? x.paragraph ?? x.content) : null)).filter((x): x is string => Boolean(x?.trim()));
    return parts.length ? parts.join("\n\n") : null;
  }
  if (isObj(v)) return text(v.text ?? v.content ?? v.value);
  return v;
}

function list(v: unknown, objKeys: string[]): unknown {
  if (typeof v === "string") {
    const lines = v.split(/\n|;|•/).map((l) => l.replace(/^\s*[-*\d.)]+\s*/, "").trim()).filter(Boolean);
    return lines.length > 1 ? lines : v.split(",").map((x) => x.trim()).filter(Boolean);
  }
  if (!Array.isArray(v)) return v;
  return v.map((x) => (isObj(x) ? (objKeys.map((k) => text(x[k])).find(Boolean) ?? null) : x)).filter((x) => x !== null);
}

function specEntry(v: unknown): unknown {
  if (!isObj(v)) return v;
  if ("value" in v || "status" in v) return v;
  const value = v.val ?? v.text ?? v.spec_value ?? v.details;
  return value !== undefined ? { value, status: v.status ?? v.verification, source: v.source ?? v.source_url ?? v.url } : v;
}

const ENTRY_KEYS = new Set(["value", "status", "source", "source_url", "url", "val", "text", "spec_value", "details", "verification", "name", "label"]);

export interface FlatSpecs {
  byKey: Record<string, unknown>;
  other: { name: string; group: string | null; entry: unknown }[];
}

/** Specs as {key: {...}}, {key: "value"}, [{name, value, ...}], or nested by group. */
export function flattenSpecs(specs: unknown, otherSpecs: unknown): FlatSpecs {
  const out: FlatSpecs = { byKey: {}, other: [] };
  const place = (name: string, entry: unknown, group: string | null) => {
    const key = matchSpecKey(name);
    if (key && !(key in out.byKey)) out.byKey[key] = specEntry(entry);
    else if (!key && !isMemorySizeName(name)) out.other.push({ name, group, entry: specEntry(entry) });
  };
  const fromList = (arr: unknown[], group: string | null) => {
    for (const item of arr) {
      if (!isObj(item)) continue;
      const name = text(item.name ?? item.label ?? item.key ?? item.spec ?? item.title);
      if (name) place(name, item, text(item.group ?? item.group_name ?? item.category) ?? group);
    }
  };
  if (Array.isArray(specs)) fromList(specs, null);
  else if (isObj(specs)) {
    for (const [name, v] of Object.entries(specs)) {
      // a group of specs: {"Display": {"Size": "...", ...}} or {"Display": [{name, value}]}
      if (Array.isArray(v) && v.every(isObj)) fromList(v, name);
      else if (isObj(v) && Object.keys(v).length > 0 && !Object.keys(v).some((k) => ENTRY_KEYS.has(k)) && Object.values(v).every((x) => typeof x === "string" || typeof x === "number" || isObj(x))) {
        for (const [n2, v2] of Object.entries(v)) place(n2, v2, name);
      } else place(name, v, null);
    }
  }
  if (Array.isArray(otherSpecs)) fromList(otherSpecs, null);
  return out;
}

/**
 * Map a model answer onto the canonical keys used by the sanitizers. Never
 * invents anything: it only renames and reshapes what the model wrote.
 */
export function normalizeAnswer(input: Obj): Obj {
  const raw = unwrap(input);
  const out: Obj = { ...raw };
  for (const [canon, names] of Object.entries(ALIASES)) {
    if (out[canon] !== undefined && out[canon] !== null && out[canon] !== "") continue;
    const hit = names.find((n) => raw[n] !== undefined && raw[n] !== null && raw[n] !== "");
    if (hit) out[canon] = raw[hit];
  }

  // SEO may come flat (seo_title / meta_title / seo_description / keywords)
  const seo: Obj = isObj(out.seo) ? { ...out.seo } : {};
  const pick = (o: Obj, names: string[]) => names.map((n) => o[n]).find((v) => v !== undefined && v !== null && v !== "");
  seo.title = pick(seo, ["title", "meta_title", "seo_title", "metaTitle"]) ?? pick(raw, ["seo_title", "meta_title", "seoTitle", "metaTitle"]);
  seo.description = pick(seo, ["description", "meta_description", "seo_description", "metaDescription"]) ?? pick(raw, ["seo_description", "meta_description", "seoDescription", "metaDescription"]);
  seo.keywords = list(pick(seo, ["keywords", "search_keywords", "tags", "keyphrases"]) ?? pick(raw, ["keywords", "search_keywords", "seo_keywords"]), ["keyword", "text"]);
  out.seo = seo;

  out.description = joinText(out.description);
  out.short_description = joinText(out.short_description);
  out.highlights = list(out.highlights, ["text", "title", "highlight", "feature", "value"]);
  out.tags = list(out.tags, ["text", "tag"]);
  out.search_attributes = list(out.search_attributes, ["text", "value"]);

  if (isObj(out.faq)) {
    // {"Question?": "Answer."}
    out.faq = Object.entries(out.faq).map(([q, a]) => ({ q, a: text(a) ?? (isObj(a) ? text(a.answer ?? a.a) : null) }));
  }
  if (Array.isArray(out.faq)) {
    out.faq = out.faq.map((f) => (isObj(f) ? { q: f.q ?? f.question ?? f.Q, a: f.a ?? f.answer ?? f.A } : f));
  }

  // brand / category / model given as {name: "..."} or a guess object
  for (const k of ["brand", "category", "suggested_brand", "suggested_category"]) {
    const v = out[k];
    if (isObj(v)) out[k] = text(v.name ?? v.value);
  }

  const flat = flattenSpecs(out.specs, out.other_specs);
  out.specs = flat.byKey;
  out.other_specs = flat.other.map((o) => {
    const e = isObj(o.entry) ? o.entry : { value: o.entry };
    return { ...e, name: o.name, ...(o.group ? { group: o.group } : {}) };
  });
  return out;
}
