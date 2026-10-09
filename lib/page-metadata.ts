import "server-only";
import type { Metadata } from "next";
import { getSeoSettings, getSiteSettings } from "@/services/settings";
import { absoluteImageUrl } from "@/lib/seo";

/**
 * Next.js merges metadata shallowly: a page's `openGraph` / `twitter` object
 * replaces the root layout's, which dropped og:site_name, twitter:site and
 * the default share image on every public page. This fills them back in from
 * the store's settings (cached, no extra database work per request).
 */
export async function withSiteDefaults(meta: Metadata): Promise<Metadata> {
  const [seo, site] = await Promise.all([getSeoSettings(), getSiteSettings()]);
  const siteName = site.store_name || seo.site_title || undefined;
  const defaultImage = absoluteImageUrl(seo.default_og_image);
  const og = (meta.openGraph ?? {}) as NonNullable<Metadata["openGraph"]> & { images?: unknown };
  const tw = (meta.twitter ?? {}) as NonNullable<Metadata["twitter"]> & { images?: unknown; card?: string };
  const hasOgImage = Array.isArray(og.images) ? og.images.length > 0 : Boolean(og.images);
  const hasTwImage = Array.isArray(tw.images) ? tw.images.length > 0 : Boolean(tw.images);
  return {
    ...meta,
    openGraph: {
      ...og,
      siteName: og.siteName ?? siteName,
      ...(hasOgImage || !defaultImage ? {} : { images: [{ url: defaultImage }] }),
    } as Metadata["openGraph"],
    twitter: {
      ...tw,
      site: tw.site ?? (seo.twitter_handle || undefined),
      ...(hasTwImage || !defaultImage ? {} : { images: [defaultImage], card: "summary_large_image" }),
    } as Metadata["twitter"],
  };
}
