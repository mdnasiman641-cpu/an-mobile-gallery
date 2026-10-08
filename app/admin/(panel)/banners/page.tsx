import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AdminPageHeader } from "@/components/admin/page-header";
import { BannerManager } from "@/components/admin/banner-manager";
import type { Banner } from "@/types";

export const metadata: Metadata = { title: "Banners" };

export default async function AdminBannersPage() {
  await requireStaff("editor");
  const supabase = await createClient();
  const { data } = await supabase.from("banners").select("*").order("placement").order("sort_order");
  return (
    <>
      <AdminPageHeader title="Home page banners" description="The hero slider and promo tiles on the home page." />
      <BannerManager banners={(data ?? []) as (Banner & { is_demo: boolean })[]} />
    </>
  );
}
