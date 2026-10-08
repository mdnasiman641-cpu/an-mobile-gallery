import type { Metadata } from "next";
import { hasRole, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AdminPageHeader } from "@/components/admin/page-header";
import { PageManager } from "@/components/admin/page-manager";
import type { Page } from "@/types";

export const metadata: Metadata = { title: "Pages" };

export default async function AdminPagesPage() {
  const session = await requireStaff("editor");
  const supabase = await createClient();
  const { data } = await supabase.from("pages").select("*").order("title");
  return (
    <>
      <AdminPageHeader title="Pages" description="About, warranty, privacy and any other information pages." />
      <PageManager pages={(data ?? []) as Page[]} canDelete={hasRole(session, "admin")} />
    </>
  );
}
