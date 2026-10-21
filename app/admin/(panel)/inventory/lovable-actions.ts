"use server";

// Admin → Inventory → Lovable stock sync. Admins only. The API key stays on the
// server (lib/integrations/lovable-inventory.ts) and is never returned.

import { revalidatePath } from "next/cache";
import { assertStaff } from "@/lib/auth";
import { invalidateStock } from "@/lib/cache";
import { getServiceClient } from "@/lib/supabase/admin";
import { checkLovableConnection, previewLovableInventory, runLovableSync, type PageMeta, type PreviewRow, type RunSummary } from "@/lib/integrations/lovable-inventory";
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

/** Read-only: fetches one page of 10 source records and shows how each would be mapped. Writes nothing. */
export async function previewLovableStockAction(page: unknown): Promise<ActionResult<{ rows: PreviewRow[]; meta: PageMeta; page: number }>> {
  const session = await assertStaff("admin");
  if ("error" in session) return { ok: false, message: session.error };
  const n = typeof page === "number" ? page : Number(page);
  const res = await previewLovableInventory(Number.isInteger(n) ? n : 1);
  if (!res.ok) return { ok: false, message: res.message };
  const failed = res.rows.filter((r) => r.error).length;
  return {
    ok: true,
    message: `Preview of page ${res.page}: ${res.rows.length} record(s), ${failed} would fail. Nothing was saved.`,
    data: { rows: res.rows, meta: res.meta, page: res.page },
  };
}
