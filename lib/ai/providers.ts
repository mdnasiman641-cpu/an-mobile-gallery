import { AiProviderError, classifyHttpError, sanitizeMessage } from "@/lib/ai/errors";
import type { AiModelConfig, AiRequest, AiResponse, AiSource } from "@/lib/ai/types";

/** Default API base URLs (editable per model in Admin → Settings → AI). */
export const DEFAULT_BASE_URL: Record<AiModelConfig["providerType"], string> = {
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  openai: "https://api.openai.com/v1",
  openai_compatible: "https://",
};

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

function trimSlash(url: string) {
  return url.replace(/\/+$/, "");
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  model: AiModelConfig,
  fetchImpl: FetchLike,
  minTimeoutMs = 0,
): Promise<unknown> {
  const secrets = model.apiKey ? [model.apiKey] : [];
  const timeoutMs = Math.max(model.timeoutMs, minTimeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    if (controller.signal.aborted) throw new AiProviderError("TIMEOUT", `No response within ${Math.round(timeoutMs / 1000)}s`);
    throw new AiProviderError("NETWORK_ERROR", sanitizeMessage(e, secrets));
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text().catch(() => "");
  if (!res.ok) throw classifyHttpError(res.status, res.headers, text, secrets);
  try {
    return JSON.parse(text);
  } catch {
    throw new AiProviderError("INVALID_RESPONSE", "The provider returned a response that is not JSON", res.status);
  }
}

/**
 * Resource path of a Gemini model: "models/gemini-2.5-flash", or
 * "tunedModels/xyz" for tuned models. The exact id from the model list is used.
 */
export function geminiModelPath(modelName: string): string {
  const name = modelName.trim().replace(/^models\//, "");
  if (name.startsWith("tunedModels/")) return `tunedModels/${encodeURIComponent(name.slice("tunedModels/".length))}`;
  return `models/${encodeURIComponent(name)}`;
}

async function callGemini(model: AiModelConfig, req: AiRequest, fetchImpl: FetchLike): Promise<AiResponse> {
  const base = trimSlash(model.apiBaseUrl || DEFAULT_BASE_URL.gemini);
  const name = model.modelName.replace(/^models\//, "");
  const research = Boolean(req.research && model.capabilities.includes("research"));
  const body = {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: [{ role: "user", parts: [{ text: req.prompt }] }],
    generationConfig: {
      temperature: 0.2,
      ...(req.maxOutputTokens ? { maxOutputTokens: req.maxOutputTokens } : {}),
      // JSON mode can't be combined with Google Search grounding.
      ...(req.json && !research ? { responseMimeType: "application/json" } : {}),
    },
    ...(research ? { tools: [{ google_search: {} }] } : {}),
  };
  const data = (await postJson(`${base}/${geminiModelPath(name)}:generateContent`, { "x-goog-api-key": model.apiKey ?? "" }, body, model, fetchImpl, req.minTimeoutMs)) as {
    candidates?: {
      content?: { parts?: { text?: string; thought?: boolean }[] };
      finishReason?: string;
      groundingMetadata?: {
        groundingChunks?: { web?: { uri?: string; title?: string } }[];
        groundingSupports?: { segment?: { text?: string }; groundingChunkIndices?: number[] }[];
        webSearchQueries?: string[];
        searchEntryPoint?: { renderedContent?: string };
      };
    }[];
    promptFeedback?: { blockReason?: string };
  };
  const cand = data.candidates?.[0];
  if (data.promptFeedback?.blockReason) throw new AiProviderError("INVALID_RESPONSE", `Request blocked: ${data.promptFeedback.blockReason}`);
  // "thought" parts are the model's reasoning, not the answer
  const text = (cand?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("").trim();
  if (!text) throw new AiProviderError("INVALID_RESPONSE", `Empty response${cand?.finishReason ? ` (${cand.finishReason})` : ""}`);
  if (cand?.finishReason === "MAX_TOKENS" && req.json) throw new AiProviderError("INVALID_RESPONSE", "The answer was cut off (output token limit reached)");
  // Keep the chunk numbering so grounding supports still point at the right source.
  const gm = cand?.groundingMetadata;
  const chunks = (gm?.groundingChunks ?? []).map((c) => (c.web?.uri ? { url: c.web.uri, title: c.web.title ?? null } : null));
  const index = new Map<number, number>();
  const sources: AiSource[] = [];
  chunks.forEach((c, i) => {
    if (c) {
      index.set(i, sources.length);
      sources.push(c);
    }
  });
  const supports = (gm?.groundingSupports ?? [])
    .map((s) => ({ text: (s.segment?.text ?? "").trim(), sources: (s.groundingChunkIndices ?? []).map((i) => index.get(i)).filter((i): i is number => i !== undefined) }))
    .filter((s) => s.text && s.sources.length);
  return { text, sources, supports, queries: (gm?.webSearchQueries ?? []).filter(Boolean), searchEntryPoint: gm?.searchEntryPoint?.renderedContent ?? null };
}

async function callOpenAiStyle(model: AiModelConfig, req: AiRequest, fetchImpl: FetchLike): Promise<AiResponse> {
  const base = trimSlash(model.apiBaseUrl || DEFAULT_BASE_URL.openai);
  const images = (req.imageUrls ?? []).filter(() => model.capabilities.includes("vision") || model.capabilities.includes("image_analysis"));
  const userContent = images.length
    ? [{ type: "text", text: req.prompt }, ...images.slice(0, 4).map((url) => ({ type: "image_url", image_url: { url } }))]
    : req.prompt;
  const research = Boolean(req.research && model.capabilities.includes("research"));
  const body = {
    model: model.modelName,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: userContent },
    ],
    // Search models don't accept response_format; ask for JSON in the prompt instead.
    // Schema-constrained output only where it is documented (OpenAI) and the admin marked the model "Structured output".
    ...(req.json && !research
      ? req.jsonSchema && model.providerType === "openai" && model.capabilities.includes("structured_output")
        ? { response_format: { type: "json_schema", json_schema: { name: req.jsonSchema.name, schema: req.jsonSchema.schema, strict: false } } }
        : { response_format: { type: "json_object" } }
      : {}),
  };
  const data = (await postJson(`${base}/chat/completions`, { authorization: `Bearer ${model.apiKey ?? ""}` }, body, model, fetchImpl, req.minTimeoutMs)) as {
    choices?: {
      finish_reason?: string;
      message?: { content?: string | null; annotations?: { type?: string; url_citation?: { url?: string; title?: string; start_index?: number; end_index?: number } }[] };
    }[];
  };
  const msg = data.choices?.[0]?.message;
  const raw = msg?.content ?? "";
  const text = raw.trim();
  if (!text) throw new AiProviderError("INVALID_RESPONSE", "Empty response");
  if (data.choices?.[0]?.finish_reason === "length" && req.json) throw new AiProviderError("INVALID_RESPONSE", "The answer was cut off (output token limit reached)");
  // url_citation annotations (search models): the cited text span supports that URL
  const sources: AiSource[] = [];
  const supports: { text: string; sources: number[] }[] = [];
  for (const a of msg?.annotations ?? []) {
    const c = a.url_citation;
    if (!c?.url) continue;
    let i = sources.findIndex((s) => s.url === c.url);
    if (i < 0) {
      i = sources.length;
      sources.push({ url: c.url, title: c.title ?? null });
    }
    const span = typeof c.start_index === "number" && typeof c.end_index === "number" ? raw.slice(c.start_index, c.end_index).trim() : "";
    if (span) supports.push({ text: span, sources: [i] });
  }
  return { text, sources, supports };
}

/** One request to one model. Throws AiProviderError on any failure. */
export async function callModel(model: AiModelConfig, req: AiRequest, fetchImpl: FetchLike = fetch): Promise<AiResponse> {
  if (!model.apiKey) throw new AiProviderError("NO_KEY", "No API key saved for this model");
  if (!/^https:\/\//.test(model.apiBaseUrl || DEFAULT_BASE_URL[model.providerType]))
    throw new AiProviderError("BAD_REQUEST", "API base URL must start with https://");
  return model.providerType === "gemini" ? callGemini(model, req, fetchImpl) : callOpenAiStyle(model, req, fetchImpl);
}

/** Parse a JSON object from model text (handles ```json fences and leading prose). */
export function parseJsonObject(text: string): Record<string, unknown> {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new AiProviderError("INVALID_RESPONSE", "The model did not return a JSON object");
  try {
    const parsed: unknown = JSON.parse(candidate.slice(start, end + 1));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed as Record<string, unknown>;
  } catch {
    throw new AiProviderError("INVALID_RESPONSE", "The model returned invalid JSON");
  }
}
