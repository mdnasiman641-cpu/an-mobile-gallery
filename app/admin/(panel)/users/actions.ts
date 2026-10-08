"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { assertStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/admin";
import { firstFieldErrors } from "@/lib/validation";
import type { ActionResult } from "@/types";

const addSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().max(72).optional().transform((v) => v || undefined),
  role: z.enum(["super_admin", "admin", "editor"]),
});

/**
 * Gives an account staff access. If no account exists for the email, one is
 * created with the given password (needs SUPABASE_SERVICE_ROLE_KEY on the
 * server). Only super admins can do this — enforced here and by RLS.
 */
export async function addStaffAction(input: unknown): Promise<ActionResult> {
  const session = await assertStaff("super_admin");
  if ("error" in session) return { ok: false, message: session.error };
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: firstFieldErrors(parsed.error) };
  const { email, password, role } = parsed.data;

  const supabase = await createClient();
  const { data: existing } = await supabase.from("users").select("id").eq("email", email).maybeSingle();
  let userId = (existing as { id: string } | null)?.id ?? null;

  if (!userId) {
    if (!password || password.length < 10) {
      return { ok: false, message: "No account uses this email yet. Set a password (10+ characters) to create one.", fieldErrors: { password: "At least 10 characters" } };
    }
    const service = getServiceClient();
    if (!service) {
      return { ok: false, message: "Creating accounts needs SUPABASE_SERVICE_ROLE_KEY on the server. Alternatively ask the person to register on the site first, then add them here." };
    }
    const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: email.split("@")[0] } });
    if (error || !data.user) return { ok: false, message: `The account couldn't be created: ${error?.message ?? "unknown error"}` };
    userId = data.user.id;
  }

  const { error } = await supabase.from("admin_users").upsert({ user_id: userId, role, is_active: true }, { onConflict: "user_id" });
  if (error) return { ok: false, message: "Staff access couldn't be granted." };
  revalidatePath("/admin/users");
  return { ok: true, message: `${email} now has ${role.replace("_", " ")} access` };
}

export async function updateStaffAction(id: string, patch: { role?: "super_admin" | "admin" | "editor"; is_active?: boolean }): Promise<ActionResult> {
  const session = await assertStaff("super_admin");
  if ("error" in session) return { ok: false, message: session.error };
  const supabase = await createClient();
  const { data: row } = await supabase.from("admin_users").select("user_id").eq("id", id).maybeSingle();
  if ((row as { user_id: string } | null)?.user_id === session.userId) {
    return { ok: false, message: "You can't change your own access. Ask another super admin." };
  }
  const clean: Record<string, unknown> = {};
  if (patch.role && ["super_admin", "admin", "editor"].includes(patch.role)) clean.role = patch.role;
  if (typeof patch.is_active === "boolean") clean.is_active = patch.is_active;
  const { error } = await supabase.from("admin_users").update(clean).eq("id", id);
  if (error) return { ok: false, message: "Staff access couldn't be updated." };
  revalidatePath("/admin/users");
  return { ok: true, message: "Staff access updated" };
}

export async function removeStaffAction(id: string): Promise<ActionResult> {
  const session = await assertStaff("super_admin");
  if ("error" in session) return { ok: false, message: session.error };
  const supabase = await createClient();
  const { error } = await supabase.from("admin_users").delete().eq("id", id).neq("user_id", session.userId);
  if (error) return { ok: false, message: "Staff access couldn't be removed." };
  revalidatePath("/admin/users");
  return { ok: true, message: "Staff access removed. The account stays as a normal customer account." };
}
