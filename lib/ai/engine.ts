import "server-only";
import { aiDb } from "@/lib/ai/db";
import { decryptSecret } from "@/lib/ai/crypto";
import { emptyHealth, runWithFailover, type RouterDeps } from "@/lib/ai/router";
import type { AiCapability, AiModelConfig, AiModelHealth, AiRequest, AiResponse, AttemptRecord, FailoverResult, ProviderType, RoutingStrategy } from "@/lib/ai/types";

/**
 * Server-only entry point. Reads model configs (staff session, or the service
 * role for background imports), decrypts keys in memory,
 * runs the request with failover, then saves model health and the attempt log
 * in one write each.
 */

export class AiSetupError extends Error {}

interface ModelRow {
  id: string;
  provider_name: string;
  display_name: string;
  provider_type: ProviderType;
  api_base_url: string;
  model_name: string;
  api_key_ciphertext: string | null;
  is_enabled: boolean;
  priority: number;
  timeout_ms: number;
  max_retries: number;
  rpm_limit: number | null;
  rpd_limit: number | null;
  cost_input_per_million: number | string | null;
  cost_output_per_million: number | string | null;
  quality_score: number | null;
  capabilities: AiCapability[];
}

interface HealthRow {
  model_id: string;
  status: AiModelHealth["status"];
  last_success_at: string | null;
  last_failure_at: string | null;
  consecutive_failures: number;
  last_error_code: string | null;
  last_error_message: string | null;
  cooldown_until: string | null;
  total_requests: number;
  successful_requests: number;
  failed_requests: number;
  minute_window_start: string | null;
  minute_count: number;
  day_window: string | null;
  day_count: number;
}

const num = (v: number | string | null) => (v === null || v === undefined || v === "" ? null : Number(v));

export function healthFromRow(r: HealthRow): AiModelHealth {
  return {
    modelId: r.model_id,
    status: r.status,
    lastSuccessAt: r.last_success_at,
    lastFailureAt: r.last_failure_at,
    consecutiveFailures: r.consecutive_failures,
    lastErrorCode: r.last_error_code,
    lastErrorMessage: r.last_error_message,
    cooldownUntil: r.cooldown_until,
    totalRequests: r.total_requests,
    successfulRequests: r.successful_requests,
    failedRequests: r.failed_requests,
    minuteWindowStart: r.minute_window_start,
    minuteCount: r.minute_count,
    dayWindow: r.day_window,
    dayCount: r.day_count,
  };
}

function healthToRow(h: AiModelHealth): HealthRow & { updated_at: string } {
  return {
    model_id: h.modelId,
    status: h.status,
    last_success_at: h.lastSuccessAt,
    last_failure_at: h.lastFailureAt,
    consecutive_failures: h.consecutiveFailures,
    last_error_code: h.lastErrorCode,
    last_error_message: h.lastErrorMessage,
    cooldown_until: h.cooldownUntil,
    total_requests: h.totalRequests,
    successful_requests: h.successfulRequests,
    failed_requests: h.failedRequests,
    minute_window_start: h.minuteWindowStart,
    minute_count: h.minuteCount,
    day_window: h.dayWindow,
    day_count: h.dayCount,
    updated_at: new Date().toISOString(),
  };
}

async function loadDeps(): Promise<Omit<RouterDeps, "onlyModelId" | "validate">> {
  const db = await aiDb();
  const [modelsRes, healthRes, settingsRes] = await Promise.all([
    db
      .from("ai_models")
      .select(
        "id, provider_name, display_name, provider_type, api_base_url, model_name, api_key_ciphertext, is_enabled, priority, timeout_ms, max_retries, rpm_limit, rpd_limit, cost_input_per_million, cost_output_per_million, quality_score, capabilities",
      ),
    db.from("ai_model_health").select("*"),
    db.from("ai_settings").select("routing_strategy, max_attempts").eq("id", 1).maybeSingle(),
  ]);
  if (modelsRes.error) throw new AiSetupError("AI settings can't be read. Run the latest database migrations (0010 and 0011) and sign in as staff.");
  const models: AiModelConfig[] = [];
  for (const r of (modelsRes.data as ModelRow[]) ?? []) {
    let apiKey: string | null = null;
    if (r.api_key_ciphertext) {
      try {
        apiKey = await decryptSecret(r.api_key_ciphertext);
      } catch {
        apiKey = null; // secret changed: key must be re-entered; the model is skipped
      }
    }
    models.push({
      id: r.id,
      providerName: r.provider_name,
      displayName: r.display_name,
      providerType: r.provider_type,
      apiBaseUrl: r.api_base_url,
      modelName: r.model_name,
      apiKey,
      isEnabled: r.is_enabled,
      priority: r.priority,
      timeoutMs: r.timeout_ms,
      maxRetries: r.max_retries,
      rpmLimit: r.rpm_limit,
      rpdLimit: r.rpd_limit,
      costInputPerMillion: num(r.cost_input_per_million),
      costOutputPerMillion: num(r.cost_output_per_million),
      qualityScore: r.quality_score,
      capabilities: r.capabilities ?? [],
    });
  }
  const health = new Map<string, AiModelHealth>();
  for (const r of (healthRes.data as HealthRow[]) ?? []) health.set(r.model_id, healthFromRow(r));
  const settings = settingsRes.data as { routing_strategy: RoutingStrategy; max_attempts: number | null } | null;
  return { models, health, strategy: settings?.routing_strategy ?? "priority", maxAttempts: settings?.max_attempts ?? null };
}

async function persist(touched: AiModelHealth[], attempts: AttemptRecord[], jobId: string | null) {
  const db = await aiDb();
  await Promise.all([
    touched.length ? db.from("ai_model_health").upsert(touched.map(healthToRow), { onConflict: "model_id" }) : null,
    jobId && attempts.length
      ? db.from("ai_job_attempts").insert(
          attempts.map((a) => ({
            job_id: jobId,
            attempt: a.attempt,
            model_id: a.modelId,
            provider: a.provider,
            model: a.model,
            status: a.status,
            error_code: a.errorCode,
            http_status: a.httpStatus,
            duration_ms: a.durationMs,
            started_at: a.startedAt,
            completed_at: a.completedAt,
          })),
        )
      : null,
  ]);
}

export async function runAi(
  req: AiRequest,
  opts: { jobId?: string | null; onlyModelId?: string; validate?: (res: AiResponse) => void } = {},
): Promise<FailoverResult> {
  const deps = await loadDeps();
  const result = await runWithFailover(req, { ...deps, onlyModelId: opts.onlyModelId, validate: opts.validate });
  const { touched, ...rest } = result;
  await persist(touched, result.attempts, opts.jobId ?? null);
  return rest as FailoverResult;
}

/** One model with its key decrypted (server only; used by Test connection). */
export async function getModelConfig(modelId: string): Promise<AiModelConfig | null> {
  const deps = await loadDeps();
  return deps.models.find((m) => m.id === modelId) ?? null;
}

/** Clear a model's cooldown and failure counters (Admin → Reset health). */
export async function resetModelHealth(modelId: string) {
  const db = await aiDb();
  await db.from("ai_model_health").upsert(healthToRow(emptyHealth(modelId)), { onConflict: "model_id" });
}
