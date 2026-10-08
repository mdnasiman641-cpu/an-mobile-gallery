"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SlidersHorizontal, X } from "lucide-react";
import type { FilterOptions } from "@/types";
import { cn, conditionLabel } from "@/lib/utils";
import { SORT_LABELS } from "@/lib/listing";

type Facet = "brand" | "ram" | "storage" | "condition";

/**
 * basePath is the public URL of the listing (e.g. /brands/apple). It is passed
 * in rather than read from the router because filtered URLs are served through
 * an internal rewrite.
 */
function useListingNav(basePath: string) {
  const router = useRouter();
  const pathname = basePath;
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function apply(changes: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === "") params.delete(k);
      else params.set(k, v);
    }
    params.delete("page"); // any filter change returns to page 1
    const qs = params.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  return { searchParams, apply, pending };
}

export function SortSelect({ showRelevance, basePath }: { showRelevance: boolean; basePath: string }) {
  const { searchParams, apply, pending } = useListingNav(basePath);
  const current = searchParams.get("sort") ?? (showRelevance ? "relevance" : "relevance");
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="hidden text-ink-soft sm:inline">Sort by</span>
      <select
        value={current}
        onChange={(e) => apply({ sort: e.target.value === "relevance" ? null : e.target.value })}
        className={cn(
          "h-10 rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 text-sm font-medium",
          pending && "opacity-60",
        )}
        aria-label="Sort products"
      >
        {Object.entries(SORT_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {value === "relevance" && !showRelevance ? "Recommended" : label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="border-b border-line py-4 last:border-b-0">
      <legend className="mb-2.5 text-sm font-semibold text-ink">{title}</legend>
      {children}
    </fieldset>
  );
}

/** Price inputs; remounted (via key) whenever the URL's min/max change. */
function PriceRange({
  initialMin,
  initialMax,
  options,
  onApply,
}: {
  initialMin: string;
  initialMax: string;
  options: FilterOptions;
  onApply: (min: string, max: string) => void;
}) {
  const [min, setMin] = useState(initialMin);
  const [max, setMax] = useState(initialMax);
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onApply(min, max);
      }}
    >
      <input
        inputMode="numeric"
        pattern="[0-9]*"
        placeholder={options.price_min !== null ? String(options.price_min) : "Min"}
        value={min}
        onChange={(e) => setMin(e.target.value.replace(/\D/g, ""))}
        aria-label="Minimum price"
        className="h-10 w-full min-w-0 rounded-[var(--radius-control)] border border-line-strong px-2.5 text-sm"
      />
      <span className="text-ink-mute" aria-hidden>
        –
      </span>
      <input
        inputMode="numeric"
        pattern="[0-9]*"
        placeholder={options.price_max !== null ? String(options.price_max) : "Max"}
        value={max}
        onChange={(e) => setMax(e.target.value.replace(/\D/g, ""))}
        aria-label="Maximum price"
        className="h-10 w-full min-w-0 rounded-[var(--radius-control)] border border-line-strong px-2.5 text-sm"
      />
      <button type="submit" className="h-10 shrink-0 rounded-[var(--radius-control)] bg-ink px-3 text-sm font-semibold text-white">
        Go
      </button>
    </form>
  );
}

function FilterBody({
  options,
  hideBrand,
  onDone,
  basePath,
}: {
  options: FilterOptions;
  hideBrand?: boolean;
  onDone?: () => void;
  basePath: string;
}) {
  const { searchParams, apply, pending } = useListingNav(basePath);
  const selected = (key: Facet) => (searchParams.get(key) ?? "").split(",").filter(Boolean);

  function toggle(key: Facet, value: string) {
    const current = selected(key);
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    apply({ [key]: next.length ? next.join(",") : null });
  }

  const chip = (active: boolean) =>
    cn(
      "inline-flex h-9 items-center rounded-full border px-3 text-sm font-medium transition-colors",
      active ? "border-ink bg-ink text-white" : "border-line-strong bg-surface text-ink hover:border-ink",
    );

  const anyActive = ["brand", "ram", "storage", "condition", "min", "max", "stock"].some((k) => searchParams.get(k));

  return (
    <div className={cn(pending && "opacity-70 transition-opacity")}>
      {anyActive ? (
        <button
          type="button"
          onClick={() => {
            apply({ brand: null, ram: null, storage: null, condition: null, min: null, max: null, stock: null });
            onDone?.();
          }}
          className="mb-1 text-sm font-semibold text-signal hover:underline"
        >
          Clear all filters
        </button>
      ) : null}

      <FilterGroup title="Availability">
        <label className="flex items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[var(--color-signal)]"
            checked={searchParams.get("stock") === "in"}
            onChange={(e) => apply({ stock: e.target.checked ? "in" : null })}
          />
          In stock only
        </label>
      </FilterGroup>

      <FilterGroup title="Price (৳)">
        <PriceRange
          key={`${searchParams.get("min") ?? ""}|${searchParams.get("max") ?? ""}`}
          initialMin={searchParams.get("min") ?? ""}
          initialMax={searchParams.get("max") ?? ""}
          options={options}
          onApply={(min, max) => {
            apply({ min: min || null, max: max || null });
            onDone?.();
          }}
        />
      </FilterGroup>

      {!hideBrand && options.brands.length ? (
        <FilterGroup title="Brand">
          <div className="flex flex-wrap gap-1.5">
            {options.brands.map((b) => (
              <button
                key={b.slug}
                type="button"
                aria-pressed={selected("brand").includes(b.slug)}
                onClick={() => toggle("brand", b.slug)}
                className={chip(selected("brand").includes(b.slug))}
              >
                {b.name}
                <span className="ml-1 text-xs opacity-60">{b.count}</span>
              </button>
            ))}
          </div>
        </FilterGroup>
      ) : null}

      {options.ram.length ? (
        <FilterGroup title="RAM">
          <div className="flex flex-wrap gap-1.5">
            {options.ram.map((v) => (
              <button key={v} type="button" aria-pressed={selected("ram").includes(v)} onClick={() => toggle("ram", v)} className={chip(selected("ram").includes(v))}>
                {v}
              </button>
            ))}
          </div>
        </FilterGroup>
      ) : null}

      {options.storage.length ? (
        <FilterGroup title="Storage">
          <div className="flex flex-wrap gap-1.5">
            {options.storage.map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={selected("storage").includes(v)}
                onClick={() => toggle("storage", v)}
                className={chip(selected("storage").includes(v))}
              >
                {v}
              </button>
            ))}
          </div>
        </FilterGroup>
      ) : null}

      {options.conditions.length > 1 ? (
        <FilterGroup title="Condition">
          <div className="flex flex-wrap gap-1.5">
            {(["new", "used", "refurbished"] as const)
              .filter((c) => options.conditions.includes(c))
              .map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={selected("condition").includes(c)}
                  onClick={() => toggle("condition", c)}
                  className={chip(selected("condition").includes(c))}
                >
                  {conditionLabel[c]}
                </button>
              ))}
          </div>
        </FilterGroup>
      ) : null}
    </div>
  );
}

export function FilterSidebar({ options, hideBrand, basePath }: { options: FilterOptions; hideBrand?: boolean; basePath: string }) {
  return (
    <aside aria-label="Filters" className="hidden w-64 shrink-0 lg:block">
      <div className="sticky top-[140px] rounded-[var(--radius-card)] border border-line bg-surface px-4 py-2">
        <FilterBody options={options} hideBrand={hideBrand} basePath={basePath} />
      </div>
    </aside>
  );
}

export function MobileFilterButton({ options, hideBrand, basePath }: { options: FilterOptions; hideBrand?: boolean; basePath: string }) {
  const [open, setOpen] = useState(false);
  const searchParams = useSearchParams();
  const activeCount = ["brand", "ram", "storage", "condition", "min", "max", "stock"].filter((k) => searchParams.get(k)).length;

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 text-sm font-semibold lg:hidden"
      >
        <SlidersHorizontal className="h-4 w-4" aria-hidden />
        Filters
        {activeCount ? (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-ink px-1 text-[11px] text-white">{activeCount}</span>
        ) : null}
      </button>
      {open ? (
        <div className="fixed inset-0 z-[60] lg:hidden" role="dialog" aria-modal="true" aria-label="Filters">
          <button type="button" className="absolute inset-0 bg-ink/40" aria-label="Close filters" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-surface px-4 pb-6">
            <div className="sticky top-0 flex items-center justify-between border-b border-line bg-surface py-3">
              <p className="font-bold">Filters</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg hover:bg-paper"
                aria-label="Close filters"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <FilterBody options={options} hideBrand={hideBrand} basePath={basePath} onDone={() => setOpen(false)} />
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-4 h-12 w-full rounded-[var(--radius-control)] bg-signal font-semibold text-white"
            >
              Show results
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
