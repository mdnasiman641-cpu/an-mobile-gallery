import Link from "next/link";
import { cn } from "@/lib/utils";

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: "neutral" | "signal" | "deal" | "taka" | "warn" | "ink";
  className?: string;
  children: React.ReactNode;
}) {
  const tones = {
    neutral: "bg-paper text-ink-soft border-line",
    signal: "bg-signal-tint text-signal-dark border-signal/20",
    deal: "bg-deal-tint text-deal border-deal/20",
    taka: "bg-taka-tint text-taka border-taka/25",
    warn: "bg-warn-tint text-warn border-warn/20",
    ink: "bg-ink text-white border-ink",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold leading-5",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-md", className)} aria-hidden />;
}

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface px-6 py-12 text-center",
        className,
      )}
    >
      <p className="text-lg font-semibold text-ink">{title}</p>
      {description ? <p className="mt-1 max-w-md text-ink-soft">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Breadcrumbs({ items }: { items: { name: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0 text-sm text-ink-mute">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${item.name}-${i}`} className="flex min-w-0 items-center gap-1.5">
              {item.href && !last ? (
                <Link href={item.href} className="hover:text-ink hover:underline">
                  {item.name}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className={cn(last && "truncate text-ink-soft")}>
                  {item.name}
                </span>
              )}
              {!last ? (
                <span aria-hidden className="text-line-strong">
                  /
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Link-based pagination: crawlable and works without JavaScript. */
export function Pagination({
  page,
  totalPages,
  buildHref,
}: {
  page: number;
  totalPages: number;
  buildHref: (page: number) => string;
}) {
  if (totalPages <= 1) return null;
  const pages: (number | "gap")[] = [];
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - page) <= 1) pages.push(p);
    else if (pages[pages.length - 1] !== "gap") pages.push("gap");
  }
  const cell = "flex h-10 min-w-10 items-center justify-center rounded-[var(--radius-control)] px-3 text-sm font-semibold";
  return (
    <nav aria-label="Pagination" className="mt-8 flex flex-wrap items-center justify-center gap-1.5">
      {page > 1 ? (
        <Link href={buildHref(page - 1)} rel="prev" className={cn(cell, "border border-line bg-surface hover:border-ink")}>
          Previous
        </Link>
      ) : null}
      {pages.map((p, i) =>
        p === "gap" ? (
          <span key={`gap-${i}`} className="px-1 text-ink-mute" aria-hidden>
            …
          </span>
        ) : (
          <Link
            key={p}
            href={buildHref(p)}
            aria-current={p === page ? "page" : undefined}
            className={cn(cell, p === page ? "bg-ink text-white" : "border border-line bg-surface hover:border-ink")}
          >
            {p}
          </Link>
        ),
      )}
      {page < totalPages ? (
        <Link href={buildHref(page + 1)} rel="next" className={cn(cell, "border border-line bg-surface hover:border-ink")}>
          Next
        </Link>
      ) : null}
    </nav>
  );
}

export function SectionHeading({
  title,
  subtitle,
  href,
  linkLabel = "View all",
  as: Tag = "h2",
  id,
}: {
  id?: string;
  title: string;
  subtitle?: string;
  href?: string;
  linkLabel?: string;
  as?: "h1" | "h2";
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div className="min-w-0">
        <Tag id={id} className="text-xl font-bold text-ink md:text-2xl">{title}</Tag>
        {subtitle ? <p className="mt-0.5 text-sm text-ink-soft">{subtitle}</p> : null}
      </div>
      {href ? (
        <Link href={href} className="shrink-0 text-sm font-semibold text-signal hover:underline">
          {linkLabel}
        </Link>
      ) : null}
    </div>
  );
}
