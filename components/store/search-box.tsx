"use client";

import { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { cn, formatPrice, isSvg } from "@/lib/utils";

interface Suggestion {
  id: string;
  slug: string;
  name: string;
  brand_name: string | null;
  image_url: string | null;
  price: number;
  sale_price: number | null;
}

// Small in-memory cache: repeated keystrokes never refetch the same query.
const memo = new Map<string, Suggestion[]>();

export function SearchBox({
  initialQuery = "",
  className,
  size = "md",
}: {
  initialQuery?: string;
  className?: string;
  size?: "md" | "lg";
}) {
  const large = size === "lg";
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState(initialQuery);
  // last fetched suggestions, tagged with the query they belong to
  const [fetched, setFetched] = useState<{ key: string; items: Suggestion[] }>({ key: "", items: [] });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const q = query.trim();
  const key = q.toLowerCase();
  // Results are derived from the query: nothing to reset when it changes.
  const results: Suggestion[] = q.length < 2 ? [] : (memo.get(key) ?? (fetched.key === key ? fetched.items : []));

  useEffect(() => {
    if (q.length < 2 || memo.has(key)) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search/suggest?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        if (!res.ok) throw new Error("search failed");
        const data = (await res.json()) as { items: Suggestion[] };
        memo.set(key, data.items);
        setFetched({ key, items: data.items });
        setActive(-1);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setFetched({ key, items: [] });
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [q, key]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (active >= 0 && results[active]) {
      router.push(`/products/${results[active].slug}`);
    } else if (query.trim()) {
      router.push(`/search?q=${encodeURIComponent(query.trim())}`);
    }
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a <= 0 ? results.length - 1 : a - 1));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const showList = open && query.trim().length >= 2;

  return (
    <div ref={boxRef} className={cn("relative w-full", className)}>
      <form role="search" action="/search" onSubmit={submit} className="relative">
        <label htmlFor={`${listId}-input`} className="sr-only">
          Search phones and gadgets
        </label>
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ink-mute" aria-hidden />
        <input
          id={`${listId}-input`}
          name="q"
          type="search"
          autoComplete="off"
          enterKeyHint="search"
          placeholder="Search iPhone 15, Samsung S25, Redmi, Realme…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={showList}
          aria-controls={`${listId}-list`}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-opt-${active}` : undefined}
          className={cn(
            "w-full rounded-[var(--radius-control)] border border-line-strong bg-surface pl-10 text-base placeholder:text-ink-mute md:text-[15px] focus:border-signal focus:outline-none focus:ring-4 focus:ring-brand/20 [&::-webkit-search-cancel-button]:hidden",
            large ? "h-12 bg-paper pr-28 focus:bg-surface" : "h-11 pr-20",
          )}
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            className={cn("absolute top-1/2 -translate-y-1/2 rounded p-1 text-ink-mute hover:text-ink", large ? "right-[6.25rem]" : "right-[4.25rem]")}
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
        <button
          type="submit"
          className={cn(
            "absolute right-1 top-1 rounded-[9px] bg-signal px-3.5 text-sm font-semibold text-white hover:bg-board",
            large ? "h-10 px-6" : "h-9",
          )}
        >
          Search
        </button>
      </form>

      {showList ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-lg shadow-ink/10">
          {(loading || (fetched.key !== key && !memo.has(key))) && results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-mute">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-mute">No matching products. Press Search to see all results.</p>
          ) : (
            <ul id={`${listId}-list`} role="listbox" aria-label="Suggestions">
              {results.map((r, i) => (
                <li
                  key={r.id}
                  id={`${listId}-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    router.push(`/products/${r.slug}`);
                    setOpen(false);
                  }}
                  className={cn("flex cursor-pointer items-center gap-3 px-3 py-2", i === active && "bg-paper")}
                >
                  <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-md bg-paper">
                    {r.image_url ? (
                      <Image
                        src={r.image_url}
                        alt=""
                        fill
                        sizes="44px"
                        className="object-contain p-1"
                        unoptimized={isSvg(r.image_url)}
                      />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{r.name}</span>
                    {r.brand_name ? <span className="block text-xs text-ink-mute">{r.brand_name}</span> : null}
                  </span>
                  <span className="price shrink-0 text-sm font-semibold text-ink">
                    {formatPrice(r.sale_price ?? r.price)}
                  </span>
                </li>
              ))}
              <li className="border-t border-line">
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    router.push(`/search?q=${encodeURIComponent(query.trim())}`);
                    setOpen(false);
                  }}
                  className="w-full px-4 py-2.5 text-left text-sm font-semibold text-signal hover:bg-paper"
                >
                  See all results for “{query.trim()}”
                </button>
              </li>
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
