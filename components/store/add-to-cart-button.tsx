"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/components/providers";
import { cn, effectivePrice } from "@/lib/utils";
import type { ProductStatus } from "@/types";

interface Props {
  product: {
    id: string;
    slug: string;
    name: string;
    image: string | null;
    price: number;
    sale_price: number | null;
    stock_quantity: number;
    status: ProductStatus;
  };
  className?: string;
}

/**
 * Quick "Add to cart" for product cards.
 *
 * Products with storage/colour options need a choice first (checkout refuses
 * them otherwise), so for those the button opens the product page instead.
 * The options check is one small read, made only when the button is tapped.
 */
export function AddToCartButton({ product, className }: Props) {
  const router = useRouter();
  const { addItem } = useStore();
  const [busy, setBusy] = useState(false);
  const soldOut = product.status === "out_of_stock" || product.stock_quantity <= 0;

  async function add() {
    setBusy(true);
    let hasOptions = true; // if the check fails, let the product page handle it
    try {
      const { getBrowserClient } = await import("@/lib/supabase/browser");
      const { count, error } = await getBrowserClient()
        .from("product_variants")
        .select("id", { count: "exact", head: true })
        .eq("product_id", product.id)
        .eq("status", "active");
      if (!error) hasOptions = (count ?? 0) > 0;
    } catch {
      hasOptions = true;
    }
    setBusy(false);

    if (hasOptions) {
      toast("Choose storage and colour", { description: product.name });
      router.push(`/products/${product.slug}`);
      return;
    }

    addItem({
      productId: product.id,
      variantId: null,
      slug: product.slug,
      name: product.name,
      variantLabel: null,
      image: product.image,
      price: effectivePrice(product.price, product.sale_price),
      maxQuantity: Math.max(1, Math.min(product.stock_quantity, 10)),
    });
    toast.success("Added to cart", {
      description: product.name,
      action: { label: "View cart", onClick: () => router.push("/cart") },
    });
  }

  return (
    <button
      type="button"
      onClick={add}
      disabled={soldOut || busy}
      aria-label={soldOut ? `${product.name} is out of stock` : `Add ${product.name} to cart`}
      className={cn(
        "relative z-10 inline-flex h-10 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] border text-[13.5px] font-semibold transition-colors",
        soldOut
          ? "cursor-not-allowed border-line bg-paper text-ink-mute"
          : "border-signal/30 bg-signal-tint text-signal hover:border-signal hover:bg-signal hover:text-white disabled:opacity-70",
        className,
      )}
    >
      <ShoppingCart className="h-4 w-4" aria-hidden />
      {soldOut ? "Out of stock" : busy ? "Adding…" : "Add to Cart"}
    </button>
  );
}
