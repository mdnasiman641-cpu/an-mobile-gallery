import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/admin/admin-shell";

/**
 * Every admin page passes through here: visitors and customers are
 * redirected to the admin login. The database enforces the same rules
 * again with RLS, so a bypassed UI still can't change data.
 */
export default async function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  const session = await requireStaff("editor");
  let pendingOrders = 0;
  if (session.role !== "editor") {
    const supabase = await createClient();
    const { count } = await supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", "pending");
    pendingOrders = count ?? 0;
  }
  return (
    <AdminShell role={session.role} email={session.email} pendingOrders={pendingOrders}>
      {children}
    </AdminShell>
  );
}
