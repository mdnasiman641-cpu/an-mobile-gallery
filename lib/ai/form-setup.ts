import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { CompletionRun } from "@/lib/ai/product-completion";

/**
 * What the product form needs for "Complete with AI": whether it can run
 * (migration applied, at least one enabled model) and the cached last result.
 * Reads only; never calls an AI provider.
 */
export async function aiFormSetup(productId?: string): Promise<{ setupMessage: string | null; completion: CompletionRun | null }> {
  const supabase = await createClient();
  const [cacheRes, modelsRes] = await Promise.all([
    productId
      ? supabase.from("ai_product_content").select("form_completion").eq("product_id", productId).maybeSingle()
      : supabase.from("ai_product_content").select("form_completion").limit(1),
    supabase.from("ai_models").select("id").eq("is_enabled", true).limit(1),
  ]);
  if (cacheRes.error || modelsRes.error) {
    return { setupMessage: "Complete with AI needs the latest database migrations (0010, 0011 and 0012) in Supabase.", completion: null };
  }
  const completion = productId ? ((cacheRes.data as { form_completion: CompletionRun | null } | null)?.form_completion ?? null) : null;
  const setupMessage = (modelsRes.data as unknown[] | null)?.length ? null : "No AI model is enabled yet. Add one in Settings → AI.";
  return { setupMessage, completion: completion && completion.completion ? completion : null };
}
