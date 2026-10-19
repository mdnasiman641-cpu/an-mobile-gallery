import "server-only";
import { unstable_cache } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache";
import { supabaseUrl } from "@/lib/env";
import { getPublicClient } from "@/lib/supabase/public";
import { buildIco, faviconFileUrl, isFaviconId, pngInfo, type FaviconFile } from "@/lib/favicon";

/**
 * The active favicon set id (site_settings.favicon_id), cached with the other
 * settings (tag "settings": refreshed when an admin saves). Read on its own,
 * so the site keeps working with the built-in icon before migration 0016.
 */
const loadFaviconId = unstable_cache(
  async (): Promise<string | null> => {
    const supabase = getPublicClient();
    if (!supabase) return null;
    const { data, error } = await supabase.from("site_settings").select("favicon_id").eq("id", 1).maybeSingle();
    if (error) {
      if (error.code === "42703" || /favicon_id/.test(error.message)) return null; // migration not run yet
      throw new Error("favicon setting unavailable"); // temporary problem: not cached
    }
    const id = (data as { favicon_id: string | null } | null)?.favicon_id ?? null;
    return isFaviconId(id) ? id : null;
  },
  ["site-favicon-id-v1"],
  { tags: [CACHE_TAGS.settings], revalidate: 86400 },
);

export async function getFaviconId(): Promise<string | null> {
  try {
    return await loadFaviconId();
  } catch {
    return null;
  }
}

const ICO_SIZES: [FaviconFile, number][] = [
  ["icon-16.png", 16],
  ["icon-32.png", 32],
  ["icon-48.png", 48],
];

/**
 * favicon.ico for an uploaded set, built from its 16/32/48 PNGs. Each set's
 * files never change (new upload = new id), so the result is cached per id
 * (base64 in the data cache) and the PNGs are fetched from Storage only once.
 */
const loadIco = unstable_cache(
  async (id: string): Promise<string | null> => {
    if (!isFaviconId(id) || !supabaseUrl) return null;
    const images: { size: number; png: Uint8Array }[] = [];
    for (const [file, size] of ICO_SIZES) {
      const res = await fetch(faviconFileUrl(supabaseUrl, id, file), { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`favicon file ${file}: HTTP ${res.status}`); // not cached; tried again next time
      const png = new Uint8Array(await res.arrayBuffer());
      const info = pngInfo(png);
      if (!info || info.width !== size || info.height !== size) return null;
      images.push({ size, png });
    }
    const ico = buildIco(images);
    let bin = "";
    for (const b of ico) bin += String.fromCharCode(b);
    return btoa(bin);
  },
  ["site-favicon-ico-v1"],
  { revalidate: 86400 * 30 },
);

export async function getFaviconIco(id: string): Promise<Uint8Array | null> {
  try {
    const b64 = await loadIco(id);
    if (!b64) return null;
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}
