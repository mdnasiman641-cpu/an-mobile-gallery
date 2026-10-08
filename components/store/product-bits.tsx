import { Star } from "lucide-react";
import { availabilityLabel, cn, discountPercent, effectivePrice, formatPrice, getAvailability } from "@/lib/utils";
import type { ProductStatus } from "@/types";

export function PriceTag({
  price,
  salePrice,
  size = "md",
  className,
}: {
  price: number;
  salePrice: number | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const final = effectivePrice(price, salePrice);
  const off = discountPercent(price, salePrice);
  const sizes = { sm: "text-base", md: "text-lg", lg: "text-[2rem] leading-none" } as const;
  return (
    <div className={cn("flex flex-wrap items-baseline gap-x-2 gap-y-0.5", className)}>
      <span className={cn("price font-bold text-ink", sizes[size])}>{formatPrice(final)}</span>
      {off > 0 ? (
        <>
          <span className={cn("price text-ink-mute line-through", size === "lg" ? "text-lg" : "text-sm")}>
            <span className="sr-only">Regular price </span>
            {formatPrice(price)}
          </span>
          {size === "lg" ? (
            <span className="text-sm font-semibold text-deal">Save {formatPrice(Number(price) - final)}</span>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function AvailabilityBadge({
  stock,
  threshold,
  status,
  className,
}: {
  stock: number;
  threshold: number;
  status?: ProductStatus;
  className?: string;
}) {
  const a = getAvailability(stock, threshold, status);
  const tone = {
    in_stock: "text-signal-dark",
    low_stock: "text-warn",
    out_of_stock: "text-deal",
  }[a];
  const dot = { in_stock: "bg-signal", low_stock: "bg-warn", out_of_stock: "bg-deal" }[a];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", tone, className)}>
      <span className={cn("h-2 w-2 rounded-full", dot)} aria-hidden />
      {availabilityLabel[a]}
      {a === "low_stock" && stock > 0 ? <span className="font-normal text-ink-mute">({stock} left)</span> : null}
    </span>
  );
}

export function RatingStars({ value, count, size = "sm" }: { value: number; count?: number; size?: "sm" | "md" }) {
  const rounded = Math.round(value * 2) / 2;
  const px = size === "sm" ? "h-3.5 w-3.5" : "h-[18px] w-[18px]";
  return (
    <span className="inline-flex items-center gap-1" aria-label={`Rated ${value.toFixed(1)} out of 5${count ? ` from ${count} reviews` : ""}`}>
      <span className="flex" aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => (
          <Star
            key={i}
            className={cn(px, i <= rounded ? "fill-taka text-taka" : i - 0.5 === rounded ? "fill-taka/50 text-taka" : "text-line-strong")}
          />
        ))}
      </span>
      {count !== undefined ? <span className="text-xs text-ink-mute">({count})</span> : null}
    </span>
  );
}
