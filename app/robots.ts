import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Private areas only. Product, brand and category pages stay crawlable.
        // /browse is the internal target of filtered listings (never linked).
        disallow: ["/admin", "/private", "/api/private", "/account", "/checkout", "/cart", "/search", "/browse"],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
