import { z } from "zod";

/**
 * Header announcement bar (sliding messages / offers) and Locations
 * (outlets), managed in Admin → Settings and stored in
 * public.storefront_header (migration 0018).
 *
 * Plain data + validation only (no React, no server APIs): used by the
 * server action, the admin form and the storefront header alike.
 * Nothing here contains shop data; every message and outlet comes from the
 * admin. With nothing configured the bar is hidden and Locations is not shown.
 */

export const MAX_MESSAGES = 30;
export const MAX_OUTLETS = 10;
export const SPEED = { min: 15, max: 150, default: 40 } as const; // pixels per second

export const HEADER_ICONS = ["none", "tag", "gift", "truck", "sparkles", "flame", "percent", "phone", "shield", "refresh", "clock", "star"] as const;
export type HeaderIcon = (typeof HEADER_ICONS)[number];
export const ICON_LABELS: Record<HeaderIcon, string> = {
  none: "No icon",
  tag: "Tag",
  gift: "Gift",
  truck: "Delivery truck",
  sparkles: "Sparkles",
  flame: "Flame",
  percent: "Percent",
  phone: "Phone",
  shield: "Shield (genuine)",
  refresh: "Exchange arrows",
  clock: "Clock",
  star: "Star",
};

export const MESSAGE_STYLES = ["plain", "bold", "highlight"] as const;
export type MessageStyle = (typeof MESSAGE_STYLES)[number];

export interface HeaderMessage {
  id: string;
  text: string;
  text_bn: string | null;
  enabled: boolean;
  /** "/path" on this site or an https:// address; null = no link. */
  link: string | null;
  /** ISO timestamps; null = no limit. */
  starts_at: string | null;
  ends_at: string | null;
  style: MessageStyle;
  icon: HeaderIcon;
  /** Short badge before the text, e.g. "OFFER". */
  label: string | null;
}

export interface HeaderOutlet {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  whatsapp: string | null;
  hours: string | null;
  map_url: string | null;
  active: boolean;
}

export interface HeaderBar {
  /** Master "Announcement Bar Visibility". OFF hides the bar; nothing else is changed. */
  enabled: boolean;
  animate: boolean;
  direction: "left" | "right";
  speed: number;
  pause_on_hover: boolean;
  show_desktop: boolean;
  show_mobile: boolean;
  bg_color: string;
  text_color: string;
  accent_color: string;
  /** Which text to show when a message has both. */
  language: "en" | "bn" | "both";
}

export interface HeaderConfig {
  bar: HeaderBar;
  messages: HeaderMessage[];
  outlets: HeaderOutlet[];
  /** Main menu (lib/navigation.ts); undefined/null = built-in menu. Saved separately. */
  nav?: unknown;
}

/** Off and empty: nothing is shown until the admin configures it. */
export const DEFAULT_BAR: HeaderBar = {
  enabled: false,
  animate: true,
  direction: "left",
  speed: SPEED.default,
  pause_on_hover: true,
  show_desktop: true,
  show_mobile: true,
  bg_color: "#073b30", // the existing top-bar colour (white text: contrast 12.5:1)
  text_color: "#ffffff",
  accent_color: "#6ee7b7",
  language: "en",
};

export const EMPTY_HEADER: HeaderConfig = { bar: DEFAULT_BAR, messages: [], outlets: [] };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Removes control characters and squeezes whitespace (text is rendered as plain text, never HTML). */
export function cleanText(v: string): string {
  return v
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const text = (max: number, label: string) =>
  z
    .string()
    .transform(cleanText)
    .pipe(z.string().max(max, `${label}: at most ${max} characters`));
const optionalText = (max: number, label: string) =>
  z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) => (v ? cleanText(v) : ""))
    .pipe(z.string().max(max, `${label}: at most ${max} characters`))
    .transform((v) => v || null);

/** A link inside this site ("/offers") or a full https:// address. */
export function safeLink(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^\/(?![/\\])[^\s]*$/.test(v)) return v.length <= 500 ? v : null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".")) return null;
    return u.toString().length <= 500 ? u.toString() : null;
  } catch {
    return null;
  }
}

const GOOGLE_MAPS_HOST = /^(maps\.app\.goo\.gl|goo\.gl|maps\.google\.[a-z.]+|(www\.)?google\.[a-z.]+|g\.co)$/i;
/** Google Maps links only (https). */
export function safeMapUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || u.username || u.password || !GOOGLE_MAPS_HOST.test(u.hostname)) return null;
    if (/^(www\.)?google\./i.test(u.hostname) && !u.pathname.startsWith("/maps")) return null;
    if (/^(goo\.gl|g\.co)$/i.test(u.hostname) && !/^\/(maps|kgs)/.test(u.pathname)) return null;
    return u.toString().length <= 1000 ? u.toString() : null;
  } catch {
    return null;
  }
}

const phone = (label: string) =>
  optionalText(20, label).refine((v) => v === null || /^\+?[0-9][0-9 -]{5,18}$/.test(v), `${label}: digits only, e.g. 01XXXXXXXXX`);

const color = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Colour must look like #1A2B3C")
  .transform((v) => v.toLowerCase());

const id = z.string().regex(/^[a-zA-Z0-9_-]{6,40}$/, "Invalid id");

const isoDate = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v, ctx) => {
    if (!v) return null;
    const t = Date.parse(v);
    if (Number.isNaN(t)) {
      ctx.addIssue({ code: "custom", message: "Invalid date" });
      return z.NEVER;
    }
    return new Date(t).toISOString();
  });

export const messageSchema = z
  .object({
    id,
    text: text(160, "Message"),
    text_bn: optionalText(160, "Bangla text"),
    enabled: z.boolean(),
    link: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((v, ctx) => {
        if (!v || !v.trim()) return null;
        const safe = safeLink(v);
        if (!safe) {
          ctx.addIssue({ code: "custom", message: "Link must start with / (a page on this site) or https://" });
          return z.NEVER;
        }
        return safe;
      }),
    starts_at: isoDate,
    ends_at: isoDate,
    style: z.enum(MESSAGE_STYLES),
    icon: z.enum(HEADER_ICONS),
    label: optionalText(24, "Offer label"),
  })
  .superRefine((m, ctx) => {
    if (!m.text && !m.text_bn) ctx.addIssue({ code: "custom", path: ["text"], message: "Write the message (English or Bangla)" });
    if (m.starts_at && m.ends_at && Date.parse(m.ends_at) <= Date.parse(m.starts_at)) {
      ctx.addIssue({ code: "custom", path: ["ends_at"], message: "End must be after the start" });
    }
  });

export const outletSchema = z
  .object({
    id,
    name: text(80, "Outlet name"),
    address: optionalText(300, "Address"),
    phone: phone("Phone"),
    whatsapp: phone("WhatsApp"),
    hours: optionalText(120, "Opening hours"),
    map_url: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((v, ctx) => {
        if (!v || !v.trim()) return null;
        const safe = safeMapUrl(v);
        if (!safe) {
          ctx.addIssue({ code: "custom", message: "Use a Google Maps link (https://maps.app.goo.gl/… or https://www.google.com/maps/…)" });
          return z.NEVER;
        }
        return safe;
      }),
    active: z.boolean(),
  })
  .superRefine((o, ctx) => {
    if (!o.name) ctx.addIssue({ code: "custom", path: ["name"], message: "Outlet name is required" });
  });

export const barSchema = z.object({
  enabled: z.boolean(),
  animate: z.boolean(),
  direction: z.enum(["left", "right"]),
  speed: z.coerce.number().int().min(SPEED.min, `Speed: ${SPEED.min}–${SPEED.max}`).max(SPEED.max, `Speed: ${SPEED.min}–${SPEED.max}`),
  pause_on_hover: z.boolean(),
  show_desktop: z.boolean(),
  show_mobile: z.boolean(),
  bg_color: color,
  text_color: color,
  accent_color: color,
  language: z.enum(["en", "bn", "both"]),
});

export const headerSchema = z.object({
  bar: barSchema,
  messages: z.array(messageSchema).max(MAX_MESSAGES, `At most ${MAX_MESSAGES} messages`),
  outlets: z.array(outletSchema).max(MAX_OUTLETS, `At most ${MAX_OUTLETS} outlets`),
});

/** Readable "where: problem" lines for the admin, keyed by path (e.g. "messages.2.link"). */
export function headerErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/**
 * Parses what is stored in the database. Anything invalid is dropped
 * (a broken row never breaks the header); missing settings get defaults.
 */
export function readHeaderConfig(row: { bar?: unknown; messages?: unknown; outlets?: unknown } | null | undefined): HeaderConfig {
  if (!row) return EMPTY_HEADER;
  const barIn = row.bar && typeof row.bar === "object" ? row.bar : {};
  const bar = barSchema.safeParse({ ...DEFAULT_BAR, ...barIn });
  const list = <T,>(v: unknown, schema: { safeParse(x: unknown): { success: boolean; data?: T } }, max: number): T[] =>
    (Array.isArray(v) ? v : [])
      .flatMap((x) => {
        const r = schema.safeParse(x);
        return r.success && r.data !== undefined ? [r.data] : [];
      })
      .slice(0, max);
  return {
    bar: bar.success ? bar.data : DEFAULT_BAR,
    messages: list(row.messages, messageSchema, MAX_MESSAGES),
    outlets: list(row.outlets, outletSchema, MAX_OUTLETS),
  };
}

// ---------------------------------------------------------------------------
// What visitors see
// ---------------------------------------------------------------------------

/** Enabled and inside its schedule at time `now` (ms). */
export function isMessageLive(m: Pick<HeaderMessage, "enabled" | "starts_at" | "ends_at">, now: number): boolean {
  if (!m.enabled) return false;
  if (m.starts_at && Date.parse(m.starts_at) > now) return false;
  if (m.ends_at && Date.parse(m.ends_at) <= now) return false;
  return true;
}

/**
 * Messages the page should carry: enabled and not yet ended at render time.
 * (Pages are cached, so ones starting later are included and the browser
 * shows each only inside its own schedule.) Empty when the bar is OFF.
 */
export function messagesForPage(config: HeaderConfig, now: number): HeaderMessage[] {
  if (!config.bar.enabled || (!config.bar.show_desktop && !config.bar.show_mobile)) return [];
  return config.messages.filter((m) => m.enabled && !(m.ends_at && Date.parse(m.ends_at) <= now));
}

/** Active outlets that have something to show besides a name. */
export function visibleOutlets(outlets: HeaderOutlet[]): HeaderOutlet[] {
  return outlets.filter((o) => o.active && o.name && (o.address || o.phone || o.whatsapp || o.hours || o.map_url));
}

/** The text(s) to show for a message, by the bar's language setting. */
export function messageTexts(m: Pick<HeaderMessage, "text" | "text_bn">, language: HeaderBar["language"]): { text: string; bn: boolean }[] {
  const en = m.text ? { text: m.text, bn: false } : null;
  const bn = m.text_bn ? { text: m.text_bn, bn: true } : null;
  if (language === "bn") return [bn ?? en].filter((x): x is { text: string; bn: boolean } => Boolean(x));
  if (language === "both") return [en, bn].filter((x): x is { text: string; bn: boolean } => Boolean(x));
  return [en ?? bn].filter((x): x is { text: string; bn: boolean } => Boolean(x));
}

/** WCAG contrast ratio of two #rrggbb colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Random id for a new message / outlet (not security relevant). */
export function newItemId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
