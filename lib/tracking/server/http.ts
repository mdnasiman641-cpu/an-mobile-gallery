import "server-only";

/** Result of one delivery request. Messages are short and never contain secrets. */
export type DeliveryResult =
  | { ok: true; summary: string }
  | { ok: false; retryable: boolean; code: string; message: string };

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export const REQUEST_TIMEOUT_MS = 8000;

/** Remove anything that looks like a credential before a message is stored or shown. */
export function redact(text: string, secrets: (string | null | undefined)[] = []): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join("[redacted]");
  return out
    .replace(/EAA[A-Za-z0-9]{20,}/g, "[redacted]") // Meta access tokens
    .replace(/(access_token|api_secret|token|secret)=([^&\s"]+)/gi, "$1=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .slice(0, 300);
}

/** fetch with a hard timeout; network errors become a retryable result. */
export async function timedFetch(fetchImpl: FetchLike, url: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response | DeliveryResult> {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, retryable: true, code: timeout ? "TIMEOUT" : "NETWORK_ERROR", message: timeout ? `No answer within ${timeoutMs / 1000} s` : "Network error" };
  }
}

export function isResult(x: Response | DeliveryResult): x is DeliveryResult {
  return !(x instanceof Response);
}
