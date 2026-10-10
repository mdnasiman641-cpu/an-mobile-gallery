import type { Metadata } from "next";
import { Suspense } from "react";
import { Breadcrumbs } from "@/components/ui/misc";
import { TrackOrderForm } from "@/components/store/track-order-form";
import { buildMetadata } from "@/lib/seo";
import { withSiteDefaults } from "@/lib/page-metadata";
import { getSiteSettings } from "@/services/settings";

// Static shell: the lookup runs in a Server Action, so this page costs nothing to serve.
export const revalidate = 86400;

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSiteSettings();
  return withSiteDefaults(
    buildMetadata({
      title: "Track your order",
      description: `Check the status and courier tracking of your ${s.store_name} order with your order number and mobile number.`,
      path: "/track",
    }),
  );
}

export default async function TrackPage() {
  const s = await getSiteSettings();
  return (
    <div className="container-page py-5 lg:py-8">
      <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Track order" }]} />
      <h1 className="mt-3 text-2xl font-bold md:text-3xl">
        Track your order <span className="bn ml-1 text-xl font-medium text-ink-soft">অর্ডার ট্র্যাক করুন</span>
      </h1>
      <p className="mt-1 max-w-2xl text-ink-soft">Enter the order number from your confirmation and the mobile number you ordered with.</p>
      <Suspense fallback={<div className="mt-6 h-64 max-w-2xl rounded-[var(--radius-card)] border border-line bg-surface" aria-hidden />}>
        <TrackOrderForm phone={s.phone ?? null} />
      </Suspense>
    </div>
  );
}
