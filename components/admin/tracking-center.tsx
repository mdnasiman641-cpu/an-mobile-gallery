"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, KeyRound, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import {
  confirmDestinationAction,
  deleteDestinationAction,
  processQueueAction,
  retryFailedEventsAction,
  saveConsentAction,
  saveDestinationAction,
  saveRoutesAction,
  setDefaultDestinationAction,
  setDestinationEnabledAction,
  verifyDestinationAction,
} from "@/app/admin/(panel)/settings/tracking/actions";
import { ConfirmButton, toastResult } from "@/components/admin/ui";
import { relativeTime } from "@/components/admin/ai-health";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { Badge } from "@/components/ui/misc";
import { META_STANDARD } from "@/lib/tracking/adapters";
import type { ConsentSettings } from "@/lib/tracking/consent";
import { EVENT_INFO, SERVER_COPY_EVENTS, TRACKED_EVENTS, type TrackedEvent } from "@/lib/tracking/events";
import { DEFAULT_ROUTE, DESTINATION_KINDS, GA4_SERVER_EVENTS, type DestinationKind, type EventRoute, type Routes } from "@/lib/tracking/routing";
import { capiStatus, destinationStatus, ID_FORMAT, KIND_LABEL, kindStatus, STATUS_LABEL, STATUS_TONE, type DestinationView, type StatusCode } from "@/lib/tracking/status";
import type { TrackingAdminData } from "@/lib/tracking/server/admin";
import { cn } from "@/lib/utils";

const card = "rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:p-5";
const SECTIONS = [
  ["overview", "Overview"],
  ["accounts", "Accounts"],
  ["routing", "Event routing"],
  ["consent", "Consent"],
  ["delivery", "Server-side & delivery"],
  ["verify", "How to verify"],
  ["log", "Change log"],
] as const;

function StatusBadge({ code }: { code: StatusCode }) {
  return <Badge tone={STATUS_TONE[code]}>{STATUS_LABEL[code]}</Badge>;
}

const when = (iso: string | null) => (iso ? relativeTime(iso) : "—");

export function TrackingCenter({ data, siteUrl }: { data: TrackingAdminData; siteUrl: string }) {
  return (
    <div className="space-y-8">
      <nav aria-label="Sections" className="flex gap-2 overflow-x-auto pb-1 text-sm">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="shrink-0 rounded-full border border-line bg-surface px-3 py-1.5 font-semibold text-ink-soft hover:border-ink hover:text-ink">
            {label}
          </a>
        ))}
      </nav>
      <Overview data={data} />
      <Accounts data={data} />
      <Routing data={data} />
      <ConsentForm initial={data.consent} hasDestinations={data.destinations.length > 0} />
      <Delivery data={data} />
      <Guide siteUrl={siteUrl} />
      <ChangeLog data={data} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function Overview({ data }: { data: TrackingAdminData }) {
  const by = (k: DestinationKind) => data.destinations.filter((d) => d.kind === k);
  const lastOf = (list: DestinationView[], f: "lastSuccessAt" | "lastErrorAt") =>
    list.map((d) => d[f]).filter((x): x is string => Boolean(x)).sort().at(-1) ?? null;
  const testMode = (list: DestinationView[]) => list.some((d) => d.isEnabled && d.debug);

  const rows = data.stats?.byDestination ?? [];
  const count = (status: string) => rows.filter((r) => r.status === status).reduce((n, r) => n + Number(r.count), 0);
  const serverDests = data.destinations.filter((d) => d.serverEnabled);
  const lastDelivered = rows.filter((r) => r.status === "delivered").map((r) => r.last).filter((x): x is string => Boolean(x)).sort().at(-1) ?? null;
  const lastFailed = rows.filter((r) => r.status === "failed").map((r) => r.last).filter((x): x is string => Boolean(x)).sort().at(-1) ?? null;
  const serverStatus: StatusCode = !serverDests.length
    ? "not_configured"
    : !data.serverKey.registered
      ? "error"
      : lastFailed && (!lastDelivered || lastFailed > lastDelivered)
        ? "last_failed"
        : lastDelivered
          ? "connected"
          : "pending";

  const cards: { title: string; status: StatusCode | null; badge?: string; lines: string[] }[] = [
    { title: "Google Tag Manager (web)", status: kindStatus(by("gtm")), lines: [`${by("gtm").filter((d) => d.isEnabled).length} of ${by("gtm").length} container(s) on`] },
    {
      title: "Google Analytics 4",
      status: kindStatus(by("ga4")),
      lines: [
        `${by("ga4").filter((d) => d.isEnabled).length} of ${by("ga4").length} propert(ies) on`,
        `Last server event: ${when(lastOf(by("ga4"), "lastSuccessAt"))}`,
        testMode(by("ga4")) ? "Test mode ON (DebugView)" : "Test mode off",
      ],
    },
    { title: "Meta Pixel", status: kindStatus(by("meta").filter((d) => d.browserEnabled)), lines: [`${by("meta").filter((d) => d.isEnabled && d.browserEnabled).length} pixel(s) in the browser`] },
    {
      title: "Meta Conversions API",
      status: capiStatus(data.destinations),
      lines: [
        `Last delivery: ${when(lastOf(by("meta").filter((d) => d.serverEnabled), "lastSuccessAt"))}`,
        `Last error: ${when(lastOf(by("meta").filter((d) => d.serverEnabled), "lastErrorAt"))}`,
        `Failed events: ${by("meta").reduce((n, d) => n + d.failedCount, 0)}`,
        testMode(by("meta")) ? "Test mode ON (Test Event Code)" : "Test mode off",
      ],
    },
    {
      title: "Server-side delivery",
      status: serverStatus,
      lines: [
        "This site's own Cloudflare Worker (not a GTM server container)",
        `Delivered: ${count("delivered")} · waiting: ${count("pending") + count("processing")} · failed: ${count("failed")}`,
        `Last delivered: ${when(lastDelivered)}`,
      ],
    },
    {
      title: "Consent management",
      status: null,
      badge: data.consent.banner ? "Banner on" : "Banner off",
      lines: [
        `Analytics: ${data.consent.analytics ? `asked (default ${data.consent.defaultAnalytics})` : "off — never used"}`,
        `Advertising: ${data.consent.advertising ? `asked (default ${data.consent.defaultAdvertising})` : "off — never used"}`,
        `Policy version ${data.consent.version}`,
      ],
    },
    { title: "Google Ads (optional)", status: kindStatus(by("google_ads")), lines: [by("google_ads").length ? "Purchase conversions only" : "Not needed for GA4 or Meta"] },
  ];

  return (
    <section id="overview" aria-labelledby="overview-h" className="scroll-mt-24">
      <h2 id="overview-h" className="text-lg font-bold">
        Overview
      </h2>
      <p className="mt-0.5 text-sm text-ink-soft">
        “Connected” appears only after a real check (Meta answered, or you confirmed the events in the provider&rsquo;s test tool) — never just because an ID is saved.
      </p>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => (
          <li key={c.title} className={card}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="font-semibold">{c.title}</h3>
              {c.status ? <StatusBadge code={c.status} /> : <Badge tone={data.consent.banner ? "signal" : "warn"}>{c.badge}</Badge>}
            </div>
            <ul className="mt-2 space-y-0.5 text-sm text-ink-soft">
              {c.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {data.stats ? (
        <p className="mt-3 text-sm text-ink-soft">
          Orders reported as purchases: <strong>{data.stats.purchases}</strong> ({data.stats.purchasesWithAdConsent} with advertising consent) · refunds sent: {data.stats.refunds} · last purchase{" "}
          {when(data.stats.lastPurchaseAt)}. These are delivery numbers, not ad results: attribution and ad spend are only in Meta / Google reports.
        </p>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

function Accounts({ data }: { data: TrackingAdminData }) {
  const [editing, setEditing] = useState<{ kind: DestinationKind; dest: DestinationView | null } | null>(null);
  return (
    <section id="accounts" aria-labelledby="accounts-h" className="scroll-mt-24">
      <h2 id="accounts-h" className="text-lg font-bold">
        Accounts
      </h2>
      <p className="mt-0.5 text-sm text-ink-soft">
        Add as many accounts of each kind as you need. Without custom routing, events go only to the <strong>default</strong> account of each kind, so a second pixel or property never
        doubles your numbers by accident.
      </p>
      {!data.encryptionAvailable ? (
        <p className="mt-3 rounded-lg bg-warn-tint p-3 text-sm">Secrets can&rsquo;t be saved here: the secure key store (Cloudflare R2 binding) isn&rsquo;t available.</p>
      ) : null}
      <div className="mt-3 space-y-4">
        {DESTINATION_KINDS.map((kind) => {
          const list = data.destinations.filter((d) => d.kind === kind);
          return (
            <div key={kind} className={card}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">
                  {KIND_LABEL[kind]} <span className="font-normal text-ink-mute">({list.length})</span>
                </h3>
                <Button size="sm" variant="outline" onClick={() => setEditing({ kind, dest: null })}>
                  <Plus className="h-4 w-4" aria-hidden /> Add account
                </Button>
              </div>
              {list.length ? (
                <ul className="mt-3 divide-y divide-line">
                  {list.map((d) => (
                    <DestinationRow key={d.id} d={d} onEdit={() => setEditing({ kind, dest: d })} />
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-ink-mute">Not configured.</p>
              )}
              {editing && editing.kind === kind ? (
                <DestinationForm key={editing.dest?.id ?? "new"} kind={kind} dest={editing.dest} onClose={() => setEditing(null)} canEncrypt={data.encryptionAvailable} />
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DestinationRow({ d, onEdit }: { d: DestinationView; onEdit: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const code = destinationStatus(d);
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      const res = await fn();
      if (toastResult(res)) router.refresh();
    });
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold break-words">
            {d.name} <span className="font-mono text-sm font-normal text-ink-soft">{d.publicId}</span>
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <StatusBadge code={code} />
            {d.isDefault ? <Badge tone="ink">Default</Badge> : null}
            {d.debug ? <Badge tone="warn">Test mode</Badge> : null}
            {d.kind === "meta" ? <Badge>{[d.browserEnabled && "Pixel", d.serverEnabled && "Conversions API"].filter(Boolean).join(" + ") || "Nothing on"}</Badge> : null}
            {d.kind === "ga4" ? <Badge>{d.ga4Delivery === "gtm" ? "Browser via GTM" : "Browser via gtag"}{d.serverEnabled ? " + server" : ""}</Badge> : null}
            {d.hasSecret ? (
              <Badge>
                <KeyRound className="h-3 w-3" aria-hidden /> {d.secretHint}
              </Badge>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" onClick={onEdit}>
            Edit
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setDestinationEnabledAction(d.id, !d.isEnabled))}>
            {d.isEnabled ? "Disable" : "Enable"}
          </Button>
          {!d.isDefault ? (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setDefaultDestinationAction(d.id))}>
              Set default
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await verifyDestinationAction(d.id);
                setResult(res.data?.message ?? res.message ?? null);
                if (res.ok) toast.success("Check finished");
                else toast.error("Check failed");
                router.refresh();
              })
            }
          >
            <ShieldCheck className="h-4 w-4" aria-hidden /> Verify
          </Button>
          {d.isEnabled && d.verificationStatus !== "connected" ? (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => confirmDestinationAction(d.id))}>
              <CheckCircle2 className="h-4 w-4" aria-hidden /> I saw the events
            </Button>
          ) : null}
          <ConfirmButton
            title={`Remove ${d.name}?`}
            description="The account and its saved secret are deleted. Its queued server events are removed too. This can't be undone."
            confirmLabel="Remove"
            onConfirm={async () => {
              const res = await deleteDestinationAction(d.id);
              if (toastResult(res)) router.refresh();
              return res;
            }}
            variant="ghost"
          >
            Remove
          </ConfirmButton>
        </div>
      </div>
      <dl className="mt-2 grid gap-x-6 gap-y-0.5 text-xs text-ink-soft sm:grid-cols-2">
        <div>
          <dt className="inline">Last verification: </dt>
          <dd className="inline">{d.verifiedAt ? `${relativeTime(d.verifiedAt)} (${d.verificationMethod === "manual" ? "confirmed by you" : d.verificationMethod === "test_event" ? "test event" : "API"})` : "never"}</dd>
        </div>
        <div>
          <dt className="inline">Last successful server delivery: </dt>
          <dd className="inline">{when(d.lastSuccessAt)}</dd>
        </div>
        <div>
          <dt className="inline">Last error: </dt>
          <dd className="inline">{d.lastErrorAt ? `${relativeTime(d.lastErrorAt)} · ${d.lastErrorCode ?? ""}` : "—"}</dd>
        </div>
        <div>
          <dt className="inline">Failed events: </dt>
          <dd className="inline">{d.failedCount}</dd>
        </div>
      </dl>
      {result || d.verificationMessage ? <p className="mt-2 rounded-lg bg-paper p-2 text-sm text-ink-soft">{result ?? d.verificationMessage}</p> : null}
    </li>
  );
}

function SecretField({
  id,
  label,
  saved,
  value,
  onChange,
  clear,
  onClear,
  hint,
}: {
  id: string;
  label: string;
  saved: { hint: string | null; at: string | null } | null;
  value: string;
  onChange: (v: string) => void;
  clear: boolean;
  onClear: (v: boolean) => void;
  hint: string;
}) {
  const [replacing, setReplacing] = useState(!saved);
  return (
    <div className="space-y-1.5 sm:col-span-2">
      {saved && !replacing ? (
        <div>
          <p className="text-sm font-medium">{label}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded bg-paper px-2 py-1 font-mono">{saved.hint ?? "saved"}</span>
            <span className="text-ink-mute">saved {when(saved.at)} · never shown again</span>
            <Button size="sm" variant="outline" onClick={() => setReplacing(true)}>
              Replace
            </Button>
            <Checkbox label="Remove saved secret" checked={clear} onChange={(e) => onClear(e.target.checked)} />
          </div>
        </div>
      ) : (
        <Field label={label} htmlFor={id} hint={hint}>
          <Input id={id} type="password" autoComplete="off" spellCheck={false} value={value} onChange={(e) => onChange(e.target.value)} placeholder={saved ? "New value (leave empty to keep the saved one)" : ""} />
        </Field>
      )}
    </div>
  );
}

function DestinationForm({ kind, dest, onClose, canEncrypt }: { kind: DestinationKind; dest: DestinationView | null; onClose: () => void; canEncrypt: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [v, setV] = useState({
    name: dest?.name ?? "",
    public_id: dest?.publicId ?? "",
    is_enabled: dest?.isEnabled ?? true,
    is_default: dest?.isDefault ?? false,
    conversion_label: dest?.conversionLabel ?? "",
    server_container_url: dest?.serverContainerUrl ?? "",
    business_id: dest?.businessId ?? "",
    ad_account_id: dest?.adAccountId ?? "",
    browser_enabled: dest?.browserEnabled ?? true,
    server_enabled: dest?.serverEnabled ?? false,
    ga4_browser_delivery: dest?.ga4Delivery ?? "gtag",
    debug_mode: dest?.debug ?? false,
    enhanced_conversions: dest?.enhanced ?? false,
    advanced_matching: dest?.advancedMatching ?? false,
    test_event_code: dest?.testEventCode ?? "",
  });
  const [secret, setSecret] = useState("");
  const [clearSecret, setClearSecret] = useState(false);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((p) => ({ ...p, [k]: val }));
  const fmt = ID_FORMAT[kind];
  const idOk = fmt.re.test(kind === "meta" ? v.public_id.replace(/\s/g, "") : v.public_id.toUpperCase().replace(/\s/g, ""));
  const pre = `dest-${dest?.id ?? "new"}`;

  function save() {
    start(async () => {
      const res = await saveDestinationAction({ id: dest?.id, kind, ...v, secret: secret || undefined, clear_secret: clearSecret || undefined });
      if (toastResult(res)) {
        setSecret("");
        onClose();
        router.refresh();
      }
    });
  }

  return (
    <div className="mt-4 rounded-lg border border-signal/30 bg-paper p-4" role="group" aria-label={dest ? `Edit ${dest.name}` : `Add ${KIND_LABEL[kind]}`}>
      <h4 className="font-semibold">{dest ? `Edit ${dest.name}` : `Add ${KIND_LABEL[kind]}`}</h4>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <Field label="Name (for you)" htmlFor={`${pre}-name`} hint="e.g. Main shop pixel">
          <Input id={`${pre}-name`} value={v.name} onChange={(e) => set("name", e.target.value)} maxLength={80} />
        </Field>
        <Field
          label={kind === "gtm" ? "Container ID" : kind === "ga4" ? "Measurement ID" : kind === "meta" ? "Pixel / Dataset ID" : "Conversion ID"}
          htmlFor={`${pre}-id`}
          hint={`${fmt.hint} Example: ${fmt.example}`}
          error={v.public_id && !idOk ? `Wrong format (example: ${fmt.example})` : undefined}
        >
          <Input id={`${pre}-id`} value={v.public_id} onChange={(e) => set("public_id", e.target.value)} spellCheck={false} autoCapitalize="characters" maxLength={40} />
        </Field>

        {kind === "gtm" ? (
          <Field
            label="Server container URL (optional)"
            htmlFor={`${pre}-sgtm`}
            className="sm:col-span-2"
            hint="Only if you run your own GTM server container (separate hosting). Set the same URL in your GTM web container's Google tag; this website does not send anything to it and does not deploy one."
          >
            <Input id={`${pre}-sgtm`} value={v.server_container_url} onChange={(e) => set("server_container_url", e.target.value)} placeholder="https://sgtm.example.com" />
          </Field>
        ) : null}

        {kind === "ga4" ? (
          <>
            <Field label="Browser events" htmlFor={`${pre}-deliv`} hint="Via GTM: add GA4 event tags in your container; the site then won't send GA4 directly (no double counting).">
              <Select id={`${pre}-deliv`} value={v.ga4_browser_delivery} onChange={(e) => set("ga4_browser_delivery", e.target.value as "gtag" | "gtm")}>
                <option value="gtag">Sent directly by the site (gtag.js)</option>
                <option value="gtm">Sent through Google Tag Manager</option>
              </Select>
            </Field>
            <div className="space-y-2 pt-1">
              <Checkbox label="Browser events on" checked={v.browser_enabled} onChange={(e) => set("browser_enabled", e.target.checked)} />
              <Checkbox label="Test mode (events show in DebugView)" checked={v.debug_mode} onChange={(e) => set("debug_mode", e.target.checked)} />
              <Checkbox
                label="Server events (Measurement Protocol)"
                description="Needed for refunds of cancelled orders, and for sending the purchase from the server (Event routing)."
                checked={v.server_enabled}
                onChange={(e) => set("server_enabled", e.target.checked)}
              />
            </div>
            <SecretField
              id={`${pre}-secret`}
              label="Measurement Protocol API secret"
              saved={dest?.hasSecret ? { hint: dest.secretHint, at: dest.secretUpdatedAt } : null}
              value={secret}
              onChange={setSecret}
              clear={clearSecret}
              onClear={setClearSecret}
              hint="GA4 → Admin → Data streams → your stream → Measurement Protocol API secrets → Create. Stored encrypted; only this server can read it."
            />
          </>
        ) : null}

        {kind === "meta" ? (
          <>
            <div className="space-y-2 sm:col-span-2">
              <Checkbox label="Meta Pixel in the browser" checked={v.browser_enabled} onChange={(e) => set("browser_enabled", e.target.checked)} />
              <Checkbox
                label="Conversions API (server events)"
                description="Purchases are sent from the server with the same event ID as the Pixel, so Meta counts them once."
                checked={v.server_enabled}
                onChange={(e) => set("server_enabled", e.target.checked)}
              />
              <Checkbox
                label="Advanced matching (hashed email and phone)"
                description="Purchases only, only with the customer's advertising consent. SHA-256 hashes are sent, never the raw values."
                checked={v.advanced_matching}
                onChange={(e) => set("advanced_matching", e.target.checked)}
              />
              <Checkbox
                label="Test mode"
                description="Server events carry the Test Event Code and appear only under Events Manager → Test events (not in your ad reports). Turn it off for real tracking."
                checked={v.debug_mode}
                onChange={(e) => set("debug_mode", e.target.checked)}
              />
            </div>
            <SecretField
              id={`${pre}-secret`}
              label="Conversions API access token"
              saved={dest?.hasSecret ? { hint: dest.secretHint, at: dest.secretUpdatedAt } : null}
              value={secret}
              onChange={setSecret}
              clear={clearSecret}
              onClear={setClearSecret}
              hint="Events Manager → your dataset → Settings → Conversions API → Generate access token. Stored encrypted; never shown again."
            />
            <Field label="Test Event Code (optional)" htmlFor={`${pre}-tec`} hint="Events Manager → Test events → Conversions API → test code (e.g. TEST12345). Used for “Verify” and in Test mode only.">
              <Input id={`${pre}-tec`} value={v.test_event_code} onChange={(e) => set("test_event_code", e.target.value)} spellCheck={false} maxLength={40} />
            </Field>
            <Field label="Business ID (optional, reference)" htmlFor={`${pre}-biz`} hint="Business settings → Business info. Not used for sending.">
              <Input id={`${pre}-biz`} value={v.business_id} onChange={(e) => set("business_id", e.target.value)} inputMode="numeric" />
            </Field>
            <Field label="Ad account ID (optional, reference)" htmlFor={`${pre}-act`} hint="Ads Manager → account menu. Not used for sending.">
              <Input id={`${pre}-act`} value={v.ad_account_id} onChange={(e) => set("ad_account_id", e.target.value)} />
            </Field>
          </>
        ) : null}

        {kind === "google_ads" ? (
          <>
            <Field label="Conversion label" htmlFor={`${pre}-label`} hint="Google Ads → Goals → Conversions → your purchase conversion → Tag setup → “send_to: AW-…/LABEL”.">
              <Input id={`${pre}-label`} value={v.conversion_label} onChange={(e) => set("conversion_label", e.target.value)} spellCheck={false} />
            </Field>
            <div className="pt-1">
              <Checkbox
                label="Enhanced conversions"
                description="Turn on enhanced conversions for this conversion in Google Ads first. Only SHA-256 hashes of the email / phone are sent, from the browser, with advertising consent."
                checked={v.enhanced_conversions}
                onChange={(e) => set("enhanced_conversions", e.target.checked)}
              />
            </div>
          </>
        ) : null}

        <div className="space-y-2 sm:col-span-2">
          <Checkbox label="Enabled" checked={v.is_enabled} onChange={(e) => set("is_enabled", e.target.checked)} />
          <Checkbox label="Default account of this kind" description="Receives events that have no custom routing." checked={v.is_default} onChange={(e) => set("is_default", e.target.checked)} />
        </div>
      </div>
      {!canEncrypt && (kind === "meta" || kind === "ga4") ? <p className="mt-3 text-sm text-warn">Secrets can&rsquo;t be saved on this server (no secure key store).</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={save} loading={pending} disabled={!v.name.trim() || !idOk}>
          Save changes
        </Button>
        <Button variant="ghost" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event routing
// ---------------------------------------------------------------------------

function kindsFor(e: TrackedEvent): DestinationKind[] {
  const kinds: DestinationKind[] = ["gtm", "ga4"];
  if (META_STANDARD[e]) kinds.push("meta");
  if (e === "purchase") kinds.push("google_ads");
  return e === "refund" ? ["ga4"] : kinds;
}

function Routing({ data }: { data: TrackingAdminData }) {
  const router = useRouter();
  const [routes, setRoutes] = useState<Routes>(data.routes);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(routes) !== JSON.stringify(data.routes);
  const enabled = data.destinations.filter((d) => d.isEnabled);
  const setRoute = (e: TrackedEvent, patch: Partial<EventRoute> | null) =>
    setRoutes((r) => {
      const next = { ...r };
      if (patch === null) delete next[e];
      else {
        const merged: EventRoute = { ...(next[e] ?? {}), ...patch };
        for (const k of Object.keys(merged) as (keyof EventRoute)[]) if (merged[k] === undefined) delete merged[k];
        if (Object.keys(merged).length) next[e] = merged;
        else delete next[e];
      }
      return next;
    });

  return (
    <section id="routing" aria-labelledby="routing-h" className="scroll-mt-24">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="routing-h" className="text-lg font-bold">
            Event routing
          </h2>
          <p className="mt-0.5 text-sm text-ink-soft">
            Which accounts receive each event. “Default accounts” = the default account of each kind. Only events the website really has are listed.
          </p>
        </div>
        <Button
          loading={pending}
          disabled={!dirty}
          onClick={() =>
            start(async () => {
              const res = await saveRoutesAction(routes);
              if (toastResult(res)) router.refresh();
            })
          }
        >
          Save routing
        </Button>
      </div>
      <ul className="mt-3 space-y-2">
        {TRACKED_EVENTS.map((e) => {
          const r = { ...(DEFAULT_ROUTE[e] ?? {}), ...(routes[e] ?? {}) };
          const kinds = kindsFor(e);
          const custom = Array.isArray(routes[e]?.destinations);
          const chosen = new Set(routes[e]?.destinations ?? []);
          const pickable = enabled.filter((d) => kinds.includes(d.kind));
          const multi = kinds.filter((k) => pickable.filter((d) => d.kind === k && chosen.has(d.id)).length > 1);
          return (
            <li key={e} className={cn(card, "py-3")}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {EVENT_INFO[e].label} <code className="text-xs font-normal text-ink-mute">{e}</code>
                  </p>
                  <p className="text-xs text-ink-mute">
                    {EVENT_INFO[e].where} · Meta: {META_STANDARD[e] ?? "not sent (no standard Meta event)"}
                  </p>
                </div>
                {e !== "refund" ? (
                  <Checkbox
                    label="Custom accounts"
                    checked={custom}
                    onChange={(ev) => setRoute(e, { destinations: ev.target.checked ? pickable.filter((d) => d.isDefault).map((d) => d.id) : undefined })}
                  />
                ) : (
                  <span className="text-xs text-ink-mute">Server only: GA4 properties that got the purchase</span>
                )}
              </div>
              {custom ? (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
                  {pickable.length ? (
                    pickable.map((d) => (
                      <Checkbox
                        key={d.id}
                        label={`${d.name} (${d.kind === "google_ads" ? "Ads" : d.kind.toUpperCase()})`}
                        checked={chosen.has(d.id)}
                        onChange={(ev) => {
                          const next = new Set(chosen);
                          if (ev.target.checked) next.add(d.id);
                          else next.delete(d.id);
                          setRoute(e, { destinations: Array.from(next) });
                        }}
                      />
                    ))
                  ) : (
                    <span className="text-sm text-ink-mute">No enabled account can receive this event.</span>
                  )}
                </div>
              ) : null}
              {multi.length ? (
                <p className="mt-2 flex gap-1.5 text-sm text-warn">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> Several {multi.join(", ").toUpperCase()} accounts selected: this event is counted in each of them.
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
                {(SERVER_COPY_EVENTS.includes(e) || e === "purchase") && META_STANDARD[e] ? (
                  <Checkbox
                    label={e === "purchase" ? "Meta: also send from the server (recommended)" : "Meta: also send from the server"}
                    description="Same event ID as the Pixel → Meta keeps one."
                    checked={Boolean(r.metaServer)}
                    onChange={(ev) => setRoute(e, { metaServer: ev.target.checked })}
                  />
                ) : null}
                {GA4_SERVER_EVENTS.includes(e) ? (
                  <Checkbox
                    label="GA4: send from the server instead of the browser"
                    description="Uses the Measurement Protocol (needs the API secret). The browser then doesn't send it to that property — never both."
                    checked={Boolean(r.ga4Server)}
                    onChange={(ev) => setRoute(e, { ga4Server: ev.target.checked })}
                  />
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

function ConsentForm({ initial, hasDestinations }: { initial: ConsentSettings; hasDestinations: boolean }) {
  const router = useRouter();
  const [c, setC] = useState(initial);
  const [pending, start] = useTransition();
  const set = <K extends keyof ConsentSettings>(k: K, v: ConsentSettings[K]) => setC((p) => ({ ...p, [k]: v }));
  const optOut = c.defaultAnalytics === "granted" || c.defaultAdvertising === "granted";
  return (
    <section id="consent" aria-labelledby="consent-h" className={cn(card, "scroll-mt-24")}>
      <h2 id="consent-h" className="text-lg font-bold">
        Consent
      </h2>
      <p className="mt-0.5 text-sm text-ink-soft">
        These settings change what the site really does: a tag of a category that isn&rsquo;t allowed never loads, and the server sends nothing for it either. Whether your settings meet
        the law for your customers is for you to decide (this tool can&rsquo;t guarantee legal compliance).
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Checkbox label="Show the cookie banner" description="Visitors choose Accept all / Reject optional / Manage preferences. Reopen from “Cookie settings” in the footer." checked={c.banner} onChange={(e) => set("banner", e.target.checked)} />
          <Checkbox label="Analytics category (GA4, GTM)" description="Off = analytics tags never load." checked={c.analytics} onChange={(e) => set("analytics", e.target.checked)} />
          <Checkbox label="Advertising category (Meta, Google Ads)" description="Off = advertising tags and Conversions API never run." checked={c.advertising} onChange={(e) => set("advertising", e.target.checked)} />
        </div>
        <div className="space-y-4">
          <Field label="Before the visitor chooses: analytics" htmlFor="consent-da" hint={c.banner ? "Used until a choice is made." : "Banner off: always used."}>
            <Select id="consent-da" value={c.defaultAnalytics} onChange={(e) => set("defaultAnalytics", e.target.value as "denied" | "granted")}>
              <option value="denied">Off until accepted (opt-in)</option>
              <option value="granted">On until rejected (opt-out)</option>
            </Select>
          </Field>
          <Field label="Before the visitor chooses: advertising" htmlFor="consent-dm">
            <Select id="consent-dm" value={c.defaultAdvertising} onChange={(e) => set("defaultAdvertising", e.target.value as "denied" | "granted")}>
              <option value="denied">Off until accepted (opt-in)</option>
              <option value="granted">On until rejected (opt-out)</option>
            </Select>
          </Field>
          <Field label="Consent policy version" htmlFor="consent-ver" hint="Change it (e.g. 2026-11) when your cookie policy changes: everyone is asked again.">
            <Input id="consent-ver" value={c.version} onChange={(e) => set("version", e.target.value)} maxLength={20} />
          </Field>
        </div>
      </div>
      {optOut || !c.banner ? (
        <p className="mt-3 flex gap-1.5 rounded-lg bg-warn-tint p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />
          {!c.banner && !optOut
            ? "Banner off and both defaults off: no optional tracking will run at all."
            : "Optional tracking will run before (or without) the visitor's explicit choice. Many privacy laws require opt-in; check what applies to your customers."}
        </p>
      ) : null}
      {!hasDestinations ? <p className="mt-3 text-sm text-ink-mute">No account is set up yet, so no banner is shown on the shop.</p> : null}
      <div className="mt-4">
        <Button
          loading={pending}
          onClick={() =>
            start(async () => {
              const res = await saveConsentAction(c);
              if (toastResult(res)) router.refresh();
            })
          }
        >
          Save consent settings
        </Button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Server-side delivery and diagnostics
// ---------------------------------------------------------------------------

function Delivery({ data }: { data: TrackingAdminData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<number[]>([]);
  const names = useMemo(() => new Map(data.destinations.map((d) => [d.id, d.name])), [data.destinations]);
  const gtmServer = data.destinations.filter((d) => d.kind === "gtm" && d.serverContainerUrl);
  const retryable = data.recent.filter((r) => r.retryable);
  return (
    <section id="delivery" aria-labelledby="delivery-h" className={cn(card, "scroll-mt-24")}>
      <h2 id="delivery-h" className="text-lg font-bold">
        Server-side &amp; delivery
      </h2>
      <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-semibold">Active server architecture</dt>
          <dd className="text-ink-soft">This website&rsquo;s own Cloudflare Worker sends Meta Conversions API and GA4 Measurement Protocol events. It is not a GTM server container.</dd>
        </div>
        <div>
          <dt className="font-semibold">GTM server container</dt>
          <dd className="text-ink-soft">
            {gtmServer.length
              ? `URL saved for ${gtmServer.map((d) => d.name).join(", ")} — used only by your GTM web container's own tags; not verified or used by this website.`
              : "Not used (none deployed)."}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Server key</dt>
          <dd className="text-ink-soft">
            {data.serverKey.registered
              ? `Registered (${data.serverKey.source === "r2" ? "Worker's private R2 bucket" : "TRACKING_SERVER_KEY"}).`
              : data.serverKey.source === "none"
                ? "Not available here (no R2 binding and no TRACKING_SERVER_KEY): server-side events can't be sent."
                : "Couldn't be registered. Reload this page."}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Retries</dt>
          <dd className="text-ink-soft">Up to 5 attempts (1 min, 5 min, 25 min, 2 h). Sent with the next order or when this page opens; nothing older than 7 days.</dd>
        </div>
      </dl>

      {data.stats?.byDestination.length ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-sm">
            <caption className="sr-only">Server events by account</caption>
            <thead className="text-xs text-ink-mute">
              <tr>
                <th className="py-1 pr-3 font-semibold">Account</th>
                <th className="py-1 pr-3 font-semibold">Channel</th>
                <th className="py-1 pr-3 font-semibold">Status</th>
                <th className="py-1 pr-3 font-semibold">Events</th>
                <th className="py-1 font-semibold">Last</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.stats.byDestination.map((r) => (
                <tr key={`${r.destinationId}-${r.channel}-${r.status}`}>
                  <td className="py-1.5 pr-3">{names.get(r.destinationId) ?? "removed"}</td>
                  <td className="py-1.5 pr-3">{r.channel === "meta_capi" ? "Conversions API" : "Measurement Protocol"}</td>
                  <td className="py-1.5 pr-3">{r.status}</td>
                  <td className="py-1.5 pr-3">{r.count}</td>
                  <td className="py-1.5">{when(r.last)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-4 text-sm text-ink-mute">No server events yet.</p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Recent server events</h3>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await processQueueAction();
                toastResult(res);
                router.refresh();
              })
            }
          >
            <RefreshCw className="h-4 w-4" aria-hidden /> Send due events now
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending || !selected.length}
            onClick={() =>
              start(async () => {
                const res = await retryFailedEventsAction(selected);
                if (toastResult(res)) setSelected([]);
                router.refresh();
              })
            }
          >
            Retry selected ({selected.length})
          </Button>
        </div>
      </div>
      {data.recent.length ? (
        <ul className="mt-2 divide-y divide-line text-sm" aria-label="Recent server events">
          {data.recent.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2">
              {r.retryable ? (
                <input
                  type="checkbox"
                  aria-label={`Select event ${r.id} for retry`}
                  className="mt-1 h-4 w-4 accent-[var(--color-signal)]"
                  checked={selected.includes(r.id)}
                  onChange={(e) => setSelected((s) => (e.target.checked ? [...s, r.id] : s.filter((x) => x !== r.id)))}
                />
              ) : (
                <span className="w-4" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <p>
                  <strong>{r.eventName}</strong> → {names.get(r.destinationId) ?? "removed"} ({r.channel === "meta_capi" ? "CAPI" : "MP"}){r.transactionId ? ` · ${r.transactionId}` : ""}
                  {r.isTest ? " · test" : ""}
                </p>
                <p className="text-xs text-ink-mute">
                  {relativeTime(r.createdAt)} · attempts {r.attempts}
                  {r.responseSummary ? ` · ${r.responseSummary}` : ""}
                  {r.lastErrorCode ? ` · ${r.lastErrorCode}: ${r.lastErrorMessage ?? ""}` : ""}
                </p>
              </div>
              <Badge tone={r.status === "delivered" ? "signal" : r.status === "failed" ? "deal" : "warn"}>{r.status}</Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-ink-mute">Nothing sent from the server yet. Event rows never contain names, addresses or raw phone numbers.</p>
      )}
      {retryable.length ? <p className="mt-2 text-xs text-ink-mute">Only failed events younger than 7 days can be retried.</p> : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Verification guide and change log
// ---------------------------------------------------------------------------

function Guide({ siteUrl }: { siteUrl: string }) {
  const steps: [string, string[]][] = [
    ["Google Tag Manager (web)", [`Tag Manager → Preview → enter ${siteUrl}.`, "On the shop, accept cookies (the container loads only after consent).", "Tag Assistant must show the container connected and events such as view_item, add_to_cart.", "Back here, press “I saw the events”."]],
    ["GA4 Realtime / DebugView", ["Turn on Test mode for the property (or use GTM Preview).", "Accept analytics cookies on the shop and open a product.", "GA4 → Admin → DebugView (or Reports → Realtime) shows page_view and view_item.", "For Measurement Protocol: press Verify — a “tracking_test” event is sent in debug mode — then check DebugView."]],
    ["Meta Events Manager → Test events", ["Add the Test Event Code to the account and press Verify: a test PageView is sent from the server and must appear under Test events.", "For the Pixel: in Test events, open the shop from the “Test browser events” box, accept cookies and browse.", "Turn Test mode on to see server purchases there too; turn it off for real tracking."]],
    ["Meta deduplication (browser + server)", ["Place a test order with Test mode on and cookies accepted.", "Test events must show ONE Purchase with “Deduplicated” (same event_id: purchase.<order number>) from Browser and Server."]],
    ["Consent rejection", ["Open the shop in a private window, press “Reject optional”.", "Browser dev tools → Network: no requests to googletagmanager.com, google-analytics.com or facebook.net; no _ga / _fbp cookies.", "Place a test order: Server-side & delivery shows no new Conversions API event for it."]],
    ["Duplicate purchase prevention", ["After an order, refresh the confirmation page and press Back: no new Purchase appears in Test events / DebugView.", "Each order has one row in the purchases count; the database refuses a second purchase record for the same order."]],
    ["Server endpoint security", ["/api/events accepts only same-site requests, only browser events (never purchase/refund), only with advertising consent, and is rate-limited.", "Secrets are never sent to the browser: they show here only as …last4."]],
  ];
  return (
    <section id="verify" aria-labelledby="verify-h" className="scroll-mt-24">
      <h2 id="verify-h" className="text-lg font-bold">
        How to verify
      </h2>
      <div className="mt-3 space-y-2">
        {steps.map(([title, list]) => (
          <details key={title} className={cn(card, "py-3")}>
            <summary className="cursor-pointer font-semibold">{title}</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink-soft">
              {list.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </details>
        ))}
      </div>
      <p className="mt-3 text-sm text-ink-soft">
        Purchase = an order successfully placed on the website (Cash on Delivery, before the shop confirms it). Cancelled or refunded orders send a GA4 refund once; Meta has no refund
        event. Full guide: docs/ANALYTICS-AND-TRACKING.md in the code repository.
      </p>
    </section>
  );
}

function ChangeLog({ data }: { data: TrackingAdminData }) {
  return (
    <section id="log" aria-labelledby="log-h" className="scroll-mt-24">
      <h2 id="log-h" className="text-lg font-bold">
        Change log
      </h2>
      {data.audit.length ? (
        <ul className="mt-2 divide-y divide-line text-sm">
          {data.audit.map((a) => (
            <li key={a.id} className="py-1.5">
              <span className="font-medium">{a.action.replace(/_/g, " ")}</span>
              {a.target ? <span className="text-ink-soft"> · {a.target}</span> : null}
              {a.fields.length ? <span className="text-ink-mute"> · {a.fields.join(", ")}</span> : null}
              <span className="text-ink-mute"> · {relativeTime(a.createdAt)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-ink-mute">No changes yet. Secret values are never written to this log.</p>
      )}
    </section>
  );
}
