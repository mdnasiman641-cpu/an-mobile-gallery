"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import {
  deleteAiModelAction,
  moveAiModelAction,
  resetAiHealthAction,
  saveAiModelAction,
  saveAiRoutingAction,
  setAiModelEnabledAction,
  testAiModelAction,
} from "@/app/admin/(panel)/settings/ai/actions";
import { ConfirmButton, toastResult } from "@/components/admin/ui";
import { HealthBadge, effectiveStatus, relativeTime, successRate, type ModelHealthView } from "@/components/admin/ai-health";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { Badge } from "@/components/ui/misc";
import { DEFAULT_BASE_URL } from "@/lib/ai/providers";
import { AI_CAPABILITIES, CAPABILITY_LABELS, ROUTING_LABELS, ROUTING_STRATEGIES, type AiCapability, type ProviderType, type RoutingStrategy } from "@/lib/ai/types";

export interface ModelRowView extends ModelHealthView {
  providerType: ProviderType;
  apiBaseUrl: string;
  keyHint: string | null;
  timeoutSeconds: number;
  maxRetries: number;
  rpmLimit: number | null;
  rpdLimit: number | null;
  costIn: number | null;
  costOut: number | null;
  qualityScore: number | null;
  capabilities: AiCapability[];
}

const PROVIDER_LABEL: Record<ProviderType, string> = { gemini: "Google Gemini", openai: "OpenAI", openai_compatible: "Custom OpenAI-compatible" };

type Form = {
  provider_name: string;
  display_name: string;
  provider_type: ProviderType;
  api_base_url: string;
  model_name: string;
  api_key: string;
  is_enabled: boolean;
  priority: string;
  timeout_seconds: string;
  max_retries: string;
  rpm_limit: string;
  rpd_limit: string;
  cost_input_per_million: string;
  cost_output_per_million: string;
  quality_score: string;
  capabilities: AiCapability[];
};

const s = (v: number | null) => (v === null ? "" : String(v));

function blank(nextPriority: number): Form {
  return {
    provider_name: "Google",
    display_name: "",
    provider_type: "gemini",
    api_base_url: DEFAULT_BASE_URL.gemini,
    model_name: "",
    api_key: "",
    is_enabled: true,
    priority: String(nextPriority),
    timeout_seconds: "45",
    max_retries: "0",
    rpm_limit: "",
    rpd_limit: "",
    cost_input_per_million: "",
    cost_output_per_million: "",
    quality_score: "",
    capabilities: ["text", "json", "product_analysis", "seo"],
  };
}

function fromRow(m: ModelRowView): Form {
  return {
    provider_name: m.providerName,
    display_name: m.displayName,
    provider_type: m.providerType,
    api_base_url: m.apiBaseUrl,
    model_name: m.modelName,
    api_key: "",
    is_enabled: m.isEnabled,
    priority: String(m.priority),
    timeout_seconds: String(m.timeoutSeconds),
    max_retries: String(m.maxRetries),
    rpm_limit: s(m.rpmLimit),
    rpd_limit: s(m.rpdLimit),
    cost_input_per_million: s(m.costIn),
    cost_output_per_million: s(m.costOut),
    quality_score: s(m.qualityScore),
    capabilities: m.capabilities,
  };
}

export function AiSettingsManager({
  models,
  routing,
  readOnly,
  activeModel,
  lastFallback,
  lastFallbackAt,
}: {
  models: ModelRowView[];
  routing: { routing_strategy: RoutingStrategy; max_attempts: number | null };
  readOnly: boolean;
  activeModel: string | null;
  lastFallback: string | null;
  lastFallbackAt: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [f, setF] = useState<Form>(blank(10));
  const [strategy, setStrategy] = useState(routing.routing_strategy);
  const [maxAttempts, setMaxAttempts] = useState(s(routing.max_attempts));
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

  const run = (id: string | null, fn: () => Promise<Parameters<typeof toastResult>[0]>) => {
    setBusyId(id);
    start(async () => {
      toastResult(await fn());
      setBusyId(null);
      router.refresh();
    });
  };

  function openNew() {
    setF(blank((models.reduce((m, x) => Math.max(m, x.priority), 0) || 0) + 10));
    setEditing("new");
  }

  function save() {
    start(async () => {
      const res = await saveAiModelAction(editing === "new" ? null : editing, f);
      if (toastResult(res)) {
        setEditing(null);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
          <p className="text-xs font-medium text-ink-mute">Current active model</p>
          <p className="mt-1 font-semibold">{activeModel ?? "None available"}</p>
        </div>
        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
          <p className="text-xs font-medium text-ink-mute">Last fallback</p>
          <p className="mt-1 font-semibold">{lastFallback ?? "None yet"}</p>
          {lastFallbackAt ? <p className="text-xs text-ink-mute">{relativeTime(lastFallbackAt)}</p> : null}
        </div>
        <form
          className="rounded-[var(--radius-card)] border border-line bg-surface p-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(null, () => saveAiRoutingAction({ routing_strategy: strategy, max_attempts: maxAttempts }));
          }}
        >
          <p className="text-xs font-medium text-ink-mute">Routing</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Select aria-label="Routing strategy" className="h-9 flex-1" value={strategy} onChange={(e) => setStrategy(e.target.value as RoutingStrategy)} disabled={readOnly}>
              {ROUTING_STRATEGIES.map((r) => (
                <option key={r} value={r}>
                  {ROUTING_LABELS[r]}
                </option>
              ))}
            </Select>
            <Input aria-label="Max models tried per job" className="h-9 w-20" placeholder="all" type="number" min={1} max={20} value={maxAttempts} onChange={(e) => setMaxAttempts(e.target.value)} disabled={readOnly} />
            <Button type="submit" size="sm" variant="outline" disabled={readOnly || pending}>
              Save
            </Button>
          </div>
          <p className="mt-1 text-xs text-ink-mute">Max models per job (empty = try each eligible model once).</p>
        </form>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold">Models and health</h2>
          <Button size="sm" onClick={openNew} disabled={readOnly}>
            <Plus className="h-4 w-4" aria-hidden /> Add model
          </Button>
        </div>
        {models.length === 0 ? (
          <p className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface p-6 text-center text-sm text-ink-soft">
            No AI models yet. Add one (for example a Google Gemini model) to start generating product content.
          </p>
        ) : (
          <ol className="space-y-2">
            {models.map((m, i) => (
              <li key={m.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="flex flex-col">
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Raise priority of ${m.displayName}`} disabled={readOnly || i === 0 || pending} onClick={() => run(m.id, () => moveAiModelAction(m.id, "up"))}>
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Lower priority of ${m.displayName}`} disabled={readOnly || i === models.length - 1 || pending} onClick={() => run(m.id, () => moveAiModelAction(m.id, "down"))}>
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{m.displayName}</p>
                      <HealthBadge status={effectiveStatus(m)} cooldownUntil={m.cooldownUntil} />
                      {!m.hasKey ? <Badge tone="deal">No key</Badge> : null}
                    </div>
                    <p className="mt-0.5 text-sm text-ink-soft">
                      {PROVIDER_LABEL[m.providerType]} · <code>{m.modelName}</code> · priority {m.priority}
                      {m.keyHint ? ` · key ${m.keyHint}` : ""}
                    </p>
                    <p className="mt-1 flex flex-wrap gap-1">
                      {m.capabilities.map((c) => (
                        <Badge key={c}>{CAPABILITY_LABELS[c as AiCapability] ?? c}</Badge>
                      ))}
                    </p>
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-ink-soft sm:grid-cols-4">
                      <div>
                        <dt className="inline text-ink-mute">Last success </dt>
                        <dd className="inline">{relativeTime(m.lastSuccessAt)}</dd>
                      </div>
                      <div>
                        <dt className="inline text-ink-mute">Last failure </dt>
                        <dd className="inline">{relativeTime(m.lastFailureAt)}</dd>
                      </div>
                      <div>
                        <dt className="inline text-ink-mute">Requests </dt>
                        <dd className="inline">{m.totalRequests}</dd>
                      </div>
                      <div>
                        <dt className="inline text-ink-mute">Success rate </dt>
                        <dd className="inline">{successRate(m)}</dd>
                      </div>
                    </dl>
                    {m.lastErrorCode ? (
                      <p className="mt-1 text-xs text-deal">
                        {m.lastErrorCode}
                        {m.lastErrorMessage ? `: ${m.lastErrorMessage}` : ""}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button variant="outline" size="sm" disabled={readOnly || pending} loading={busyId === m.id && pending} onClick={() => run(m.id, () => testAiModelAction(m.id))}>
                      Test connection
                    </Button>
                    <Button variant="outline" size="sm" disabled={readOnly} onClick={() => { setF(fromRow(m)); setEditing(m.id); }}>
                      Edit
                    </Button>
                    <Button variant="outline" size="sm" disabled={readOnly || pending} onClick={() => run(m.id, () => setAiModelEnabledAction(m.id, !m.isEnabled))}>
                      {m.isEnabled ? "Disable" : "Enable"}
                    </Button>
                    <Button variant="ghost" size="sm" disabled={readOnly || pending} onClick={() => run(m.id, () => resetAiHealthAction(m.id))}>
                      Reset health
                    </Button>
                    <ConfirmButton title={`Remove ${m.displayName}?`} description="The model and its saved key are deleted. Job history keeps its name." confirmLabel="Remove" disabled={readOnly} onConfirm={async () => { const r = await deleteAiModelAction(m.id); router.refresh(); return r; }}>
                      Remove
                    </ConfirmButton>
                  </div>
                </div>
                {editing === m.id ? <ModelForm f={f} set={set} isNew={false} keyHint={m.keyHint} pending={pending} onSave={save} onCancel={() => setEditing(null)} /> : null}
              </li>
            ))}
          </ol>
        )}
        {editing === "new" ? (
          <div className="mt-3 rounded-[var(--radius-card)] border border-line bg-surface p-4">
            <h3 className="font-semibold">Add model</h3>
            <ModelForm f={f} set={set} isNew keyHint={null} pending={pending} onSave={save} onCancel={() => setEditing(null)} />
          </div>
        ) : null}
      </section>
    </div>
  );
}

function ModelForm({
  f,
  set,
  isNew,
  keyHint,
  pending,
  onSave,
  onCancel,
}: {
  f: Form;
  set: <K extends keyof Form>(k: K, v: Form[K]) => void;
  isNew: boolean;
  keyHint: string | null;
  pending: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const id = (n: string) => `aim-${n}`;
  return (
    <form
      className="mt-4 space-y-4 border-t border-line pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
      autoComplete="off"
    >
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Provider type" htmlFor={id("type")}>
          <Select
            id={id("type")}
            value={f.provider_type}
            onChange={(e) => {
              const t = e.target.value as ProviderType;
              set("provider_type", t);
              if (t !== "openai_compatible") set("api_base_url", DEFAULT_BASE_URL[t]);
              set("provider_name", t === "gemini" ? "Google" : t === "openai" ? "OpenAI" : f.provider_name);
            }}
          >
            {(Object.keys(PROVIDER_LABEL) as ProviderType[]).map((t) => (
              <option key={t} value={t}>
                {PROVIDER_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Provider name" htmlFor={id("pname")} required>
          <Input id={id("pname")} value={f.provider_name} onChange={(e) => set("provider_name", e.target.value)} />
        </Field>
        <Field label="Display name" htmlFor={id("dname")} required hint="e.g. Gemini Model A">
          <Input id={id("dname")} value={f.display_name} onChange={(e) => set("display_name", e.target.value)} />
        </Field>
        <Field label="Model name" htmlFor={id("model")} required hint="Exactly as the provider names it">
          <Input id={id("model")} value={f.model_name} onChange={(e) => set("model_name", e.target.value)} />
        </Field>
        <Field label="API base URL" htmlFor={id("base")} required className="md:col-span-2">
          <Input id={id("base")} value={f.api_base_url} onChange={(e) => set("api_base_url", e.target.value)} />
        </Field>
        <Field
          label="API key"
          htmlFor={id("key")}
          required={isNew}
          hint={isNew ? "Encrypted on the server. It is never shown again." : `Saved key ${keyHint ?? "(none)"}. Leave empty to keep it.`}
          className="md:col-span-2"
        >
          <Input id={id("key")} type="password" autoComplete="new-password" spellCheck={false} value={f.api_key} onChange={(e) => set("api_key", e.target.value)} />
        </Field>
        <Field label="Priority" htmlFor={id("prio")} hint="1 = tried first">
          <Input id={id("prio")} type="number" min={1} max={10000} value={f.priority} onChange={(e) => set("priority", e.target.value)} />
        </Field>
        <Field label="Timeout (seconds)" htmlFor={id("timeout")}>
          <Input id={id("timeout")} type="number" min={1} max={120} value={f.timeout_seconds} onChange={(e) => set("timeout_seconds", e.target.value)} />
        </Field>
        <Field label="Max retries" htmlFor={id("retries")} hint="Same model, for timeouts / server errors">
          <Input id={id("retries")} type="number" min={0} max={3} value={f.max_retries} onChange={(e) => set("max_retries", e.target.value)} />
        </Field>
        <Field label="Quality (1–10)" htmlFor={id("quality")} hint="For quality / balanced routing">
          <Input id={id("quality")} type="number" min={1} max={10} value={f.quality_score} onChange={(e) => set("quality_score", e.target.value)} />
        </Field>
        <Field label="RPM limit" htmlFor={id("rpm")} hint="Requests per minute (optional)">
          <Input id={id("rpm")} type="number" min={1} value={f.rpm_limit} onChange={(e) => set("rpm_limit", e.target.value)} />
        </Field>
        <Field label="RPD limit" htmlFor={id("rpd")} hint="Requests per day (optional)">
          <Input id={id("rpd")} type="number" min={1} value={f.rpd_limit} onChange={(e) => set("rpd_limit", e.target.value)} />
        </Field>
        <Field label="Cost per 1M input tokens" htmlFor={id("cin")} hint="Optional, any currency">
          <Input id={id("cin")} type="number" min={0} step="0.0001" value={f.cost_input_per_million} onChange={(e) => set("cost_input_per_million", e.target.value)} />
        </Field>
        <Field label="Cost per 1M output tokens" htmlFor={id("cout")}>
          <Input id={id("cout")} type="number" min={0} step="0.0001" value={f.cost_output_per_million} onChange={(e) => set("cost_output_per_million", e.target.value)} />
        </Field>
      </div>
      <fieldset>
        <legend className="text-sm font-medium">Capabilities</legend>
        <p className="text-xs text-ink-mute">Product content needs Product analysis + JSON (or Structured output). Verify specifications needs Research.</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {AI_CAPABILITIES.map((c) => (
            <Checkbox
              key={c}
              label={CAPABILITY_LABELS[c]}
              checked={f.capabilities.includes(c)}
              onChange={(e) => set("capabilities", e.target.checked ? [...f.capabilities, c] : f.capabilities.filter((x) => x !== c))}
            />
          ))}
        </div>
      </fieldset>
      <Checkbox label="Enabled" checked={f.is_enabled} onChange={(e) => set("is_enabled", e.target.checked)} />
      <div className="flex gap-2">
        <Button type="submit" loading={pending}>
          {isNew ? "Add model" : "Save model"}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
