import Link from "next/link";
import Image from "next/image";
import type { ProductCard as ProductCardType } from "@/types";
import { cn, conditionLabel, discountPercent, isSvg } from "@/lib/utils";
import { AvailabilityBadge, PriceTag, RatingStars } from "@/components/store/product-bits";
import { AddToCartButton } from "@/components/store/add-to-cart-button";
import { WishlistButton } from "@/components/store/wishlist-button";

export function ProductCard({ product, priority = false }: { product: ProductCardType; priority?: boolean }) {
  const off = discountPercent(product.price, product.sale_price);
  const specLine = [product.ram_options[0] && `${product.ram_options.join("/")} RAM`, product.storage_options.join(" / ")]
    .filter(Boolean)
    .join(", ");

  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface transition-[border-color,box-shadow] duration-200 hover:border-brand/50 hover:shadow-[var(--shadow-lift)]">
      <div className="relative aspect-square bg-gradient-to-b from-paper to-surface">
        {product.image_url ? (
          <Image
            src={product.image_url}
            alt={product.image_alt || product.name}
            fill
            sizes="(min-width: 1280px) 240px, (min-width: 768px) 30vw, 50vw"
            className="object-contain p-5 mix-blend-multiply transition-transform duration-300 group-hover:scale-[1.04] sm:p-7"
            priority={priority}
            unoptimized={isSvg(product.image_url)}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-ink-mute">No image</div>
        )}
        <div className="absolute left-2.5 top-2.5 flex flex-col items-start gap-1">
          {off > 0 ? (
            <span className="rounded-md bg-deal px-1.5 py-0.5 text-[11px] font-bold leading-4 text-white">−{off}%</span>
          ) : null}
          {product.condition !== "new" ? (
            <span className="rounded-md bg-ink px-1.5 py-0.5 text-[11px] font-bold leading-4 text-white">
              {conditionLabel[product.condition]}
            </span>
          ) : product.is_new ? (
            <span className="rounded-md bg-signal px-1.5 py-0.5 text-[11px] font-bold leading-4 text-white">New</span>
          ) : null}
        </div>
        <WishlistButton
          variant="icon"
          productId={product.id}
          productSlug={product.slug}
          productName={product.name}
          className="absolute right-2.5 top-2.5 z-10"
        />
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3 sm:p-4">
        {product.brand_name ? <p className="text-xs font-medium text-ink-mute">{product.brand_name}</p> : null}
        <h3 className="line-clamp-2 text-[14px] font-semibold leading-snug text-ink sm:text-[15px]">
          <Link href={`/products/${product.slug}`} className="after:absolute after:inset-0 focus-visible:outline-none">
            {product.name}
          </Link>
        </h3>
        {specLine ? <p className="line-clamp-1 text-xs text-ink-mute">{specLine}</p> : null}
        <div className="mt-auto space-y-1 pt-1.5">
          <PriceTag price={product.price} salePrice={product.sale_price} size="sm" />
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <AvailabilityBadge stock={product.stock_quantity} threshold={product.low_stock_threshold} status={product.status} />
            {product.rating_count > 0 ? <RatingStars value={product.rating_avg} count={product.rating_count} /> : null}
          </div>
        </div>
        <AddToCartButton
          className="mt-2"
          product={{
            id: product.id,
            slug: product.slug,
            name: product.name,
            image: product.image_url,
            price: product.price,
            sale_price: product.sale_price,
            stock_quantity: product.stock_quantity,
            status: product.status,
          }}
        />
      </div>
    </article>
  );
}

/**
 * Responsive product grid. `rails` limits how many cards show per breakpoint
 * (6 on phones/tablets, 8 on laptops, 10 on wide screens) so home-page rows
 * always end on a full line.
 */
export function ProductGrid({
  products,
  className,
  priorityCount = 0,
  rails = false,
}: {
  products: ProductCardType[];
  className?: string;
  priorityCount?: number;
  rails?: boolean;
}) {
  return (
    <ul className={cn("grid grid-cols-2 gap-2.5 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5", className)}>
      {products.map((p, i) => (
        <li key={p.id} className={cn(rails && i >= 8 && "hidden xl:block", rails && i >= 6 && i < 8 && "hidden lg:block")}>
          <ProductCard product={p} priority={i < priorityCount} />
        </li>
      ))}
    </ul>
  );
}

export function ProductGridSkeleton({ count = 10 }: { count?: number }) {
  return (
    <ul className="grid grid-cols-2 gap-2.5 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" aria-label="Loading products">
      {Array.from({ length: count }).map((_, i) => (
        <li key={i} className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
          <div className="skeleton aspect-square" />
          <div className="space-y-2 p-4">
            <div className="skeleton h-3 w-1/3 rounded" />
            <div className="skeleton h-4 w-5/6 rounded" />
            <div className="skeleton h-5 w-1/2 rounded" />
            <div className="skeleton mt-3 h-10 w-full rounded-[var(--radius-control)]" />
          </div>
        </li>
      ))}
    </ul>
  );
}
