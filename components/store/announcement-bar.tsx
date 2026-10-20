"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { Clock, Flame, Gift, Percent, Phone, RefreshCw, ShieldCheck, Sparkles, Star, Tag, Truck, type LucideIcon } from "lucide-react";
import { isMessageLive, messageTexts, type HeaderBar, type HeaderIcon, type HeaderMessage } from "@/lib/header-config";
import { cn } from "@/lib/utils";

const ICONS: Record<Exclude<HeaderIcon, "none">, LucideIcon> = {
  tag: Tag,
  gift: Gift,
  truck: Truck,
  sparkles: Sparkles,
  flame: Flame,
  percent: Percent,
  phone: Phone,
  shield: ShieldCheck,
  refresh: RefreshCw,
  clock: Clock,
  star: Star,
};

// useLayoutEffect warns during server rendering; the measurement only matters in the browser
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
const MAX_TIMER = 6 * 3600_000;

/**
 * The sliding announcement bar. Movement is a CSS animation (transform only,
 * no React updates while it runs). The browser checks each message's
 * schedule when the page opens, and again only at the next start / end time.
 */
export function AnnouncementBar({
  bar,
  messages,
  renderedAt,
  preview = false,
}: {
  bar: HeaderBar;
  messages: HeaderMessage[];
  /** Server time of this render; the first browser render uses it too (no hydration mismatch). */
  renderedAt: number;
  /** Admin preview: always visible (no device classes), links not followed. */
  preview?: boolean;
}) {
  const [now, setNow] = useState(renderedAt);
  // the page may come from a cache: check the schedules against the visitor's clock once
  useEffect(() => {
    if (preview) return;
    const id = window.setTimeout(() => setNow(Date.now()), 0);
    return () => window.clearTimeout(id);
  }, [preview]);
  // one timer for the next start / end time (if within 6 h); none otherwise
  useEffect(() => {
    if (preview) return;
    const next = messages
      .flatMap((m) => [m.starts_at, m.ends_at])
      .map((d) => (d ? Date.parse(d) : NaN))
      .filter((d) => d > now)
      .sort((a, b) => a - b)[0];
    if (!next || next - now > MAX_TIMER) return;
    const id = window.setTimeout(() => setNow(Date.now()), next - now + 500);
    return () => window.clearTimeout(id);
  }, [messages, preview, now]);

  const live = preview ? messages.filter((m) => m.enabled) : messages.filter((m) => isMessageLive(m, now));
  if (!bar.enabled || live.length === 0 || (!bar.show_desktop && !bar.show_mobile && !preview)) return null;

  return (
    <div
      role="region"
      aria-label="Announcements"
      className={cn(
        // min-w-0 + inline-size containment: the sliding track never widens its parent
        "w-full min-w-0 text-[13px] leading-none [contain:inline-size]",
        !preview && !bar.show_mobile && "hidden md:block",
        !preview && !bar.show_desktop && "md:hidden",
      )}
      style={{ backgroundColor: bar.bg_color, color: bar.text_color }}
    >
      <Marquee bar={bar} messages={live} preview={preview} />
    </div>
  );
}

function Marquee({ bar, messages, preview }: { bar: HeaderBar; messages: HeaderMessage[]; preview: boolean }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLUListElement>(null);
  // first guess from the text length (same on server and browser), measured right after
  const chars = messages.reduce((n, m) => n + messageTexts(m, bar.language).reduce((k, t) => k + t.text.length, 0) + (m.label?.length ?? 0) + 6, 0);
  const [size, setSize] = useState<{ box: number; copy: number }>({ box: 0, copy: chars * 7.5 });

  useIsoLayoutEffect(() => {
    if (!bar.animate) return;
    const box = boxRef.current;
    const copy = copyRef.current;
    if (!box || !copy) return;
    const measure = () => setSize({ box: box.clientWidth, copy: copy.scrollWidth });
    measure();
    // only fires when the bar's width or the text width actually changes (no polling)
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [bar.animate, messages, bar.language]);

  const items = (copy: "a" | "b") => (
    <ul
      ref={copy === "a" ? copyRef : undefined}
      className={cn("flex shrink-0 items-center", bar.animate && "justify-around", copy === "b" && "marquee-copy")}
      style={bar.animate && size.box ? { minWidth: size.box } : undefined}
      aria-hidden={copy === "b" || undefined}
      // the second copy only makes the loop seamless: not read out, not focusable
      {...(copy === "b" ? { inert: true } : {})}
    >
      {messages.map((m) => (
        <li key={m.id} className="flex shrink-0 items-center px-5">
          <MessageItem m={m} bar={bar} preview={preview} />
        </li>
      ))}
    </ul>
  );

  if (!bar.animate) {
    return (
      <div className="container-page no-scrollbar flex h-9 items-center overflow-x-auto">
        <div className="mx-auto flex w-max items-center">{items("a")}</div>
      </div>
    );
  }

  // seconds for one full copy to pass, from the speed in px/s
  const duration = Math.max(4, Math.round((Math.max(size.copy, size.box) / bar.speed) * 10) / 10);
  return (
    <div ref={boxRef} className={cn("marquee no-scrollbar relative flex h-9 items-center overflow-hidden", bar.pause_on_hover && "marquee-pausable")}>
      <div
        className="marquee-track flex w-max items-center"
        style={{ animationDuration: `${duration}s`, animationDirection: bar.direction === "right" ? "reverse" : "normal" }}
      >
        {items("a")}
        {items("b")}
      </div>
    </div>
  );
}

function MessageItem({ m, bar, preview }: { m: HeaderMessage; bar: HeaderBar; preview: boolean }) {
  const Icon = m.icon !== "none" ? ICONS[m.icon] : null;
  const texts = messageTexts(m, bar.language);
  const body = (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: bar.accent_color }} aria-hidden /> : null}
      {m.label ? (
        <span className="rounded px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wide" style={{ backgroundColor: bar.accent_color, color: bar.bg_color }}>
          {m.label}
        </span>
      ) : null}
      {texts.map((t, i) => (
        <span
          key={i}
          lang={t.bn ? "bn" : undefined}
          className={cn(t.bn && "bn", m.style === "bold" && "font-semibold", m.style === "highlight" && "font-bold")}
          style={m.style === "highlight" ? { color: bar.accent_color } : undefined}
        >
          {i > 0 ? <span aria-hidden className="mr-2 opacity-60">·</span> : null}
          {t.text}
        </span>
      ))}
    </span>
  );
  if (!m.link || preview) return body;
  if (m.link.startsWith("/")) {
    return (
      <Link href={m.link} prefetch={false} className="rounded hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
        {body}
      </Link>
    );
  }
  return (
    <a href={m.link} target="_blank" rel="noopener noreferrer" className="rounded hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
      {body}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
