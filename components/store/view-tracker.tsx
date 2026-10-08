"use client";

import { useEffect } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";

/**
 * Counts a product view at most once per browser session, after the page is
 * idle. Goes straight to Supabase (no server function involved).
 */
export function ViewTracker({ productId }: { productId: string }) {
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
