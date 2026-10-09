import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Product, brand and category pages stay crawlable. Account, checkout,
        // cart and search pages are NOT blocked here on purpose: they carry a
        // noindex tag, which search engines can only see if they may crawl the
        // page (a blocked URL can still be indexed from links). Access control
        // never relies on robots.txt. /browse is the internal target of
        // filtered listings (never linked).
        disallow: ["/admin", "/private", "/api/private", "/browse"],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
