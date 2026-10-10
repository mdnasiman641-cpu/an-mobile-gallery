"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { SPEC_GROUP_ORDER } from "@/lib/ai/spec-catalog";
import type { Verification } from "@/lib/ai/product-content";
import { cn } from "@/lib/utils";

export interface SpecRowValue {
  group_name: string;
  name: string;
  value: string;
}

const COMMON_SPECS: [string, string][] = [
  ["General", "Operating system"],
  ["Display", "Display"],
  ["Display", "Size"],
  ["Display", "Resolution"],
  ["Display", "Refresh rate"],
  ["Performance", "Chipset"],
  ["Memory", "RAM"],
  ["Memory", "Storage"],
  ["Camera", "Rear camera"],
  ["Camera", "Front camera"],
  ["Battery", "Battery"],
  ["Battery", "Charging"],
  ["Connectivity", "Network"],
  ["Connectivity", "SIM"],
  ["Physical", "Weight"],
];

const control =
  "w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 text-base text-ink placeholder:text-ink-mute focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/20 md:text-[15px] aria-[invalid=true]:border-deal";

/**
 * Specifications editor: rows grouped under collapsible headings (Display,
 * Camera, …), roomy inputs, a value box that grows for long values, group
 * change, reordering, and badges showing what AI filled and what was edited.
 * Only edits the rows; saving still goes through the product form.
 */
export function SpecEditor({
  specs,
  onChange,
  originOf,
  statusOf,
  isProtected,
}: {
  specs: SpecRowValue[];
  onChange: (specs: SpecRowValue[]) => void;
  originOf: (row: SpecRowValue) => "ai" | "manual" | "empty";
  statusOf: (name: string) => Verification;
  isProtected: (name: string) => boolean;
}) {
  const [closed, setClosed] = useState<string[]>([]);
  const [addTo, setAddTo] = useState("");

  // groups in the order they first appear; empty group names show as "General"
  const groupOf = (r: SpecRowValue) => r.group_name.trim() || "General";
  const groups: string[] = [];
  for (const r of specs) if (!groups.includes(groupOf(r))) groups.push(groupOf(r));
  const groupChoices = Array.from(new Set([...groups, ...SPEC_GROUP_ORDER]));
  const target = addTo || groups[groups.length - 1] || "General";

  const update = (i: number, patch: Partial<SpecRowValue>) => onChange(specs.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange(specs.filter((_, n) => n !== i));
  /** Insert at the end of a group (keeps the list grouped). */
  const insertInGroup = (list: SpecRowValue[], row: SpecRowValue) => {
    const last = list.map(groupOf).lastIndexOf(groupOf(row));
    const at = last >= 0 ? last + 1 : list.length;
    return [...list.slice(0, at), row, ...list.slice(at)];
  };
  const add = (group: string) => onChange(insertInGroup(specs, { group_name: group, name: "", value: "" }));
  const moveToGroup = (i: number, group: string) => {
    let g = group;
    if (group === "__new") {
      const name = window.prompt("Name of the new group (e.g. Audio)")?.trim();
      if (!name) return;
      g = name.slice(0, 60);
    }
    const row = { ...specs[i], group_name: g };
    onChange(insertInGroup(specs.filter((_, n) => n !== i), row));
  };
  /** Swap with the neighbouring row of the same group. */
  const move = (i: number, dir: -1 | 1) => {
    const g = groupOf(specs[i]);
    let j = i + dir;
    while (j >= 0 && j < specs.length && groupOf(specs[j]) !== g) j += dir;
    if (j < 0 || j >= specs.length) return;
    const next = [...specs];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const renameGroup = (from: string) => {
    const name = window.prompt(`Rename the group “${from}” to:`, from)?.trim();
    if (!name || name === from) return;
    onChange(specs.map((r) => (groupOf(r) === from ? { ...r, group_name: name.slice(0, 60) } : r)));
  };

  const problem = (r: SpecRowValue, i: number): string | null => {
    const name = r.name.trim();
    const value = r.value.trim();
    if (!name && !value) return "Empty row — it won't be saved";
    if (!name) return "Add a name for this value";
    if (!value) return "No value — this row won't be saved";
    if (specs.some((o, n) => n < i && groupOf(o) === groupOf(r) && o.name.trim().toLowerCase() === name.toLowerCase())) return "Same name as another row in this group";
    return null;
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-soft">
          {specs.length} specification{specs.length === 1 ? "" : "s"} in {groups.length} group{groups.length === 1 ? "" : "s"}. RAM and Storage also power the search filters.
        </p>
        <div className="flex flex-wrap gap-2">
          {specs.length === 0 ? (
            <Button type="button" variant="outline" size="sm" onClick={() => onChange(COMMON_SPECS.map(([group_name, name]) => ({ group_name, name, value: "" })))}>
              Start with common phone specs
            </Button>
          ) : (
            <>
              <Button type="button" variant="ghost" size="sm" onClick={() => setClosed([])}>
                Expand all
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setClosed(groups)}>
                Collapse all
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {groups.map((g) => {
          const rows = specs.map((r, i) => ({ r, i })).filter(({ r }) => groupOf(r) === g);
          const aiCount = rows.filter(({ r }) => originOf(r) === "ai").length;
          const issues = rows.filter(({ r, i }) => problem(r, i)).length;
          const open = !closed.includes(g);
          return (
            <section key={g} className="rounded-[var(--radius-card)] border border-line" aria-label={`${g} specifications`}>
              <div className="flex flex-wrap items-center justify-between gap-2 bg-paper px-3 py-2 sm:px-4">
                <button
                  type="button"
                  className="flex min-h-10 min-w-0 items-center gap-2 text-left font-semibold"
                  aria-expanded={open}
                  onClick={() => setClosed((c) => (open ? [...c, g] : c.filter((x) => x !== g)))}
                >
                  <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", !open && "-rotate-90")} aria-hidden />
                  <span className="min-w-0 break-words">{g}</span>
                  <span className="text-sm font-normal text-ink-mute">({rows.length})</span>
                  {aiCount ? <Badge tone="signal">AI {aiCount}</Badge> : null}
                  {issues ? <Badge tone="warn">{issues} to check</Badge> : null}
                </button>
                <div className="flex gap-1">
                  <Button type="button" variant="ghost" size="sm" onClick={() => renameGroup(g)}>
                    Rename
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => add(g)} aria-label={`Add a specification to ${g}`}>
                    <Plus className="h-4 w-4" aria-hidden /> Add
                  </Button>
                </div>
              </div>
              {open ? (
                <ul className="divide-y divide-line">
                  {rows.map(({ r, i }, k) => {
                    const origin = originOf(r);
                    const locked = isProtected(r.name);
                    const issue = problem(r, i);
                    const status = statusOf(r.name);
                    return (
                      <li key={i} className="px-3 py-3 sm:px-4">
                        <div className="grid gap-2 md:grid-cols-[minmax(9rem,13rem)_minmax(0,1fr)_auto] md:items-start">
                          <input
                            className={cn(control, "h-11")}
                            placeholder="Name (e.g. Size)"
                            value={r.name}
                            onChange={(e) => update(i, { name: e.target.value })}
                            aria-label={`Spec ${i + 1} name`}
                            aria-invalid={Boolean(issue && !r.name.trim() && r.value.trim())}
                            maxLength={80}
                          />
                          <textarea
                            className={cn(control, "min-h-11 resize-y py-2.5 leading-snug")}
                            rows={Math.min(4, Math.max(1, Math.ceil(r.value.length / 55)))}
                            placeholder="Value (e.g. 6.7 inches, 120Hz)"
                            value={r.value}
                            onChange={(e) => update(i, { value: e.target.value })}
                            aria-label={`Spec ${i + 1} value`}
                            aria-invalid={Boolean(issue && r.name.trim() && !r.value.trim())}
                            maxLength={500}
                          />
                          <div className="flex flex-wrap items-center gap-1 md:flex-nowrap">
                            <select
                              className="h-10 max-w-40 rounded-[var(--radius-control)] border border-line-strong bg-surface px-2 text-base md:text-sm"
                              value={g}
                              onChange={(e) => moveToGroup(i, e.target.value)}
                              aria-label={`Spec ${i + 1} group`}
                            >
                              {groupChoices.map((x) => (
                                <option key={x} value={x}>
                                  {x}
                                </option>
                              ))}
                              <option value="__new">New group…</option>
                            </select>
                            <button type="button" className="rounded p-2.5 hover:bg-paper disabled:opacity-30" disabled={k === 0} onClick={() => move(i, -1)} aria-label={`Move spec ${i + 1} up`}>
                              <ArrowUp className="h-4 w-4" />
                            </button>
                            <button type="button" className="rounded p-2.5 hover:bg-paper disabled:opacity-30" disabled={k === rows.length - 1} onClick={() => move(i, 1)} aria-label={`Move spec ${i + 1} down`}>
                              <ArrowDown className="h-4 w-4" />
                            </button>
                            <button type="button" className="rounded p-2.5 text-deal hover:bg-deal-tint" onClick={() => remove(i)} aria-label={`Remove spec ${i + 1}`}>
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                          {locked ? (
                            <Badge>Set by you</Badge>
                          ) : origin === "ai" ? (
                            <Badge tone={status === "VERIFIED" ? "signal" : "taka"}>AI · {status === "VERIFIED" ? "verified" : "likely, please check"}</Badge>
                          ) : origin === "manual" ? (
                            <Badge tone="ink">Manual</Badge>
                          ) : null}
                          {issue ? (
                            <span className="text-warn" role="status">
                              {issue}
                            </span>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </section>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={() => add(target)}>
          <Plus className="h-4 w-4" aria-hidden />
          Add specification
        </Button>
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          to
          <select className="h-10 rounded-[var(--radius-control)] border border-line-strong bg-surface px-2 text-base md:text-sm" value={target} onChange={(e) => setAddTo(e.target.value)} aria-label="Group for the new specification">
            {groupChoices.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-2 text-xs text-ink-mute">Rows with an empty name or value are skipped when saving. “AI · likely” values are from the model&apos;s knowledge, not a source — check them.</p>
    </div>
  );
}
