"use server";

// Admin → Settings → Branding & Favicon. Admins only (checked here AND by
// Storage / table RLS). Files are uploaded with the admin's own session: no
// service-role key is involved.

import { assertStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { invalidateContent } from "@/lib/cache";
import { supabaseUrl } from "@/lib/env";
import { FAVICON_FILE_NAMES, FAVICON_FILES, FAVICON_FOLDER, FAVICON_MAX_BYTES, faviconFileUrl, faviconPath, isFaviconId, pngInfo, type FaviconFile } from "@/lib/favicon";
import type { ActionResult } from "@/types";

const MEDIA = "media";
const MIGRATION = "The favicon setting needs database migration 0016 (supabase/migrations/20261020000016_site_favicon.sql). Run it in the Supabase SQL editor first.";

export interface UploadedFavicon {
  id: string;
  urls: Record<FaviconFile, string>;
}

/**
 * Step 1 — upload a new icon set (not active yet).
 * The browser sends the square PNGs it made from the admin's image. Each is
 * checked here before anything is stored: it must be a real, well-formed PNG
 * (bytes, not the declared type), exactly the expected size, and small
 * enough. SVG or any other file type is refused, so no script can be served.
 * Nothing is replaced: the current icon stays active until "Save".
 */
export async function uploadFaviconAction(form: FormData): Promise<ActionResult<UploadedFavicon>> {
  const session = await assertStaff("admin");
  if ("error" in session) return { ok: false, message: session.error };
  if (!(form instanceof FormData)) return { ok: false, message: "Invalid upload." };

  const keys = Array.from(new Set(Array.from(form.keys())));
  const unexpected = keys.filter((k) => !(FAVICON_FILE_NAMES as string[]).includes(k));
  if (unexpected.length) return { ok: false, message: "Invalid upload." };

  const files: { name: FaviconFile; bytes: Uint8Array }[] = [];
  for (const name of FAVICON_FILE_NAMES) {
    const entries = form.getAll(name);
    const f = entries[0];
    if (entries.length !== 1 || !(f instanceof Blob)) return { ok: false, message: "Some icon sizes are missing. Choose the image again." };
    if (f.size > FAVICON_MAX_BYTES[name]) return { ok: false, message: "The icon image is too detailed (file too large). Use a simpler logo image." };
    const bytes = new Uint8Array(await f.arrayBuffer());
    const info = pngInfo(bytes);
    const size = FAVICON_FILES[name];
    if (!info) return { ok: false, message: "The icon files aren't valid PNG images. Choose the image again." };
    if (info.width !== size || info.height !== size) return { ok: false, message: `The ${name} icon must be ${size} × ${size} px.` };
    files.push({ name, bytes });
  }

  const id = crypto.randomUUID();
  const supabase = await createClient();
  const done: string[] = [];
  for (const f of files) {
    const path = faviconPath(id, f.name);
    const { error } = await supabase.storage.from(MEDIA).upload(path, f.bytes, { contentType: "image/png", cacheControl: "31536000", upsert: false });
    if (error) {
      if (done.length) await supabase.storage.from(MEDIA).remove(done); // no half sets left behind
      return {
        ok: false,
        message: /row-level security|unauthori[sz]ed|permission/i.test(error.message) ? "You don't have permission to upload images." : "The icon couldn't be uploaded. Please try again.",
      };
    }
    done.push(path);
  }
  const urls = Object.fromEntries(FAVICON_FILE_NAMES.map((n) => [n, faviconFileUrl(supabaseUrl, id, n)])) as Record<FaviconFile, string>;
  return { ok: true, message: "Icon uploaded — press Save to use it.", data: { id, urls } };
}

/**
 * Step 2 — make an uploaded set the site's favicon (or null = built-in icon).
 * The set must be complete in Storage. Only after the setting is saved is the
 * previous uploaded set deleted (best effort), so a failed save never leaves
 * the site without its old icon.
 */
export async function saveFaviconAction(id: unknown): Promise<ActionResult> {
  const session = await assertStaff("admin");
  if ("error" in session) return { ok: false, message: session.error };
  if (id !== null && !isFaviconId(id)) return { ok: false, message: "Invalid icon." };
  const supabase = await createClient();

  const { data: current, error: readError } = await supabase.from("site_settings").select("favicon_id").eq("id", 1).maybeSingle();
  if (readError) return { ok: false, message: /favicon_id/.test(readError.message) || readError.code === "42703" ? MIGRATION : "The favicon couldn't be saved." };
  const previous = (current as { favicon_id: string | null } | null)?.favicon_id ?? null;
  if (previous === id) return { ok: true, message: "Favicon unchanged" };

  if (id) {
    const { data: listed, error } = await supabase.storage.from(MEDIA).list(`${FAVICON_FOLDER}/${id}`, { limit: 20 });
    const names = new Set(((listed ?? []) as { name: string }[]).map((f) => f.name));
    if (error || FAVICON_FILE_NAMES.some((n) => !names.has(n))) return { ok: false, message: "This icon upload is incomplete. Choose the image again." };
  }

  const { error } = await supabase.from("site_settings").update({ favicon_id: id }).eq("id", 1);
  if (error) return { ok: false, message: /favicon_id/.test(error.message) || error.code === "42703" ? MIGRATION : "The favicon couldn't be saved." };

  invalidateContent(); // every page's <head> links the icon

  if (previous && isFaviconId(previous)) {
    // the old set is no longer referenced: remove it (failure only leaves unused files)
    await supabase.storage
      .from(MEDIA)
      .remove(FAVICON_FILE_NAMES.map((n) => faviconPath(previous, n)))
      .catch(() => undefined);
  }
  return { ok: true, message: id ? "Favicon saved. Browsers show it after a reload; Google updates on its next visit." : "Custom favicon removed: the built-in icon is used again." };
}

/** Delete an uploaded set that was never saved (admin cancelled or picked another image). */
export async function discardFaviconUploadAction(id: unknown): Promise<ActionResult> {
  const session = await assertStaff("admin");
  if ("error" in session) return { ok: false, message: session.error };
  if (!isFaviconId(id)) return { ok: false, message: "Invalid icon." };
  const supabase = await createClient();
  const { data } = await supabase.from("site_settings").select("favicon_id").eq("id", 1).maybeSingle();
  if ((data as { favicon_id: string | null } | null)?.favicon_id === id) return { ok: false, message: "This icon is in use." };
  await supabase.storage.from(MEDIA).remove(FAVICON_FILE_NAMES.map((n) => faviconPath(id, n)));
  return { ok: true };
}
