"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Clock, ExternalLink, MapPin, MessageCircle, Phone } from "lucide-react";
import type { HeaderOutlet } from "@/lib/header-config";
import { cn, whatsappLink } from "@/lib/utils";

/**
 * "Locations" in the main navigation bar: the shop's active outlets
 * (Admin → Settings → Locations / Outlets). Click an outlet to see its
 * address, hours, phone, WhatsApp and map. All on this website.
 */
export function LocationsMenu({ outlets, className }: { outlets: HeaderOutlet[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(outlets.length === 1 ? outlets[0].id : null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  // listeners only while the panel is open
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (outlets.length === 0) return null;

  return (
    <div ref={rootRef} className={cn("relative shrink-0", className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-12 items-center gap-1.5 whitespace-nowrap px-3 text-[14px] font-semibold text-white/95 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white"
      >
        <MapPin className="h-4 w-4" aria-hidden />
        Locations
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <div
          id={panelId}
          role="region"
          aria-label="Our outlets"
          className="absolute right-0 top-full z-50 max-h-[70vh] w-[min(calc(100vw-2rem),360px)] overflow-y-auto rounded-[var(--radius-card)] border border-line bg-surface p-1.5 text-ink shadow-[var(--shadow-soft)]"
        >
          <ul>
            {outlets.map((o) => {
              const isOpen = expanded === o.id;
              const wa = whatsappLink(o.whatsapp);
              return (
                <li key={o.id} className="rounded-lg">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setExpanded(isOpen ? null : o.id)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left font-semibold hover:bg-paper"
                  >
                    <span className="min-w-0 [overflow-wrap:anywhere]">{o.name}</span>
                    <ChevronDown className={cn("h-4 w-4 shrink-0 text-ink-mute transition-transform", isOpen && "rotate-180")} aria-hidden />
                  </button>
                  {isOpen ? (
                    <div className="space-y-2 px-3 pb-3 text-sm text-ink-soft">
                      {o.address ? (
                        <p className="flex gap-2">
                          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-signal" aria-hidden />
                          <span className="[overflow-wrap:anywhere]">{o.address}</span>
                        </p>
                      ) : null}
                      {o.hours ? (
                        <p className="flex gap-2">
                          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-signal" aria-hidden />
                          <span>{o.hours}</span>
                        </p>
                      ) : null}
                      <div className="flex flex-wrap gap-2 pt-1">
                        {o.phone ? (
                          <a href={`tel:${o.phone.replace(/[\s-]/g, "")}`} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 font-semibold text-ink hover:border-signal">
                            <Phone className="h-3.5 w-3.5" aria-hidden />
                            {o.phone}
                          </a>
                        ) : null}
                        {wa ? (
                          <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 font-semibold text-ink hover:border-signal">
                            <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                            WhatsApp
                            <span className="sr-only"> (opens in a new tab)</span>
                          </a>
                        ) : null}
                        {o.map_url ? (
                          <a href={o.map_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-signal px-3 py-1.5 font-semibold text-white hover:bg-signal-dark">
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                            Google Maps
                            <span className="sr-only"> (opens in a new tab)</span>
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
