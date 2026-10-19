import type { Metadata } from "next";
import { after } from "next/server";
import { requireStaff } from "@/lib/auth";
import { getSiteUrl } from "@/lib/env";
import { readTrackingAdmin } from "@/lib/tracking/server/admin";
import { deliverOutbox } from "@/lib/tracking/server/delivery";
import { AdminPageHeader } from "@/components/admin/page-header";
import { TrackingCenter } from "@/components/admin/tracking-center";

export const metadata: Metadata = { title: "Analytics & Tracking" };

export default async function TrackingSettingsPage() {
  await requireStaff("admin");
  const data = await readTrackingAdmin();
  // events waiting for a retry are sent after this page has been delivered
  if (!data.migrationMissing) after(() => deliverOutbox({ limit: 5 }).then(() => undefined));
  return (
    <>
      <AdminPageHeader
        title="Analytics & Tracking"
        description="Google Tag Manager, Google Analytics 4, Meta Pixel & Conversions API, Google Ads, cookie consent and server-side event delivery."
        back={{ href: "/admin/settings", label: "Settings" }}
      />
      {data.migrationMissing ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface p-5 text-ink-soft">
          Analytics &amp; tracking need database migration 0015 (supabase/migrations/20261019000015_tracking.sql). Run it in the Supabase SQL editor first. Until then no tracking tag loads
          and no cookie banner is shown.
        </p>
      ) : (
        <TrackingCenter data={data} siteUrl={getSiteUrl()} />
      )}
    </>
  );
}
