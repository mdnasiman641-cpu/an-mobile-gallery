import type { Metadata, Viewport } from "next";
import { Hind_Siliguri, Onest } from "next/font/google";
import "@/styles/globals.css";
import { AppToaster } from "@/components/providers";
import { getSeoSettings, getSiteSettings } from "@/services/settings";
import { getSiteUrl } from "@/lib/env";
import { absoluteImageUrl } from "@/lib/seo";

const onest = Onest({ subsets: ["latin"], variable: "--font-onest", display: "swap" });
const hind = Hind_Siliguri({
  subsets: ["bengali", "latin"],
  weight: ["400", "500", "600"],
  variable: "--font-hind",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const [seo, site] = await Promise.all([getSeoSettings(), getSiteSettings()]);
  const storeName = site.store_name || seo.site_title;
  const verification = seo.google_site_verification || process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || undefined;
  const ogImage = absoluteImageUrl(seo.default_og_image);

  return {
    metadataBase: new URL(getSiteUrl()),
    title: { default: seo.site_title, template: `%s | ${storeName}` },
    description: seo.site_description,
    keywords: seo.default_keywords || undefined,
    applicationName: storeName,
    openGraph: {
      siteName: storeName,
      type: "website",
      locale: "en_BD",
      images: ogImage ? [{ url: ogImage }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      site: seo.twitter_handle || undefined,
    },
    verification: verification ? { google: verification } : undefined,
    other: seo.facebook_domain_verification
      ? { "facebook-domain-verification": seo.facebook_domain_verification }
      : undefined,
    formatDetection: { telephone: false },
  };
}

export const viewport: Viewport = {
  themeColor: "#0e7c66",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${onest.variable} ${hind.variable}`}>
      <body className="min-h-dvh antialiased">
        {children}
        <AppToaster />
      </body>
    </html>
  );
}
