import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { StaffRole } from "@/types";

export interface StaffSession {
  userId: string;
  email: string | null;
  role: StaffRole;
}

const ROLE_RANK: Record<StaffRole, number> = { editor: 1, admin: 2, super_admin: 3 };

/** The signed-in user (validated with Supabase Auth, not just the cookie). */
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/** Staff role of the current user, or null for customers / visitors. */
export const getStaffSession = cache(async (): Promise<StaffSession | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("admin_users")
    .select("role, is_active")
    .eq("user_id", user.id)
    .maybeSingle();
  const row = data as { role: StaffRole; is_active: boolean } | null;
  if (!row || !row.is_active) return null;
  return { userId: user.id, email: user.email ?? null, role: row.role };
});

export function hasRole(session: StaffSession | null, min: StaffRole): boolean {
  return Boolean(session && ROLE_RANK[session.role] >= ROLE_RANK[min]);
}

/**
 * Guard for admin pages. Customers and visitors are redirected away.
 * The database enforces the same rules again through RLS.
 */
export async function requireStaff(min: StaffRole = "editor"): Promise<StaffSession> {
  const session = await getStaffSession();
  if (!session) {
    const user = await getCurrentUser();
    redirect(user ? "/admin/login?error=not_staff" : "/admin/login");
  }
  if (!hasRole(session, min)) redirect("/admin/dashboard?error=forbidden");
  return session;
}

/** Guard for Server Actions: returns an error instead of redirecting. */
export async function assertStaff(min: StaffRole = "editor"): Promise<StaffSession | { error: string }> {
  const session = await getStaffSession();
  if (!session) return { error: "Your session has ended. Please sign in again." };
  if (!hasRole(session, min)) return { error: "You don't have permission to do this." };
  return session;
}

export async function requireUser(next = "/account") {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return user;
}
