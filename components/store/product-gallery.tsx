"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { cn, isSvg } from "@/lib/utils";

export const VARIANT_IMAGE_EVENT = "amg:variant-image";

interface GalleryImage {
  url: string;
  alt: string;
}

export function ProductGallery({ images, productName }: { images: GalleryImage[]; productName: string }) {
  const [index, setIndex] = useState(0);
  const [override, setOverride] = useState<string | null>(null);

  // The variant picker announces its image; show it without another request.
  useEffect(() => {
    const onVariant = (e: Event) => {
      const url = (e as CustomEvent<string | null>).detail;
      if (!url) return setOverride(null);
      const found = images.findIndex((i) => i.url === url);
      if (found >= 0) {
        setIndex(found);
        setOverride(null);
      } else {
        setOverride(url);
      }
    };
    window.addEventListener(VARIANT_IMAGE_EVENT, onVariant);
    return () => window.removeEventListener(VARIANT_IMAGE_EVENT, onVariant);
  }, [images]);

  const current = override ? { url: override, alt: productName } : images[index];

  if (!current) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-[var(--radius-card)] border border-line bg-surface text-ink-mute">
        No image available
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="relative aspect-square overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
        <Image
          key={current.url}
          src={current.url}
          alt={current.alt}
          fill
          priority
          sizes="(min-width: 1024px) 560px, 100vw"
          className="object-contain p-6 sm:p-10"
          unoptimized={isSvg(current.url)}
        />
      </div>
      {images.length > 1 ? (
        <ul className="no-scrollbar flex min-w-0 snap-x gap-2 overflow-x-auto overscroll-x-contain p-0.5" aria-label="Product images">
          {images.map((img, i) => (
            <li key={img.url} className="shrink-0 snap-start">
              <button
                type="button"
                onClick={() => {
                  setIndex(i);
                  setOverride(null);
                }}
                aria-label={`Show image ${i + 1} of ${images.length}`}
                aria-current={!override && i === index ? "true" : undefined}
                className={cn(
                  "relative h-16 w-16 overflow-hidden rounded-lg border bg-surface sm:h-20 sm:w-20",
                  !override && i === index ? "border-ink ring-1 ring-ink" : "border-line hover:border-line-strong",
                )}
              >
                <Image src={img.url} alt="" fill sizes="80px" className="object-contain p-1.5" unoptimized={isSvg(img.url)} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
