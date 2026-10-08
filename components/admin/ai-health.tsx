import { cn } from "@/lib/utils";
import type { HealthStatus } from "@/lib/ai/types";

export interface ModelHealthView {
  id: string;
  displayName: string;
  providerName: string;
  modelName: string;
  priority: number;
  isEnabled: boolean;
  hasKey: boolean;
  capabilities: string[];
  status: HealthStatus;
  cooldownUntil: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
}

const TONE: Record<HealthStatus, string> = {
  HEALTHY: "bg-signal",
  DEGRADED: "bg-warn",
  RATE_LIMITED: "bg-warn",
  QUOTA_EXCEEDED: "bg-deal",
  AUTH_ERROR: "bg-deal",
  TIMEOUT: "bg-warn",
  PROVIDER_ERROR: "bg-deal",
  DISABLED: "bg-ink-mute",
};

export function effectiveStatus(m: Pick<ModelHealthView, "isEnabled" | "status">): HealthStatus {
  return m.isEnabled ? m.status : "DISABLED";
}

/** True while an ISO time is still in the future (cooldowns). */
export function isFuture(iso: string | null | undefined): boolean {
  return Boolean(iso) && Date.parse(iso as string) > Date.now();
}

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const diff = Date.parse(iso) - now;
  const abs = Math.abs(diff);
  const unit = abs < 60_000 ? `${Math.round(abs / 1000)}s` : abs < 3_600_000 ? `${Math.round(abs / 60_000)}m` : abs < 86_400_000 ? `${Math.round(abs / 3_600_000)}h` : `${Math.round(abs / 86_400_000)}d`;
  return diff > 0 ? `in ${unit}` : `${unit} ago`;
}

export function HealthBadge({ status, cooldownUntil }: { status: HealthStatus; cooldownUntil?: string | null }) {
  const cooling = isFuture(cooldownUntil);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold">
      <span className={cn("h-2 w-2 rounded-full", TONE[status])} aria-hidden />
      {status.replace(/_/g, " ")}
      {cooling && status !== "DISABLED" ? <span className="font-normal text-ink-mute">· retry {relativeTime(cooldownUntil)}</span> : null}
    </span>
  );
}

export function successRate(m: Pick<ModelHealthView, "successfulRequests" | "totalRequests">): string {
  return m.totalRequests ? `${Math.round((m.successfulRequests / m.totalRequests) * 100)}%` : "—";
}
