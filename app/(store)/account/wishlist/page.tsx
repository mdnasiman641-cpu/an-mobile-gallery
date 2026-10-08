import Link from "next/link";
import Image from "next/image";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { removeWishlistAction } from "@/app/(store)/account/actions";
import { EmptyState } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { AvailabilityBadge, PriceTag } from "@/components/store/product-bits";
import { isSvg } from "@/lib/utils";
import type { ProductStatus } from "@/types";

interface Row {
  product_id: string;
  product: {
    name: string;
    slug: string;
    price: number;
    sale_price: number | null;
    stock_quantity: number;
    low_stock_threshold: number;
    status: ProductStatus;
    product_images: { url: string; is_primary: boolean }[];
  } | null;
}

export default async function WishlistPage() {
  const user = await requireUser("/account/wishlist");
  const supabase = await createClient();
  const { data } = await supabase
    .from("wishlists")
    .select("product_id, product:products(name, slug, price, sale_price, stock_quantity, low_stock_threshold, status, product_images(url, is_primary))")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  const rows = ((data ?? []) as unknown as Row[]).filter((r) => r.product);

  return (
    <section aria-labelledby="wish-h">
      <h2 id="wish-h" className="mb-4 text-lg font-bold">
        Wishlist
      </h2>
      {rows.length === 0 ? (
        <EmptyState
          title="Your wishlist is empty"
          description="Tap the heart on a product page to save it here."
          action={<ButtonLink href="/products">Browse phones</ButtonLink>}
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {rows.map(({ product_id, product: p }) => {
            const img = p!.product_images.find((i) => i.is_primary)?.url ?? p!.product_images[0]?.url;
            return (
              <li key={product_id} className="flex gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-3">
                <Link href={`/products/${p!.slug}`} className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-paper">
                  {img ? <Image src={img} alt={p!.name} fill sizes="80px" className="object-contain p-1.5" unoptimized={isSvg(img)} /> : null}
                </Link>
                <div className="min-w-0 flex-1">
                  <Link href={`/products/${p!.slug}`} className="line-clamp-2 text-sm font-semibold hover:underline">
                    {p!.name}
                  </Link>
                  <PriceTag price={Number(p!.price)} salePrice={p!.sale_price === null ? null : Number(p!.sale_price)} size="sm" />
                  <AvailabilityBadge stock={p!.stock_quantity} threshold={p!.low_stock_threshold} status={p!.status} />
                  <form action={removeWishlistAction.bind(null, product_id)} className="mt-1">
                    <button type="submit" className="text-xs font-semibold text-ink-soft underline hover:text-deal">
                      Remove
                    </button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
