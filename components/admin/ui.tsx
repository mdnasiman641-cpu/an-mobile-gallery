"use client";

import { useId, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { ImagePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";
import { uploadImage } from "@/lib/image-upload";
import { cn, isSvg } from "@/lib/utils";
import type { ActionResult } from "@/types";

/** Show a toast for an action result and return whether it succeeded. */
export function toastResult(res: ActionResult<unknown> | undefined, success?: string): boolean {
  if (!res) return false;
  if (res.ok) toast.success(res.message ?? success ?? "Saved");
  else toast.error(res.message ?? "Something went wrong. Please try again.");
  return res.ok;
}

/** Button that asks for confirmation in a modal dialog before running an action. */
export function ConfirmButton({
  title,
  description,
  confirmLabel = "Confirm",
  onConfirm,
  children,
  variant = "outline",
  size = "sm",
  tone = "danger",
  className,
  disabled,
}: {
  title: string;
  description?: string;
  confirmLabel?: string;
  onConfirm: () => Promise<ActionResult<unknown> | void>;
  children: React.ReactNode;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  tone?: "danger" | "primary";
  className?: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [pending, start] = useTransition();
  return (
    <>
      <Button type="button" variant={variant} size={size} className={className} disabled={disabled} onClick={() => ref.current?.showModal()}>
        {children}
      </Button>
      <dialog
        ref={ref}
        className="m-auto w-[min(92vw,420px)] rounded-[var(--radius-card)] border border-line bg-surface p-0 text-ink backdrop:bg-ink/40"
        aria-labelledby={titleId}
      >
        <div className="p-5">
          <h2 id={titleId} className="text-lg font-bold">
            {title}
          </h2>
          {description ? <p className="mt-1.5 text-sm text-ink-soft">{description}</p> : null}
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => ref.current?.close()}>
              Cancel
            </Button>
            <Button
              type="button"
              variant={tone === "danger" ? "danger" : "primary"}
              loading={pending}
              onClick={() =>
                start(async () => {
                  const res = await onConfirm();
                  if (res) toastResult(res);
                  ref.current?.close();
                })
              }
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}

/** Single-image field (logo, banner, OG image). Uploads straight to Storage. */
export function ImageField({
  label,
  value,
  onChange,
  folder,
  aspect = "aspect-[16/9]",
  hint,
  maxEdge,
}: {
  label: string;
  value: string | null;
  onChange: (url: string | null) => void;
  folder: "brands" | "banners" | "site" | "categories";
  aspect?: string;
  hint?: string;
  maxEdge?: number;
}) {
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const up = await uploadImage(file, folder, { maxEdge });
      onChange(up.url);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <p className="text-sm font-medium">{label}</p>
      <div className={cn("relative mt-1.5 overflow-hidden rounded-[var(--radius-control)] border border-dashed border-line-strong bg-paper", aspect)}>
        {value ? (
          <Image src={value} alt="" fill sizes="400px" className="object-contain" unoptimized={isSvg(value)} />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-sm text-ink-mute">No image</span>
        )}
        {busy ? <span className="absolute inset-0 flex items-center justify-center bg-surface/80 text-sm font-medium">Uploading…</span> : null}
      </div>
      <div className="mt-2 flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
          <ImagePlus className="h-4 w-4" aria-hidden />
          {value ? "Replace" : "Upload"}
        </Button>
        {value ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            <Trash2 className="h-4 w-4" aria-hidden />
            Remove
          </Button>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          className="sr-only"
          aria-label={`Upload ${label}`}
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </div>
      {hint ? <p className="mt-1 text-xs text-ink-mute">{hint}</p> : null}
    </div>
  );
}
