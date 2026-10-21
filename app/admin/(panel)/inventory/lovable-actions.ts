"use server";

// Admin → Inventory → Lovable stock sync. Admins only. The API key stays on the
// server (lib/integrations/lovable-inventory.ts) and is never returned.

import { revalidatePath } from "next/cache";
import { assertStaff } from "@/lib/auth";
import { invalidateStock } from "@/lib/cache";
import { getServiceClient } from "@/lib/supabase/admin";
import { checkLovableConnection, decideLovableGroup, previewLovableInventory, runLovableSync, type PreviewResult, type RunSummary } from "@/lib/integrations/lovable-inventory";
import type { ActionResult } from "@/types";

export async function checkLovableConnectionAction(): Promise<ActionResult> {
  const session = await assertStaff("admin");
  if ("error" in session) return { ok: false, message: session.error };
  const res = await checkLovableConnection();
  revalidatePath("/admin/inventory");
  return { ok: res.ok, message: res.ok && res.incremental === false ? `${res.message} The API ignores updated_since, so every sync reads all pages.` : res.message };
}

export async function syncLovableStockAction(mode: unknown): Promise<ActionResult<Omit<RunSummary, "changedProductIds">>> {
  const session = await assertStaff("admin");
  if ("error" in session) return { ok: false, message: session.error };
  if (mode !== "test" && mode !== "auto") return { ok: false, message: "Invalid sync mode." };
  const res = await runLovableSync(mode);
  if (res.summary?.changedProductIds.length) {
    // refresh only the pages whose stock changed (new imports are drafts: not public)
    const db = getServiceClient();
    const { data } = db ? await db.from("products").select("slug").in("id", res.summary.changedProductIds.slice(0, 200)) : { data: [] };
    invalidateStock(((data ?? []) as { slug: string }[]).map((p) => p.slug));
  }
  revalidatePath("/admin/inventory");
  const { changedProductIds: _ids, ...summary } = res.summary ?? ({} as RunSummary);
  void _ids;
  return { ok: res.ok, message: res.message, data: res.summary ? summary : undefined };
}

/** Read-only: reads every source page, groups the batches and shows what a sync would do. Writes nothing. */
export async function previewLovableStockAction(): Promise<ActionResult<PreviewResult>> {
  const session = await assertStaff("admin");
  if ("error" in session) return { ok: false, message: session.error };
  const res = await previewLovableInventory();
  if (!res.ok) return { ok: false, message: res.message };
  const r = res.result;
  return {
    ok: true,
    message: `Preview: ${r.records} records → ${r.groups.length} products. ${r.counts.create} new draft(s), ${r.counts.skip_zero} skipped (0 stock), ${r.counts.held} need a decision, ${r.counts.update} stock change(s). Nothing was saved.`,
    data: r,
  };
}

/** Explicit admin mapping for one group: link to an existing product, create a new draft, or clear. */
export async function decideLovableGroupAction(groupKey: unknown, decision: unknown, productId?: unknown): Promise<ActionResult> {
  const session = await assertStaff("admin");
  if ("error" in session) return { ok: false, message: session.error };
  if (typeof groupKey !== "string") return { ok: false, message: "Invalid group." };
  const d =
    decision === "link" && typeof productId === "string"
      ? ({ type: "link", productId } as const)
      : decision === "create"
        ? ({ type: "create" } as const)
        : decision === "clear"
          ? ({ type: "clear" } as const)
          : null;
  if (!d) return { ok: false, message: "Invalid decision." };
  const res = await decideLovableGroup(groupKey, d, session.userId ?? null);
  revalidatePath("/admin/inventory");
  return res;
}
