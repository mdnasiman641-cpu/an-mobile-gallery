"use client";

import { useRef, useState } from "react";
import { ImagePlus, RotateCcw, Trash2 } from "lucide-react";
import { discardFaviconUploadAction, uploadFaviconAction } from "@/app/admin/(panel)/settings/branding-actions";
import { Button } from "@/components/ui/button";
import { DEFAULT_FAVICON, type FaviconFile, type FaviconState } from "@/lib/favicon";
import { FAVICON_ACCEPT, makeFaviconSet } from "@/lib/favicon-image";

/** Browser tab, Google result and phone home-screen previews + upload / replace / remove. */
export type { FaviconState };

export function FaviconField({
  value,
  saved,
  storeName,
  onChange,
}: {
  value: FaviconState;
  /** The icon that is live on the site now. */
  saved: FaviconState;
  storeName: string;
  onChange: (next: FaviconState) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error" | "warn"; text: string } | null>(null);
  const icon = (f: FaviconFile, fallback: string) => value.urls?.[f] ?? fallback;
  const small = icon("icon-32.png", DEFAULT_FAVICON.svg);
  const google = icon("icon-48.png", DEFAULT_FAVICON.png192);
  const apple = icon("apple-touch-icon.png", DEFAULT_FAVICON.apple);
  const savedId = saved.id;
  const changed = value.id !== savedId;

  async function discardUnsaved() {
    if (value.id && value.id !== savedId) await discardFaviconUploadAction(value.id).catch(() => undefined);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      const { form, warnings } = await makeFaviconSet(file);
      const res = await uploadFaviconAction(form);
      if (!res.ok || !res.data) throw new Error(res.message ?? "The icon couldn't be uploaded.");
      await discardUnsaved(); // an earlier unsaved upload is no longer needed
      onChange({ id: res.data.id, urls: res.data.urls });
      setMessage({ tone: warnings.length ? "warn" : "ok", text: [...warnings, "Uploaded. Press “Save settings” to make it the site's icon."].join(" ") });
    } catch (e) {
      setMessage({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <p className="text-sm font-medium">Browser favicon &amp; site icon</p>
      <div className="mt-1.5 grid gap-3 rounded-[var(--radius-control)] border border-dashed border-line-strong bg-paper p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0 space-y-2.5">
          {/* browser tab */}
          <div className="flex min-w-0 items-center gap-2 rounded-t-lg border border-line bg-surface px-3 py-2 text-sm" aria-label="Browser tab preview">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={small} alt="" width={16} height={16} className="h-4 w-4 shrink-0" />
            <span className="truncate">{storeName}</span>
          </div>
          {/* Google result */}
          <div className="flex min-w-0 items-center gap-2.5 rounded-lg border border-line bg-surface p-2.5" aria-label="Google search result preview">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={google} alt="" width={18} height={18} className="h-[18px] w-[18px]" />
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-sm">{storeName}</span>
              <span className="block truncate text-xs text-ink-mute">Google search result</span>
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3 sm:flex-col sm:justify-center" aria-label="Phone home screen preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={apple} alt="" width={56} height={56} className="h-14 w-14 rounded-[14px] border border-line bg-white" />
          <span className="text-xs text-ink-mute">Home screen</span>
        </div>
      </div>
      <p className="mt-1.5 text-xs text-ink-mute">
        {value.id ? (changed ? "New icon — not live until you save." : "Your uploaded icon is live.") : changed ? "Built-in icon will be used after you save." : "Built-in brand icon (nothing uploaded)."}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} loading={busy} aria-label={value.id ? "Replace favicon" : "Upload favicon"}>
          {busy ? null : <ImagePlus className="h-4 w-4" aria-hidden />}
          {value.id ? "Replace" : "Upload"}
        </Button>
        {value.id ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-label="Remove favicon"
            onClick={async () => {
              await discardUnsaved();
              onChange({ id: null, urls: null });
              setMessage({ tone: "ok", text: "Press “Save settings” to go back to the built-in icon." });
            }}
          >
            <Trash2 className="h-4 w-4" aria-hidden /> Remove
          </Button>
        ) : null}
        {changed && savedId ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-label="Undo favicon change"
            onClick={async () => {
              await discardUnsaved();
              onChange(saved);
              setMessage(null);
            }}
          >
            <RotateCcw className="h-4 w-4" aria-hidden /> Undo
          </Button>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          accept={FAVICON_ACCEPT.join(",")}
          className="sr-only"
          aria-label="Choose favicon image"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
      </div>
      {message ? (
        <p role={message.tone === "error" ? "alert" : "status"} className={`mt-2 text-sm ${message.tone === "error" ? "text-deal" : message.tone === "warn" ? "text-warn" : "text-signal-dark"}`}>
          {message.text}
        </p>
      ) : null}
      <p className="mt-1.5 text-xs text-ink-mute">
        Square logo mark, 512 × 512 px PNG or SVG works best (no long text — it can&rsquo;t be read at 16 px). Used for browser tabs, Google search results (sizes from 16 to 512 px) and
        phone home screens.
      </p>
    </div>
  );
}
