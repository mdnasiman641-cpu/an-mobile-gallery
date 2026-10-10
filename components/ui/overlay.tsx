"use client";

import { useEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";

/**
 * Shared behaviour for full-screen drawers and sheets (mobile menu, filters).
 *
 * Why a portal: the store header is sticky with backdrop-filter, and an element
 * with backdrop-filter (like transform or filter) becomes the containing block
 * for position:fixed children. A drawer rendered inside the header was therefore
 * sized to the header box instead of the screen, and the category bar below the
 * header stayed visible. Rendering into <body> makes "fixed inset-0" mean the
 * viewport again, and its z-index is compared with the header's, not nested in it.
 */
export function OverlayPortal({ children }: { children: React.ReactNode }) {
  // only rendered after a user action, so document always exists here
  return typeof document === "undefined" ? null : createPortal(children, document.body);
}

// ---- scroll lock that also works on iPhone Safari --------------------------
// body{overflow:hidden} alone does not stop touch scrolling on older iOS, so the
// body is pinned with position:fixed at the current offset and restored after.
let locks = 0;
let saved: { y: number; style: string | null } | null = null;

function lockScroll() {
  if (locks++ > 0) return;
  const body = document.body;
  const y = window.scrollY;
  saved = { y, style: body.getAttribute("style") };
  const scrollbar = window.innerWidth - document.documentElement.clientWidth;
  body.style.position = "fixed";
  body.style.top = `-${y}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
  body.style.overflow = "hidden";
  if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
}

function unlockScroll() {
  if (--locks > 0 || !saved) return;
  const body = document.body;
  if (saved.style === null) body.removeAttribute("style");
  else body.setAttribute("style", saved.style);
  window.scrollTo({ top: saved.y, left: 0, behavior: "instant" });
  saved = null;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * While `open`: page scroll is locked, Escape closes, Tab stays inside the
 * dialog, focus starts on `initialFocus` and returns to the opener on close,
 * and the overlay closes itself when the screen reaches `closeAtMinWidth`
 * (where the desktop layout takes over).
 */
export function useModalOverlay(
  open: boolean,
  close: () => void,
  dialogRef: RefObject<HTMLElement | null>,
  { initialFocus, closeAtMinWidth = 1024 }: { initialFocus?: RefObject<HTMLElement | null>; closeAtMinWidth?: number } = {},
) {
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    lockScroll();
    (initialFocus?.current ?? dialogRef.current)?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);

    const wide = window.matchMedia(`(min-width: ${closeAtMinWidth}px)`);
    const onWide = () => wide.matches && closeRef.current();
    wide.addEventListener("change", onWide);

    return () => {
      document.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", onWide);
      unlockScroll();
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [open, dialogRef, initialFocus, closeAtMinWidth]);
}
