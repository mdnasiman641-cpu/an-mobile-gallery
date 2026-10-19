"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Cookie, X } from "lucide-react";
import { getConsent, getTrackingConfig, initTracking, onTrackingChange, productItem, saveConsent, track, trackPageView } from "@/lib/tracking/client";
import { listId } from "@/components/tracking/track-events";
import type { PublicTrackingConfig } from "@/lib/tracking/routing";
import { OverlayPortal, useModalOverlay } from "@/components/ui/overlay";
import { Button } from "@/components/ui/button";

/** Opens the cookie preferences from anywhere (footer link). */
export const OPEN_CONSENT_EVENT = "amg:open-consent";

const subscribe = (fn: () => void) => onTrackingChange(fn);

/**
 * Storefront tracking: consent banner + preference centre, tag loading,
 * client-navigation page views, and phone / WhatsApp click events.
 * Renders nothing (and loads nothing) when no tracking is configured.
 */
export function TrackingRoot({ config }: { config: PublicTrackingConfig | null }) {
  const pathname = usePathname();
  const consent = useSyncExternalStore(subscribe, getConsent, getConsent);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    initTracking(config);
  }, [config]);

  useEffect(() => {
    trackPageView(pathname);
  }, [pathname]);

  useEffect(() => {
    if (!config) return;
    const open = () => setPrefsOpen(true);
    window.addEventListener(OPEN_CONSENT_EVENT, open);
    // phone and WhatsApp links anywhere on the site (no markup changes needed)
    const onClick = (ev: MouseEvent) => {
      const a = (ev.target as Element | null)?.closest?.("a[href]");
      const href = a?.getAttribute("href") ?? "";
      if (href.startsWith("tel:")) track({ name: "phone_click", method: "phone" });
      else if (/^(https?:\/\/)?(wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com)\b|^whatsapp:/i.test(href)) track({ name: "whatsapp_click", method: "whatsapp" });
      else if (href.startsWith("/products/")) {
        // product card clicked in a tracked list (data set by ProductCard)
        const raw = a?.closest("[data-track-item]")?.getAttribute("data-track-item");
        if (!raw) return;
        try {
          const p = JSON.parse(raw) as { id: string; name: string; price: number; brand: string | null; list: string; index?: number };
          track({ name: "select_item", items: [productItem({ productId: p.id, name: p.name, price: p.price, brand: p.brand, index: p.index })], item_list_name: p.list, item_list_id: listId(p.list) });
        } catch {
          /* ignore malformed data */
        }
      }
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => {
      window.removeEventListener(OPEN_CONSENT_EVENT, open);
      document.removeEventListener("click", onClick, { capture: true });
    };
  }, [config]);

  if (!config) return null;
  const showBanner = consent.ask && !dismissed && !prefsOpen;
  const choose = (analytics: boolean, advertising: boolean) => {
    saveConsent({ analytics, advertising });
    setDismissed(true);
    setPrefsOpen(false);
  };

  return (
    <>
      {showBanner ? (
        <section
          role="region"
          aria-label="Cookie consent"
          className="fixed inset-x-0 bottom-0 z-[70] border-t border-line bg-surface/98 shadow-[0_-8px_30px_rgba(15,23,42,0.12)] backdrop-blur"
        >
          <div className="container-page flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 gap-3">
              <Cookie className="mt-0.5 h-5 w-5 shrink-0 text-signal" aria-hidden />
              <p className="min-w-0 text-sm text-ink-soft">
                We use necessary cookies to run the shop (cart, sign-in).{" "}
                {config.consent.analytics && config.consent.advertising
                  ? "With your permission we also use analytics cookies to understand visits and advertising cookies to measure our ads."
                  : config.consent.analytics
                    ? "With your permission we also use analytics cookies to understand visits."
                    : "With your permission we also use advertising cookies to measure our ads."}{" "}
                <Link href="/pages/privacy-policy" className="font-semibold text-ink underline">
                  Privacy &amp; cookies
                </Link>
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setPrefsOpen(true)}>
                Manage preferences
              </Button>
              <Button size="sm" variant="outline" onClick={() => choose(false, false)}>
                Reject optional
              </Button>
              <Button size="sm" onClick={() => choose(true, true)}>
                Accept all
              </Button>
            </div>
          </div>
        </section>
      ) : null}
      {prefsOpen ? <ConsentPreferences config={config} current={consent} onSave={choose} onClose={() => setPrefsOpen(false)} /> : null}
    </>
  );
}

function ConsentPreferences({
  config,
  current,
  onSave,
  onClose,
}: {
  config: PublicTrackingConfig;
  current: { analytics: boolean; advertising: boolean };
  onSave: (analytics: boolean, advertising: boolean) => void;
  onClose: () => void;
}) {
  const [analytics, setAnalytics] = useState(current.analytics);
  const [advertising, setAdvertising] = useState(current.advertising);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useModalOverlay(true, onClose, dialogRef, { initialFocus: closeRef, closeAtMinWidth: 100_000 });

  const row = (id: string, title: string, text: string, checked: boolean, onChange: ((v: boolean) => void) | null) => (
    <li className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="font-semibold">
          {title}
        </label>
        <p className="text-sm text-ink-soft">{text}</p>
      </div>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="mt-1 h-5 w-5 shrink-0 accent-[var(--color-signal)]"
        checked={checked}
        disabled={!onChange}
        onChange={(e) => onChange?.(e.target.checked)}
      />
    </li>
  );

  return (
    <OverlayPortal>
      <div className="fixed inset-0 z-[80] flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="consent-title"
          tabIndex={-1}
          className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl sm:p-6"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3">
            <h2 id="consent-title" className="text-lg font-bold">
              Cookie preferences
            </h2>
            <button ref={closeRef} type="button" className="-m-2 rounded p-2 hover:bg-paper" onClick={onClose} aria-label="Close">
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>
          <p className="mt-1 text-sm text-ink-soft">Choose which optional cookies we may use. You can change this any time from “Cookie settings” at the bottom of every page.</p>
          <ul className="mt-3 divide-y divide-line">
            {row("consent-necessary", "Necessary", "Cart, checkout, sign-in and remembering this choice. Always on.", true, null)}
            {config.consent.analytics
              ? row("consent-analytics", "Analytics", "Google Analytics / Tag Manager: which pages are visited and how the shop is used.", analytics, setAnalytics)
              : null}
            {config.consent.advertising
              ? row("consent-advertising", "Advertising", "Meta (Facebook) Pixel and Google Ads: measuring which ads lead to visits and orders.", advertising, setAdvertising)
              : null}
          </ul>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => onSave(false, false)}>
              Reject optional
            </Button>
            <Button size="sm" variant="outline" onClick={() => onSave(analytics, advertising)}>
              Save preferences
            </Button>
            <Button size="sm" onClick={() => onSave(true, true)}>
              Accept all
            </Button>
          </div>
        </div>
      </div>
    </OverlayPortal>
  );
}

/** "Cookie settings" link for the footer. Hidden when no optional tracking is configured. */
export function CookieSettingsButton({ className }: { className?: string }) {
  const configured = useSyncExternalStore(subscribe, () => getTrackingConfig() !== null, () => false);
  if (!configured) return null;
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new Event(OPEN_CONSENT_EVENT))}>
      Cookie settings
    </button>
  );
}

/** Footer list item with the "Cookie settings" button (nothing when no tracking is configured). */
export function CookieSettingsItem({ className }: { className?: string }) {
  const configured = useSyncExternalStore(subscribe, () => getTrackingConfig() !== null, () => false);
  if (!configured) return null;
  return (
    <li>
      <CookieSettingsButton className={className} />
    </li>
  );
}
