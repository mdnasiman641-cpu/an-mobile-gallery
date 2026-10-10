"use server";

import { z } from "zod";
import { assertStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AiSetupError, runAi } from "@/lib/ai/engine";
import { AiProviderError, explainFailures } from "@/lib/ai/errors";
import { parseJsonObject } from "@/lib/ai/providers";
import { ALL_UNAVAILABLE_MESSAGE } from "@/lib/ai/router";
import {
  buildCompletionRequest,
  COMPLETION_SECTIONS,
  evaluateCompletion,
  fillGaps,
  mergeSections,
  SECTION_LABELS,
  sanitizeCompletion,
  type CompletionInput,
  type CompletionRun,
  type ProductCompletion,
} from "@/lib/ai/product-completion";
import { conditionFromName, conditionLabel } from "@/lib/utils";
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
  const named = conditionFromName(input.name);
  if (named && input.condition === "new") {
    return { ok: false, message: `The name says ${conditionLabel[named]} but Condition is New. Fix the Condition first so the description isn't wrong.` };
  }
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

  const taxonomy = { brands, categories };
  const facts = { name: input.name, ram: input.ram, storage: input.storage, condition: input.condition };
  /** Parse + clean + judge one answer. An answer with none of the requested fields fails over to the next model. */
  const readAnswer = (res: { text: string; sources: { url: string; title: string | null }[] }, req: CompletionInput) => {
    const c = sanitizeCompletion(parseJsonObject(res.text), req, res.sources, taxonomy);
    if (evaluateCompletion(c, facts).status === "failed") throw new AiProviderError("INVALID_RESPONSE", "The answer had none of the requested fields");
    return c;
  };

  try {
    const answer: { completion: ProductCompletion | null } = { completion: null };
    const result = await runAi(buildCompletionRequest(completionInput), {
      jobId,
      // Not JSON, or JSON without any requested field, counts as a failure: the next model is tried.
      validate: (res) => {
        answer.completion = readAnswer(res, completionInput);
      },
    });
    const tried = result.attempts.filter((a) => a.status !== "skipped");
    const chain = tried.map((a) => `${a.provider} / ${a.model}`).filter((m, i, all) => all.indexOf(m) === i);
    const skipped = result.attempts.filter((a) => a.status === "skipped").map((a) => `${a.provider} / ${a.model}: ${a.message ?? a.errorCode ?? "skipped"}`);

    if (!result.ok || !answer.completion) {
      const failures = tried.filter((a) => a.status === "failed").map((a) => `${a.provider} / ${a.model}: ${a.errorCode}${a.httpStatus ? ` (${a.httpStatus})` : ""} ${a.message ?? ""}`.trim());
      await finish("failed", { attempts: result.attempts.length, error_code: result.ok ? "INVALID_RESPONSE" : result.code, error_message: (result.ok ? "The AI answer could not be read." : result.message).slice(0, 1000) });
      const noModels = !result.ok && result.code === "NO_ELIGIBLE_MODEL";
      return {
        ok: false,
        // the real reason, from what the providers answered (no specs are made up when this happens)
        message: noModels ? `${result.message} Add or enable models in Settings → AI.` : `${ALL_UNAVAILABLE_MESSAGE} ${explainFailures([...failures, ...skipped])}`,
        attempts: [...failures, ...skipped],
      };
    }

    let completion = answer.completion;
    let check = evaluateCompletion(completion, facts);
    let usedModel = result.model;
    let followUp = 0;

    // The model answered but left required fields empty: ask once more, only for those
    // sections, and keep everything that was already filled.
    const retry = check.retrySections.filter((x) => sections.includes(x));
    if (retry.length && check.status !== "failed") {
      const retryInput: CompletionInput = { ...completionInput, sections: retry };
      const second: { completion: ProductCompletion | null } = { completion: null };
      const again = await runAi(buildCompletionRequest(retryInput), { jobId, validate: (res) => void (second.completion = readAnswer(res, retryInput)) });
      followUp = again.attempts.filter((a) => a.status !== "skipped").length;
      if (again.ok && second.completion) {
        const extra = second.completion;
        completion = { ...fillGaps(completion, extra), sections };
        check = evaluateCompletion(completion, facts);
        if (!check.retrySections.length) usedModel = again.model;
      }
    }

    if (check.status === "failed") {
      const missing = check.fields.filter((f) => f.state === "failed").map((f) => f.label);
      await finish("failed", { attempts: result.attempts.length + followUp, error_code: "EMPTY_RESULT", error_message: `The AI answer had none of the requested fields: ${missing.join(", ")}`.slice(0, 1000) });
      return { ok: false, message: `${usedModel.displayName} answered, but none of the requested fields could be used (${missing.join(", ")}). Nothing in the form was changed. Try again or use another model.` };
    }

    const researchCapable = usedModel.capabilities.includes("research");
    const researchNote = completion.researched
      ? null
      : researchCapable
        ? "Web search was allowed, but the model returned no sources for this product. Values are marked “likely”, not verified."
        : `No web research: ${usedModel.displayName} has “Research (web)” turned off in Settings → AI, so values come from the model's own knowledge and are marked “likely”, not verified.`;
    const createdAt = new Date().toISOString();
    const run: CompletionRun = {
      completion,
      usedModel: `${usedModel.providerName} / ${usedModel.modelName}`,
      chain,
      skipped,
      fallbackUsed: result.fallbackUsed,
      createdAt,
      check,
      researchNote,
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
    const mergedCompletion: ProductCompletion | null = prevCompletion && sections.length < COMPLETION_SECTIONS.length ? mergeSections(prevCompletion.completion, completion) : null;
    const cached: CompletionRun = mergedCompletion ? { ...run, completion: mergedCompletion, check: evaluateCompletion(mergedCompletion, facts) } : run;
    await supabase
      .from("ai_product_content")
      // a new row shows up in AI Products as "ready for review"; an existing row keeps its status
      .upsert({ product_id: input.productId, form_completion: cached, extras, ...(prev ? {} : { review_status: "ready", model: run.usedModel, generated_at: createdAt }) }, { onConflict: "product_id" });

    const notFilled = check.fields.filter((f) => f.required && (f.state === "failed" || f.state === "partial"));
    await finish("succeeded", {
      attempts: result.attempts.length + followUp,
      fallback_used: result.fallbackUsed,
      final_model_id: usedModel.id,
      final_provider: usedModel.providerName,
      final_model: usedModel.modelName,
      ...(check.status === "partial" ? { error_code: "PARTIAL", error_message: `Incomplete: ${notFilled.map((f) => `${f.label} (${f.note ?? f.state})`).join("; ")}`.slice(0, 1000) } : {}),
    });
    if (check.status === "success") return { ok: true, message: "AI completed the product information. Please review before saving.", data: run };
    const requestedCount = check.fields.filter((f) => f.required && f.state !== "skipped").length;
    const failedNames = notFilled.filter((f) => f.state === "failed").map((f) => f.label);
    const partialNames = notFilled.filter((f) => f.state === "partial").map((f) => f.label);
    return {
      ok: true,
      message: [
        `Partly completed: ${requestedCount - notFilled.length} of ${requestedCount} fields are complete.`,
        failedNames.length ? `Not filled: ${failedNames.join(", ")}.` : "",
        partialNames.length ? `Check: ${partialNames.join(", ")}.` : "",
        `Review before saving${check.retrySections.length ? `, or retry ${check.retrySections.map((x) => SECTION_LABELS[x]).join(", ")}` : ""}.`,
      ]
        .filter(Boolean)
        .join(" "),
      data: run,
    };
  } catch (e) {
    const message = e instanceof AiSetupError ? e.message : e instanceof AiProviderError ? e.message : "The AI request failed. Please try again.";
    await finish("failed", { error_code: e instanceof AiSetupError ? "SETUP" : "ERROR", error_message: message.slice(0, 1000) });
    return { ok: false, message };
  }
}
