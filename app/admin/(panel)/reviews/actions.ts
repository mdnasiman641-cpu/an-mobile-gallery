"use server";

import { z } from "zod";
import { assertStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { invalidateProduct } from "@/lib/cache";
import type { ActionResult } from "@/types";

export async function moderateReviewAction(id: string, op: "approved" | "rejected" | "pending" | "delete"): Promise<ActionResult> {
  const session = await assertStaff("editor");
  if ("error" in session) return { ok: false, message: session.error };
  if (!z.string().uuid().safeParse(id).success) return { ok: false, message: "Invalid review." };
  const supabase = await createClient();

  const { data: review } = await supabase.from("reviews").select("product:products(slug)").eq("id", id).maybeSingle();
  const slug = (review as { product: { slug: string } | null } | null)?.product?.slug;

  const { error } =
    op === "delete"
      ? await supabase.from("reviews").delete().eq("id", id)
      : await supabase.from("reviews").update({ status: op }).eq("id", id);
  if (error) return { ok: false, message: "The review couldn't be updated." };

  // product rating and review list changed
  invalidateProduct([slug]);
  return { ok: true, message: { approved: "Review published", rejected: "Review rejected", pending: "Moved back to pending", delete: "Review deleted" }[op] };
}
