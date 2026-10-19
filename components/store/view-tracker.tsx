"use client";

import { useEffect } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";
import { itemsEvent, productItem, track } from "@/lib/tracking/client";

/**
 * Counts a product view at most once per browser session, after the page is
 * idle. Goes straight to Supabase (no server function involved).
 * Also sends the view_item tracking event (every view; only with consent,
 * decided inside the tracking module).
 */
export function ViewTracker({
  productId,
  tracking,
}: {
  productId: string;
  tracking?: { name: string; price: number; brand: string | null; category: string | null };
}) {
  const t = tracking ? JSON.stringify(tracking) : null;
  useEffect(() => {
    if (!t) return;
    const p = JSON.parse(t) as { name: string; price: number; brand: string | null; category: string | null };
    track(itemsEvent("view_item", [productItem({ productId, name: p.name, price: p.price, brand: p.brand, category: p.category })]));
  }, [productId, t]);

  useEffect(() => {
    const key = `amg-viewed-${productId}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      return; // storage blocked: skip counting rather than count every reload
    }
    const run = () => {
      getBrowserClient()
        .rpc("record_product_view", { p_product_id: productId })
        .then(() => undefined, () => undefined);
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(run);
    else window.setTimeout(run, 2000);
  }, [productId]);
  return null;
}
