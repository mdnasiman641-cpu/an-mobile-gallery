import type { AiErrorCode, AuthReason } from "@/lib/ai/types";

/** An error from a provider, already classified and safe to store/show. */
export class AiProviderError extends Error {
  constructor(
    public code: AiErrorCode,
    message: string,
    public httpStatus: number | null = null,
    public retryAfterMs: number | null = null,
    /** "day" | "billing" for QUOTA_EXCEEDED */
    public quotaScope: "day" | "billing" | null = null,
    /** For AUTH_ERROR: what exactly was refused. */
    public authReason: AuthReason | null = null,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
  /** The provider's own error code, e.g. Gemini "PERMISSION_DENIED" or OpenAI "invalid_api_key". */
  providerCode: string | null = null;
}

/**
 * Remove anything that could be a credential from text before it is stored,
 * logged or shown: API keys (Google "AIza…", OpenAI "sk-…"), bearer tokens,
 * key= query parameters, and the actual key if we know it.
 */
export function sanitizeMessage(input: unknown, knownSecrets: (string | null | undefined)[] = []): string {
  let s = typeof input === "string" ? input : input instanceof Error ? input.message : JSON.stringify(input ?? "");
  for (const secret of knownSecrets) if (secret && secret.length >= 6) s = s.split(secret).join("[redacted]");
  s = s
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, "[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]")
    .replace(/([?&](?:key|api_key|apikey|token)=)[^&\s"']+/gi, "$1[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > 280 ? `${s.slice(0, 277)}…` : s;
}

/** Retry-After: seconds or an HTTP date. Also OpenAI's "6m0s" style reset headers. */
export function parseRetryAfter(headers: Headers | null, body: unknown, now = Date.now()): number | null {
  const ra = headers?.get("retry-after");
  if (ra) {
    const secs = Number(ra);
    if (Number.isFinite(secs) && secs >= 0) return Math.round(secs * 1000);
    const at = Date.parse(ra);
    if (!Number.isNaN(at)) return Math.max(0, at - now);
  }
  // Gemini: error.details[].retryDelay = "12s" (google.rpc.RetryInfo)
  const details = (body as { error?: { details?: { retryDelay?: string }[] } } | null)?.error?.details;
  if (Array.isArray(details)) {
    for (const d of details) {
      const m = typeof d?.retryDelay === "string" ? /^(\d+(?:\.\d+)?)s$/.exec(d.retryDelay) : null;
      if (m) return Math.round(Number(m[1]) * 1000);
    }
  }
  const reset = headers?.get("x-ratelimit-reset-requests") ?? headers?.get("x-ratelimit-reset-tokens");
  if (reset) {
    const m = /^(?:(\d+)h)?(?:(\d+)m(?!s))?(?:(\d+(?:\.\d+)?)s)?(?:(\d+)ms)?$/.exec(reset);
    if (m && m[0]) {
      const ms = (Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)) * 1000 + Number(m[4] ?? 0);
      if (ms > 0) return Math.round(ms);
    }
  }
  return null;
}

interface ProviderErrorBody {
  error?: {
    message?: string;
    /** Gemini: "PERMISSION_DENIED", "INVALID_ARGUMENT", …  OpenAI: undefined */
    status?: string;
    /** OpenAI: "invalid_api_key", "model_not_found", …  Gemini: the HTTP code */
    code?: string | number;
    type?: string;
    details?: { "@type"?: string; reason?: string; retryDelay?: string }[];
  };
  message?: string;
}

/**
 * Key-wide reasons: every model using the same key (same provider project)
 * fails the same way. PROJECT_DENIED is project-level at Google: in production
 * every Gemini model on the denied project returned it.
 */
export const KEY_WIDE_REASONS: ReadonlySet<AuthReason> = new Set(["INVALID_KEY", "API_NOT_ENABLED", "KEY_RESTRICTED", "PROJECT_DENIED"]);

/**
 * Work out why access was refused, from the provider's structured error
 * (google.rpc.ErrorInfo reasons, OpenAI error codes) and its message.
 * Returns null when the response is not an access problem.
 */
export function authReasonFor(status: number, body: ProviderErrorBody | null, rawText: string): AuthReason | null {
  const reasons = (body?.error?.details ?? []).map((d) => String(d?.reason ?? "").toUpperCase()).filter(Boolean);
  const code = String(body?.error?.code ?? "").toLowerCase();
  const rpcStatus = String(body?.error?.status ?? "").toUpperCase();
  const text = `${body?.error?.message ?? body?.message ?? ""} ${rawText}`.toLowerCase();
  const has = (...r: string[]) => r.some((x) => reasons.includes(x));

  if (has("API_KEY_INVALID", "API_KEY_EXPIRED") || code === "invalid_api_key" || /api key (?:not valid|expired|is invalid)|incorrect api key|invalid api key|invalid x-api-key|api_key_invalid/.test(text))
    return "INVALID_KEY";
  if (has("SERVICE_DISABLED", "API_DISABLED") || /has not been used in project|api (?:has not been|is not) enabled|is disabled\. enable it|service_disabled/.test(text)) return "API_NOT_ENABLED";
  if (has("API_KEY_SERVICE_BLOCKED", "API_KEY_HTTP_REFERRER_BLOCKED", "API_KEY_IP_ADDRESS_BLOCKED", "API_KEY_ANDROID_APP_BLOCKED", "API_KEY_IOS_APP_BLOCKED") || /requests (?:to this api|from this) .* (?:are|is) blocked/.test(text))
    return "KEY_RESTRICTED";
  if (/user location is not supported|unsupported_country|not available in your (?:country|region)|country, region, or territory not supported/.test(text) || code === "unsupported_country_region_territory")
    return "REGION_NOT_SUPPORTED";
  if (has("CONSUMER_SUSPENDED", "BILLING_DISABLED") || /project has been denied access|project .*(?:suspended|denied)|organization .*(?:disabled|deactivated)|account .*(?:suspended|deactivated)/.test(text))
    return "PROJECT_DENIED";
  if (code === "model_not_found" || /(?:do(?:es)? not|don't) have access to (?:the )?model|model .*(?:not found|not supported) .*(?:access|permission)|permission denied on resource .*model|not allowed to (?:use|sample from) (?:this )?model/.test(text))
    return status === 404 ? null : "MODEL_DENIED";
  if (status === 401) return "INVALID_KEY";
  if (status === 403 || rpcStatus === "PERMISSION_DENIED" || rpcStatus === "UNAUTHENTICATED") return "ACCESS_DENIED";
  return null;
}

/** Turn an HTTP error response into a classified, sanitized error. */
export function classifyHttpError(status: number, headers: Headers | null, bodyText: string, secrets: string[] = []): AiProviderError {
  let body: ProviderErrorBody | null = null;
  try {
    const parsed: unknown = JSON.parse(bodyText);
    body = parsed && typeof parsed === "object" ? (parsed as ProviderErrorBody) : null;
  } catch {
    body = null;
  }
  const raw = body?.error?.message ?? (body && "message" in body ? String(body.message) : bodyText);
  const text = `${raw} ${bodyText}`.toLowerCase();
  const message = sanitizeMessage(raw || `HTTP ${status}`, secrets);
  const retryAfter = parseRetryAfter(headers, body);
  const rawCode = body?.error?.status ?? (typeof body?.error?.code === "string" ? body.error.code : null) ?? body?.error?.type ?? null;
  const providerCode = rawCode ? sanitizeMessage(String(rawCode), secrets).slice(0, 60) : null;
  const err = (...args: ConstructorParameters<typeof AiProviderError>) => {
    const e = new AiProviderError(...args);
    e.providerCode = providerCode;
    return e;
  };

  if (status === 429 || text.includes("resource_exhausted") || text.includes("rate limit")) {
    const isBilling = text.includes("insufficient_quota") || text.includes("billing") || text.includes("exceeded your current quota");
    const isDaily = /per[ _-]?day|perday|daily/.test(text);
    if (isBilling) return err("QUOTA_EXCEEDED", message, status, retryAfter, "billing");
    if (isDaily || (text.includes("quota") && !text.includes("per minute") && !text.includes("perminute")))
      return err("QUOTA_EXCEEDED", message, status, retryAfter, "day");
    return err("RATE_LIMITED", message, status, retryAfter);
  }
  // 401 / 403, and Gemini's 400 "API key not valid" / "User location is not supported"
  if (status === 401 || status === 403 || status === 400) {
    const reason = authReasonFor(status, body, bodyText);
    if (reason && (status !== 400 || reason === "INVALID_KEY" || reason === "REGION_NOT_SUPPORTED"))
      return err("AUTH_ERROR", message, status, null, null, reason);
  }
  if (status === 404) {
    // OpenAI answers 404 model_not_found both for unknown models and for models the key can't use
    return err("MODEL_UNAVAILABLE", message, status, retryAfter);
  }
  if (status === 408) return err("TIMEOUT", message, status, retryAfter);
  if (status >= 500 || text.includes("overloaded") || text.includes("unavailable"))
    return err("PROVIDER_ERROR", message, status, retryAfter);
  return err("BAD_REQUEST", message, status, retryAfter);
}

/** Short, storable error code, e.g. "AUTH_ERROR (403) PROJECT_DENIED". */
export function errorCodeLabel(err: Pick<AiProviderError, "code" | "httpStatus" | "authReason"> & { providerCode?: string | null }): string {
  const status = [err.httpStatus, err.providerCode].filter(Boolean).join(" ");
  return `${err.code}${status ? ` (${status})` : ""}${err.authReason ? ` ${err.authReason}` : ""}`;
}

/**
 * One plain-language reason for a run where every model failed, from the
 * per-model failure lines. Only describes what the providers actually said.
 */
export function explainFailures(lines: string[]): string {
  const all = lines.join("\n");
  if (!lines.length) return "No model was tried.";
  if (/PROJECT_DENIED/.test(all))
    return "Google refused access for this API key's Google Cloud project (PROJECT_DENIED: “Your project has been denied access”). This is a restriction on the Google account/project, not a website error: use a key from a different Google Cloud project, contact Google support, or enable another provider in Settings → AI.";
  if (/INVALID_KEY/.test(all)) return "The provider rejected the API key (INVALID_KEY). Enter a valid key in Settings → AI.";
  if (/API_NOT_ENABLED/.test(all)) return "The API is not enabled for this key's project (API_NOT_ENABLED). Enable it in the provider's console.";
  if (/KEY_RESTRICTED/.test(all)) return "The key's restrictions block this API (KEY_RESTRICTED). Check the key's API restrictions.";
  if (/MODEL_DENIED/.test(all)) return "This key has no access to the configured models (MODEL_DENIED).";
  if (/QUOTA_EXCEEDED/.test(all)) return "The models' quota is used up (QUOTA_EXCEEDED). They are tried again after the quota resets.";
  if (/RATE_LIMITED/.test(all)) return "The models are rate limited right now (RATE_LIMITED). Try again in a few minutes.";
  return `Reason: ${lines[0]}`;
}
