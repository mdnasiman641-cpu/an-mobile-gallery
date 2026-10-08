"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AiSetupError } from "@/lib/ai/engine";
import { enqueueAiJob, processAiJob, processPendingJobs } from "@/lib/ai/jobs";
import type { ContentTask } from "@/lib/ai/product-content";
import { syncFromExportUrl } from "@/lib/integrations/stock-sync";
import type { ActionResult } from "@/types";

const TASKS: ContentTask[] = ["full", "verify", "seo", "description", "faq", "improve"];
const uuid = z.string().uuid();

/** Queue an AI task for a product and run it now (the admin waits for the result). */
export async function runAiTaskAction(productId: string, task: ContentTask, replaceManual: boolean): Promise<ActionResult> {
  const session = await assertStaff("editor");
  if ("error" in session) return { ok: false, message: session.error };
  if (!uuid.safeParse(productId).success || !TASKS.includes(task)) return { ok: false, message: "Invalid request." };
  try {
    const { jobId, alreadyQueued } = await enqueueAiJob(productId, task, { replaceManual, trigger: "manual", requestedBy: session.userId });
    if (alreadyQueued) {
      const res = await processAiJob(jobId); // picks it up if it was stuck; otherwise reports it is running
      revalidatePath(`/admin/products/${productId}`);
      return { ok: res.ok, message: res.ok ? res.message : "An AI job for this product is already running. Try again in a minute." };
    }
    const res = await processAiJob(jobId);
    revalidatePath(`/admin/products/${productId}`);
    revalidatePath("/admin/ai-products");
    return { ok: res.ok, message: res.message };
  } catch (e) {
    return { ok: false, message: e instanceof AiSetupError ? e.message : `AI request failed: ${(e as Error).message}` };
  }
}

export async function retryAiJobAction(jobId: string): Promise<ActionResult> {
  const session = await assertStaff("editor");
  if ("error" in session) return { ok: false, message: session.error };
  if (!uuid.safeParse(jobId).success) return { ok: false, message: "Invalid job." };
  const supabase = await createClient();
  const { data } = await supabase.from("ai_jobs").select("product_id, task_type, replace_manual").eq("id", jobId).maybeSingle();
  const job = data as { product_id: string; task_type: ContentTask; replace_manual: boolean } | null;
  if (!job) return { ok: false, message: "Job not found." };
  try {
    const { jobId: next } = await enqueueAiJob(job.product_id, job.task_type, { replaceManual: job.replace_manual, trigger: "retry", requestedBy: session.userId });
    const res = await processAiJob(next);
    revalidatePath("/admin/ai-products");
    return { ok: res.ok, message: res.message };
  } catch (e) {
    return { ok: false, message: e instanceof AiSetupError ? e.message : (e as Error).message };
  }
}

/** Run the oldest queued jobs (imports that were not processed yet). */
export async function processAiQueueAction(): Promise<ActionResult> {
  const session = await assertStaff("editor");
  if ("error" in session) return { ok: false, message: session.error };
  try {
    const results = await processPendingJobs(2);
    revalidatePath("/admin/ai-products");
    if (results.length === 0) return { ok: true, message: "The AI queue is empty." };
    const done = results.filter((r) => r.ok).length;
    return { ok: done > 0, message: `${done} of ${results.length} queued product${results.length === 1 ? "" : "s"} processed.${done < results.length ? ` ${results.find((r) => !r.ok)?.message ?? ""}` : ""}` };
  } catch (e) {
    return { ok: false, message: e instanceof AiSetupError ? e.message : (e as Error).message };
  }
}

const extrasSchema = z.object({
  faq: z.array(z.object({ q: z.string().trim().min(3).max(200), a: z.string().trim().min(2).max(600) })).max(12),
  keywords: z.array(z.string().trim().min(1).max(40)).max(20),
  tags: z.array(z.string().trim().min(1).max(30)).max(20),
});

/** Save FAQ / keywords / tags edited by hand. Marks them as manual so AI won't overwrite them. */
export async function saveAiExtrasAction(productId: string, values: unknown): Promise<ActionResult> {
  const session = await assertStaff("editor");
  if ("error" in session) return { ok: false, message: session.error };
  if (!uuid.safeParse(productId).success) return { ok: false, message: "Invalid product." };
  const parsed = extrasSchema.safeParse(values);
  if (!parsed.success) return { ok: false, message: "Each FAQ needs a question and an answer; keywords and tags must be short." };
  const supabase = await createClient();
  const { data } = await supabase.from("ai_product_content").select("extras").eq("product_id", productId).maybeSingle();
  const extras = { ...((data as { extras: Record<string, unknown> } | null)?.extras ?? {}), ...parsed.data, manual: true };
  const { error } = await supabase.from("ai_product_content").upsert({ product_id: productId, extras }, { onConflict: "product_id" });
  if (error) return { ok: false, message: "Couldn't save. Has the latest database migration been run?" };
  revalidatePath(`/admin/products/${productId}`);
  return { ok: true, message: "Saved (marked as manually edited)" };
}

/** Admin → AI Products → "Sync stock now". */
export async function syncStockNowAction(): Promise<ActionResult> {
  const session = await assertStaff("admin");
  if ("error" in session) return { ok: false, message: session.error };
  const res = await syncFromExportUrl();
  revalidatePath("/admin/ai-products");
  return { ok: res.ok, message: res.message };
}
