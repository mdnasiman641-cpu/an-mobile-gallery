import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { encryptionAvailable } from "@/lib/ai/crypto";
import { meetsRequirements, orderModels } from "@/lib/ai/router";
import type { AiCapability, AiModelConfig, HealthStatus, ProviderType, RoutingStrategy } from "@/lib/ai/types";
import { AdminPageHeader } from "@/components/admin/page-header";
import { AiSettingsManager, type ModelRowView } from "@/components/admin/ai-settings";
import { isFuture } from "@/components/admin/ai-health";

export const metadata: Metadata = { title: "AI settings" };

interface Row {
  id: string;
  provider_name: string;
  display_name: string;
  provider_type: ProviderType;
  api_base_url: string;
  model_name: string;
  api_key_hint: string | null;
  is_enabled: boolean;
  priority: number;
  timeout_ms: number;
  max_retries: number;
  rpm_limit: number | null;
  rpd_limit: number | null;
  cost_input_per_million: string | number | null;
  cost_output_per_million: string | number | null;
  quality_score: number | null;
  capabilities: AiCapability[];
}

export default async function AiSettingsPage() {
  await requireStaff("admin");
  const supabase = await createClient();
  // The API key column is never selected (and can't be: browser roles have no access to it).
  const [modelsRes, healthRes, settingsRes, fallbackRes] = await Promise.all([
    supabase
      .from("ai_models")
      .select(
        "id, provider_name, display_name, provider_type, api_base_url, model_name, api_key_hint, is_enabled, priority, timeout_ms, max_retries, rpm_limit, rpd_limit, cost_input_per_million, cost_output_per_million, quality_score, capabilities",
      )
      .order("priority")
      .order("display_name"),
    supabase.from("ai_model_health").select("*"),
    supabase.from("ai_settings").select("routing_strategy, max_attempts").eq("id", 1).maybeSingle(),
    supabase.from("ai_jobs").select("final_provider, final_model, completed_at").eq("fallback_used", true).order("completed_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const migrationMissing = Boolean(modelsRes.error);
  const health = new Map(((healthRes.data as Record<string, unknown>[]) ?? []).map((h) => [h.model_id as string, h]));
  const num = (v: string | number | null) => (v === null || v === "" ? null : Number(v));
  const rows: ModelRowView[] = ((modelsRes.data as Row[]) ?? []).map((r) => {
    const h = health.get(r.id) ?? {};
    return {
      id: r.id,
      providerName: r.provider_name,
      displayName: r.display_name,
      providerType: r.provider_type,
      apiBaseUrl: r.api_base_url,
      modelName: r.model_name,
      keyHint: r.api_key_hint,
      isEnabled: r.is_enabled,
      priority: r.priority,
      timeoutSeconds: Math.round(r.timeout_ms / 1000),
      maxRetries: r.max_retries,
      rpmLimit: r.rpm_limit,
      rpdLimit: r.rpd_limit,
      costIn: num(r.cost_input_per_million),
      costOut: num(r.cost_output_per_million),
      qualityScore: r.quality_score,
      capabilities: r.capabilities ?? [],
      hasKey: Boolean(r.api_key_hint),
      status: ((h.status as HealthStatus) ?? "HEALTHY") as HealthStatus,
      cooldownUntil: (h.cooldown_until as string) ?? null,
      lastSuccessAt: (h.last_success_at as string) ?? null,
      lastFailureAt: (h.last_failure_at as string) ?? null,
      lastErrorCode: (h.last_error_code as string) ?? null,
      lastErrorMessage: (h.last_error_message as string) ?? null,
      totalRequests: (h.total_requests as number) ?? 0,
      successfulRequests: (h.successful_requests as number) ?? 0,
      failedRequests: (h.failed_requests as number) ?? 0,
    };
  });

  const settings = (settingsRes.data as { routing_strategy: RoutingStrategy; max_attempts: number | null } | null) ?? { routing_strategy: "priority" as const, max_attempts: null };

  // "Current active model": first model that would be used for product content right now.
  const configs: AiModelConfig[] = rows.map((r) => ({
    id: r.id,
    providerName: r.providerName,
    displayName: r.displayName,
    providerType: r.providerType,
    apiBaseUrl: r.apiBaseUrl,
    modelName: r.modelName,
    apiKey: r.hasKey ? "set" : null,
    isEnabled: r.isEnabled,
    priority: r.priority,
    timeoutMs: r.timeoutSeconds * 1000,
    maxRetries: r.maxRetries,
    rpmLimit: r.rpmLimit,
    rpdLimit: r.rpdLimit,
    costInputPerMillion: r.costIn,
    costOutputPerMillion: r.costOut,
    qualityScore: r.qualityScore,
    capabilities: r.capabilities,
  }));
  const active = orderModels(
    configs.filter((m) => {
      const r = rows.find((x) => x.id === m.id)!;
      return m.isEnabled && m.apiKey && meetsRequirements(m, "product_content") && !isFuture(r.cooldownUntil);
    }),
    settings.routing_strategy,
  )[0];
  const lastFallback = fallbackRes.data as { final_provider: string | null; final_model: string | null; completed_at: string | null } | null;

  return (
    <>
      <AdminPageHeader title="AI settings" description="Enter a provider key once, load its models, and add the ones you want. Keys are encrypted on the server and never shown again." back={{ href: "/admin/settings", label: "Settings" }} />
      {migrationMissing ? (
        <p className="mb-4 rounded-[var(--radius-card)] border border-warn/30 bg-warn-tint p-4 text-sm">
          AI settings need the latest database migration (<code>20261009000010_homepage_ai_sync.sql</code>).
        </p>
      ) : null}
      {!(await encryptionAvailable()) ? (
        <p className="mb-4 rounded-[var(--radius-card)] border border-warn/30 bg-warn-tint p-4 text-sm">
          The secure key store isn&rsquo;t available on this server. On Cloudflare it works automatically (the Worker&rsquo;s private R2 bucket); for local
          development set <code>AI_KEYS_ENCRYPTION_SECRET</code>.
        </p>
      ) : null}
      <AiSettingsManager
        models={rows}
        routing={settings}
        readOnly={migrationMissing}
        activeModel={active ? `${active.displayName} (${active.modelName})` : null}
        lastFallback={lastFallback?.final_model ? `${lastFallback.final_provider ?? ""} · ${lastFallback.final_model}` : null}
        lastFallbackAt={lastFallback?.completed_at ?? null}
      />
    </>
  );
}
