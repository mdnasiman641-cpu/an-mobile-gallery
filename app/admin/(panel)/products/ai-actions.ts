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
import { buildResearchRequest, emptyResearch, parseResearch, RESEARCH_MAX_AGE_MS, researchKey, type ProductResearch } from "@/lib/ai/research";
import { conditionFromName, conditionLabel } from "@/lib/utils";
import type { ActionResult } from "@/types";

/**
 * Admin → Products → AI Product Assistant ("Generate All" and the single-part actions).
 *
 * At most: one web-research request (only when it can return sources), ONE structured
 * JSON request for all requested parts, and one follow-up for required fields that came
 * back empty — each with automatic failover across the configured models — and returns
 * suggestions for the form. It never writes to the product: the
 * admin reviews the filled-in form and saves / publishes it themselves.
 * The result is cached on the product so a page reload shows it again
 * without another AI request.
 */

const STALE_MS = 5 * 60_000;
/** Models tried per step when Settings → AI sets no limit (each try can wait up to 90 s). */
const DEFAULT_MAX_ATTEMPTS = 3;
/** No follow-up request after this much time: the admin can retry the missing parts. */
const FOLLOW_UP_BUDGET_MS = 60_000;

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
  /** Specifications already in the form (context for description / SEO / FAQ). */
  knownSpecs: z.array(z.object({ name: z.string().trim().max(80), value: z.string().trim().max(500) })).max(100).optional(),
  /** "Research product": always search again instead of reusing recent research. */
  forceResearch: z.boolean().optional(),
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

  const startedAt = Date.now();
  const [productRes, brandsRes, categoriesRes, cacheRes, lastNoSourcesRes, modelsChangedRes] = await Promise.all([
    supabase.from("products").select("id").eq("id", input.productId).maybeSingle(),
    supabase.from("brands").select("id, name").eq("is_active", true).order("name"),
    supabase.from("categories").select("id, name").eq("is_active", true).order("name"),
    supabase.from("ai_product_content").select("form_completion").eq("product_id", input.productId).maybeSingle(),
    // the last web research (any product) that came back without sources, and the last change to the AI models
    supabase
      .from("ai_product_content")
      .select("research_at:form_completion->research->>at, research_model:form_completion->research->>model")
      .eq("form_completion->research->>status", "no_sources")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("ai_models").select("updated_at").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const cachedRun = (cacheRes.data as { form_completion: CompletionRun | null } | null)?.form_completion ?? null;
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
  const completionInput: CompletionInput = {
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
    knownSpecs: (input.knownSpecs ?? []).filter((x) => x.name && x.value),
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
    // ---- Step 1: live web research (identity + specifications) -------------------
    const key = researchKey(input.name, input.ram, input.storage);
    const recent = cachedRun?.research;
    const reusable = recent && recent.status === "ok" && recent.key === key && Date.now() - Date.parse(recent.at) < RESEARCH_MAX_AGE_MS;
    const wantsFacts = sections.includes("basic") || sections.includes("specs") || (completionInput.knownSpecs?.length ?? 0) < 5;
    let research: ProductResearch | null = null;
    let researchAttempts = 0;
    // The configured research model answered WITHOUT a web search last time (no sources) and the AI
    // models haven't changed since: its notes would be discarded again, so don't wait for it.
    const noSources = lastNoSourcesRes.data as { research_at: string | null; research_model: string | null } | null;
    const modelsChangedAt = Date.parse((modelsChangedRes.data as { updated_at: string } | null)?.updated_at ?? "") || 0;
    const noSourcesAt = Date.parse(noSources?.research_at ?? "") || 0;
    const researchCantSearch = noSourcesAt > modelsChangedAt && Date.now() - noSourcesAt < RESEARCH_MAX_AGE_MS;
    if (wantsFacts || reusable) {
      if (reusable && !input.forceResearch) research = recent;
      else if (researchCantSearch && !input.forceResearch)
        research = emptyResearch(
          "unavailable",
          `Web research skipped: ${noSources?.research_model ?? "the research model"} returned no web sources on its last run, so nothing could be verified. Turn on a model that can search the web (for example Gemini with Google Search) in Settings → AI, or use “Verify specifications”.`,
          key,
        );
      else {
        const r = await runAi(buildResearchRequest(completionInput), {
          jobId,
          defaultMaxAttempts: DEFAULT_MAX_ATTEMPTS,
          validate: (res) => {
            if (!res.text.trim()) throw new AiProviderError("INVALID_RESPONSE", "Empty research answer");
          },
        });
        researchAttempts = r.attempts.length;
        if (r.ok) research = parseResearch(r.response, `${r.model.providerName} / ${r.model.modelName}`, key);
        else if (r.code === "NO_ELIGIBLE_MODEL")
          research = emptyResearch("unavailable", "No AI model has “Research (web)” turned on in Settings → AI, so no web search was done.", key);
        else
          research = emptyResearch(
            "failed",
            `The web search failed: ${(() => {
              const lines = r.attempts.filter((a) => a.status !== "success").map((a) => `${a.provider} / ${a.model}: ${a.errorCode ?? ""} ${a.message ?? ""}`.trim());
              return lines.length ? explainFailures(lines) : r.message;
            })()}`,
            key,
          );
      }
    }
    completionInput.research = research;

    // ---- Step 2: the listing, written from the research --------------------------
    const answer: { completion: ProductCompletion | null } = { completion: null };
    const result = await runAi(buildCompletionRequest(completionInput), {
      jobId,
      defaultMaxAttempts: DEFAULT_MAX_ATTEMPTS,
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
    if (retry.length && check.status !== "failed" && Date.now() - startedAt < FOLLOW_UP_BUDGET_MS) {
      const retryInput: CompletionInput = { ...completionInput, sections: retry };
      const second: { completion: ProductCompletion | null } = { completion: null };
      const again = await runAi(buildCompletionRequest(retryInput), {
        jobId,
        defaultMaxAttempts: DEFAULT_MAX_ATTEMPTS,
        validate: (res) => void (second.completion = readAnswer(res, retryInput)),
      });
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

    const researchNote = completion.researched
      ? null
      : `${research?.message ?? "No web research was needed for this part."} This is a draft from the AI model's own knowledge: values are marked “likely”, not verified.`;
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
      research,
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
    const base: CompletionRun = { ...run, research: run.research ?? prevCompletion?.research ?? null };
    const cached: CompletionRun = mergedCompletion ? { ...base, completion: mergedCompletion, check: evaluateCompletion(mergedCompletion, facts) } : base;
    await supabase
      .from("ai_product_content")
      // a new row shows up in AI Products as "ready for review"; an existing row keeps its status
      .upsert({ product_id: input.productId, form_completion: cached, extras, ...(prev ? {} : { review_status: "ready", model: run.usedModel, generated_at: createdAt }) }, { onConflict: "product_id" });

    const notFilled = check.fields.filter((f) => f.required && (f.state === "failed" || f.state === "partial"));
    await finish("succeeded", {
      attempts: researchAttempts + result.attempts.length + followUp,
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

/**
 * "Cancel" in the AI Product Assistant: the form stops waiting (nothing in it changes) and the
 * product's AI lock is released so a new request can start at once. A request already sent to
 * the provider can't be recalled; its answer is only cached, never applied to the form.
 */
export async function cancelProductAiAction(productId: unknown): Promise<ActionResult> {
  const session = await assertStaff("editor");
  if ("error" in session) return { ok: false, message: session.error };
  const id = z.string().uuid().safeParse(productId);
  if (!id.success) return { ok: false, message: "Invalid product." };
  const supabase = await createClient();
  await supabase
    .from("ai_jobs")
    .update({ status: "failed", completed_at: new Date().toISOString(), error_code: "CANCELLED", error_message: "Cancelled by the admin." })
    .eq("product_id", id.data)
    .eq("task_type", "complete")
    .eq("status", "processing");
  return { ok: true, message: "Cancelled. Nothing in the form was changed." };
}
