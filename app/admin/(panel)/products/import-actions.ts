"use server";

// Admin → Products → "Import from a link": reads a public phone specification page on the server
// and returns facts for the form (see lib/product-import.ts). Nothing is saved here: the admin
// reviews the filled-in form and saves it. Photos are fetched one by one (same site only) and
// uploaded by the browser through the normal image upload (resized, WebP, the shop's storage).

import { z } from "zod";
import { assertStaff } from "@/lib/auth";
import { checkImportUrl, parseProductPage, siteWord, type ImportedProduct } from "@/lib/product-import";
import type { ActionResult } from "@/types";

const PAGE_TIMEOUT_MS = 15_000;
const MAX_PAGE_BYTES = 3_000_000;
const MAX_IMAGE_BYTES = 6_000_000;
const HEADERS = {
  "user-agent": "Mozilla/5.0 (compatible; AN-Mobile-Gadgets-Importer/1.0; +https://anmobilegadgets.com)",
  accept: "text/html,application/xhtml+xml",
  "accept-language": "en-US,en;q=0.9",
};

async function readLimited(res: Response, max: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > max) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  return buf.byteLength > max ? null : buf;
}

export async function importProductFromUrlAction(rawUrl: unknown): Promise<ActionResult<ImportedProduct>> {
  const session = await assertStaff("editor");
  if ("error" in session) return { ok: false, message: session.error };
  const url = typeof rawUrl === "string" ? checkImportUrl(rawUrl) : null;
  if (!url) return { ok: false, message: "Paste the full https:// link of the phone's page." };
  let res: Response;
  try {
    res = await fetch(url.toString(), { headers: HEADERS, redirect: "follow", signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) });
  } catch (e) {
    return { ok: false, message: (e as Error).name === "TimeoutError" ? "The page did not answer within 15 seconds. Try again." : "The page couldn't be opened from the server." };
  }
  if (!res.ok) {
    return {
      ok: false,
      message: res.status === 403 || res.status === 429 || res.status === 503 ? `${url.hostname} refused automatic reading (HTTP ${res.status}). Try again later or enter the details by hand.` : `The page answered with HTTP ${res.status}.`,
    };
  }
  const final = checkImportUrl(res.url || url.toString()) ?? url;
  if (!/html/i.test(res.headers.get("content-type") ?? "html")) return { ok: false, message: "That link is not a web page." };
  const bytes = await readLimited(res, MAX_PAGE_BYTES);
  if (!bytes) return { ok: false, message: "The page is too large to read." };
  const product = parseProductPage(new TextDecoder().decode(bytes), final);
  if (!product.name && product.specs.length === 0) return { ok: false, message: "No phone details were found on that page." };
  return {
    ok: true,
    message: `Found ${product.specs.length} specification(s) and ${product.images.length} photo(s) of ${product.name ?? "the phone"}.`,
    data: product,
  };
}

const imageInput = z.object({ pageUrl: z.string().url(), imageUrl: z.string().url() });

/** One photo from the same site as the imported page, returned as base64 for the browser's normal upload. */
export async function fetchImportImageAction(raw: unknown): Promise<ActionResult<{ base64: string; type: string; name: string }>> {
  const session = await assertStaff("editor");
  if ("error" in session) return { ok: false, message: session.error };
  const parsed = imageInput.safeParse(raw);
  const page = parsed.success ? checkImportUrl(parsed.data.pageUrl) : null;
  const img = parsed.success ? checkImportUrl(parsed.data.imageUrl) : null;
  if (!page || !img) return { ok: false, message: "Invalid photo link." };
  if (siteWord(img.hostname) !== siteWord(page.hostname)) return { ok: false, message: "Only photos from the same site are imported." };
  if (!/\.(jpe?g|png|webp|avif)$/i.test(img.pathname)) return { ok: false, message: "Not a photo." };
  let res: Response;
  try {
    res = await fetch(img.toString(), { headers: { ...HEADERS, accept: "image/avif,image/webp,image/png,image/jpeg", referer: page.toString() }, signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) });
  } catch {
    return { ok: false, message: "The photo couldn't be downloaded." };
  }
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!res.ok || !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(type)) return { ok: false, message: "The photo couldn't be downloaded." };
  const bytes = await readLimited(res, MAX_IMAGE_BYTES);
  if (!bytes) return { ok: false, message: "The photo is too large." };
  return { ok: true, data: { base64: Buffer.from(bytes).toString("base64"), type, name: img.pathname.split("/").pop() ?? "photo" } };
}
