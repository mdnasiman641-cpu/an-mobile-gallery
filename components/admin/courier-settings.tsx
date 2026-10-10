"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveCourierSettingsAction, setWebhookSecretAction, testPathaoAction } from "@/app/admin/(panel)/settings/courier/actions";
import { toastResult } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { Badge } from "@/components/ui/misc";
import type { PathaoSettingsView } from "@/lib/couriers/config";

type Store = { id: number; name: string; address: string | null; active: boolean };

const card = "rounded-[var(--radius-card)] border border-line bg-surface p-5";

export function CourierSettingsForm({ initial, webhookUrl }: { initial: PathaoSettingsView; webhookUrl: string }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial.isEnabled);
  const [environment, setEnvironment] = useState(initial.environment);
  const [clientId, setClientId] = useState(initial.clientId);
  const [clientSecret, setClientSecret] = useState("");
  const [storeId, setStoreId] = useState(initial.storeId ? String(initial.storeId) : "");
  const [deliveryType, setDeliveryType] = useState<12 | 24 | 48>(initial.defaultDeliveryType);
  const [itemType, setItemType] = useState<1 | 2 | 3>(initial.defaultItemType);
  const [weight, setWeight] = useState(String(initial.defaultWeight));
  const [stores, setStores] = useState<Store[] | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);
  const [customSecret, setCustomSecret] = useState("");
  const [saving, startSave] = useTransition();
  const [testing, startTest] = useTransition();
  const [settingSecret, startSecret] = useTransition();

  function save() {
    startSave(async () => {
      const res = await saveCourierSettingsAction({
        is_enabled: enabled,
        environment,
        client_id: clientId,
        client_secret: clientSecret || undefined,
        store_id: storeId,
        default_delivery_type: deliveryType,
        default_item_type: itemType,
        default_weight: weight,
      });
      if (toastResult(res)) {
        setClientSecret("");
        router.refresh();
      }
    });
  }

  function test() {
    setTestResult(null);
    startTest(async () => {
      const res = await testPathaoAction({ environment, client_id: clientId, client_secret: clientSecret || undefined });
      setTestResult({ ok: res.ok, message: res.message ?? (res.ok ? "Connected" : "Connection failed") });
      if (res.ok && res.data) {
        setStores(res.data.stores);
        if (!storeId && res.data.stores.length === 1) setStoreId(String(res.data.stores[0].id));
      }
    });
  }

  function makeSecret() {
    if (initial.hasWebhookSecret && !window.confirm("Replace the webhook secret? Pathao updates stop being accepted until you enter the new secret in the Pathao panel.")) return;
    startSecret(async () => {
      const res = await setWebhookSecretAction({ secret: customSecret || undefined });
      if (toastResult(res) && res.data) {
        setWebhookSecret(res.data.secret);
        setCustomSecret("");
        router.refresh();
      }
    });
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Couldn't copy. Select the text and copy it.");
    }
  }

  return (
    <div className="grid max-w-3xl gap-6">
      <section className={card} aria-labelledby="pa-h">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="pa-h" className="font-bold">
            Pathao merchant API
          </h2>
          <Badge tone={initial.isEnabled ? "signal" : "neutral"}>{initial.isEnabled ? "On" : "Off"}</Badge>
        </div>
        <p className="mt-1 text-sm text-ink-soft">
          From merchant.pathao.com → Developer API: the client ID and client secret. The secret is encrypted on the server and never shown again.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Environment" htmlFor="cs-env">
            <Select id="cs-env" value={environment} onChange={(e) => setEnvironment(e.target.value as "live" | "sandbox")}>
              <option value="live">Live (real parcels)</option>
              <option value="sandbox">Sandbox (test account)</option>
            </Select>
          </Field>
          <Field label="Client ID" htmlFor="cs-id">
            <Input id="cs-id" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" spellCheck={false} maxLength={200} />
          </Field>
          <Field label="Client secret" htmlFor="cs-secret" hint={initial.secretHint ? `Saved (${initial.secretHint}). Leave empty to keep it.` : "Not saved yet"} className="sm:col-span-2">
            <Input
              id="cs-secret"
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              autoComplete="new-password"
              spellCheck={false}
              maxLength={500}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button variant="outline" size="sm" onClick={test} loading={testing} disabled={!clientId || (!clientSecret && !initial.secretHint)}>
              Test connection
            </Button>
            {testResult ? (
              <p className={`text-sm ${testResult.ok ? "text-signal" : "text-deal"}`} role="status">
                {testResult.message}
              </p>
            ) : null}
          </div>
          <Field label="Pickup store" htmlFor="cs-store" hint={stores ? undefined : "Test the connection to load your Pathao stores"} className="sm:col-span-2">
            {stores && stores.length > 0 ? (
              <Select id="cs-store" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                <option value="">Choose…</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id} disabled={!s.active}>
                    {s.name}
                    {s.address ? ` — ${s.address}` : ""}
                    {s.active ? "" : " (inactive)"}
                  </option>
                ))}
              </Select>
            ) : (
              <Input id="cs-store" inputMode="numeric" value={storeId} onChange={(e) => setStoreId(e.target.value.replace(/\D/g, ""))} placeholder="Store ID" />
            )}
          </Field>
          <Field label="Default delivery type" htmlFor="cs-dt">
            <Select id="cs-dt" value={deliveryType} onChange={(e) => setDeliveryType(Number(e.target.value) as 12 | 24 | 48)}>
              <option value={48}>Normal</option>
              <option value={24}>Express</option>
              <option value={12}>On demand</option>
            </Select>
          </Field>
          <Field label="Default item type" htmlFor="cs-it">
            <Select id="cs-it" value={itemType} onChange={(e) => setItemType(Number(e.target.value) as 1 | 2 | 3)}>
              <option value={2}>Parcel</option>
              <option value={3}>Fragile</option>
              <option value={1}>Document</option>
            </Select>
          </Field>
          <Field label="Default weight (kg)" htmlFor="cs-w">
            <Input id="cs-w" type="number" inputMode="decimal" min={0.1} max={50} step={0.1} value={weight} onChange={(e) => setWeight(e.target.value)} />
          </Field>
          <div className="flex items-end sm:col-span-2">
            <Checkbox
              label="Turn on Pathao parcel creation"
              description="Adds “Create with Pathao” to orders. Recording shipments by hand always works."
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
          </div>
        </div>
        <div className="mt-5">
          <Button onClick={save} loading={saving}>
            Save courier settings
          </Button>
        </div>
      </section>

      <section className={card} aria-labelledby="wh-h">
        <h2 id="wh-h" className="font-bold">
          Status updates from Pathao (webhook)
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          In the Pathao merchant panel → Developer API → Webhook, add this callback URL and the same secret. Pathao then updates shipment statuses here automatically. Pathao must be turned on above
          first.
        </p>
        <Field label="Callback URL" htmlFor="wh-url" className="mt-4">
          <div className="flex gap-2">
            <Input id="wh-url" value={webhookUrl} readOnly className="min-w-0 font-mono text-sm" />
            <Button variant="outline" size="sm" className="h-11" onClick={() => copy(webhookUrl)}>
              Copy
            </Button>
          </div>
        </Field>
        <p className="mt-3 text-sm">
          Webhook secret: {initial.hasWebhookSecret ? <Badge tone="signal">Set</Badge> : <Badge tone="warn">Not set</Badge>}
        </p>
        {webhookSecret ? (
          <div className="mt-3 rounded-lg border border-warn/30 bg-warn-tint p-3">
            <p className="text-sm font-semibold">Copy this secret into the Pathao panel now. It is not stored here and won&apos;t be shown again.</p>
            <div className="mt-2 flex gap-2">
              <Input value={webhookSecret} readOnly aria-label="New webhook secret" className="min-w-0 font-mono text-sm" />
              <Button variant="outline" size="sm" className="h-11" onClick={() => copy(webhookSecret)}>
                Copy
              </Button>
            </div>
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <Field label="Your own secret (optional)" htmlFor="wh-custom" hint="Leave empty to generate a strong one" className="min-w-0 flex-1 basis-60">
            <Input id="wh-custom" type="password" value={customSecret} onChange={(e) => setCustomSecret(e.target.value)} autoComplete="new-password" maxLength={200} />
          </Field>
          <Button variant="outline" onClick={makeSecret} loading={settingSecret}>
            {initial.hasWebhookSecret ? "Replace webhook secret" : "Create webhook secret"}
          </Button>
        </div>
      </section>
    </div>
  );
}
