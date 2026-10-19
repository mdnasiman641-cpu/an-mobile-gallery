"use client";

import { useEffect } from "react";
import { productItem, track } from "@/lib/tracking/client";
import type { TrackEvent } from "@/lib/tracking/events";

/** Sends one event when a (server-rendered) page shows. Renders nothing. */
export function TrackOnMount({ event }: { event: Omit<TrackEvent, "event_id"> }) {
  const key = JSON.stringify(event);
  useEffect(() => {
    track(JSON.parse(key) as Omit<TrackEvent, "event_id">);
  }, [key]);
  return null;
}

export interface ListProduct {
  id: string;
  name: string;
  price: number;
  sale_price: number | null;
  brand_name: string | null;
}

export const listId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 80) || "list";

/** view_item_list for a product grid (real prices from the listing). */
export function TrackItemList({ listName, products }: { listName: string; products: ListProduct[] }) {
  const key = JSON.stringify([listName, products.map((p) => [p.id, p.name, p.price, p.sale_price, p.brand_name])]);
  useEffect(() => {
    const [name, rows] = JSON.parse(key) as [string, [string, string, number, number | null, string | null][]];
    if (!rows.length) return;
    const items = rows.slice(0, 50).map(([id, n, price, sale, brand], index) =>
      productItem({ productId: id, name: n, price: sale !== null && Number(sale) < Number(price) ? Number(sale) : Number(price), brand, index }),
    );
    // a list view has no "value": only the items shown, with their real prices
    track({ name: "view_item_list", items, item_list_name: name.slice(0, 120), item_list_id: listId(name) });
  }, [key]);
  return null;
}
