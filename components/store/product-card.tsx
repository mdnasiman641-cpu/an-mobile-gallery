import Link from "next/link";
import Image from "next/image";
import type { ProductCard as ProductCardType } from "@/types";
import { cn, conditionLabel, discountPercent, isSvg } from "@/lib/utils";
import { AvailabilityBadge, PriceTag, RatingStars } from "@/components/store/product-bits";

export function ProductCard({ product, priority = false }: { product: ProductCardType; priority?: boolean }) {
  const off = discountPercent(product.price, product.sale_price);
  const specLine = [product.ram_options[0] && `${product.ram_options.join("/")} RAM`, product.storage_options.join(" / ")]
    .filter(Boolean)
    .join(", ");

  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface transition-colors hover:border-line-strong">
      <div className="relative aspect-square bg-paper">
        {product.image_url ? (
          <Image
            src={product.image_url}
            alt={product.image_alt || product.name}
            fill
            sizes="(min-width: 1280px) 240px, (min-width: 768px) 30vw, 50vw"
            className="object-contain p-4 transition-transform duration-300 group-hover:scale-[1.03] sm:p-6"
            priority={priority}
            unoptimized={isSvg(product.image_url)}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-ink-mute">No image</div>
        )}
        <div className="absolute left-2 top-2 flex flex-col items-start gap-1">
          {off > 0 ? (
            <span className="rounded-md bg-deal px-1.5 py-0.5 text-[11px] font-bold text-white">−{off}%</span>
          ) : null}
          {product.condition !== "new" ? (
            <span className="rounded-md bg-ink px-1.5 py-0.5 text-[11px] font-bold text-white">
              {conditionLabel[product.condition]}
            </span>
          ) : product.is_new ? (
            <span className="rounded-md bg-signal px-1.5 py-0.5 text-[11px] font-bold text-white">New</span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3 sm:p-4">
        {product.brand_name ? <p className="text-xs font-medium text-ink-mute">{product.brand_name}</p> : null}
        <h3 className="line-clamp-2 text-[14px] font-semibold leading-snug text-ink sm:text-[15px]">
          <Link href={`/products/${product.slug}`} className="after:absolute after:inset-0 focus-visible:outline-none">
            {product.name}
          </Link>
        </h3>
        {specLine ? <p className="line-clamp-1 text-xs text-ink-soft">{specLine}</p> : null}
        {product.rating_count > 0 ? <RatingStars value={product.rating_avg} count={product.rating_count} /> : null}
        <div className="mt-auto pt-1.5">
          <PriceTag price={product.price} salePrice={product.sale_price} size="sm" />
          <AvailabilityBadge
            stock={product.stock_quantity}
            threshold={product.low_stock_threshold}
            status={product.status}
            className="mt-1"
          />
        </div>
      </div>
    </article>
  );
}

export function ProductGrid({
  products,
  className,
  priorityCount = 0,
}: {
  products: ProductCardType[];
  className?: string;
  priorityCount?: number;
}) {
  return (
    <ul className={cn("grid grid-cols-2 gap-2.5 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5", className)}>
      {products.map((p, i) => (
        <li key={p.id}>
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
          </div>
        </li>
      ))}
    </ul>
  );
}
