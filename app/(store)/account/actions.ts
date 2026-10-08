"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { bdPhone, firstFieldErrors } from "@/lib/validation";
import type { ActionResult } from "@/types";

const profileSchema = z.object({
  full_name: z.string().trim().min(2, "Enter your full name").max(100),
  phone: bdPhone.or(z.literal("").transform(() => null)),
  address: z.string().trim().max(500).optional().transform((v) => v || null),
  city: z.string().trim().max(80).optional().transform((v) => v || null),
  area: z.string().trim().max(80).optional().transform((v) => v || null),
});

export async function updateProfileAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Please sign in again." };

  const parsed = profileSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Please check the highlighted fields.", fieldErrors: firstFieldErrors(parsed.error) };
  const d = parsed.data;

  const { error: userErr } = await supabase.from("users").update({ full_name: d.full_name, phone: d.phone }).eq("id", user.id);
  const { error: custErr } = await supabase
    .from("customers")
    .update({ full_name: d.full_name, phone: d.phone, address: d.address, city: d.city, area: d.area })
    .eq("user_id", user.id);

  if (custErr?.code === "23505") return { ok: false, fieldErrors: { phone: "This number is linked to another account." } };
  if (userErr || custErr) return { ok: false, message: "Your profile couldn't be saved. Please try again." };
  revalidatePath("/account");
  return { ok: true, message: "Profile saved." };
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

export async function removeWishlistAction(productId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("wishlists").delete().eq("user_id", user.id).eq("product_id", productId);
  revalidatePath("/account/wishlist");
}
