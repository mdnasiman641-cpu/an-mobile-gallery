import type { AiRequest, AiResponse } from "@/lib/ai/types";

/**
 * Step 1 of "Complete with AI": live web research for the exact phone.
 *
 * Why a separate step: when a model is asked for a long JSON listing and
 * "may" use Google Search at the same time, it usually answers from its own
 * knowledge and never searches — the old flow then reported "web search was
 * allowed, but the model returned no sources". Here the research request asks
 * only for facts with search; the provider's grounding data (sources and the
 * text spans each source supports) is kept, and step 2 writes the listing from
 * these notes. A value counts as VERIFIED only when it is found in a span that
 * a real search result supports — never because a model says so.
 *
 * Plain logic, no secrets.
 */

export interface ResearchSource {
  /** 1-based number used in the notes and by the listing step. */
  n: number;
  url: string;
  title: string | null;
}

export interface ProductResearch {
  /** ok: a real web search returned sources. */
  status: "ok" | "no_sources" | "failed" | "unavailable";
  notes: string | null;
  sources: ResearchSource[];
  /** Text spans of the notes and the sources (numbers) that support them. */
  supports: { text: string; sources: number[] }[];
  /** Searches the provider actually ran. */
  queries: string[];
  /** Google Search Suggestions HTML (shown with grounded results, as Google requires). */
  searchEntryPoint: string | null;
  /** "Provider / model" that did the research. */
  model: string | null;
  at: string;
  /** Why research didn't happen, when it didn't. */
  message: string | null;
  /** Name / RAM / storage the research is for (reused only for the same product). */
  key: string;
}

export function researchKey(name: string, ram: string, storage: string): string {
  return [name, ram, storage].map((s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "")).join("|");
}

/** Research no older than this is reused for later parts (description, SEO, FAQ). */
export const RESEARCH_MAX_AGE_MS = 7 * 24 * 3600_000;

const SYSTEM = `You are a careful product researcher for a mobile phone shop in Bangladesh. You use Google Search to find the official specifications of one exact device.
Rules:
- Search the web. Do not answer from memory.
- Prefer, in this order: the manufacturer's official product page, the manufacturer's official specification or support page, established phone specification databases, other credible sources only when necessary.
- Use a page only if it is about this exact model. Similar names (Pro / Plus / Lite / Prime, 4G vs 5G, another year or region) are different devices.
- Report original manufacturer specifications. For a used phone do not guess its condition, battery health, repairs or what comes with it.
- Never mention prices, offers, ratings or reviews.
- Plain text only, in the layout asked for.`;

export function buildResearchRequest(p: { name: string; ram: string; storage: string; condition: string; brand: string | null; model: string | null }): AiRequest {
  const hint = [p.brand, p.model].filter(Boolean).join(" ");
  return {
    task: "verify",
    system: SYSTEM,
    prompt: `Product name as the shop typed it: "${p.name}"
${hint ? `Brand / model already selected by the shop: ${hint}\n` : ""}Variant: ${p.ram} RAM, ${p.storage} storage. Condition: ${p.condition}.

1. Work out the brand, exact model and variant from the name. Words like used, pre-owned, pre own, official, intact, box, new are shop notes, not part of the model.
2. Search with several queries, for example: the exact model name; brand + model + specifications; brand + model official site; model + ${p.ram}/${p.storage}; a regional variant if relevant.
3. Compare the results and keep only facts about this exact model and variant.

Answer in exactly this layout:
IDENTITY: brand | exact model name | model number(s) if documented | device type | exact model confirmed: yes or no, and why
VARIANT: is ${p.ram} RAM + ${p.storage} storage an official variant (yes / no / unknown)? List the official RAM/storage variants.
SPECIFICATIONS: one line per specification, "Name: value", for everything documented: general (OS at launch, announced, release), network (technology, 2G/3G/4G/5G bands, SIM), display (type, size, resolution, refresh rate, brightness, protection), platform (chipset, CPU, GPU), memory (card slot), cameras (each rear camera, front camera, video, flash), battery (capacity, type, charging), connectivity (Wi-Fi, Bluetooth, GPS, USB, OTG, NFC, infrared, FM radio, headphone jack), body (dimensions, weight, build, colours, IP rating), sensors (fingerprint and its position, face unlock, others), audio, other features${p.condition === "new" ? ", box contents" : ""}.
CONFLICTS: "Name: value A (source) vs value B (source)" for every specification where sources disagree, or "none".
NOT FOUND: important specifications you could not find.`,
    json: false,
    research: true,
    minTimeoutMs: 90_000,
  };
}

export function emptyResearch(status: ProductResearch["status"], message: string, key: string, model: string | null = null): ProductResearch {
  return { status, notes: null, sources: [], supports: [], queries: [], searchEntryPoint: null, model, at: new Date().toISOString(), message, key };
}

/** Number the sources 1..n and keep the grounding spans. */
export function parseResearch(res: AiResponse, model: string, key: string): ProductResearch {
  const sources = res.sources.slice(0, 30).map((s, i) => ({ n: i + 1, url: s.url, title: s.title }));
  const supports = (res.supports ?? [])
    .map((s) => ({ text: s.text, sources: s.sources.filter((i) => i < sources.length).map((i) => i + 1) }))
    .filter((s) => s.sources.length);
  const ok = sources.length > 0;
  return {
    status: ok ? "ok" : "no_sources",
    notes: res.text.slice(0, 12_000),
    sources,
    supports,
    queries: (res.queries ?? []).slice(0, 12),
    searchEntryPoint: res.searchEntryPoint ?? null,
    model,
    at: new Date().toISOString(),
    message: ok ? null : `${model} answered without running a web search (no sources returned), so nothing could be verified.`,
    key,
  };
}

/** The research as given to the listing step. */
export function researchForPrompt(r: ProductResearch): string {
  const list = r.sources.map((s) => `[${s.n}] ${s.title ?? "source"} — ${s.url}`).join("\n");
  return `Sources from a live web search:\n${list}\n\nResearch notes:\n${r.notes ?? ""}`;
}

// ---------------------------------------------------------------------------
// Evidence: is a value really in the researched text?
// ---------------------------------------------------------------------------

const STOP = new Set(["the", "and", "with", "for", "inch", "inches", "yes", "type", "support", "supported", "only", "dual", "single"]);
const numbersOf = (s: string) => (s.replace(/(\d),(?=\d{3}\b)/g, "$1").match(/\d+(?:\.\d+)?/g) ?? []).map((n) => n.replace(/\.0+$/, ""));
const wordsOf = (s: string) => (s.toLowerCase().match(/[a-z][a-z0-9+-]{2,}/g) ?? []).filter((w) => !STOP.has(w));

/** True when the value's numbers (all) or words (most) appear in the text. */
export function valueInText(value: string, text: string): boolean {
  const t = text.toLowerCase();
  const nums = numbersOf(value);
  const tNums = new Set(numbersOf(text));
  if (nums.length) return nums.every((n) => tNums.has(n));
  const words = wordsOf(value);
  if (!words.length) return false;
  const hit = words.filter((w) => t.includes(w)).length;
  return hit / words.length >= 0.6;
}

export interface Evidence {
  sources: ResearchSource[];
  /** The supporting text (shortened). */
  text: string;
}

/**
 * Find a span of the research that a real source supports and that contains
 * the value. `cited` are the source numbers the listing step gave (may be empty).
 * Spans mentioning the spec name are preferred.
 */
export function findEvidence(label: string, value: string, cited: number[], r: ProductResearch | null): Evidence | null {
  if (!r || r.status !== "ok" || !value.trim()) return null;
  const labelWords = wordsOf(label);
  const spans = r.supports.filter((s) => !cited.length || s.sources.some((n) => cited.includes(n)));
  const ranked = [...spans].sort((a, b) => Number(labelWords.some((w) => b.text.toLowerCase().includes(w))) - Number(labelWords.some((w) => a.text.toLowerCase().includes(w))));
  const hit = ranked.find((s) => valueInText(value, s.text));
  if (hit) {
    const nums = cited.length ? hit.sources.filter((n) => cited.includes(n)) : hit.sources;
    const sources = r.sources.filter((s) => nums.includes(s.n));
    if (sources.length) return { sources, text: hit.text.length > 220 ? `${hit.text.slice(0, 217)}…` : hit.text };
  }
  return null;
}
