import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AdminPageHeader } from "@/components/admin/page-header";
import { SiteSettingsForm } from "@/components/admin/settings-forms";
import { DEFAULT_SITE_SETTINGS } from "@/services/settings";
import type { SiteSettings } from "@/types";

export const metadata: Metadata = { title: "Settings" };

export default async function AdminSettingsPage() {
  await requireStaff("admin");
  const supabase = await createClient();
  // read fresh (not the cached copy) so the form always shows saved values
  const { data } = await supabase.from("site_settings").select("*").eq("id", 1).maybeSingle();
  const { id: _id, updated_at: _u, ...settings } = (data ?? {}) as SiteSettings & { id?: number; updated_at?: string };
  return (
    <>
      <AdminPageHeader title="Store settings" description="Contact details, delivery charges and currency." />
      <SiteSettingsForm initial={{ ...DEFAULT_SITE_SETTINGS, ...settings }} />
    </>
  );
}
