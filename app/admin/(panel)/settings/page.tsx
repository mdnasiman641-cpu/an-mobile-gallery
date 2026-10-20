import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AdminPageHeader } from "@/components/admin/page-header";
import { SiteSettingsForm } from "@/components/admin/settings-forms";
import { DEFAULT_SITE_SETTINGS } from "@/services/settings";
import { supabaseUrl } from "@/lib/env";
import { FAVICON_FILE_NAMES, faviconFileUrl, isFaviconId } from "@/lib/favicon";
import { readHeaderConfig } from "@/lib/header-config";
import type { SiteSettings } from "@/types";

export const metadata: Metadata = { title: "Settings" };

export default async function AdminSettingsPage() {
  await requireStaff("admin");
  const supabase = await createClient();
  // read fresh (not the cached copy) so the form always shows saved values
  const [{ data }, headerRes] = await Promise.all([
    supabase.from("site_settings").select("*").eq("id", 1).maybeSingle(),
    supabase.from("storefront_header").select("bar, messages, outlets").eq("id", 1).maybeSingle(),
  ]);
  // null = migration 0018 not run yet (the section explains it)
  const header = headerRes.error || !headerRes.data ? null : readHeaderConfig(headerRes.data as { bar: unknown; messages: unknown; outlets: unknown });
  const { id: _id, updated_at: _u, favicon_id: faviconId, ...settings } = (data ?? {}) as SiteSettings & { id?: number; updated_at?: string; favicon_id?: string | null };
  const favicon = isFaviconId(faviconId)
    ? { id: faviconId, urls: Object.fromEntries(FAVICON_FILE_NAMES.map((n) => [n, faviconFileUrl(supabaseUrl, faviconId, n)])) }
    : { id: null, urls: null };
  return (
    <>
      <AdminPageHeader title="Store settings" description="Logo and favicon, contact details, delivery charges, announcement bar and Locations." />
      <SiteSettingsForm initial={{ ...DEFAULT_SITE_SETTINGS, ...settings }} favicon={favicon} header={header} />
    </>
  );
}
