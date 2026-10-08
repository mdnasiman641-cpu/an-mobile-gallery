import type { NextConfig } from "next";

// Allow next/image to optimise files served from this project's Supabase Storage.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseHost = supabaseUrl ? new URL(supabaseUrl).hostname : undefined;

// Listing pages (/products, /offers, /brands/x, /categories/x) are cached
// when opened without parameters. Any of these query keys sends the request
// to the per-request version under /browse/... while the visitor still sees
// the public URL. Unknown parameters (e.g. utm_source) keep the cached page.
const LISTING_QUERY_KEYS = ["page", "sort", "brand", "category", "ram", "storage", "condition", "stock", "min", "max", "flag", "q"];
const LISTING_ROUTES: [string, string][] = [
  ["/products", "/browse/products"],
  ["/offers", "/browse/offers"],
  ["/brands/:slug", "/browse/brands/:slug"],
  ["/categories/:slug", "/browse/categories/:slug"],
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // NEXT_OUTPUT=standalone produces a self-contained Node server for any host
  // (VPS, Docker, Render, Railway...). Vercel ignores this and needs nothing.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  images: {
    // On Cloudflare Workers, /_next/image is served by OpenNext through the
    // IMAGES binding (wrangler.jsonc); remotePatterns below still restricts
    // which hosts may be resized (only this project's Supabase Storage).
    // NEXT_PUBLIC_SUPABASE_URL must therefore be set at BUILD time.
    // Uploads are already compressed to WebP in the browser. Set
    // NEXT_IMAGE_UNOPTIMIZED=true to skip server-side transformation entirely
    // (zero optimisation cost; useful on free hosting tiers and Cloudflare).
    unoptimized: process.env.NEXT_IMAGE_UNOPTIMIZED === "true",
    // NEXT_IMAGE_LOADER=cloudflare -> resize through Cloudflare (/cdn-cgi/image).
    ...(process.env.NEXT_IMAGE_LOADER === "cloudflare"
      ? { loader: "custom" as const, loaderFile: "./lib/image-loader.ts" }
      : {}),
    formats: ["image/webp"],
    // Fewer widths = fewer transformations to generate and cache.
    deviceSizes: [384, 640, 828, 1080, 1440],
    imageSizes: [64, 128, 256],
    // Image URLs are immutable (unique file names), so cache optimised copies long.
    minimumCacheTTL: 60 * 60 * 24 * 31,
    remotePatterns: supabaseHost
      ? [
          {
            protocol: "https",
            hostname: supabaseHost,
            pathname: "/storage/v1/object/public/**",
          },
        ]
      : [],
  },
  async rewrites() {
    return {
      beforeFiles: LISTING_ROUTES.flatMap(([source, destination]) =>
        LISTING_QUERY_KEYS.map((key) => ({ source, destination, has: [{ type: "query" as const, key }] })),
      ),
      afterFiles: [],
      fallback: [],
    };
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        source: "/demo/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }],
      },
      {
        // Admin pages must never be indexed or cached by shared caches.
        source: "/admin/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
