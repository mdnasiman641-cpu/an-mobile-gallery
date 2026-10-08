"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Saves to the customer's wishlist. Checks the session only when tapped; the
 * Supabase client is loaded on that first tap, so product cards stay light.
 */
export function WishlistButton({
  productId,
  productSlug,
  variant = "text",
  productName,
  className,
}: {
  productId: string;
  productSlug: string;
  variant?: "text" | "icon";
  productName?: string;
  className?: string;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const { getBrowserClient } = await import("@/lib/supabase/browser");
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

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={save}
        disabled={busy || saved}
        aria-pressed={saved}
        aria-label={saved ? "Saved to wishlist" : `Save ${productName ?? "this product"} to wishlist`}
        className={cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface/90 text-ink-mute backdrop-blur hover:border-deal/40 hover:text-deal disabled:opacity-80",
          className,
        )}
      >
        <Heart className={cn("h-[18px] w-[18px]", saved && "fill-deal text-deal")} aria-hidden />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={save}
      disabled={busy || saved}
      aria-pressed={saved}
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-[var(--radius-control)] px-3 text-sm font-semibold text-ink-soft hover:bg-ink/5 hover:text-ink disabled:opacity-70",
        className,
      )}
    >
      <Heart className={cn("h-4 w-4", saved && "fill-deal text-deal")} aria-hidden />
      {saved ? "Saved" : "Save"}
    </button>
  );
}
