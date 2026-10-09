"use server";

import { z } from "zod";
import { assertStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AiSetupError, runAi } from "@/lib/ai/engine";
import { AiProviderError } from "@/lib/ai/errors";
import { parseJsonObject } from "@/lib/ai/providers";
import { ALL_UNAVAILABLE_MESSAGE } from "@/lib/ai/router";
import { buildCompletionRequest, COMPLETION_SECTIONS, mergeSections, sanitizeCompletion, type CompletionRun } from "@/lib/ai/product-completion";
import type { ActionResult } from "@/types";

/**
 * Admin → Products → Complete with AI.
 *
 * Runs ONE AI request (with automatic failover across the configured models)
 * and returns suggestions for the form. It never writes to the product: the
 * admin reviews the filled-in form and saves / publishes it themselves.
 * The result is cached on the product so a page reload shows it again
 * without another AI request.
 */

const STALE_MS = 5 * 60_000;

const inputSchema = z.object({
  productId: z.string().uuid(),
  name: z.string().trim().min(2, "Enter the product name").max(200),
  ram: z.string().trim().min(1, "Enter the RAM").max(40),
  storage: z.string().trim().min(1, "Enter the ROM / storage").max(40),
  condition: z.enum(["new", "used", "refurbished"]).default("new"),
  brandId: z.string().uuid().nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  model: z.string().trim().max(80).nullable().optional(),
  sections: z.array(z.enum(COMPLETION_SECTIONS)).min(1).max(COMPLETION_SECTIONS.length).default([...COMPLETION_SECTIONS]),
});


export async function completeProductWithAiAction(raw: unknown): Promise<ActionResult<CompletionRun> & { attempts?: string[] }> {
  const session = await assertStaff("editor");
  if ("error" in session) return { ok: false, message: session.error };
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Please check the product name, RAM and storage." };
  const input = parsed.data;
  const sections = Array.from(new Set(input.sections));
  const supabase = await createClient();

  const [productRes, brandsRes, categoriesRes] = await Promise.all([
    supabase.from("products").select("id").eq("id", input.productId).maybeSingle(),
    supabase.from("brands").select("id, name").eq("is_active", true).order("name"),
    supabase.from("categories").select("id, name").eq("is_active", true).order("name"),
  ]);
  if (!productRes.data) return { ok: false, message: "The product draft couldn't be found. Save it and try again." };
  const brands = (brandsRes.data as { id: string; name: string }[]) ?? [];
  const categories = (categoriesRes.data as { id: string; name: string }[]) ?? [];

  // One run per product at a time (database-enforced). A run that died mid-way is released after 5 minutes.
  await supabase
    .from("ai_jobs")
    .update({ status: "failed", completed_at: new Date().toISOString(), error_code: "STALE", error_message: "Did not finish." })
    .eq("product_id", input.productId)
    .eq("task_type", "complete")
    .eq("status", "processing")
    .lt("started_at", new Date(Date.now() - STALE_MS).toISOString());
  const { data: jobRow, error: jobError } = await supabase
    .from("ai_jobs")
    .insert({ product_id: input.productId, task_type: "complete", status: "processing", trigger: "manual", started_at: new Date().toISOString(), requested_by: session.userId })
    .select("id")
    .single();
  if (jobError || !jobRow) {
    if (jobError?.code === "23505") return { ok: false, message: "AI is already working on this product. Please wait for it to finish." };
    return { ok: false, message: /ai_jobs|task_type|check constraint/i.test(jobError?.message ?? "") ? "Run the latest database migration (0012) to use Complete with AI." : "Couldn't start the AI request. Please try again." };
  }
  const jobId = (jobRow as { id: string }).id;
  const finish = (status: "succeeded" | "failed", fields: Record<string, unknown>) =>
    supabase.from("ai_jobs").update({ status, completed_at: new Date().toISOString(), ...fields }).eq("id", jobId);

  const nameOf = (list: { id: string; name: string }[], id: string | null | undefined) => (id ? (list.find((x) => x.id === id)?.name ?? null) : null);
  const completionInput = {
    name: input.name,
    ram: input.ram,
    storage: input.storage,
    condition: input.condition,
    brand: nameOf(brands, input.brandId),
    category: nameOf(categories, input.categoryId),
    model: input.model || null,
    brandOptions: brands.map((b) => b.name),
    categoryOptions: categories.map((c) => c.name),
    sections,
  };

  try {
    const answer: { json: Record<string, unknown> | null } = { json: null };
    const result = await runAi(buildCompletionRequest(completionInput), {
      jobId,
      // An answer that isn't a JSON object counts as a failure, so the next model is tried.
      validate: (res) => {
        answer.json = parseJsonObject(res.text);
      },
    });
    const tried = result.attempts.filter((a) => a.status !== "skipped");
    const chain = tried.map((a) => `${a.provider} / ${a.model}`).filter((m, i, all) => all.indexOf(m) === i);
    const skipped = result.attempts.filter((a) => a.status === "skipped").map((a) => `${a.provider} / ${a.model}: ${a.message ?? a.errorCode ?? "skipped"}`);

    if (!result.ok || !answer.json) {
      const failures = tried.filter((a) => a.status === "failed").map((a) => `${a.provider} / ${a.model}: ${a.errorCode}${a.httpStatus ? ` (${a.httpStatus})` : ""} ${a.message ?? ""}`.trim());
      await finish("failed", { attempts: result.attempts.length, error_code: result.ok ? "INVALID_RESPONSE" : result.code, error_message: (result.ok ? "The AI answer could not be read." : result.message).slice(0, 1000) });
      const noModels = !result.ok && result.code === "NO_ELIGIBLE_MODEL";
      return {
        ok: false,
        message: noModels ? `${result.message} Add or enable models in Settings → AI.` : ALL_UNAVAILABLE_MESSAGE,
        attempts: [...failures, ...skipped],
      };
    }

    const completion = sanitizeCompletion(answer.json, completionInput, result.response.sources, { brands, categories });
    const createdAt = new Date().toISOString();
    const run: CompletionRun = {
      completion,
      usedModel: `${result.model.providerName} / ${result.model.modelName}`,
      chain,
      skipped,
      fallbackUsed: result.fallbackUsed,
      createdAt,
    };

    // Cache the result (not applied to the product). FAQ and keywords have no
    // form fields, so they are kept with the AI content unless edited by hand.
    const { data: existing } = await supabase.from("ai_product_content").select("extras, form_completion").eq("product_id", input.productId).maybeSingle();
    const prev = existing as { extras: Record<string, unknown> | null; form_completion: CompletionRun | null } | null;
    const prevExtras = (prev?.extras ?? {}) as Record<string, unknown>;
    const extras = prevExtras.manual
      ? prevExtras
      : {
          ...prevExtras,
          ...(sections.includes("faq") ? { faq: completion.faq } : {}),
          ...(sections.includes("seo") ? { keywords: completion.seo.keywords } : {}),
        };
    const prevCompletion = prev?.form_completion ?? null;
    // Regenerating one section keeps the other sections of the last result.
    const cached: CompletionRun =
      prevCompletion && sections.length < COMPLETION_SECTIONS.length
        ? { ...run, completion: mergeSections(prevCompletion.completion, completion) }
        : run;
    await supabase
      .from("ai_product_content")
      // a new row shows up in AI Products as "ready for review"; an existing row keeps its status
      .upsert({ product_id: input.productId, form_completion: cached, extras, ...(prev ? {} : { review_status: "ready", model: run.usedModel, generated_at: createdAt }) }, { onConflict: "product_id" });

    await finish("succeeded", {
      attempts: result.attempts.length,
      fallback_used: result.fallbackUsed,
      final_model_id: result.model.id,
      final_provider: result.model.providerName,
      final_model: result.model.modelName,
    });
    return { ok: true, message: "AI completed the product information. Please review before saving.", data: run };
  } catch (e) {
    const message = e instanceof AiSetupError ? e.message : e instanceof AiProviderError ? e.message : "The AI request failed. Please try again.";
    await finish("failed", { error_code: e instanceof AiSetupError ? "SETUP" : "ERROR", error_message: message.slice(0, 1000) });
    return { ok: false, message };
  }
}
