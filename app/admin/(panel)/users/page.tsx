import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AdminPageHeader } from "@/components/admin/page-header";
import { StaffManager, type StaffRow } from "@/components/admin/staff-manager";

export const metadata: Metadata = { title: "Staff users" };

export default async function AdminUsersPage() {
  const session = await requireStaff("super_admin");
  const supabase = await createClient();
  const { data: staff } = await supabase.from("admin_users").select("id, user_id, role, is_active, created_at").order("created_at");
  const staffRows = (staff ?? []) as Omit<StaffRow, "email" | "full_name">[];
  const { data: profiles } = staffRows.length
    ? await supabase.from("users").select("id, email, full_name").in("id", staffRows.map((s) => s.user_id))
    : { data: [] };
  const byId = new Map(((profiles ?? []) as { id: string; email: string | null; full_name: string | null }[]).map((p) => [p.id, p]));
  const rows: StaffRow[] = staffRows.map((s) => ({ ...s, email: byId.get(s.user_id)?.email ?? null, full_name: byId.get(s.user_id)?.full_name ?? null }));

  return (
    <>
      <AdminPageHeader title="Staff users" description="Who can open this admin panel. Customers never have access." />
      <StaffManager rows={rows} currentUserId={session.userId} canCreate={Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)} />
    </>
  );
}
