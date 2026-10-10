import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth";
import { getSiteUrl } from "@/lib/env";
import { readPathaoSettings } from "@/lib/couriers/config";
import { AdminPageHeader } from "@/components/admin/page-header";
import { CourierSettingsForm } from "@/components/admin/courier-settings";

export const metadata: Metadata = { title: "Courier settings" };

export default async function CourierSettingsPage() {
  await requireStaff("admin");
  // Only non-secret fields reach the browser (the view never includes the secret or token).
  const { view } = await readPathaoSettings();
  return (
    <>
      <AdminPageHeader
        title="Courier settings"
        description="Pathao merchant API. Shipments can always be recorded by hand on each order, with or without this."
        back={{ href: "/admin/settings", label: "Settings" }}
      />
      {view.migrationMissing ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface p-5 text-ink-soft">
          Courier settings need database migration 0014 (supabase/migrations/20261010000014_shipments_tracking.sql). Run it in the Supabase SQL editor first.
        </p>
      ) : (
        <CourierSettingsForm initial={view} webhookUrl={`${getSiteUrl()}/api/integrations/pathao/webhook`} />
      )}
    </>
  );
}
