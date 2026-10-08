/**
 * Storefront wording stated by the shop owner (not stored in the database).
 *
 * Store name, phone, WhatsApp, address, opening hours and social links come
 * from Admin → Settings. Everything here is fixed marketing copy; edit it
 * here if the shop's services or EMI terms change.
 */

/** Shown under the logo and in the footer. */
export const STORE_SERVICES = "Buy | Sell | Exchange | Installment";

/** Short location label used when no full address is set in Admin → Settings. */
export const STORE_AREA = "Kapasia, Gazipur";

/** Highlights in the slim bar above the header (desktop). */
export const TOP_BAR_HIGHLIGHTS = [
  "100% Genuine Products",
  "Easy EMI Installment",
  "Buy | Sell | Exchange",
  "Trusted Shop in Kapasia",
] as const;

export const EXCHANGE_PROMO = {
  titleBn: "পুরাতন ফোন দিয়ে নতুন ফোন নিন",
  subtitle: "Buy | Sell | Exchange",
  text: "Bring your old phone to the shop and put its value towards a new one.",
  cta: "Exchange now",
  whatsappMessage: "Hello, I want to exchange my old phone for a new one.",
  /** Admin → Pages: publish a page with one of these slugs and the button links to it. */
  pageSlugs: ["exchange", "buy-sell-exchange", "phone-exchange"],
} as const;

export const EMI_PROMO = {
  title: "Easy EMI Installment",
  months: "3, 6, 9, 12 months",
  points: ["Low down payment", "No hidden charge", "Quick approval"],
  cta: "View EMI plans",
  /** Used when no EMI page is published. */
  fallbackCta: "Ask about EMI plans",
  whatsappMessage: "Hello, I want to know about EMI / installment plans.",
  pageSlugs: ["emi", "emi-installment", "installment", "emi-plans"],
} as const;
