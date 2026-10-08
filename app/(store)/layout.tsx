import { StoreProvider } from "@/components/providers";
import { StoreHeader } from "@/components/store/header";
import { StoreFooter } from "@/components/store/footer";
import { JsonLd } from "@/components/seo/json-ld";
import { organizationJsonLd, websiteJsonLd } from "@/lib/jsonld";
import { getSeoSettings, getSiteSettings } from "@/services/settings";

export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const [settings, seo] = await Promise.all([getSiteSettings(), getSeoSettings()]);
  return (
    <StoreProvider>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-lg focus:bg-ink focus:px-4 focus:py-2 focus:text-white"
      >
        Skip to content
      </a>
      <StoreHeader />
      <main id="main" className="min-h-[60vh]">
        {children}
      </main>
      <StoreFooter />
      <JsonLd data={[organizationJsonLd(settings, seo), websiteJsonLd(settings.store_name)]} />
    </StoreProvider>
  );
}
