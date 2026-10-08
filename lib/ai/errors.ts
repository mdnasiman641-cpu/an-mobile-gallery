import type { AiErrorCode } from "@/lib/ai/types";

/** An error from a provider, already classified and safe to store/show. */
export class AiProviderError extends Error {
  constructor(
    public code: AiErrorCode,
    message: string,
    public httpStatus: number | null = null,
    public retryAfterMs: number | null = null,
    /** "day" | "billing" for QUOTA_EXCEEDED */
    public quotaScope: "day" | "billing" | null = null,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
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

/** Turn an HTTP error response into a classified, sanitized error. */
export function classifyHttpError(status: number, headers: Headers | null, bodyText: string, secrets: string[] = []): AiProviderError {
  let body: unknown = null;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = null;
  }
  const raw =
    (body as { error?: { message?: string } } | null)?.error?.message ??
    (typeof body === "object" && body && "message" in body ? String((body as { message: unknown }).message) : bodyText);
  const text = `${raw} ${bodyText}`.toLowerCase();
  const message = sanitizeMessage(raw || `HTTP ${status}`, secrets);
  const retryAfter = parseRetryAfter(headers, body);

  if (status === 429 || text.includes("resource_exhausted") || text.includes("rate limit")) {
    const isBilling = text.includes("insufficient_quota") || text.includes("billing") || text.includes("exceeded your current quota");
    const isDaily = /per[ _-]?day|perday|daily/.test(text);
    if (isBilling) return new AiProviderError("QUOTA_EXCEEDED", message, status, retryAfter, "billing");
    if (isDaily || (text.includes("quota") && !text.includes("per minute") && !text.includes("perminute")))
      return new AiProviderError("QUOTA_EXCEEDED", message, status, retryAfter, "day");
    return new AiProviderError("RATE_LIMITED", message, status, retryAfter);
  }
  if (status === 401 || status === 403) return new AiProviderError("AUTH_ERROR", message, status, retryAfter);
  if (status === 404) return new AiProviderError("MODEL_UNAVAILABLE", message, status, retryAfter);
  if (status === 408) return new AiProviderError("TIMEOUT", message, status, retryAfter);
  if (status >= 500 || text.includes("overloaded") || text.includes("unavailable"))
    return new AiProviderError("PROVIDER_ERROR", message, status, retryAfter);
  return new AiProviderError("BAD_REQUEST", message, status, retryAfter);
}
