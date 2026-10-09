import { AiProviderError, errorCodeLabel, sanitizeMessage } from "@/lib/ai/errors";
import { getJson } from "@/lib/ai/model-discovery";
import { callModel, DEFAULT_BASE_URL, geminiModelPath, type FetchLike } from "@/lib/ai/providers";
import { AUTH_REASON_LABELS, type AiModelConfig } from "@/lib/ai/types";

/**
 * Admin → Test connection, step by step:
 *   1. Is the API key accepted?        (model list request)
 *   2. Can this key use this model?    (Gemini: GET the model; OpenAI-style: is it in the key's list)
 *   3. Does a generation request work? (the real generate call, recorded in model health)
 *   4. Web research, only for models marked "Research (web)".
 * The provider's own error text is shown (with any key removed).
 */

export type StepKey = "key" | "model" | "generate" | "research";

export interface DiagnosticStep {
  key: StepKey;
  label: string;
  /** null = not checked */
  ok: boolean | null;
  detail: string;
}

const LABELS: Record<StepKey, string> = {
  key: "API key",
  model: "Model access",
  generate: "Generation request",
  research: "Web research",
};

export function describeError(e: unknown, secret: string | null): string {
  if (e instanceof AiProviderError) {
    const reason = e.authReason ? `${AUTH_REASON_LABELS[e.authReason]}. ` : "";
    return `${reason}${errorCodeLabel(e)}: ${sanitizeMessage(e.message, [secret])}`;
  }
  return sanitizeMessage(e, [secret]);
}

const step = (key: StepKey, ok: boolean | null, detail: string): DiagnosticStep => ({ key, label: LABELS[key], ok, detail });

/** Steps 1 and 2. They don't count as generation requests and don't change model health. */
export async function checkKeyAndModel(model: AiModelConfig, fetchImpl: FetchLike = fetch): Promise<DiagnosticStep[]> {
  const key = model.apiKey;
  if (!key) return [step("key", false, "No API key is saved for this model. Edit the model and enter the key."), step("model", null, "Not checked.")];
  const base = (model.apiBaseUrl || DEFAULT_BASE_URL[model.providerType]).replace(/\/+$/, "");
  const id = model.modelName.trim();

  if (model.providerType === "gemini") {
    const headers = { "x-goog-api-key": key };
    try {
      await getJson(`${base}/models?pageSize=1`, headers, key, fetchImpl);
    } catch (e) {
      const keyRejected = e instanceof AiProviderError && e.code === "AUTH_ERROR";
      return [step("key", keyRejected ? false : null, keyRejected ? `Rejected. ${describeError(e, key)}` : `Couldn't check. ${describeError(e, key)}`), step("model", null, "Not checked.")];
    }
    try {
      const info = (await getJson(`${base}/${geminiModelPath(id)}`, headers, key, fetchImpl)) as { name?: string; supportedGenerationMethods?: string[] };
      const methods = info.supportedGenerationMethods ?? [];
      const canGenerate = methods.length === 0 || methods.includes("generateContent");
      return [
        step("key", true, "Accepted by Google."),
        step("model", canGenerate, canGenerate ? `Found ${info.name ?? id}.` : `${info.name ?? id} exists but doesn't support generateContent (${methods.join(", ")}).`),
      ];
    } catch (e) {
      return [step("key", true, "Accepted by Google."), step("model", false, `Not accessible. ${describeError(e, key)}`)];
    }
  }

  // OpenAI and OpenAI-compatible
  let list: unknown;
  try {
    list = await getJson(`${base}/models`, { authorization: `Bearer ${key}` }, key, fetchImpl);
  } catch (e) {
    const keyRejected = e instanceof AiProviderError && e.code === "AUTH_ERROR";
    const noList = e instanceof AiProviderError && (e.code === "MODEL_UNAVAILABLE" || e.code === "BAD_REQUEST" || e.code === "INVALID_RESPONSE");
    return [
      step("key", keyRejected ? false : null, keyRejected ? `Rejected. ${describeError(e, key)}` : noList ? "This provider has no model list; the key is checked by the generation request." : `Couldn't check. ${describeError(e, key)}`),
      step("model", null, noList ? "Checked by the generation request." : "Not checked."),
    ];
  }
  const ids = (((list as { data?: { id?: string }[] })?.data ?? (Array.isArray(list) ? (list as { id?: string }[]) : [])) as { id?: string }[]).map((m) => m.id);
  const listed = ids.includes(id);
  return [
    step("key", true, "Accepted by the provider."),
    step("model", listed ? true : null, listed ? `${id} is in this key's model list.` : `${id} is not in this key's model list (${ids.length} models). The generation request below shows whether it still works.`),
  ];
}

/** Step 4: a small grounded (web search) request. Not recorded in model health. */
export async function checkResearch(model: AiModelConfig, fetchImpl: FetchLike = fetch): Promise<DiagnosticStep> {
  try {
    const res = await callModel(
      model,
      { task: "test", system: "You are a connection test.", prompt: "Search the web and reply with the current year as a single number.", json: false, research: true },
      fetchImpl,
    );
    return step("research", true, `Works${res.sources.length ? ` (${res.sources.length} source${res.sources.length === 1 ? "" : "s"})` : " (no sources returned)"}.`);
  } catch (e) {
    return step("research", false, `${describeError(e, model.apiKey)} Untick "Research (web)" on this model if your plan doesn't include web search.`);
  }
}

export { step as diagnosticStep };
