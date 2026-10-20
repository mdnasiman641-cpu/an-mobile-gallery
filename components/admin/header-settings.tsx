"use client";

import { useId, useState } from "react";
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from "lucide-react";
import { AnnouncementBar } from "@/components/store/announcement-bar";
import { LocationsMenu } from "@/components/store/locations-menu";
import { ConfirmButton } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { Badge } from "@/components/ui/misc";
import {
  HEADER_ICONS,
  ICON_LABELS,
  MAX_MESSAGES,
  MAX_OUTLETS,
  SPEED,
  contrastRatio,
  isMessageLive,
  newItemId,
  visibleOutlets,
  type HeaderBar,
  type HeaderConfig,
  type HeaderIcon,
  type HeaderMessage,
  type HeaderOutlet,
  type MessageStyle,
} from "@/lib/header-config";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Form state (strings for inputs; converted on save)
// ---------------------------------------------------------------------------

export interface MessageDraft {
  id: string;
  text: string;
  text_bn: string;
  enabled: boolean;
  link: string;
  /** datetime-local value in the admin's own time zone */
  starts: string;
  ends: string;
  style: MessageStyle;
  icon: HeaderIcon;
  label: string;
}
export interface OutletDraft {
  id: string;
  name: string;
  address: string;
  phone: string;
  whatsapp: string;
  hours: string;
  map_url: string;
  active: boolean;
}
export interface HeaderDraft {
  bar: HeaderBar;
  messages: MessageDraft[];
  outlets: OutletDraft[];
}

const pad = (n: number) => String(n).padStart(2, "0");
function isoToLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localToIso(local: string): string | null {
  if (!local) return null;
  const t = new Date(local).getTime(); // read in the admin's own time zone
  return Number.isNaN(t) ? local : new Date(t).toISOString();
}

export function toHeaderDraft(c: HeaderConfig): HeaderDraft {
  return {
    bar: { ...c.bar },
    messages: c.messages.map((m) => ({
      id: m.id,
      text: m.text,
      text_bn: m.text_bn ?? "",
      enabled: m.enabled,
      link: m.link ?? "",
      starts: isoToLocal(m.starts_at),
      ends: isoToLocal(m.ends_at),
      style: m.style,
      icon: m.icon,
      label: m.label ?? "",
    })),
    outlets: c.outlets.map((o) => ({
      id: o.id,
      name: o.name,
      address: o.address ?? "",
      phone: o.phone ?? "",
      whatsapp: o.whatsapp ?? "",
      hours: o.hours ?? "",
      map_url: o.map_url ?? "",
      active: o.active,
    })),
  };
}

/** What is sent to the server (validated again there). */
export function headerPayload(d: HeaderDraft) {
  return {
    bar: d.bar,
    messages: d.messages.map((m) => ({
      id: m.id,
      text: m.text,
      text_bn: m.text_bn || null,
      enabled: m.enabled,
      link: m.link || null,
      starts_at: localToIso(m.starts),
      ends_at: localToIso(m.ends),
      style: m.style,
      icon: m.icon,
      label: m.label || null,
    })),
    outlets: d.outlets.map((o) => ({
      id: o.id,
      name: o.name,
      address: o.address || null,
      phone: o.phone || null,
      whatsapp: o.whatsapp || null,
      hours: o.hours || null,
      map_url: o.map_url || null,
      active: o.active,
    })),
  };
}

/** For the preview: drafts as the storefront would read them (lenient). */
function previewMessages(d: HeaderDraft): HeaderMessage[] {
  return headerPayload(d).messages.filter((m) => m.text || m.text_bn) as HeaderMessage[];
}

function messageStatus(m: MessageDraft, now: number): { label: string; tone: "signal" | "neutral" | "warn" | "deal" } {
  const msg = { enabled: m.enabled, starts_at: localToIso(m.starts), ends_at: localToIso(m.ends) };
  if (!m.enabled) return { label: "Disabled", tone: "neutral" };
  if (msg.ends_at && Date.parse(msg.ends_at) <= now) return { label: "Ended", tone: "deal" };
  if (msg.starts_at && Date.parse(msg.starts_at) > now) return { label: "Scheduled", tone: "warn" };
  return isMessageLive(msg, now) ? { label: "Live", tone: "signal" } : { label: "Not live", tone: "neutral" };
}

function move<T>(list: T[], i: number, by: -1 | 1): T[] {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

function Card({ title, description, children }: { title: string; description?: string; children: React.ReactNode; id?: string }) {
  const id = useId();
  return (
    <section className="min-w-0 rounded-[var(--radius-card)] border border-line bg-surface p-5" aria-labelledby={id}>
      <h2 id={id} className="font-bold">
        {title}
      </h2>
      {description ? <p className="text-sm text-ink-soft">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ColorField({ label, value, onChange, id }: { label: string; value: string; onChange: (v: string) => void; id: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-12 shrink-0 cursor-pointer rounded-[var(--radius-control)] border border-line bg-surface p-1"
        />
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value.trim())} maxLength={7} className="font-mono" />
      </div>
    </div>
  );
}

export function HeaderSettings({
  value,
  onChange,
  errors,
  available,
  store,
}: {
  value: HeaderDraft;
  onChange: (next: HeaderDraft) => void;
  errors: Record<string, string>;
  /** false = migration 0018 not run yet */
  available: boolean;
  /** Store contact details (Admin → Settings → Contact), to copy into an outlet. */
  store: { name: string; address: string; phone: string; whatsapp: string; hours: string; map_url: string };
}) {
  const uid = useId();
  const bar = value.bar;
  const setBar = (patch: Partial<HeaderBar>) => onChange({ ...value, bar: { ...bar, ...patch } });
  const setMsg = (i: number, patch: Partial<MessageDraft>) => onChange({ ...value, messages: value.messages.map((m, k) => (k === i ? { ...m, ...patch } : m)) });
  const setOutlet = (i: number, patch: Partial<OutletDraft>) => onChange({ ...value, outlets: value.outlets.map((o, k) => (k === i ? { ...o, ...patch } : o)) });
  const [now] = useState(() => Date.now()); // statuses as of opening the page
  const contrast = /^#[0-9a-f]{6}$/i.test(bar.bg_color) && /^#[0-9a-f]{6}$/i.test(bar.text_color) ? contrastRatio(bar.bg_color, bar.text_color) : null;
  const previewOutlets = visibleOutlets(headerPayload(value).outlets as HeaderOutlet[]);
  const liveCount = value.messages.filter((m) => messageStatus(m, now).label === "Live").length;

  if (!available) {
    return (
      <Card title="Announcement bar, offers & Locations">
        <p className="rounded-lg bg-warn-tint p-3 text-sm text-warn" role="status">
          This needs database migration 0018 (supabase/migrations/20261021000018_storefront_header.sql). Run it in the Supabase SQL editor, then reload this page.
        </p>
      </Card>
    );
  }

  const newOutlet = (o: Partial<OutletDraft> = {}): OutletDraft => ({ id: newItemId(), name: "", address: "", phone: "", whatsapp: "", hours: "", map_url: "", active: true, ...o });

  return (
    <>
      {/* ---------------- preview ---------------- */}
      <Card title="Header preview" description="How the top of the website will look after you save (unsaved changes included).">
        <div className="overflow-hidden rounded-lg border border-line">
          {bar.enabled && previewMessages(value).some((m) => m.enabled) ? (
            <AnnouncementBar bar={{ ...bar, show_desktop: true, show_mobile: true }} messages={previewMessages(value)} renderedAt={now} preview />
          ) : (
            <p className="bg-paper px-3 py-2 text-xs text-ink-mute">
              {bar.enabled ? "No enabled messages: the announcement bar is hidden." : "Announcement Bar Visibility is OFF: the bar is hidden on desktop and mobile."}
            </p>
          )}
          <div className="flex h-12 items-center justify-between bg-gradient-to-r from-signal to-[#0c8667] px-3 text-sm font-medium text-white">
            <span className="truncate opacity-80">Categories · Brands · Offers</span>
            {previewOutlets.length ? <LocationsMenu outlets={previewOutlets} /> : <span className="text-xs opacity-80">Locations hidden (no active outlet)</span>}
          </div>
        </div>
        <p className="mt-2 text-xs text-ink-mute">
          The preview shows every enabled message; on the website each one appears only inside its own start and end time. {liveCount} live now.
        </p>
      </Card>

      {/* ---------------- A ---------------- */}
      <Card id={`${uid}-a`} title="Announcement bar settings" description="The bar above the website header. Turning it off keeps every message and setting saved.">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-paper p-3">
            <div>
              <p className="text-sm font-semibold" id={`${uid}-vis`}>
                Announcement Bar Visibility
              </p>
              <p className="text-sm text-ink-mute">{bar.enabled ? "ON: enabled, live messages are shown." : "OFF: the bar is hidden everywhere. Messages stay saved."}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={bar.enabled}
              aria-labelledby={`${uid}-vis`}
              onClick={() => setBar({ enabled: !bar.enabled })}
              className={cn("relative h-7 w-12 shrink-0 rounded-full transition-colors", bar.enabled ? "bg-signal" : "bg-line-strong")}
            >
              <span className={cn("absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-[left]", bar.enabled ? "left-6" : "left-1")} />
            </button>
          </div>
          <Checkbox label="Show on desktop" description="Screens 768 px and wider" checked={bar.show_desktop} onChange={(e) => setBar({ show_desktop: e.target.checked })} />
          <Checkbox label="Show on mobile" description="Phones (narrower than 768 px)" checked={bar.show_mobile} onChange={(e) => setBar({ show_mobile: e.target.checked })} />
          <ColorField id={`${uid}-bg`} label="Background colour" value={bar.bg_color} onChange={(v) => setBar({ bg_color: v })} />
          <ColorField id={`${uid}-fg`} label="Text colour" value={bar.text_color} onChange={(v) => setBar({ text_color: v })} />
          <ColorField id={`${uid}-ac`} label="Accent colour (icons, labels, highlighted text)" value={bar.accent_color} onChange={(v) => setBar({ accent_color: v })} />
          <Field label="Text to show" htmlFor={`${uid}-lang`} hint="For messages that have both English and Bangla text">
            <Select id={`${uid}-lang`} value={bar.language} onChange={(e) => setBar({ language: e.target.value as HeaderBar["language"] })}>
              <option value="en">English (Bangla when there is no English)</option>
              <option value="bn">Bangla (English when there is no Bangla)</option>
              <option value="both">Both</option>
            </Select>
          </Field>
          {errors["bar.bg_color"] || errors["bar.text_color"] || errors["bar.accent_color"] ? (
            <p className="text-sm text-deal md:col-span-2" role="alert">
              {errors["bar.bg_color"] ?? errors["bar.text_color"] ?? errors["bar.accent_color"]}
            </p>
          ) : null}
          {contrast !== null && contrast < 4.5 ? (
            <p className="rounded-lg bg-warn-tint p-2.5 text-sm text-warn md:col-span-2" role="status">
              Text and background contrast is {contrast.toFixed(1)}:1. Use at least 4.5:1 so everyone can read it (e.g. white text on a dark background).
            </p>
          ) : null}
        </div>
      </Card>

      {/* ---------------- B ---------------- */}
      <Card id={`${uid}-b`} title="Sliding text" description="Messages move across the bar in a continuous loop. Visitors who turned on “reduce motion” see them standing still.">
        <div className="grid gap-4 md:grid-cols-2">
          <Checkbox label="Sliding animation" description="Off: messages stand still (scroll sideways if they don't fit)" checked={bar.animate} onChange={(e) => setBar({ animate: e.target.checked })} />
          <Checkbox label="Pause on hover (desktop)" description="Stops while the mouse is over the bar" checked={bar.pause_on_hover} onChange={(e) => setBar({ pause_on_hover: e.target.checked })} disabled={!bar.animate} />
          <Field label="Direction" htmlFor={`${uid}-dir`}>
            <Select id={`${uid}-dir`} value={bar.direction} onChange={(e) => setBar({ direction: e.target.value as HeaderBar["direction"] })} disabled={!bar.animate}>
              <option value="left">Right to left</option>
              <option value="right">Left to right</option>
            </Select>
          </Field>
          <Field label={`Speed: ${bar.speed} px per second`} htmlFor={`${uid}-speed`} error={errors["bar.speed"]} hint="Slower is easier to read (40 is a good start)">
            <input
              id={`${uid}-speed`}
              type="range"
              min={SPEED.min}
              max={SPEED.max}
              step={5}
              value={bar.speed}
              disabled={!bar.animate}
              onChange={(e) => setBar({ speed: Number(e.target.value) })}
              className="accent-[var(--color-signal)]"
            />
          </Field>
        </div>
      </Card>

      {/* ---------------- C ---------------- */}
      <Card
        id={`${uid}-c`}
        title="Messages & offers"
        description="Write your own messages in English and/or Bangla (emoji are fine). They show in this order. Only enabled messages inside their start/end time are shown."
      >
        {value.messages.length === 0 ? <p className="mb-3 text-sm text-ink-mute">No messages yet. The bar stays hidden until you add one.</p> : null}
        <ol className="grid gap-3">
          {value.messages.map((m, i) => {
            const st = messageStatus(m, now);
            const e = (k: string) => errors[`messages.${i}.${k}`];
            const p = `${uid}-m${i}`;
            return (
              <li key={m.id} className={cn("rounded-lg border p-3", m.enabled ? "border-line" : "border-dashed border-line bg-paper")} aria-label={`Message ${i + 1}`}>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">#{i + 1}</span>
                  <Badge tone={st.tone}>{st.label}</Badge>
                  <Checkbox label="Enabled" checked={m.enabled} onChange={(ev) => setMsg(i, { enabled: ev.target.checked })} className="ml-1" />
                  <span className="ml-auto flex items-center gap-1">
                    <Button type="button" size="sm" variant="ghost" aria-label={`Move message ${i + 1} up`} disabled={i === 0} onClick={() => onChange({ ...value, messages: move(value.messages, i, -1) })}>
                      <ArrowUp className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button type="button" size="sm" variant="ghost" aria-label={`Move message ${i + 1} down`} disabled={i === value.messages.length - 1} onClick={() => onChange({ ...value, messages: move(value.messages, i, 1) })}>
                      <ArrowDown className="h-4 w-4" aria-hidden />
                    </Button>
                    <ConfirmButton
                      variant="ghost"
                      title={`Delete message ${i + 1}?`}
                      description="It is removed when you press Save settings."
                      confirmLabel="Delete"
                      onConfirm={async () => onChange({ ...value, messages: value.messages.filter((x) => x.id !== m.id) })}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                      <span className="sr-only">Delete message {i + 1}</span>
                    </ConfirmButton>
                  </span>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Message" htmlFor={`${p}-text`} error={e("text")} hint="Up to 160 characters">
                    <Input id={`${p}-text`} value={m.text} maxLength={160} onChange={(ev) => setMsg(i, { text: ev.target.value })} placeholder="Your message" />
                  </Field>
                  <Field label="Bangla text (optional)" htmlFor={`${p}-bn`} error={e("text_bn")}>
                    <Input id={`${p}-bn`} value={m.text_bn} maxLength={160} className="bn" onChange={(ev) => setMsg(i, { text_bn: ev.target.value })} />
                  </Field>
                  <Field label="Offer label (optional)" htmlFor={`${p}-label`} error={e("label")} hint="Small badge before the text, e.g. OFFER">
                    <Input id={`${p}-label`} value={m.label} maxLength={24} onChange={(ev) => setMsg(i, { label: ev.target.value })} />
                  </Field>
                  <Field label="Link (optional)" htmlFor={`${p}-link`} error={e("link")} hint="A page on this site (/offers) or a full https:// address">
                    <Input id={`${p}-link`} value={m.link} maxLength={500} onChange={(ev) => setMsg(i, { link: ev.target.value })} placeholder="/offers" />
                  </Field>
                  <Field label="Text style" htmlFor={`${p}-style`}>
                    <Select id={`${p}-style`} value={m.style} onChange={(ev) => setMsg(i, { style: ev.target.value as MessageStyle })}>
                      <option value="plain">Normal</option>
                      <option value="bold">Bold</option>
                      <option value="highlight">Highlight (accent colour)</option>
                    </Select>
                  </Field>
                  <Field label="Icon" htmlFor={`${p}-icon`}>
                    <Select id={`${p}-icon`} value={m.icon} onChange={(ev) => setMsg(i, { icon: ev.target.value as HeaderIcon })}>
                      {HEADER_ICONS.map((k) => (
                        <option key={k} value={k}>
                          {ICON_LABELS[k]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Start (optional)" htmlFor={`${p}-start`} error={e("starts_at")} hint="Empty = from now">
                    <Input id={`${p}-start`} type="datetime-local" value={m.starts} onChange={(ev) => setMsg(i, { starts: ev.target.value })} />
                  </Field>
                  <Field label="End (optional)" htmlFor={`${p}-end`} error={e("ends_at")} hint="Empty = no end">
                    <Input id={`${p}-end`} type="datetime-local" value={m.ends} onChange={(ev) => setMsg(i, { ends: ev.target.value })} />
                  </Field>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={value.messages.length >= MAX_MESSAGES}
            onClick={() =>
              onChange({
                ...value,
                messages: [...value.messages, { id: newItemId(), text: "", text_bn: "", enabled: true, link: "", starts: "", ends: "", style: "plain", icon: "none", label: "" }],
              })
            }
          >
            <Plus className="h-4 w-4" aria-hidden /> Add message
          </Button>
          <span className="text-xs text-ink-mute">
            {value.messages.length}/{MAX_MESSAGES}
          </span>
        </div>
      </Card>

      {/* ---------------- D ---------------- */}
      <Card id={`${uid}-d`} title="Locations / Outlets" description={`“Locations” in the main menu bar lists your active outlets (up to ${MAX_OUTLETS}). Hidden while no outlet is active.`}>
        {errors.outlets ? (
          <p className="mb-3 text-sm text-deal" role="alert">
            {errors.outlets}
          </p>
        ) : null}
        {value.outlets.length === 0 ? <p className="mb-3 text-sm text-ink-mute">No outlets yet.</p> : null}
        <ol className="grid gap-3">
          {value.outlets.map((o, i) => {
            const e = (k: string) => errors[`outlets.${i}.${k}`];
            const p = `${uid}-o${i}`;
            return (
              <li key={o.id} className={cn("rounded-lg border p-3", o.active ? "border-line" : "border-dashed border-line bg-paper")} aria-label={`Outlet ${i + 1}`}>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">Outlet {i + 1}</span>
                  <Badge tone={o.active ? "signal" : "neutral"}>{o.active ? "Active" : "Inactive"}</Badge>
                  <Checkbox label="Active" checked={o.active} onChange={(ev) => setOutlet(i, { active: ev.target.checked })} className="ml-1" />
                  <span className="ml-auto flex items-center gap-1">
                    <Button type="button" size="sm" variant="ghost" aria-label={`Move outlet ${i + 1} up`} disabled={i === 0} onClick={() => onChange({ ...value, outlets: move(value.outlets, i, -1) })}>
                      <ArrowUp className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button type="button" size="sm" variant="ghost" aria-label={`Move outlet ${i + 1} down`} disabled={i === value.outlets.length - 1} onClick={() => onChange({ ...value, outlets: move(value.outlets, i, 1) })}>
                      <ArrowDown className="h-4 w-4" aria-hidden />
                    </Button>
                    <ConfirmButton
                      variant="ghost"
                      title={`Delete outlet ${i + 1}?`}
                      description="It is removed when you press Save settings."
                      confirmLabel="Delete"
                      onConfirm={async () => onChange({ ...value, outlets: value.outlets.filter((x) => x.id !== o.id) })}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                      <span className="sr-only">Delete outlet {i + 1}</span>
                    </ConfirmButton>
                  </span>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Outlet name" htmlFor={`${p}-name`} error={e("name")} required>
                    <Input id={`${p}-name`} value={o.name} maxLength={80} onChange={(ev) => setOutlet(i, { name: ev.target.value })} />
                  </Field>
                  <Field label="Opening hours" htmlFor={`${p}-hours`} error={e("hours")}>
                    <Input id={`${p}-hours`} value={o.hours} maxLength={120} onChange={(ev) => setOutlet(i, { hours: ev.target.value })} />
                  </Field>
                  <Field label="Address" htmlFor={`${p}-address`} error={e("address")} className="md:col-span-2">
                    <Input id={`${p}-address`} value={o.address} maxLength={300} onChange={(ev) => setOutlet(i, { address: ev.target.value })} />
                  </Field>
                  <Field label="Phone" htmlFor={`${p}-phone`} error={e("phone")}>
                    <Input id={`${p}-phone`} type="tel" value={o.phone} maxLength={20} onChange={(ev) => setOutlet(i, { phone: ev.target.value })} placeholder="01XXXXXXXXX" />
                  </Field>
                  <Field label="WhatsApp number" htmlFor={`${p}-wa`} error={e("whatsapp")}>
                    <Input id={`${p}-wa`} type="tel" value={o.whatsapp} maxLength={20} onChange={(ev) => setOutlet(i, { whatsapp: ev.target.value })} placeholder="01XXXXXXXXX" />
                  </Field>
                  <Field label="Google Maps link" htmlFor={`${p}-map`} error={e("map_url")} className="md:col-span-2">
                    <Input id={`${p}-map`} value={o.map_url} maxLength={1000} onChange={(ev) => setOutlet(i, { map_url: ev.target.value })} placeholder="https://maps.app.goo.gl/…" />
                  </Field>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" size="sm" disabled={value.outlets.length >= MAX_OUTLETS} onClick={() => onChange({ ...value, outlets: [...value.outlets, newOutlet()] })}>
            <Plus className="h-4 w-4" aria-hidden /> Add outlet
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={value.outlets.length >= MAX_OUTLETS || !(store.address || store.phone || store.map_url)}
            onClick={() =>
              onChange({
                ...value,
                outlets: [...value.outlets, newOutlet({ name: store.name, address: store.address, phone: store.phone, whatsapp: store.whatsapp, hours: store.hours, map_url: store.map_url })],
              })
            }
          >
            <Copy className="h-4 w-4" aria-hidden /> Add from store contact details
          </Button>
          <span className="text-xs text-ink-mute">
            {value.outlets.length}/{MAX_OUTLETS}
            {value.outlets.length >= MAX_OUTLETS ? " — maximum reached" : ""}
          </span>
        </div>
      </Card>
    </>
  );
}
