/** Shared types for the multi-model AI system. Safe to import anywhere (no secrets). */

export const PROVIDER_TYPES = ["gemini", "openai", "openai_compatible"] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export const AI_CAPABILITIES = [
  "text",
  "vision",
  "structured_output",
  "json",
  "product_analysis",
  "seo",
  "research",
  "long_context",
  "image_analysis",
] as const;
export type AiCapability = (typeof AI_CAPABILITIES)[number];

export const CAPABILITY_LABELS: Record<AiCapability, string> = {
  text: "Text",
  vision: "Vision",
  structured_output: "Structured output",
  json: "JSON",
  product_analysis: "Product analysis",
  seo: "SEO",
  research: "Research (web)",
  long_context: "Long context",
  image_analysis: "Product image analysis",
};

export const HEALTH_STATUSES = [
  "HEALTHY",
  "DEGRADED",
  "RATE_LIMITED",
  "QUOTA_EXCEEDED",
  "AUTH_ERROR",
  "TIMEOUT",
  "PROVIDER_ERROR",
  "DISABLED",
] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const ROUTING_STRATEGIES = ["priority", "lowest_cost", "best_quality", "balanced"] as const;
export type RoutingStrategy = (typeof ROUTING_STRATEGIES)[number];

export const ROUTING_LABELS: Record<RoutingStrategy, string> = {
  priority: "Priority first",
  lowest_cost: "Lowest cost first",
  best_quality: "Best quality first",
  balanced: "Balanced",
};

/** What a job needs. Each inner list is "any of these"; all lists must match. */
export type AiTask =
  | "product_content"
  | "verify"
  | "seo"
  | "description"
  | "faq"
  | "improve"
  | "image_analysis"
  | "test";

export const TASK_REQUIREMENTS: Record<AiTask, AiCapability[][]> = {
  product_content: [["product_analysis"], ["json", "structured_output"]],
  verify: [["research"]],
  seo: [["seo", "text"]],
  description: [["text"]],
  faq: [["text"]],
  improve: [["text"]],
  image_analysis: [["vision", "image_analysis"]],
  test: [],
};

/** A model as the server uses it (apiKey is decrypted only on the server). */
export interface AiModelConfig {
  id: string;
  providerName: string;
  displayName: string;
  providerType: ProviderType;
  apiBaseUrl: string;
  modelName: string;
  apiKey: string | null;
  isEnabled: boolean;
  priority: number;
  timeoutMs: number;
  maxRetries: number;
  rpmLimit: number | null;
  rpdLimit: number | null;
  costInputPerMillion: number | null;
  costOutputPerMillion: number | null;
  qualityScore: number | null;
  capabilities: AiCapability[];
}

export interface AiModelHealth {
  modelId: string;
  status: HealthStatus;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  cooldownUntil: string | null;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  minuteWindowStart: string | null;
  minuteCount: number;
  dayWindow: string | null;
  dayCount: number;
}

export interface AiRequest {
  task: AiTask;
  system: string;
  prompt: string;
  /** Ask for a JSON object back. */
  json: boolean;
  /** Let research-capable models search the web (Gemini grounding / OpenAI search models). */
  research?: boolean;
  /** Public image URLs (only sent to vision-capable models). */
  imageUrls?: string[];
  maxOutputTokens?: number;
}

export interface AiSource {
  url: string;
  title: string | null;
}

export interface AiResponse {
  text: string;
  sources: AiSource[];
}

export type AiErrorCode =
  | "RATE_LIMITED"
  | "QUOTA_EXCEEDED"
  | "AUTH_ERROR"
  | "TIMEOUT"
  | "PROVIDER_ERROR"
  | "NETWORK_ERROR"
  | "MODEL_UNAVAILABLE"
  | "BAD_REQUEST"
  | "INVALID_RESPONSE"
  | "LOCAL_LIMIT"
  | "COOLDOWN"
  | "NO_KEY";

export interface AttemptRecord {
  attempt: number;
  modelId: string;
  provider: string;
  model: string;
  status: "success" | "failed" | "skipped";
  errorCode: AiErrorCode | null;
  httpStatus: number | null;
  message: string | null;
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

export type FailoverResult =
  | { ok: true; response: AiResponse; model: AiModelConfig; attempts: AttemptRecord[]; fallbackUsed: boolean }
  | { ok: false; code: "NO_ELIGIBLE_MODEL" | "ALL_MODELS_UNAVAILABLE"; message: string; attempts: AttemptRecord[] };
