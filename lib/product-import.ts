/**
 * "Import from a link" (Admin → Products → New product): reads a phone's public specification
 * page (e.g. mobiledokan.com/mobile/oppo-a6c) and returns FACTS for the product form:
 * name, brand, model, specification rows and the phone's own photos.
 *
 * What is never taken from the other site: its descriptions / reviews / prose, its prices,
 * its warranty or shop terms, its name or logo, ads, icons and pictures of other phones.
 * Description, highlights and SEO are written afterwards by "Generate all" in AN MOBILE GADGETS'
 * own words. Plain string parsing (no DOM): runs the same in Cloudflare Workers and in tests.
 */

import { PHONE_SPECS, isMemorySizeName, matchSpecKey } from "@/lib/ai/spec-catalog";

export interface ImportedSpec {
  group_name: string;
  name: string;
  value: string;
}

export interface ImportedProduct {
  name: string | null;
  brand: string | null;
  model: string | null;
  specs: ImportedSpec[];
  /** Absolute https URLs of the phone's photos only (same site, matching the model), max 8. */
  images: string[];
  /** The page's own price, shown for reference only — never put into the form. */
  referencePrice: number | null;
  sourceHost: string;
}

export const MAX_IMPORT_IMAGES = 8;
const MAX_SPECS = 150;

// ---------------------------------------------------------------------------
// Small HTML helpers
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", deg: "°", times: "×", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…" };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
const stripTags = (s: string) => s.replace(/<(script|style|svg|noscript)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ");
export const cleanText = (s: string) => decodeEntities(stripTags(s)).replace(/\s+/g, " ").trim();
const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? "") : null;
};

/** "mobiledokan" from www.mobiledokan.com, "gsmarena" from m.gsmarena.com … */
export function siteWord(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".");
  const generic = new Set(["com", "net", "org", "co", "bd", "in", "io", "info", "shop", "store", "uk"]);
  const named = parts.filter((p) => !generic.has(p) && p.length > 2);
  return named.length ? named[named.length - 1] : parts[0];
}

/** Removes the other site's name ("MobileDokan", "mobile dokan", "mobiledokan.com") from a text. */
export function withoutSiteName(text: string, host: string): string {
  const word = siteWord(host);
  if (word.length < 4) return text;
  const loose = word.split("").map((c) => c.replace(/[^a-z0-9]/i, "")).filter(Boolean).join("[\\s.\\-]*");
  return text
    .replace(new RegExp(`(?:https?://)?(?:www\\.)?${loose}(?:\\.[a-z]{2,6})*`, "gi"), " ")
    .replace(/\s+([,.;:|])/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/^[\s|,:;–—-]+|[\s|,:;–—-]+$/g, "")
    .trim();
}

// ---------------------------------------------------------------------------
// Name, brand, model, price
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;
function jsonLdProducts(html: string): Json[] {
  const out: Json[] = [];
  const re = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    try {
      const data: unknown = JSON.parse(m[1].trim());
      const queue: unknown[] = Array.isArray(data) ? [...data] : [data];
      while (queue.length) {
        const d = queue.shift();
        if (!d || typeof d !== "object") continue;
        const o = d as Json;
        if (Array.isArray(o["@graph"])) queue.push(...(o["@graph"] as unknown[]));
        const t = o["@type"];
        if (t === "Product" || (Array.isArray(t) && t.includes("Product"))) out.push(o);
      }
    } catch {
      // not valid JSON: ignore
    }
  }
  return out;
}

const metaContent = (html: string, prop: string): string | null => {
  const re = /<meta\b[^>]*>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const p = attr(m[0], "property") ?? attr(m[0], "name");
    if (p && p.toLowerCase() === prop) return attr(m[0], "content");
  }
  return null;
};

/** "Oppo A6c Price in Bangladesh 2026, Specs & Review | Site" → "Oppo A6c" */
export function cleanProductName(raw: string, host: string): string {
  return withoutSiteName(
    raw
      .replace(/\s*[|–—-]\s*[^|–—-]*$/, (m) => (/price|spec|review|bangladesh|full/i.test(m) || m.length < 40 ? "" : m))
      .replace(/\b(full\s+)?(price|specifications?|specs|review|features)\b.*$/i, "")
      .replace(/\bin\s+bangladesh\b.*$/i, ""),
    host,
  )
    .replace(/[,|:–—-]+$/, "")
    .trim()
    .slice(0, 120);
}

// ---------------------------------------------------------------------------
// Specification tables
// ---------------------------------------------------------------------------

/** Our group for the other site's group heading. */
function groupFor(heading: string): string {
  const h = heading.toLowerCase();
  if (/camera/.test(h)) return "Camera";
  if (/display|screen/.test(h)) return "Display";
  if (/battery|power/.test(h)) return "Battery";
  if (/memory|storage/.test(h)) return "Memory";
  if (/network|connect/.test(h)) return "Connectivity";
  if (/sensor|security/.test(h)) return "Security & sensors";
  if (/multimedia|audio|sound|media/.test(h)) return "Multimedia";
  if (/design|body|build|physical|dimension/.test(h)) return "Physical";
  if (/hardware|software|platform|performance|processor|chipset/.test(h)) return "Performance";
  if (/general|launch|overview|basic/.test(h)) return "General";
  if (/box|package/.test(h)) return "In the box";
  return "Other features";
}

/** Labels that mean different things in different groups ("Resolution" of the display vs a camera). */
const AMBIGUOUS = /^(resolution|size|type|capacity|version|setup|camera setup|features|video|video recording|autofocus|flash|aperture|zoom|status)$/i;
/** Rows that are about the other shop, not the phone (or that we never invent). */
const SKIP_LABEL = /price|দাম|cost|offer|emi|warranty|guarantee|review|rating|score|compare|buy|shop|seller|dealer|availability in|official site|website|link/i;
const CATALOG = new Map(PHONE_SPECS.map((s) => [s.key, s]));

function mapRow(heading: string, label: string, value: string): ImportedSpec | null {
  if (SKIP_LABEL.test(label)) return null;
  const group = groupFor(heading);
  const h = heading.toLowerCase();
  const l = label.toLowerCase();
  // RAM / storage belong to the admin (quick fields); the page's values are the model's variants
  if (isMemorySizeName(label) || /^(internal )?(storage|memory)$|^ram$|^rom$/i.test(label)) {
    return /ram/i.test(label) ? { group_name: "Memory", name: "RAM variants", value } : { group_name: "Memory", name: "Storage variants", value };
  }
  if (group === "Camera") {
    const front = /selfie|front/.test(h);
    const key = /^(resolution|camera)$/.test(l) ? (front ? "front_camera" : "main_camera") : /^camera setup$|^setup$/.test(l) ? (front ? null : "rear_camera") : /^video( recording)?$/.test(l) ? (front ? "front_video" : "video_recording") : !front ? matchSpecKey(label) : null;
    const spec = key ? CATALOG.get(key) : null;
    if (spec && spec.group === "Camera") return { group_name: spec.group, name: spec.label, value };
    return { group_name: "Camera", name: `${front ? "Front camera" : "Main camera"} ${label.charAt(0).toLowerCase()}${label.slice(1)}`.slice(0, 80), value };
  }
  const key = matchSpecKey(`${heading} ${label}`) ?? matchSpecKey(label);
  const spec = key ? CATALOG.get(key) : null;
  if (spec && !(AMBIGUOUS.test(label) && spec.group !== group)) return { group_name: spec.group, name: spec.label, value };
  return { group_name: group, name: label.slice(0, 80), value };
}

/** Two-column rows of every table, with the nearest heading before the table as its group. */
export function parseSpecTables(html: string, host: string): ImportedSpec[] {
  const out: ImportedSpec[] = [];
  const seen = new Set<string>();
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let prevEnd = 0;
  let heading = "General";
  for (let t = tableRe.exec(html); t; t = tableRe.exec(html)) {
    // the last piece of text between the previous table and this one is its heading
    const between = html.slice(prevEnd, t.index);
    const texts = stripTags(between)
      .split(/\s{2,}|\n/)
      .map((x) => decodeEntities(x).replace(/\s+/g, " ").trim())
      .filter((x) => x.length >= 2 && x.length <= 40 && /[a-z]/i.test(x) && !/advert|sponsor|^ads?$/i.test(x));
    if (texts.length) heading = texts[texts.length - 1];
    prevEnd = t.index + t[0].length;
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    for (let r = rowRe.exec(t[1]); r; r = rowRe.exec(t[1])) {
      const cells = [...r[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => cleanText(c[1]));
      if (cells.length !== 2) continue;
      const label = withoutSiteName(cells[0], host).replace(/:$/, "").trim();
      // a row that mentions the other site is about that site (credits, its warranty …), not the phone
      if (withoutSiteName(cells[1], host) !== cells[1].replace(/\s+/g, " ").trim() || /^(source|credits?|collected by|data source)$/i.test(label)) continue;
      const value = cells[1];
      if (label.length < 2 || label.length > 60 || !value || value.length > 500) continue;
      const row = mapRow(heading, label, value);
      if (!row) continue;
      const k = row.name.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(row);
      if (out.length >= MAX_SPECS) return out;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Photos: only this phone's pictures from the same site
// ---------------------------------------------------------------------------

const NOT_A_PHONE_PHOTO = /logo|icon|favicon|sprite|avatar|banner|(^|[-_/])ads?([-_/.]|$)|advert|sponsor|promo|placeholder|loading|lazy|whatsapp|facebook|twitter|telegram|youtube|instagram|pinterest|share|badge|flag|payment|bkash|nagad|app-?store|google-?play|compare|rating|star|thumb-?default|no-?image|\.svg$|\.gif$/i;

/** Distinct words of the model ("oppo-a6c" → ["a6c"]) that a photo's file name must contain. */
function modelTokens(name: string | null, brand: string | null, pagePath: string): string[] {
  const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const b = new Set(words(brand ?? ""));
  const fromName = words(name ?? "").filter((w) => !b.has(w));
  const fromPath = words(pagePath.split("/").filter(Boolean).pop() ?? "").filter((w) => !b.has(w));
  const tokens = fromName.length ? fromName : fromPath;
  return tokens.filter((w) => /\d/.test(w) || w.length >= 3).slice(0, 4);
}

export function pickPhoneImages(html: string, pageUrl: URL, name: string | null, brand: string | null, ldImages: string[]): string[] {
  const site = siteWord(pageUrl.hostname);
  const candidates: string[] = [...ldImages];
  const og = metaContent(html, "og:image");
  if (og) candidates.push(og);
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = attr(tag, "data-src") ?? attr(tag, "data-lazy-src") ?? attr(tag, "data-original") ?? attr(tag, "src");
    const srcset = attr(tag, "data-srcset") ?? attr(tag, "srcset");
    const largest = srcset
      ?.split(",")
      .map((x) => x.trim().split(/\s+/))
      .sort((a, b) => parseInt(b[1] ?? "0", 10) - parseInt(a[1] ?? "0", 10))[0]?.[0];
    const w = parseInt(attr(tag, "width") ?? "0", 10);
    if (w && w < 200) continue;
    const meta = `${attr(tag, "class") ?? ""} ${attr(tag, "alt") ?? ""} ${attr(tag, "id") ?? ""}`;
    if (NOT_A_PHONE_PHOTO.test(meta)) continue;
    const pick = largest ?? src;
    if (pick) candidates.push(pick);
  }
  const tokens = modelTokens(name, brand, pageUrl.pathname);
  const fromLd = new Set(ldImages.map((u) => { try { return new URL(u, pageUrl).pathname; } catch { return ""; } }));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of candidates) {
    let u: URL;
    try {
      u = new URL(raw.trim(), pageUrl);
    } catch {
      continue;
    }
    if (u.protocol !== "https:") continue;
    if (siteWord(u.hostname) !== site) continue; // same site / its CDN only: no ad networks
    const file = u.pathname.split("/").pop() ?? "";
    if (!/\.(jpe?g|png|webp|avif)$/i.test(file)) continue;
    if (NOT_A_PHONE_PHOTO.test(u.pathname)) continue;
    const squashed = file.toLowerCase().replace(/[^a-z0-9]/g, "");
    const isThisPhone = fromLd.has(u.pathname) || (tokens.length > 0 && tokens.every((tk) => squashed.includes(tk)));
    if (!isThisPhone) continue;
    // one copy per photo (thumbnails like name-300x300.webp are the same picture)
    const key = u.pathname.replace(/-\d{2,4}x\d{2,4}(?=\.[a-z]+$)/i, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    u.search = "";
    u.hash = "";
    out.push(u.toString());
    if (out.length >= MAX_IMPORT_IMAGES) break;
  }
  return out;
}

// ---------------------------------------------------------------------------

export function parseProductPage(html: string, pageUrl: URL): ImportedProduct {
  const host = pageUrl.hostname;
  const ld = jsonLdProducts(html)[0] ?? null;
  const ldBrand = ld?.brand && typeof ld.brand === "object" ? (ld.brand as Json).name : ld?.brand;
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  const rawName = (typeof ld?.name === "string" && ld.name) || (h1 ? cleanText(h1) : null) || metaContent(html, "og:title") || /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || null;
  const name = rawName ? cleanProductName(cleanText(rawName), host) || null : null;
  const specs = parseSpecTables(html, host);
  const brandRow = specs.find((s) => /^brand$/i.test(s.name));
  const modelRow = specs.find((s) => /^model$/i.test(s.name));
  const brand = (typeof ldBrand === "string" && ldBrand.trim() ? withoutSiteName(ldBrand.trim(), host) : null) ?? brandRow?.value ?? null;
  const model = modelRow?.value ?? (typeof ld?.model === "string" ? ld.model : null);
  const ldImages = (Array.isArray(ld?.image) ? ld.image : ld?.image ? [ld.image] : [])
    .map((i) => (typeof i === "string" ? i : i && typeof i === "object" ? ((i as Json).url as string | undefined) : undefined))
    .filter((i): i is string => typeof i === "string");
  const offers = (Array.isArray(ld?.offers) ? ld.offers[0] : ld?.offers) as Json | undefined;
  const priceRaw = offers?.price ?? (offers?.priceSpecification as Json | undefined)?.price ?? offers?.lowPrice;
  const referencePrice = Number(priceRaw) > 0 ? Math.round(Number(priceRaw)) : null;
  return {
    name,
    brand,
    model,
    specs: specs.filter((s) => !/^(brand|model)$/i.test(s.name)),
    images: pickPhoneImages(html, pageUrl, name, brand, ldImages),
    referencePrice,
    sourceHost: host.replace(/^www\./, ""),
  };
}

/** Public https pages only (no IP addresses, local or internal names). */
export function checkImportUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return null;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || /^[\d.]+$/.test(h) || h.includes(":") || /(^|\.)(localhost|local|internal|lan|home|corp|test|invalid|example)$/.test(h)) return null;
  return u;
}
