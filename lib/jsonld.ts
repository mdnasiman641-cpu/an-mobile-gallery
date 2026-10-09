import type { ProductDetail, Review, SeoSettings, SiteSettings } from "@/types";
import { absoluteImageUrl, absoluteUrl } from "@/lib/seo";
import { effectivePrice, getAvailability, toPlainText, variantLabel } from "@/lib/utils";

type JsonLd = Record<string, unknown>;

const CONDITION: Record<string, string> = {
  new: "https://schema.org/NewCondition",
  used: "https://schema.org/UsedCondition",
  refurbished: "https://schema.org/RefurbishedCondition",
};

function availabilityUrl(stock: number, threshold: number, status?: string): string {
  const a = getAvailability(stock, threshold, status as never);
  if (a === "out_of_stock") return "https://schema.org/OutOfStock";
  if (a === "low_stock") return "https://schema.org/LimitedAvailability";
  return "https://schema.org/InStock";
}

/** Valid GTIN lengths are 8, 12, 13 or 14 digits; anything else is omitted. */
function gtinField(barcode: string | null): JsonLd {
  const digits = barcode?.replace(/\D/g, "") ?? "";
  if ([8, 12, 13, 14].includes(digits.length) && digits === barcode?.trim()) {
    return { [`gtin${digits.length}`]: digits };
  }
  return {};
}

function money(n: number): string {
  return Number(n).toFixed(2);
}

/**
 * Delivery charge for Bangladesh, from the store settings. One shipping rate
 * applies to the whole country in schema.org terms, so the HIGHER of the two
 * zone charges is used (the price never looks lower than what a customer
 * outside Dhaka pays). Delivery times are not stated: the store has no
 * setting for them, and invented values must not be published.
 */
function shippingDetails(settings: SiteSettings | null): JsonLd | undefined {
  if (!settings) return undefined;
  const rate = Math.max(Number(settings.delivery_charge_inside_dhaka) || 0, Number(settings.delivery_charge_outside_dhaka) || 0);
  return {
    "@type": "OfferShippingDetails",
    shippingRate: {
      "@type": "MonetaryAmount",
      value: money(rate),
      currency: settings.currency || "BDT",
    },
    shippingDestination: { "@type": "DefinedRegion", addressCountry: "BD" },
  };
}

function returnPolicy(settings: SiteSettings | null): JsonLd | undefined {
  if (!settings || !settings.return_days) return undefined;
  return {
    "@type": "MerchantReturnPolicy",
    applicableCountry: "BD",
    returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
    merchantReturnDays: settings.return_days,
  };
}

function buildOffer(args: {
  url: string;
  price: number;
  salePrice: number | null;
  stock: number;
  threshold: number;
  status?: string;
  condition: string;
  currency: string;
  sellerName: string;
  sku?: string | null;
  name?: string;
  settings: SiteSettings | null;
}): JsonLd {
  const finalPrice = effectivePrice(args.price, args.salePrice);
  const offer: JsonLd = {
    "@type": "Offer",
    url: args.url,
    priceCurrency: args.currency,
    price: money(finalPrice),
    availability: availabilityUrl(args.stock, args.threshold, args.status),
    itemCondition: CONDITION[args.condition] ?? CONDITION.new,
    seller: { "@type": "Organization", name: args.sellerName },
  };
  if (args.name) offer.name = args.name;
  if (args.sku) offer.sku = args.sku;
  if (finalPrice < Number(args.price)) {
    // Sale price + original price, the form Google uses for strikethrough pricing.
    offer.priceSpecification = [
      { "@type": "UnitPriceSpecification", price: money(finalPrice), priceCurrency: args.currency },
      {
        "@type": "UnitPriceSpecification",
        priceType: "https://schema.org/StrikethroughPrice",
        price: money(args.price),
        priceCurrency: args.currency,
      },
    ];
  }
  const shipping = shippingDetails(args.settings);
  if (shipping) offer.shippingDetails = shipping;
  const returns = returnPolicy(args.settings);
  if (returns) offer.hasMerchantReturnPolicy = returns;
  return offer;
}

/**
 * schema.org Product built only from real database fields.
 * Ratings/reviews are included only when approved reviews exist.
 */
export function productJsonLd(
  product: ProductDetail,
  opts: { settings: SiteSettings | null; storeName: string; reviews: Review[]; url: string },
): JsonLd {
  const currency = opts.settings?.currency || "BDT";
  const activeVariants = product.variants.filter((v) => v.status === "active");

  const data: JsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${opts.url}#product`,
    name: product.name,
    url: opts.url,
    description: toPlainText(product.short_description || product.description, 5000) || product.name,
    ...(product.images.length ? { image: product.images.map((i) => absoluteImageUrl(i.url)).filter(Boolean) } : {}),
    itemCondition: CONDITION[product.condition],
    ...(product.sku ? { sku: product.sku } : {}),
    ...(product.mpn ? { mpn: product.mpn } : {}),
    ...(product.model ? { model: product.model } : {}),
    ...gtinField(product.barcode),
    ...(product.brand ? { brand: { "@type": "Brand", name: product.brand.name } } : {}),
    ...(product.category ? { category: product.category.name } : {}),
  };

  if (activeVariants.length > 0) {
    data.offers = activeVariants.map((v) =>
      buildOffer({
        url: `${opts.url}?variant=${v.id}`,
        price: v.price,
        salePrice: v.sale_price,
        stock: v.stock,
        threshold: product.low_stock_threshold,
        status: product.status,
        condition: product.condition,
        currency,
        sellerName: opts.storeName,
        sku: v.sku,
        name: `${product.name} ${variantLabel(v)}`.trim(),
        settings: opts.settings,
      }),
    );
  } else {
    data.offers = buildOffer({
      url: opts.url,
      price: product.price,
      salePrice: product.sale_price,
      stock: product.stock_quantity,
      threshold: product.low_stock_threshold,
      status: product.status,
      condition: product.condition,
      currency,
      sellerName: opts.storeName,
      sku: product.sku,
      settings: opts.settings,
    });
  }

  if (product.rating_count > 0 && opts.reviews.length > 0) {
    data.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: Number(product.rating_avg).toFixed(1),
      reviewCount: product.rating_count,
      bestRating: 5,
      worstRating: 1,
    };
    data.review = opts.reviews.slice(0, 5).map((r) => ({
      "@type": "Review",
      author: { "@type": "Person", name: r.customer_name },
      datePublished: r.created_at.slice(0, 10),
      reviewBody: r.body,
      ...(r.title ? { name: r.title } : {}),
      reviewRating: { "@type": "Rating", ratingValue: r.rating, bestRating: 5, worstRating: 1 },
    }));
  }

  return data;
}

export function breadcrumbJsonLd(items: { name: string; path: string }[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export function organizationJsonLd(settings: SiteSettings | null, seo: SeoSettings | null): JsonLd {
  const name = seo?.organization_name || settings?.store_name || "AN MOBILE GALLERY";
  const sameAs = [settings?.facebook_url, settings?.instagram_url, settings?.youtube_url, settings?.tiktok_url].filter(
    Boolean,
  );
  const logo = absoluteImageUrl(seo?.organization_logo || settings?.logo_url);
  return {
    "@context": "https://schema.org",
    "@type": "Store",
    "@id": `${absoluteUrl("/")}#organization`,
    name,
    ...(seo?.organization_legal_name ? { legalName: seo.organization_legal_name } : {}),
    url: absoluteUrl("/"),
    ...(logo ? { logo, image: logo } : {}),
    ...(settings?.phone && !settings.phone.includes("X") ? { telephone: settings.phone } : {}),
    ...(settings?.email ? { email: settings.email } : {}),
    ...(seo?.organization_founding_year ? { foundingDate: String(seo.organization_founding_year) } : {}),
    ...(settings?.address && !settings.address.startsWith("Update")
      ? { address: { "@type": "PostalAddress", streetAddress: settings.address, addressCountry: "BD" } }
      : {}),
    currenciesAccepted: settings?.currency || "BDT",
    paymentAccepted: "Cash",
    ...(sameAs.length ? { sameAs } : {}),
  };
}

export function websiteJsonLd(name: string): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name,
    url: absoluteUrl("/"),
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${absoluteUrl("/search")}?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };
}

/** Safe serialisation for <script type="application/ld+json">. */
export function serializeJsonLd(data: JsonLd | JsonLd[]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}
