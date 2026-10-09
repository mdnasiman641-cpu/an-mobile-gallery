"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, DownloadCloud, Plus, Search } from "lucide-react";
import {
  addSelectedModelsAction,
  deleteAiModelAction,
  loadProviderModelsAction,
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
import type { DiscoveredModel } from "@/lib/ai/model-discovery";
import type { DiagnosticStep } from "@/lib/ai/diagnostics";
import { cn } from "@/lib/utils";
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
  consecutiveFailures: number;
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
  const [tests, setTests] = useState<Record<string, DiagnosticStep[]>>({});
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

  const run = (id: string | null, fn: () => Promise<Parameters<typeof toastResult>[0]>) => {
    setBusyId(id);
    start(async () => {
      toastResult(await fn());
      setBusyId(null);
      router.refresh();
    });
  };

  function test(id: string) {
    setBusyId(id);
    start(async () => {
      const res = await testAiModelAction(id);
      toastResult(res);
      const steps = res.data?.steps;
      if (steps) setTests((prev) => ({ ...prev, [id]: steps }));
      setBusyId(null);
      router.refresh();
    });
  }

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

      <AddModelsPanel models={models} readOnly={readOnly} onAdded={() => router.refresh()} />

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">AI models and health</h2>
            <p className="text-sm text-ink-soft">Tried top to bottom. If one fails or hits its limit, the next one is used automatically.</p>
          </div>
          <Button size="sm" variant="ghost" onClick={openNew} disabled={readOnly}>
            <Plus className="h-4 w-4" aria-hidden /> Add a model by name
          </Button>
        </div>
        {models.length === 0 ? (
          <p className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface p-6 text-center text-sm text-ink-soft">
            No AI models yet. Use &ldquo;Load models&rdquo; above to add some.
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
                        <dt className="inline text-ink-mute">Timeout </dt>
                        <dd className="inline">{m.timeoutSeconds}s</dd>
                      </div>
                      <div>
                        <dt className="inline text-ink-mute">Max retries </dt>
                        <dd className="inline">{m.maxRetries}</dd>
                      </div>
                      <div>
                        <dt className="inline text-ink-mute">Limits </dt>
                        <dd className="inline">{m.rpmLimit || m.rpdLimit ? `${m.rpmLimit ?? "–"} RPM · ${m.rpdLimit ?? "–"} RPD` : "none set"}</dd>
                      </div>
                      <div>
                        <dt className="inline text-ink-mute">Cost / quality </dt>
                        <dd className="inline">
                          {m.costIn !== null || m.costOut !== null ? `${m.costIn ?? 0} / ${m.costOut ?? 0} per 1M` : "cost –"} · {m.qualityScore ? `Q${m.qualityScore}` : "Q –"}
                        </dd>
                      </div>
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
                      <div>
                        <dt className="inline text-ink-mute">OK / failed </dt>
                        <dd className="inline">
                          {m.successfulRequests} / {m.failedRequests}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline text-ink-mute">Failures in a row </dt>
                        <dd className="inline">{m.consecutiveFailures}</dd>
                      </div>
                    </dl>
                    {m.lastErrorCode ? (
                      <p className="mt-1 text-xs text-deal">
                        {m.lastErrorCode}
                        {m.lastErrorMessage ? `: ${m.lastErrorMessage}` : ""}
                      </p>
                    ) : null}
                    {tests[m.id] ? (
                      <ul className="mt-2 space-y-1 rounded-lg bg-paper p-2.5 text-xs" aria-label={`Test results for ${m.displayName}`}>
                        {tests[m.id].map((st) => (
                          <li key={st.key} className="flex gap-2">
                            <span className={cn("w-16 shrink-0 font-semibold", st.ok === true ? "text-signal" : st.ok === false ? "text-deal" : "text-ink-mute")}>
                              {st.ok === true ? "✓ OK" : st.ok === false ? "✕ Failed" : "– Skipped"}
                            </span>
                            <span>
                              <strong>{st.label}:</strong> {st.detail}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button variant="outline" size="sm" disabled={readOnly || pending} loading={busyId === m.id && pending} onClick={() => test(m.id)}>
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
                    <ConfirmButton title={`Delete ${m.displayName}?`} description="This model configuration and its saved key copy are deleted. Other models from the same provider keep working. Job history keeps its name." confirmLabel="Delete" disabled={readOnly} onConfirm={async () => { const r = await deleteAiModelAction(m.id); router.refresh(); return r; }}>
                      Delete
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
            <h3 className="font-semibold">Add a model by name</h3>
            <p className="text-sm text-ink-soft">Only needed for providers that don&rsquo;t offer a model list.</p>
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

// ---------------------------------------------------------------------------
// Enter key once → Load models → select → Add selected models
// ---------------------------------------------------------------------------

function AddModelsPanel({ models, readOnly, onAdded }: { models: ModelRowView[]; readOnly: boolean; onAdded: () => void }) {
  const [type, setType] = useState<ProviderType>("gemini");
  const [providerName, setProviderName] = useState("Google");
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL.gemini);
  const [apiKey, setApiKey] = useState("");
  const [useKeyOf, setUseKeyOf] = useState("");
  const [found, setFound] = useState<DiscoveredModel[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [timeout, setTimeoutSec] = useState("45");
  const [retries, setRetries] = useState("0");
  const [loading, startLoad] = useTransition();
  const [adding, startAdd] = useTransition();

  // Saved keys that can be reused: one entry per provider type + base URL + key.
  const savedKeys = Array.from(
    new Map(
      models
        .filter((m) => m.hasKey && m.providerType === type)
        .map((m) => [`${m.apiBaseUrl}|${m.keyHint}`, { id: m.id, label: `${m.providerName} key ${m.keyHint ?? ""} (saved with ${m.displayName})`, baseUrl: m.apiBaseUrl }]),
    ).values(),
  );
  const configured = new Set(models.filter((m) => m.providerType === type).map((m) => `${m.apiBaseUrl}|${m.modelName}`));

  function changeType(t: ProviderType) {
    setType(t);
    setBaseUrl(t === "openai_compatible" ? "https://" : DEFAULT_BASE_URL[t]);
    setProviderName(t === "gemini" ? "Google" : t === "openai" ? "OpenAI" : "");
    setUseKeyOf("");
    setFound(null);
    setSelected([]);
  }

  const credentials = () => ({ provider_type: type, api_base_url: baseUrl, ...(useKeyOf ? { use_key_of: useKeyOf } : { api_key: apiKey }) });

  function load() {
    startLoad(async () => {
      const res = await loadProviderModelsAction(credentials());
      if (toastResult(res) && res.data) {
        setFound(res.data.models);
        setBaseUrl(res.data.baseUrl);
        setSelected([]);
      }
    });
  }

  function add() {
    // in the order the admin ticked them (#1 is tried first)
    const picked = selected.map((sid) => (found ?? []).find((m) => m.id === sid)).filter((m): m is DiscoveredModel => Boolean(m));
    startAdd(async () => {
      const res = await addSelectedModelsAction({
        ...credentials(),
        provider_name: providerName || "Custom",
        timeout_seconds: timeout,
        max_retries: retries,
        models: picked.map((m) => ({
          id: m.id,
          label: m.label,
          capabilities: m.capabilities.length ? m.capabilities : ["text"],
          cost_input_per_million: m.costInputPerMillion,
          cost_output_per_million: m.costOutputPerMillion,
        })),
      });
      if (toastResult(res)) {
        setSelected([]);
        setApiKey("");
        onAdded();
      }
    });
  }

  const q = query.trim().toLowerCase();
  const visible = (found ?? []).filter((m) => (showAll || !m.nonChat) && (!q || m.label.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)));
  const hiddenCount = (found ?? []).filter((m) => m.nonChat).length;
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const id = (n: string) => `addm-${n}`;

  return (
    <section aria-labelledby="add-models" className="rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:p-5">
      <h2 id="add-models" className="text-lg font-bold">
        Add models
      </h2>
      <p className="text-sm text-ink-soft">Enter one API key, load the provider&rsquo;s models, tick the ones you want (for example 3 or 4) and add them.</p>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <Field label="Provider type" htmlFor={id("type")}>
          <Select id={id("type")} value={type} onChange={(e) => changeType(e.target.value as ProviderType)} disabled={readOnly}>
            {(Object.keys(PROVIDER_LABEL) as ProviderType[]).map((t) => (
              <option key={t} value={t}>
                {PROVIDER_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Provider name" htmlFor={id("pname")} hint="Shown in the list, e.g. Google, OpenRouter">
          <Input id={id("pname")} value={providerName} maxLength={80} onChange={(e) => setProviderName(e.target.value)} disabled={readOnly} />
        </Field>
        <Field label="API base URL" htmlFor={id("base")}>
          <Input id={id("base")} value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); setUseKeyOf(""); setFound(null); }} disabled={readOnly} />
        </Field>
        <Field label="API key" htmlFor={id("key")} hint="Sent only to this site's server; encrypted when saved and never shown again." className="md:col-span-2">
          <Input
            id={id("key")}
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            placeholder={useKeyOf ? "Using a saved key" : ""}
            value={apiKey}
            onChange={(e) => { setApiKey(e.target.value); if (e.target.value) setUseKeyOf(""); }}
            disabled={readOnly || Boolean(useKeyOf)}
          />
        </Field>
        {savedKeys.length ? (
          <Field label="Or use a saved key" htmlFor={id("saved")}>
            <Select
              id={id("saved")}
              value={useKeyOf}
              onChange={(e) => {
                setUseKeyOf(e.target.value);
                const k = savedKeys.find((x) => x.id === e.target.value);
                if (k) { setBaseUrl(k.baseUrl); setApiKey(""); }
                setFound(null);
              }}
              disabled={readOnly}
            >
              <option value="">Type a new key</option>
              {savedKeys.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>

      <div className="mt-4">
        <Button onClick={load} loading={loading} disabled={readOnly || (!apiKey && !useKeyOf) || !/^https:\/\//.test(baseUrl)}>
          <DownloadCloud className="h-4 w-4" aria-hidden /> Load models
        </Button>
      </div>

      {found ? (
        <div className="mt-5 border-t border-line pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-semibold">Available models ({visible.length})</p>
            <div className="relative min-w-52 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-mute" aria-hidden />
              <Input aria-label="Filter models" className="h-9 pl-9" placeholder="Filter…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            {hiddenCount ? (
              <Checkbox label={`Show ${hiddenCount} non-text models`} checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            ) : null}
          </div>
          <ul className="mt-3 max-h-96 divide-y divide-line overflow-y-auto rounded-lg border border-line" aria-label="Available models">
            {visible.map((m) => {
              const isAdded = configured.has(`${baseUrl}|${m.id}`);
              const order = selected.indexOf(m.id);
              return (
                <li key={m.id}>
                  <label className={`flex cursor-pointer items-start gap-3 px-3 py-2.5 ${isAdded ? "opacity-60" : "hover:bg-paper"}`}>
                    <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--color-signal)]" checked={order >= 0} disabled={isAdded} onChange={() => toggle(m.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">
                        {m.label} {order >= 0 ? <Badge tone="signal">#{order + 1}</Badge> : null} {isAdded ? <Badge>Already added</Badge> : null}
                      </span>
                      <span className="block truncate text-xs text-ink-mute">
                        <code>{m.id}</code>
                        {m.contextWindow ? ` · ${Math.round(m.contextWindow / 1000)}k context` : ""}
                        {m.costInputPerMillion !== null ? ` · ${m.costInputPerMillion}/${m.costOutputPerMillion ?? 0} per 1M` : ""}
                      </span>
                      {m.description ? <span className="block truncate text-xs text-ink-soft">{m.description}</span> : null}
                    </span>
                  </label>
                </li>
              );
            })}
            {visible.length === 0 ? <li className="px-3 py-3 text-sm text-ink-mute">No models match.</li> : null}
          </ul>

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <Field label="Timeout (s)" htmlFor={id("timeout")} className="w-28">
              <Input id={id("timeout")} type="number" min={1} max={120} value={timeout} onChange={(e) => setTimeoutSec(e.target.value)} />
            </Field>
            <Field label="Max retries" htmlFor={id("retries")} className="w-28">
              <Input id={id("retries")} type="number" min={0} max={3} value={retries} onChange={(e) => setRetries(e.target.value)} />
            </Field>
            <Button onClick={add} loading={adding} disabled={readOnly || selected.length === 0}>
              Add selected models ({selected.length})
            </Button>
          </div>
          <p className="mt-2 text-xs text-ink-mute">
            Models are added in the order you ticked them (#1 is tried first). Capabilities are suggested from what the provider reports; adjust them, RPM/RPD limits,
            cost and quality with Edit afterwards.
          </p>
        </div>
      ) : null}
    </section>
  );
}
