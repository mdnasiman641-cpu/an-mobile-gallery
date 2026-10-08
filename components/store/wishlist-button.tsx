"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";
import { toast } from "sonner";
import { getBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

/** Saves to the customer's wishlist. Checks the session only when tapped. */
export function WishlistButton({ productId, productSlug }: { productId: string; productSlug: string }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const supabase = getBrowserClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      setBusy(false);
      router.push(`/login?next=/products/${productSlug}`);
      return;
    }
    const { error } = await supabase.from("wishlists").insert({ user_id: data.user.id, product_id: productId });
    setBusy(false);
    if (error && error.code !== "23505") {
      toast.error("Couldn't save to your wishlist. Please try again.");
      return;
    }
    setSaved(true);
    toast.success("Saved to wishlist", { action: { label: "View", onClick: () => router.push("/account/wishlist") } });
  }

  return (
    <button
      type="button"
      onClick={save}
      disabled={busy || saved}
      aria-pressed={saved}
      className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-control)] px-3 text-sm font-semibold text-ink-soft hover:bg-ink/5 hover:text-ink disabled:opacity-70"
    >
      <Heart className={cn("h-4 w-4", saved && "fill-deal text-deal")} aria-hidden />
      {saved ? "Saved" : "Save"}
    </button>
  );
}
