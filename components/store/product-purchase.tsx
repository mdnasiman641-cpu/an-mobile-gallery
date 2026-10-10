"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { GitCompareArrows, Minus, Plus, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/components/providers";
import { AvailabilityBadge, PriceTag } from "@/components/store/product-bits";
import { VARIANT_IMAGE_EVENT } from "@/components/store/product-gallery";
import { Button } from "@/components/ui/button";
import { cn, effectivePrice, variantLabel, whatsappLink, formatPrice } from "@/lib/utils";
import type { ProductStatus, ProductVariant } from "@/types";

interface Props {
  product: {
    id: string;
    slug: string;
    name: string;
    price: number;
    sale_price: number | null;
    stock_quantity: number;
    low_stock_threshold: number;
    status: ProductStatus;
    image: string | null;
  };
  variants: ProductVariant[];
  whatsapp: string | null;
}

function uniq(values: (string | null)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => Boolean(v))));
}

export function ProductPurchase({ product, variants, whatsapp }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { addItem, toggleCompare, compare } = useStore();
  const hasVariants = variants.length > 0;

  const initial = useMemo(() => {
    const fromUrl = variants.find((v) => v.id === searchParams.get("variant"));
    if (fromUrl) return fromUrl;
    const inStock = variants.filter((v) => v.stock > 0);
    const pool = inStock.length ? inStock : variants;
    return [...pool].sort((a, b) => effectivePrice(a.price, a.sale_price) - effectivePrice(b.price, b.sale_price))[0] ?? null;
  }, [variants, searchParams]);

  const [storage, setStorage] = useState<string | null>(initial?.storage ?? null);
  const [ram, setRam] = useState<string | null>(initial?.ram ?? null);
  const [color, setColor] = useState<string | null>(initial?.color ?? null);
  const [quantity, setQuantity] = useState(1);

  const storages = uniq(variants.map((v) => v.storage));
  const rams = uniq(variants.map((v) => v.ram));
  const colors = uniq(variants.map((v) => v.color));

  const selected = useMemo(() => {
    if (!hasVariants) return null;
    return (
      variants.find(
        (v) =>
          (storages.length === 0 || v.storage === storage) &&
          (rams.length <= 1 || v.ram === ram) &&
          (colors.length === 0 || v.color === color),
      ) ?? null
    );
  }, [hasVariants, variants, storages.length, rams.length, colors.length, storage, ram, color]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent(VARIANT_IMAGE_EVENT, { detail: selected?.image_url ?? null }));
  }, [selected]);

  const price = selected ? selected.price : product.price;
  const salePrice = selected ? selected.sale_price : product.sale_price;
  const stock = hasVariants ? (selected?.stock ?? 0) : product.stock_quantity;
  const soldOut = product.status === "out_of_stock" || stock <= 0;
  const combinationMissing = hasVariants && !selected;
  const maxQty = Math.max(1, Math.min(stock, 10));

  // Is this option available with the other current choices?
  function available(kind: "storage" | "ram" | "color", value: string) {
    return variants.some(
      (v) =>
        (kind === "storage" ? v.storage === value : storages.length === 0 || v.storage === storage) &&
        (kind === "ram" ? v.ram === value : rams.length <= 1 || v.ram === ram) &&
        (kind === "color" ? v.color === value : true),
    );
  }

  function pickStorage(value: string) {
    setStorage(value);
    // keep colour if that combination exists, otherwise pick the first that does
    const match = variants.find((v) => v.storage === value && (rams.length <= 1 || v.ram === ram) && v.color === color);
    if (!match) {
      const first = variants.find((v) => v.storage === value);
      if (first) {
        setColor(first.color);
        setRam(first.ram);
      }
    }
    setQuantity(1);
  }

  function add(goToCheckout: boolean) {
    if (combinationMissing) {
      toast.error("This combination isn't available. Choose another option.");
      return;
    }
    if (soldOut) return;
    addItem(
      {
        productId: product.id,
        variantId: selected?.id ?? null,
        slug: product.slug,
        name: product.name,
        variantLabel: selected ? variantLabel(selected) : null,
        image: selected?.image_url ?? product.image,
        price: effectivePrice(price, salePrice),
        maxQuantity: maxQty,
      },
      quantity,
    );
    if (goToCheckout) {
      router.push("/checkout");
    } else {
      toast.success("Added to cart", { action: { label: "View cart", onClick: () => router.push("/cart") } });
    }
  }

  const inCompare = compare.some((c) => c.id === product.id);
  const wa = whatsappLink(
    whatsapp,
    `Hi, I want to order ${product.name}${selected ? ` (${variantLabel(selected)})` : ""} — ${formatPrice(effectivePrice(price, salePrice))}.`,
  );

  const option = (active: boolean, disabled: boolean) =>
    cn(
      "inline-flex min-h-10 items-center gap-2 rounded-[var(--radius-control)] border px-3.5 text-sm font-semibold transition-colors",
      active ? "border-ink bg-ink text-white" : "border-line-strong bg-surface text-ink hover:border-ink",
      disabled && !active && "border-dashed text-ink-mute",
    );

  return (
    <div className="flex flex-col gap-5">
      <div>
        <PriceTag price={price} salePrice={salePrice} size="lg" />
        <div className="mt-2">
          {combinationMissing ? (
            <span className="text-sm font-semibold text-deal">Not available in this combination</span>
          ) : (
            <AvailabilityBadge stock={stock} threshold={product.low_stock_threshold} status={product.status} className="text-sm" />
          )}
        </div>
      </div>

      {storages.length ? (
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Storage</legend>
          <div className="flex flex-wrap gap-2">
            {storages.map((s) => (
              <button key={s} type="button" aria-pressed={storage === s} className={option(storage === s, !available("storage", s))} onClick={() => pickStorage(s)}>
                {s}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}

      {rams.length > 1 ? (
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">RAM</legend>
          <div className="flex flex-wrap gap-2">
            {rams.map((r) => (
              <button key={r} type="button" aria-pressed={ram === r} className={option(ram === r, !available("ram", r))} onClick={() => setRam(r)}>
                {r}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}

      {colors.length ? (
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">
            Colour{color ? <span className="font-normal text-ink-soft">: {color}</span> : null}
          </legend>
          <div className="flex flex-wrap gap-2">
            {colors.map((c) => {
              const hex = variants.find((v) => v.color === c)?.color_hex;
              return (
                <button key={c} type="button" aria-pressed={color === c} className={option(color === c, !available("color", c))} onClick={() => setColor(c)}>
                  {hex ? <span className="h-4 w-4 rounded-full border border-black/10" style={{ backgroundColor: hex }} aria-hidden /> : null}
                  {c}
                </button>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {!soldOut && !combinationMissing ? (
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold" id="qty-label">
            Quantity
          </span>
          <div className="flex items-center rounded-[var(--radius-control)] border border-line-strong" role="group" aria-labelledby="qty-label">
            <button
              type="button"
              className="flex h-10 w-10 items-center justify-center disabled:opacity-40"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              disabled={quantity <= 1}
              aria-label="Decrease quantity"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="price w-8 text-center font-semibold" aria-live="polite">
              {quantity}
            </span>
            <button
              type="button"
              className="flex h-10 w-10 items-center justify-center disabled:opacity-40"
              onClick={() => setQuantity((q) => Math.min(maxQty, q + 1))}
              disabled={quantity >= maxQty}
              aria-label="Increase quantity"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Button size="lg" variant="outline" className="px-3 sm:px-6" disabled={soldOut || combinationMissing} onClick={() => add(false)}>
          <ShoppingBag className="hidden h-[18px] w-[18px] min-[370px]:block" aria-hidden />
          Add to cart
        </Button>
        <Button size="lg" className="px-3 sm:px-6" disabled={soldOut || combinationMissing} onClick={() => add(true)}>
          Buy now
        </Button>
      </div>
      {soldOut ? (
        <p className="-mt-2 text-sm text-ink-soft">
          Out of stock right now. {wa ? "Message us and we'll tell you when it's back." : "Please check back soon."}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => toggleCompare({ id: product.id, slug: product.slug, name: product.name, image: product.image })}
          aria-pressed={inCompare}
          className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-control)] px-3 text-sm font-semibold text-ink-soft hover:bg-ink/5 hover:text-ink"
        >
          <GitCompareArrows className="h-4 w-4" aria-hidden />
          {inCompare ? "Added to compare" : "Compare"}
        </button>
        {wa ? (
          <a
            href={wa}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-control)] px-3 text-sm font-semibold text-signal-dark hover:bg-signal-tint"
          >
            Order on WhatsApp
          </a>
        ) : null}
      </div>
    </div>
  );
}
