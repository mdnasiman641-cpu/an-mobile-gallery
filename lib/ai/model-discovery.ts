import { AiProviderError, classifyHttpError, sanitizeMessage } from "@/lib/ai/errors";
import type { FetchLike } from "@/lib/ai/providers";
import type { AiCapability, ProviderType } from "@/lib/ai/types";

/**
 * Provider adapters that list the models available to an API key.
 * Nothing is hard-coded: the list always comes from the provider.
 *
 *  - Google Gemini:      GET {base}/models?pageSize=1000 (x-goog-api-key), paginated
 *  - OpenAI:             GET {base}/models (Bearer)
 *  - OpenAI-compatible:  GET {base}/models (Bearer); extra fields such as
 *                        name / context_length / input modalities / pricing are used when present
 */

export interface DiscoveredModel {
  /** Exact model id to send in requests. */
  id: string;
  label: string;
  description: string | null;
  contextWindow: number | null;
  /** Suggested from what the provider reports; the admin can change them. */
  capabilities: AiCapability[];
  costInputPerMillion: number | null;
  costOutputPerMillion: number | null;
  /** Not a chat/text model (embeddings, speech, images…): hidden unless "Show all". */
  nonChat: boolean;
}

const MAX_MODELS = 600;
const LIST_TIMEOUT_MS = 20_000;
const BASE_CAPS: AiCapability[] = ["text", "json", "product_analysis", "seo"];
// Model *types* (not names) that can't do text generation.
const NON_CHAT = /(embed|whisper|tts|dall-e|davinci|babbage|moderation|transcri|audio|realtime|image-gen|imagen|veo|sora|speech|rerank)/i;

export function normalizeBaseUrl(type: ProviderType, raw: string): string {
  let url = raw.trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(url)) throw new AiProviderError("BAD_REQUEST", "API base URL must start with https://");
  // Gemini keys work on /v1beta; accept the bare host too.
  if (type === "gemini" && !/\/v1(beta)?$/i.test(url)) url = `${url}/v1beta`;
  return url;
}

/** GET a provider JSON endpoint. Errors are classified and never contain the key. */
export async function getJson(url: string, headers: Record<string, string>, apiKey: string, fetchImpl: FetchLike): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchImpl(url, { method: "GET", headers: { accept: "application/json", ...headers }, signal: controller.signal });
  } catch (e) {
    if (controller.signal.aborted) throw new AiProviderError("TIMEOUT", "The provider did not answer within 20 seconds");
    throw new AiProviderError("NETWORK_ERROR", sanitizeMessage(e, [apiKey]));
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text().catch(() => "");
  if (!res.ok) throw classifyHttpError(res.status, res.headers, text, [apiKey]);
  try {
    return JSON.parse(text);
  } catch {
    throw new AiProviderError("INVALID_RESPONSE", "The provider's model list is not JSON. Check the API base URL.");
  }
}

interface GeminiModel {
  name?: string;
  baseModelId?: string;
  displayName?: string;
  description?: string;
  inputTokenLimit?: number;
  supportedGenerationMethods?: string[];
}

export function parseGeminiModels(pages: unknown[]): DiscoveredModel[] {
  const out: DiscoveredModel[] = [];
  for (const page of pages) {
    for (const m of ((page as { models?: GeminiModel[] })?.models ?? [])) {
      const id = (m.name ?? "").replace(/^models\//, "");
      if (!id) continue;
      const methods = m.supportedGenerationMethods ?? [];
      const canGenerate = methods.includes("generateContent");
      const caps = new Set<AiCapability>(canGenerate ? BASE_CAPS : []);
      if (canGenerate && (m.inputTokenLimit ?? 0) >= 200_000) caps.add("long_context");
      out.push({
        id,
        label: m.displayName?.trim() || id,
        description: m.description?.trim().slice(0, 240) || null,
        contextWindow: m.inputTokenLimit ?? null,
        capabilities: [...caps],
        costInputPerMillion: null,
        costOutputPerMillion: null,
        nonChat: !canGenerate || NON_CHAT.test(id),
      });
    }
  }
  return out;
}

interface OpenAiModel {
  id?: string;
  name?: string;
  description?: string;
  context_length?: number;
  owned_by?: string;
  architecture?: { input_modalities?: string[]; modality?: string };
  pricing?: { prompt?: string | number; completion?: string | number };
}

const perMillion = (v: string | number | undefined) => {
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1_000_000 * 10000) / 10000 : null;
};

export function parseOpenAiModels(body: unknown): DiscoveredModel[] {
  const list = ((body as { data?: OpenAiModel[] })?.data ?? (Array.isArray(body) ? (body as OpenAiModel[]) : [])) as OpenAiModel[];
  const out: DiscoveredModel[] = [];
  for (const m of list) {
    const id = (m.id ?? "").trim();
    if (!id) continue;
    const nonChat = NON_CHAT.test(id);
    const caps = new Set<AiCapability>(nonChat ? [] : BASE_CAPS);
    const inputs = m.architecture?.input_modalities ?? (m.architecture?.modality ? m.architecture.modality.split("->")[0].split("+") : []);
    if (!nonChat && inputs.some((x) => /image/i.test(x))) caps.add("vision");
    if (!nonChat && (m.context_length ?? 0) >= 200_000) caps.add("long_context");
    if (!nonChat && /search/i.test(id)) caps.add("research");
    out.push({
      id,
      label: m.name?.trim() || id,
      description: m.description?.trim().slice(0, 240) || (m.owned_by ? `by ${m.owned_by}` : null),
      contextWindow: m.context_length ?? null,
      capabilities: [...caps],
      costInputPerMillion: perMillion(m.pricing?.prompt),
      costOutputPerMillion: perMillion(m.pricing?.completion),
      nonChat,
    });
  }
  return out;
}

/** Ask the provider which models this key can use. Throws AiProviderError (sanitized). */
export async function discoverModels(type: ProviderType, baseUrl: string, apiKey: string, fetchImpl: FetchLike = fetch): Promise<DiscoveredModel[]> {
  if (!apiKey.trim()) throw new AiProviderError("NO_KEY", "Enter the API key first");
  const base = normalizeBaseUrl(type, baseUrl);
  let models: DiscoveredModel[];
  if (type === "gemini") {
    const pages: unknown[] = [];
    let token: string | null = null;
    for (let i = 0; i < 5; i++) {
      const url: string = `${base}/models?pageSize=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`;
      const page = await getJson(url, { "x-goog-api-key": apiKey }, apiKey, fetchImpl);
      pages.push(page);
      token = (page as { nextPageToken?: string }).nextPageToken ?? null;
      if (!token) break;
    }
    models = parseGeminiModels(pages);
  } else {
    models = parseOpenAiModels(await getJson(`${base}/models`, { authorization: `Bearer ${apiKey}` }, apiKey, fetchImpl));
  }
  const seen = new Set<string>();
  return models
    .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
    .sort((a, b) => Number(a.nonChat) - Number(b.nonChat) || a.label.localeCompare(b.label))
    .slice(0, MAX_MODELS);
}
