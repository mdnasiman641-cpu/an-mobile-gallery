"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { processAiQueueAction, retryAiJobAction, runAiTaskAction, syncStockNowAction } from "@/app/admin/(panel)/ai-products/actions";
import { toastResult } from "@/components/admin/ui";
import { Button, type ButtonProps } from "@/components/ui/button";
import type { ActionResult } from "@/types";

function ActionButton({ label, busyLabel, run, ...props }: { label: string; busyLabel?: string; run: () => Promise<ActionResult> } & Omit<ButtonProps, "onClick">) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      {...props}
      loading={pending}
      onClick={() =>
        start(async () => {
          toastResult(await run());
          router.refresh();
        })
      }
    >
      {pending && busyLabel ? busyLabel : label}
    </Button>
  );
}

export function SyncStockButton({ disabled }: { disabled?: boolean }) {
  return <ActionButton label="Sync stock now" busyLabel="Syncing…" size="sm" disabled={disabled} run={() => syncStockNowAction()} />;
}

export function ProcessQueueButton({ count }: { count: number }) {
  return <ActionButton label={`Process queue (${count})`} busyLabel="Running AI…" size="sm" variant="outline" disabled={count === 0} run={() => processAiQueueAction()} />;
}

export function RetryJobButton({ jobId }: { jobId: string }) {
  return <ActionButton label="Retry" busyLabel="Retrying…" size="sm" variant="outline" run={() => retryAiJobAction(jobId)} />;
}

export function RegenerateButton({ productId }: { productId: string }) {
  return <ActionButton label="Regenerate" busyLabel="Generating…" size="sm" variant="ghost" run={() => runAiTaskAction(productId, "full", false)} />;
}
