import { AiProviderError, KEY_WIDE_REASONS, errorCodeLabel, sanitizeMessage } from "@/lib/ai/errors";
import { callModel, type FetchLike } from "@/lib/ai/providers";
import {
  TASK_REQUIREMENTS,
  type AiModelConfig,
  type AiModelHealth,
  type AiRequest,
  type AiResponse,
  type AttemptRecord,
  type FailoverResult,
  type RoutingStrategy,
} from "@/lib/ai/types";

/**
 * Multi-model routing with automatic failover.
 *
 * - Only models that are enabled, have a key and have the capabilities the
 *   task needs are eligible (an image task never goes to a text-only model).
 * - Eligible models are ordered by the routing strategy (default: priority).
 * - Each model is tried at most once per job (plus its own "max retries" for
 *   timeouts / 5xx / network errors), so A → B → A loops cannot happen.
 * - Models in cooldown, or over their own RPM/RPD limits, are skipped without
 *   a request. Cooldown comes from Retry-After when the provider sends it,
 *   otherwise from exponential backoff (30 s, 60 s, 5 min, 15 min).
 * - Access refusals (401/403) are never retried. When the KEY itself is
 *   rejected (invalid key, API not enabled, key restrictions), every other
 *   model using the same key is put in the same cooldown without a request.
 *   Project / model denials only affect the model that got them.
 * - Success resets the model to HEALTHY. A model disabled by the admin is
 *   never re-enabled here.
 */

export const BACKOFF_MS = [30_000, 60_000, 5 * 60_000, 15 * 60_000];
const AUTH_COOLDOWN_MS = 6 * 3600_000;
/** Access refusals that won't fix themselves: wait a day (or until the admin resets / saves a new key). */
const PERMANENT_AUTH_COOLDOWN_MS = 24 * 3600_000;
const REGION_COOLDOWN_MS = 3600_000;
const MODEL_UNAVAILABLE_COOLDOWN_MS = 3600_000;
const BILLING_COOLDOWN_MS = 24 * 3600_000;

export const ALL_UNAVAILABLE_MESSAGE = "All configured AI models are currently unavailable.";

export function emptyHealth(modelId: string): AiModelHealth {
  return {
    modelId,
    status: "HEALTHY",
    lastSuccessAt: null,
    lastFailureAt: null,
    consecutiveFailures: 0,
    lastErrorCode: null,
    lastErrorMessage: null,
    cooldownUntil: null,
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    minuteWindowStart: null,
    minuteCount: 0,
    dayWindow: null,
    dayCount: 0,
  };
}

export function meetsRequirements(model: AiModelConfig, task: AiRequest["task"]): boolean {
  return TASK_REQUIREMENTS[task].every((anyOf) => anyOf.some((cap) => model.capabilities.includes(cap)));
}

function totalCost(m: AiModelConfig): number | null {
  if (m.costInputPerMillion === null && m.costOutputPerMillion === null) return null;
  return (m.costInputPerMillion ?? 0) + (m.costOutputPerMillion ?? 0);
}

export function orderModels(models: AiModelConfig[], strategy: RoutingStrategy): AiModelConfig[] {
  const byPriority = (a: AiModelConfig, b: AiModelConfig) => a.priority - b.priority || a.displayName.localeCompare(b.displayName);
  const list = [...models];
  if (strategy === "priority") return list.sort(byPriority);
  if (strategy === "lowest_cost") {
    return list.sort((a, b) => {
      const ca = totalCost(a);
      const cb = totalCost(b);
      if (ca === null && cb === null) return byPriority(a, b);
      if (ca === null) return 1;
      if (cb === null) return -1;
      return ca - cb || byPriority(a, b);
    });
  }
  if (strategy === "best_quality") {
    return list.sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0) || byPriority(a, b));
  }
  // balanced: quality (0–1) minus relative cost (0–1), equal weight, so a much
  // pricier model must be much better to win. Unknown quality = 5/10, unknown cost = average.
  const costs = list.map(totalCost).filter((c): c is number => c !== null);
  const maxCost = Math.max(1e-9, ...costs);
  const avgCost = costs.length ? costs.reduce((s, c) => s + c, 0) / costs.length : 0;
  const score = (m: AiModelConfig) => (m.qualityScore ?? 5) / 10 - (totalCost(m) ?? avgCost) / maxCost;
  return list.sort((a, b) => score(b) - score(a) || byPriority(a, b));
}

/** Next cooldown for a failure, given how many failures in a row (after this one). */
export function cooldownFor(err: AiProviderError, consecutive: number, now: number): number | null {
  const backoff = BACKOFF_MS[Math.min(Math.max(consecutive, 1), BACKOFF_MS.length) - 1];
  switch (err.code) {
    case "RATE_LIMITED":
      return now + (err.retryAfterMs ?? backoff);
    case "QUOTA_EXCEEDED": {
      if (err.retryAfterMs) return now + err.retryAfterMs;
      if (err.quotaScope === "billing") return now + BILLING_COOLDOWN_MS;
      const d = new Date(now);
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 8, 0, 0); // daily quotas reset around 08:00 UTC
    }
    case "AUTH_ERROR":
      if (err.authReason === "REGION_NOT_SUPPORTED") return now + REGION_COOLDOWN_MS;
      if (err.authReason && err.authReason !== "ACCESS_DENIED") return now + PERMANENT_AUTH_COOLDOWN_MS;
      return now + AUTH_COOLDOWN_MS;
    case "MODEL_UNAVAILABLE":
      return now + MODEL_UNAVAILABLE_COOLDOWN_MS;
    case "TIMEOUT":
    case "PROVIDER_ERROR":
    case "NETWORK_ERROR":
      return now + (err.retryAfterMs ?? backoff);
    default:
      return null; // BAD_REQUEST / INVALID_RESPONSE: try the next model, no cooldown
  }
}

function statusFor(err: AiProviderError): AiModelHealth["status"] {
  switch (err.code) {
    case "RATE_LIMITED":
      return "RATE_LIMITED";
    case "QUOTA_EXCEEDED":
      return "QUOTA_EXCEEDED";
    case "AUTH_ERROR":
      return "AUTH_ERROR";
    case "TIMEOUT":
      return "TIMEOUT";
    case "PROVIDER_ERROR":
    case "NETWORK_ERROR":
    case "MODEL_UNAVAILABLE":
      return "PROVIDER_ERROR";
    default:
      return "DEGRADED";
  }
}

const TRANSIENT = new Set(["TIMEOUT", "PROVIDER_ERROR", "NETWORK_ERROR"]);

/** Local RPM/RPD check. Returns the time the limit frees up, or null if OK. */
function localLimitUntil(model: AiModelConfig, h: AiModelHealth, now: number): number | null {
  const minuteStart = h.minuteWindowStart ? Date.parse(h.minuteWindowStart) : 0;
  if (model.rpmLimit && now - minuteStart < 60_000 && h.minuteCount >= model.rpmLimit) return minuteStart + 60_000;
  const today = new Date(now).toISOString().slice(0, 10);
  if (model.rpdLimit && h.dayWindow === today && h.dayCount >= model.rpdLimit) {
    const d = new Date(now);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  }
  return null;
}

function countRequest(h: AiModelHealth, now: number) {
  const minuteStart = h.minuteWindowStart ? Date.parse(h.minuteWindowStart) : 0;
  if (now - minuteStart >= 60_000) {
    h.minuteWindowStart = new Date(now).toISOString();
    h.minuteCount = 0;
  }
  h.minuteCount += 1;
  const today = new Date(now).toISOString().slice(0, 10);
  if (h.dayWindow !== today) {
    h.dayWindow = today;
    h.dayCount = 0;
  }
  h.dayCount += 1;
  h.totalRequests += 1;
}

export interface RouterDeps {
  models: AiModelConfig[];
  health: Map<string, AiModelHealth>;
  strategy: RoutingStrategy;
  maxAttempts: number | null;
  fetchImpl?: FetchLike;
  now?: () => number;
  /** Restrict to one model (Test connection). */
  onlyModelId?: string;
  /** Extra check on the response (e.g. JSON shape). Throw AiProviderError to fail over. */
  validate?: (res: AiResponse) => void;
}

/**
 * Run a request with failover. Mutates `deps.health` in place; the caller
 * persists the touched rows (returned in `touched`) in a single write.
 */
export async function runWithFailover(req: AiRequest, deps: RouterDeps): Promise<FailoverResult & { touched: AiModelHealth[] }> {
  const now = deps.now ?? Date.now;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const attempts: AttemptRecord[] = [];
  const touched = new Map<string, AiModelHealth>();
  const reasons: string[] = [];

  const pool = deps.models.filter(
    (m) => (deps.onlyModelId ? m.id === deps.onlyModelId : m.isEnabled) && meetsRequirements(m, req.task),
  );
  const eligible = orderModels(pool, deps.strategy);
  if (eligible.length === 0) {
    return {
      ok: false,
      code: "NO_ELIGIBLE_MODEL",
      message: deps.onlyModelId
        ? "This model is not set up for this task."
        : `No enabled AI model has the capabilities this task needs (${TASK_REQUIREMENTS[req.task].map((g) => g.join(" or ")).join(" + ") || "any"}).`,
      attempts,
      touched: [],
    };
  }

  const maxCalls = Math.min(deps.maxAttempts ?? eligible.length, eligible.length);
  // Keys rejected during this run (in memory only, never stored).
  const keyOf = (m: AiModelConfig) => `${m.providerType}|${m.apiBaseUrl.replace(/\/+$/, "")}|${m.apiKey ?? ""}`;
  const rejectedKeys = new Map<string, { by: string; err: AiProviderError }>();
  let calls = 0;
  let attemptNo = 0;
  let firstCalled: string | null = null;

  for (const model of eligible) {
    if (calls >= maxCalls) break;
    const h = deps.health.get(model.id) ?? emptyHealth(model.id);
    deps.health.set(model.id, h);
    const t = now();
    const stamp = new Date(t).toISOString();
    const skip = (code: AttemptRecord["errorCode"], message: string) => {
      attemptNo += 1;
      attempts.push({ attempt: attemptNo, modelId: model.id, provider: model.providerName, model: model.modelName, status: "skipped", errorCode: code, httpStatus: null, message, startedAt: stamp, completedAt: stamp, durationMs: 0 });
      reasons.push(`${model.displayName}: ${message}`);
    };

    if (!model.apiKey) {
      skip("NO_KEY", "no API key saved");
      continue;
    }
    const rejected = rejectedKeys.get(keyOf(model));
    if (rejected) {
      skip("AUTH_ERROR", `same API key was rejected on ${rejected.by} (${rejected.err.authReason})`);
      continue;
    }
    // Test connection ignores cooldown and local limits so the admin can check a fix.
    if (!deps.onlyModelId) {
      const cool = h.cooldownUntil ? Date.parse(h.cooldownUntil) : 0;
      if (cool > t) {
        // Say WHY it is cooling down (the last real provider error), not just that it is.
        const why = h.lastErrorCode ? `${h.lastErrorCode}${h.lastErrorMessage ? `: ${h.lastErrorMessage}` : ""}` : h.status;
        skip("COOLDOWN", `not called (${why}) — available again ${new Date(cool).toISOString()}`);
        continue;
      }
      const limitUntil = localLimitUntil(model, h, t);
      if (limitUntil) {
        h.status = "RATE_LIMITED";
        h.cooldownUntil = new Date(limitUntil).toISOString();
        touched.set(model.id, h);
        skip("LOCAL_LIMIT", "configured RPM/RPD limit reached");
        continue;
      }
    }

    calls += 1;
    firstCalled ??= model.id;
    let lastErr: AiProviderError | null = null;
    for (let retry = 0; retry <= model.maxRetries; retry++) {
      const started = now();
      countRequest(h, started);
      touched.set(model.id, h);
      attemptNo += 1;
      try {
        const response = await callModel(model, req, fetchImpl);
        deps.validate?.(response);
        const done = now();
        attempts.push({ attempt: attemptNo, modelId: model.id, provider: model.providerName, model: model.modelName, status: "success", errorCode: null, httpStatus: 200, message: null, startedAt: new Date(started).toISOString(), completedAt: new Date(done).toISOString(), durationMs: done - started });
        h.status = "HEALTHY";
        h.consecutiveFailures = 0;
        h.cooldownUntil = null;
        h.lastSuccessAt = new Date(done).toISOString();
        h.successfulRequests += 1;
        return { ok: true, response, model, attempts, fallbackUsed: model.id !== eligible[0].id || attempts.some((a) => a.status !== "success"), touched: [...touched.values()] };
      } catch (e) {
        const err = e instanceof AiProviderError ? e : new AiProviderError("PROVIDER_ERROR", sanitizeMessage(e, [model.apiKey]));
        const done = now();
        lastErr = err;
        attempts.push({ attempt: attemptNo, modelId: model.id, provider: model.providerName, model: model.modelName, status: "failed", errorCode: err.code, httpStatus: err.httpStatus, message: [err.authReason, err.providerCode].filter(Boolean).length ? `${[err.authReason, err.providerCode].filter(Boolean).join(" · ")}: ${err.message}` : err.message, startedAt: new Date(started).toISOString(), completedAt: new Date(done).toISOString(), durationMs: done - started });
        h.failedRequests += 1;
        h.lastFailureAt = new Date(done).toISOString();
        h.lastErrorCode = errorCodeLabel(err);
        h.lastErrorMessage = sanitizeMessage(err.message, [model.apiKey]);
        if (!(TRANSIENT.has(err.code) && retry < model.maxRetries)) break;
      }
    }
    if (lastErr) {
      h.consecutiveFailures += 1;
      h.status = statusFor(lastErr);
      const until = cooldownFor(lastErr, h.consecutiveFailures, now());
      h.cooldownUntil = until ? new Date(until).toISOString() : null;
      reasons.push(`${model.displayName}: ${errorCodeLabel(lastErr)} – ${lastErr.message}`);
      if (lastErr.code === "AUTH_ERROR" && lastErr.authReason && KEY_WIDE_REASONS.has(lastErr.authReason)) {
        rejectedKeys.set(keyOf(model), { by: model.displayName, err: lastErr });
        // Same key on other models: same result, so cool them down now instead of calling them.
        for (const other of deps.models) {
          if (other.id === model.id || keyOf(other) !== keyOf(model)) continue;
          const oh = deps.health.get(other.id) ?? emptyHealth(other.id);
          deps.health.set(other.id, oh);
          oh.status = "AUTH_ERROR";
          oh.lastFailureAt = h.lastFailureAt;
          oh.lastErrorCode = errorCodeLabel(lastErr);
          oh.lastErrorMessage = `Same API key as ${model.displayName}: ${sanitizeMessage(lastErr.message, [model.apiKey])}`.slice(0, 280);
          oh.cooldownUntil = h.cooldownUntil;
          touched.set(other.id, oh);
        }
      }
    }
  }

  return {
    ok: false,
    code: "ALL_MODELS_UNAVAILABLE",
    message: `${ALL_UNAVAILABLE_MESSAGE}${reasons.length ? ` ${reasons.join(" | ")}` : ""}`,
    attempts,
    touched: [...touched.values()],
  };
}
