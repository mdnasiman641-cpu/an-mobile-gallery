import "server-only";
import { aiDb } from "@/lib/ai/db";
import { AiSetupError, runAi } from "@/lib/ai/engine";
import { parseJsonObject } from "@/lib/ai/providers";
import { AiProviderError } from "@/lib/ai/errors";
import {
  contentGaps,
  buildRequest,
  needsVerification,
  planMerge,
  sanitizeContent,
  type Applied,
  type ContentTask,
  type ProductAiContent,
  type ProductAiInput,
  type ProductSnapshot,
} from "@/lib/ai/product-content";
import { invalidateProduct } from "@/lib/cache";

/**
 * AI job queue (stored in Supabase, processed on demand — no polling).
 *  - enqueueAiJob: one pending/processing job per product (database-enforced).
 *  - processAiJob: claims the job, runs the AI with failover, writes the result.
 * Jobs stuck in "processing" for 10+ minutes (e.g. the Worker was stopped)
 * can be claimed again.
 */

const STALE_MS = 10 * 60_000;

export interface JobOutcome {
  ok: boolean;
  message: string;
  jobId?: string;
  keptManual?: string[];
}


async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function enqueueAiJob(
  productId: string,
  task: ContentTask,
  opts: { replaceManual?: boolean; trigger?: "manual" | "import" | "retry"; requestedBy?: string | null } = {},
): Promise<{ jobId: string; alreadyQueued: boolean }> {
  const client = await aiDb();
  const { data, error } = await client
    .from("ai_jobs")
    .insert({
      product_id: productId,
      task_type: task,
      replace_manual: Boolean(opts.replaceManual),
      trigger: opts.trigger ?? "manual",
      requested_by: opts.requestedBy ?? null,
    })
    .select("id")
    .single();
  if (!error && data) {
    await client.from("ai_product_content").upsert({ product_id: productId, review_status: "pending" }, { onConflict: "product_id", ignoreDuplicates: true });
    return { jobId: (data as { id: string }).id, alreadyQueued: false };
  }
  if (error?.code === "23505") {
    const { data: active } = await client
      .from("ai_jobs")
      .select("id")
      .eq("product_id", productId)
      .in("status", ["pending", "processing"])
      .maybeSingle();
    if (active) return { jobId: (active as { id: string }).id, alreadyQueued: true };
  }
  throw new Error(`Couldn't queue the AI job: ${error?.message ?? "unknown error"}`);
}

interface ProductRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  model: string | null;
  sku: string | null;
  mpn: string | null;
  condition: string;
  stock_quantity: number;
  short_description: string | null;
  description: string | null;
  meta_title: string | null;
  meta_description: string | null;
  brand_id: string | null;
  category_id: string | null;
  brand: { name: string } | null;
  product_specifications: { group_name: string; name: string; value: string; sort_order: number }[];
  product_features: { feature: string; sort_order: number }[];
}

export async function processAiJob(jobId: string): Promise<JobOutcome> {
  const client = await aiDb();
  const staleBefore = new Date(Date.now() - STALE_MS).toISOString();
  const { data: claimed } = await client
    .from("ai_jobs")
    .update({ status: "processing", started_at: new Date().toISOString() })
    .eq("id", jobId)
    // "complete" jobs belong to the product form's Complete with AI (never processed here)
    .neq("task_type", "complete")
    .or(`status.eq.pending,and(status.eq.processing,started_at.lt.${staleBefore})`)
    .select("id, product_id, task_type, replace_manual, trigger")
    .maybeSingle();
  const job = claimed as { id: string; product_id: string; task_type: ContentTask | "test"; replace_manual: boolean; trigger: string } | null;
  if (!job) return { ok: false, message: "This AI job is already running or finished.", jobId };
  const task = job.task_type === "test" ? "full" : job.task_type;

  const finish = async (status: "succeeded" | "failed", fields: Record<string, unknown>) =>
    client.from("ai_jobs").update({ status, completed_at: new Date().toISOString(), ...fields }).eq("id", job.id);

  try {
    await client.from("ai_product_content").upsert({ product_id: job.product_id, review_status: "processing" }, { onConflict: "product_id" });

    const [productRes, contentRes, sourceRes, brandsRes, categoriesRes, reviewsRes] = await Promise.all([
      client
        .from("products")
        .select(
          "id, name, slug, status, model, sku, mpn, condition, stock_quantity, short_description, description, meta_title, meta_description, brand_id, category_id, brand:brands(name), product_specifications(group_name, name, value, sort_order), product_features(feature, sort_order)",
        )
        .eq("id", job.product_id)
        .maybeSingle(),
      client.from("ai_product_content").select("applied, input_hash, content, extras").eq("product_id", job.product_id).maybeSingle(),
      client.from("product_external_sources").select("payload").eq("product_id", job.product_id).order("last_synced_at", { ascending: false }).limit(1).maybeSingle(),
      client.from("brands").select("id, name").eq("is_active", true),
      client.from("categories").select("id, name").eq("is_active", true),
      client.from("reviews").select("rating, title, body").eq("product_id", job.product_id).eq("status", "approved").limit(15),
    ]);
    const p = productRes.data as ProductRow | null;
    if (!p) {
      await finish("failed", { error_code: "PRODUCT_MISSING", error_message: "The product no longer exists." });
      return { ok: false, message: "The product no longer exists.", jobId };
    }
    const brands = (brandsRes.data as { id: string; name: string }[]) ?? [];
    const categories = (categoriesRes.data as { id: string; name: string }[]) ?? [];
    const stock = ((sourceRes.data as { payload: Record<string, unknown> } | null)?.payload ?? null) as ProductAiInput["stock"];
    const existing = contentRes.data as { applied: Applied; input_hash: string | null; content: Partial<ProductAiContent>; extras: Record<string, unknown> | null } | null;

    const specs = [...(p.product_specifications ?? [])].sort((a, b) => a.sort_order - b.sort_order);
    const features = [...(p.product_features ?? [])].sort((a, b) => a.sort_order - b.sort_order).map((f) => f.feature);
    const input: ProductAiInput = {
      name: p.name,
      brand: p.brand?.name ?? null,
      model: p.model,
      sku: p.sku,
      mpn: p.mpn,
      condition: p.condition,
      stockQuantity: p.stock_quantity,
      shortDescription: p.short_description,
      description: p.description,
      specs: specs.map((s) => ({ name: s.name, value: s.value })),
      features,
      stock: stock
        ? { ram: str(stock.ram), storage: str(stock.storage), condition: str(stock.condition), color: str(stock.color), model: str(stock.model), notes: str(stock.notes) }
        : null,
      brandOptions: brands.map((b) => b.name),
      categoryOptions: categories.map((c) => c.name),
      approvedReviews: ((reviewsRes.data as { rating: number; title: string | null; body: string }[]) ?? []).map((r) => ({ ...r, body: r.body.slice(0, 400) })),
    };

    // Same input as last time for an automatic run → reuse, don't call the AI again.
    const hash = await sha256(JSON.stringify({ task, input }));
    if (job.trigger === "import" && existing?.input_hash === hash && existing.content && Object.keys(existing.content).length) {
      await client.from("ai_product_content").update({ review_status: needsVerification(existing.content as ProductAiContent) ? "needs_verification" : "ready" }).eq("product_id", p.id);
      await finish("succeeded", { error_code: "CACHED", error_message: "Same product data as the last run; previous AI content reused." });
      return { ok: true, message: "Nothing changed since the last run; kept the existing AI content.", jobId };
    }

    const answer: { json: Record<string, unknown> | null } = { json: null };
    const result = await runAi(buildRequest(input, task, task === "verify" || task === "full"), {
      jobId: job.id,
      // JSON that has none of the requested fields is not a success: try the next model.
      validate: (res) => {
        const json = parseJsonObject(res.text);
        const gaps = contentGaps(task, sanitizeContent(json, input, res.sources));
        if (gaps.missing.length === gaps.requested.length) throw new AiProviderError("INVALID_RESPONSE", `The answer had none of the requested fields (${gaps.missing.join(", ")})`);
        answer.json = json;
      },
    });
    const parsed = answer.json;
    if (!result.ok || !parsed) {
      const message = result.ok ? "The AI answer could not be read." : result.message;
      await client.from("ai_product_content").update({ review_status: "failed" }).eq("product_id", p.id);
      await finish("failed", { attempts: result.attempts.length, error_code: result.ok ? "INVALID_RESPONSE" : result.code, error_message: message.slice(0, 1000) });
      return { ok: false, message, jobId };
    }

    const content = sanitizeContent(parsed, input, result.response.sources);
    const gaps = contentGaps(task, content);
    const findId = (list: { id: string; name: string }[], name: string | null) => (name ? (list.find((x) => x.name.toLowerCase() === name.toLowerCase())?.id ?? null) : null);
    const current: ProductSnapshot = {
      name: p.name,
      short_description: p.short_description,
      description: p.description,
      meta_title: p.meta_title,
      meta_description: p.meta_description,
      model: p.model,
      brand_id: p.brand_id,
      category_id: p.category_id,
      features,
      specs: specs.map((s) => ({ group_name: s.group_name, name: s.name, value: s.value })),
    };
    const plan = planMerge(task, content, current, existing?.applied ?? {}, { brandId: findId(brands, content.suggested_brand), categoryId: findId(categories, content.suggested_category) }, job.replace_manual);

    // Only content fields are written. Price, stock, status and images are never touched here.
    if (Object.keys(plan.update).length) {
      const { error } = await client.from("products").update(plan.update).eq("id", p.id);
      if (error) throw new Error(`Saving the product failed: ${error.message}`);
    }
    if (plan.features) {
      await client.from("product_features").delete().eq("product_id", p.id);
      if (plan.features.length) await client.from("product_features").insert(plan.features.map((feature, i) => ({ product_id: p.id, feature, sort_order: i })));
    }
    if (plan.specs) {
      await client.from("product_specifications").delete().eq("product_id", p.id);
      if (plan.specs.length) await client.from("product_specifications").insert(plan.specs.map((s, i) => ({ product_id: p.id, ...s, sort_order: i })));
    }

    // Partial tasks keep the previous full content for the fields they don't produce.
    const prev = (existing?.content ?? {}) as Partial<ProductAiContent>;
    const merged: ProductAiContent =
      task === "full"
        ? content
        : {
            ...(prev as ProductAiContent),
            ...(task === "seo" ? { seo: content.seo } : {}),
            ...(task === "description" || task === "improve"
              ? { short_description: content.short_description, description: content.description, highlights: content.highlights, ...(task === "improve" ? { title: content.title } : {}) }
              : {}),
            ...(task === "faq" ? { faq: content.faq } : {}),
            ...(task === "verify" ? { specs: content.specs } : {}),
            condition: content.condition,
            specs: task === "verify" || !prev.specs ? content.specs : prev.specs,
          };
    const generatedExtras = { faq: merged.faq ?? [], tags: merged.tags ?? [], keywords: merged.seo?.keywords ?? [], search_attributes: merged.search_attributes ?? [], short_title: merged.short_title ?? null };
    // FAQ / keywords / tags edited by hand stay unless the admin chose to replace edits.
    const prevExtras = existing?.extras ?? null;
    const extras =
      prevExtras?.manual && !job.replace_manual
        ? { ...generatedExtras, faq: prevExtras.faq ?? [], keywords: prevExtras.keywords ?? [], tags: prevExtras.tags ?? [], manual: true }
        : generatedExtras;
    await client
      .from("ai_product_content")
      .update({
        content: merged,
        applied: plan.applied,
        extras,
        sources: result.response.sources,
        input_hash: hash,
        model: `${result.model.providerName} · ${result.model.modelName}`,
        generated_at: new Date().toISOString(),
        review_status: needsVerification(merged) || gaps.missing.length ? "needs_verification" : "ready",
      })
      .eq("product_id", p.id);
    await finish("succeeded", {
      attempts: result.attempts.length,
      fallback_used: result.fallbackUsed,
      final_model_id: result.model.id,
      final_provider: result.model.providerName,
      final_model: result.model.modelName,
      ...(gaps.missing.length ? { error_code: "PARTIAL", error_message: `Not filled by AI: ${gaps.missing.join(", ")}` } : {}),
    });
    if (p.status === "active" || p.status === "out_of_stock") {
      try {
        invalidateProduct([p.slug]);
      } catch {
        // outside a request (background run): the page refreshes on its normal schedule
      }
    }

    const kept = plan.keptManual.length ? ` Kept your edits to: ${plan.keptManual.join(", ").replace(/_/g, " ")}.` : "";
    const via = `${result.model.displayName}${result.fallbackUsed ? ", after failover" : ""}`;
    if (gaps.missing.length) {
      return { ok: true, message: `AI content partly ready (${via}). Not filled: ${gaps.missing.join(", ")} — run that part again.${kept}`, jobId, keptManual: plan.keptManual };
    }
    return { ok: true, message: `AI content ready (${via}).${kept}`, jobId, keptManual: plan.keptManual };
  } catch (e) {
    const message = e instanceof AiSetupError ? e.message : `AI job failed: ${(e as Error).message}`.slice(0, 1000);
    await client.from("ai_product_content").update({ review_status: "failed" }).eq("product_id", job.product_id);
    await finish("failed", { error_code: e instanceof AiSetupError ? "SETUP" : "ERROR", error_message: message });
    return { ok: false, message, jobId };
  }
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : typeof v === "number" ? String(v) : null;
}

/** Process up to `limit` queued jobs, oldest first (Admin → AI Products → Process queue). */
export async function processPendingJobs(limit = 2): Promise<JobOutcome[]> {
  const client = await aiDb();
  const staleBefore = new Date(Date.now() - STALE_MS).toISOString();
  const { data } = await client
    .from("ai_jobs")
    .select("id")
    .neq("task_type", "complete")
    .or(`status.eq.pending,and(status.eq.processing,started_at.lt.${staleBefore})`)
    .order("created_at", { ascending: true })
    .limit(limit);
  const out: JobOutcome[] = [];
  for (const row of (data as { id: string }[]) ?? []) out.push(await processAiJob(row.id));
  return out;
}
