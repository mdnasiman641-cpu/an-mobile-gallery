import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Availability, ProductCondition, ProductStatus, OrderStatus, PaymentStatus } from "@/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Bangladeshi digit grouping (lakh/crore): 158000 -> 1,58,000
const takaFormatter = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export function formatPrice(value: number | string | null | undefined, symbol = "৳"): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (n === null || n === undefined || Number.isNaN(n)) return `${symbol}0`;
  return `${symbol}${takaFormatter.format(Math.round(n))}`;
}

export function effectivePrice(price: number, salePrice: number | null | undefined): number {
  return salePrice !== null && salePrice !== undefined && Number(salePrice) < Number(price) ? Number(salePrice) : Number(price);
}

export function discountPercent(price: number, salePrice: number | null | undefined): number {
  if (salePrice === null || salePrice === undefined) return 0;
  const p = Number(price);
  const s = Number(salePrice);
  if (!p || s >= p) return 0;
  return Math.round(((p - s) / p) * 100);
}

export function getAvailability(stock: number, lowThreshold: number, status?: ProductStatus): Availability {
  if (status === "out_of_stock" || stock <= 0) return "out_of_stock";
  if (stock <= lowThreshold) return "low_stock";
  return "in_stock";
}

export const availabilityLabel: Record<Availability, string> = {
  in_stock: "In Stock",
  low_stock: "Low Stock",
  out_of_stock: "Out of Stock",
};

export const conditionLabel: Record<ProductCondition, string> = {
  new: "New",
  used: "Used",
  refurbished: "Refurbished",
};

export const statusLabel: Record<ProductStatus, string> = {
  active: "Active",
  draft: "Draft",
  out_of_stock: "Out of Stock",
  archived: "Archived",
};

export const orderStatusLabel: Record<OrderStatus, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  processing: "Processing",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export const orderStatusTone = {
  pending: "warn",
  confirmed: "signal",
  processing: "signal",
  shipped: "signal",
  delivered: "neutral",
  cancelled: "deal",
} as const satisfies Record<OrderStatus, "warn" | "signal" | "neutral" | "deal">;

export const paymentStatusLabel: Record<PaymentStatus, string> = {
  unpaid: "Unpaid",
  paid: "Paid",
  partially_paid: "Partially paid",
  refunded: "Refunded",
};

export function variantLabel(v: { storage?: string | null; ram?: string | null; color?: string | null }): string {
  return [v.storage, v.ram ? `${v.ram} RAM` : null, v.color].filter(Boolean).join(" / ");
}

// Building an Intl formatter is ~50x slower than using one (measured ~0.08 ms
// vs ~0.001 ms in Node), and admin tables format a date per row. Create each
// formatter once per Worker instance, on first use.
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
function dateFormatter(withTime: boolean): Intl.DateTimeFormat {
  const key = withTime ? "dt" : "d";
  let f = dateFormatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
      timeZone: "Asia/Dhaka",
    });
    dateFormatters.set(key, f);
  }
  return f;
}

export function formatDate(value: string | Date, withTime = false): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return dateFormatter(withTime).format(d);
}

/** Strip the light markdown we store in descriptions -> plain text. */
export function toPlainText(input: string | null | undefined, max?: number): string {
  if (!input) return "";
  const text = input
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\[(.+?)\]\((.+?)\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (max && text.length > max) return `${text.slice(0, max - 1).trimEnd()}…`;
  return text;
}

export function whatsappLink(number: string | null | undefined, message?: string): string | null {
  if (!number) return null;
  let digits = number.replace(/\D/g, "");
  if (digits.startsWith("01")) digits = `88${digits}`;
  if (digits.length < 11) return null;
  return `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
}

export function isSvg(src: string | null | undefined): boolean {
  return Boolean(src && /\.svg(\?|$)/i.test(src));
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/** "8 Oct 2026, 2:30 am" for the current moment (Bangladesh time). */
export function nowLabel(): string {
  return formatDate(new Date(), true);
}

export function currentYear(): number {
  return new Date().getFullYear();
}
