"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import { Toaster, toast } from "sonner";
import type { CartItem } from "@/types";

/**
 * Cart and compare list live in the browser (localStorage): zero database
 * traffic while shopping. Prices are re-checked by the server at checkout.
 */

const CART_KEY = "amg-cart-v1";
const COMPARE_KEY = "amg-compare-v1";
const MAX_COMPARE = 4;

export interface CompareItem {
  id: string;
  slug: string;
  name: string;
  image: string | null;
}

interface StoreContextValue {
  ready: boolean;
  items: CartItem[];
  count: number;
  subtotal: number;
  addItem: (item: Omit<CartItem, "key" | "quantity">, quantity?: number) => void;
  updateQuantity: (key: string, quantity: number) => void;
  removeItem: (key: string) => void;
  clear: () => void;
  /** Apply fresh server prices/stock; unavailable lines are removed. Returns true if anything changed. */
  syncItems: (lines: { key: string; available: boolean; price: number; maxQuantity: number }[]) => boolean;
  compare: CompareItem[];
  toggleCompare: (item: CompareItem) => void;
  removeCompare: (id: string) => void;
  clearCompare: () => void;
}

const StoreContext = createContext<StoreContextValue | null>(null);

type Listener = () => void;

/**
 * A list persisted in localStorage, exposed as an external store for
 * useSyncExternalStore: no effects, correct hydration (the server snapshot is
 * empty), and other open tabs stay in sync through the "storage" event.
 * Falls back to memory when storage is blocked (private mode, quota).
 */
function createPersistentList<T>(key: string) {
  const EMPTY: T[] = [];
  const listeners = new Set<Listener>();
  let cachedRaw: string | null | undefined;
  let cachedValue: T[] = EMPTY;
  let memory: T[] | null = null;

  function get(): T[] {
    if (memory) return memory;
    let raw: string | null;
    try {
      raw = window.localStorage.getItem(key);
    } catch {
      return EMPTY;
    }
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      try {
        const parsed: unknown = raw ? JSON.parse(raw) : EMPTY;
        cachedValue = Array.isArray(parsed) ? (parsed as T[]) : EMPTY;
      } catch {
        cachedValue = EMPTY;
      }
    }
    return cachedValue;
  }

  function set(next: T[]) {
    try {
      const raw = JSON.stringify(next);
      window.localStorage.setItem(key, raw);
      cachedRaw = raw;
      cachedValue = next;
      memory = null;
    } catch {
      memory = next; // storage full or blocked: keep working for this visit
    }
    listeners.forEach((l) => l());
  }

  function subscribe(listener: Listener) {
    listeners.add(listener);
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) listener();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  }

  return { get, set, subscribe, getServer: () => EMPTY };
}

const cartStore = createPersistentList<CartItem>(CART_KEY);
const compareStore = createPersistentList<CompareItem>(COMPARE_KEY);
const subscribeNoop = () => () => {};

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const items = useSyncExternalStore(cartStore.subscribe, cartStore.get, cartStore.getServer);
  const compare = useSyncExternalStore(compareStore.subscribe, compareStore.get, compareStore.getServer);
  // true only after hydration, so server HTML and first client render match
  const ready = useSyncExternalStore(subscribeNoop, () => true, () => false);

  const addItem = useCallback<StoreContextValue["addItem"]>((item, quantity = 1) => {
    const key = `${item.productId}:${item.variantId ?? "base"}`;
    const prev = cartStore.get();
    const existing = prev.find((i) => i.key === key);
    cartStore.set(
      existing
        ? prev.map((i) => (i.key === key ? { ...i, ...item, quantity: Math.min(i.quantity + quantity, item.maxQuantity, 10) } : i))
        : [...prev, { ...item, key, quantity: Math.min(quantity, item.maxQuantity, 10) }],
    );
  }, []);

  const updateQuantity = useCallback((key: string, quantity: number) => {
    cartStore.set(
      cartStore.get().map((i) => (i.key === key ? { ...i, quantity: Math.max(1, Math.min(quantity, i.maxQuantity, 10)) } : i)),
    );
  }, []);

  const removeItem = useCallback((key: string) => cartStore.set(cartStore.get().filter((i) => i.key !== key)), []);
  const clear = useCallback(() => cartStore.set([]), []);

  const syncItems = useCallback<StoreContextValue["syncItems"]>((lines) => {
    let changed = false;
    const next: CartItem[] = [];
    for (const item of cartStore.get()) {
      const line = lines.find((l) => l.key === item.key);
      if (!line) {
        next.push(item);
        continue;
      }
      if (!line.available || line.maxQuantity < 1) {
        changed = true;
        continue;
      }
      const quantity = Math.min(item.quantity, line.maxQuantity);
      if (line.price !== item.price || quantity !== item.quantity || line.maxQuantity !== item.maxQuantity) changed = true;
      next.push({ ...item, price: line.price, quantity, maxQuantity: line.maxQuantity });
    }
    if (changed) cartStore.set(next);
    return changed;
  }, []);

  const toggleCompare = useCallback((item: CompareItem) => {
    const prev = compareStore.get();
    if (prev.some((p) => p.id === item.id)) {
      compareStore.set(prev.filter((p) => p.id !== item.id));
      toast("Removed from compare");
      return;
    }
    if (prev.length >= MAX_COMPARE) {
      toast.error(`You can compare up to ${MAX_COMPARE} phones. Remove one first.`);
      return;
    }
    compareStore.set([...prev, item]);
    toast.success("Added to compare", { action: { label: "Compare", onClick: () => (window.location.href = "/compare") } });
  }, []);

  const removeCompare = useCallback((id: string) => compareStore.set(compareStore.get().filter((p) => p.id !== id)), []);
  const clearCompare = useCallback(() => compareStore.set([]), []);

  const value = useMemo<StoreContextValue>(() => {
    const count = items.reduce((n, i) => n + i.quantity, 0);
    const subtotal = items.reduce((n, i) => n + i.price * i.quantity, 0);
    return {
      ready,
      items,
      count,
      subtotal,
      addItem,
      updateQuantity,
      removeItem,
      clear,
      syncItems,
      compare,
      toggleCompare,
      removeCompare,
      clearCompare,
    };
  }, [ready, items, compare, addItem, updateQuantity, removeItem, clear, syncItems, toggleCompare, removeCompare, clearCompare]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside <StoreProvider>");
  return ctx;
}

export function AppToaster() {
  return (
    <Toaster
      position="bottom-center"
      toastOptions={{ classNames: { toast: "!rounded-[12px] !font-sans" } }}
      richColors
      closeButton
    />
  );
}
