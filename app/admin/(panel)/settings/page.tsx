import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AdminPageHeader } from "@/components/admin/page-header";
import { SiteSettingsForm } from "@/components/admin/settings-forms";
import { DEFAULT_SITE_SETTINGS } from "@/services/settings";
import { supabaseUrl } from "@/lib/env";
import { FAVICON_FILE_NAMES, faviconFileUrl, isFaviconId } from "@/lib/favicon";
import type { SiteSettings } from "@/types";

export const metadata: Metadata = { title: "Settings" };

export default async function AdminSettingsPage() {
  await requireStaff("admin");
  const supabase = await createClient();
  // read fresh (not the cached copy) so the form always shows saved values
  const { data } = await supabase.from("site_settings").select("*").eq("id", 1).maybeSingle();
  const { id: _id, updated_at: _u, favicon_id: faviconId, ...settings } = (data ?? {}) as SiteSettings & { id?: number; updated_at?: string; favicon_id?: string | null };
  const favicon = isFaviconId(faviconId)
    ? { id: faviconId, urls: Object.fromEntries(FAVICON_FILE_NAMES.map((n) => [n, faviconFileUrl(supabaseUrl, faviconId, n)])) }
    : { id: null, urls: null };
  return (
    <>
      <AdminPageHeader title="Store settings" description="Logo and favicon, contact details, delivery charges and currency." />
      <SiteSettingsForm initial={{ ...DEFAULT_SITE_SETTINGS, ...settings }} favicon={favicon} />
    </>
  );
}
