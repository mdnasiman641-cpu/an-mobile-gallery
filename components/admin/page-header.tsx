import Link from "next/link";

export function AdminPageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back ? (
          <Link href={back.href} className="text-sm font-semibold text-signal hover:underline">
            {back.label}
          </Link>
        ) : null}
        <h1 className="text-2xl font-bold">{title}</h1>
        {description ? <p className="mt-0.5 text-sm text-ink-soft">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export const adminTable = {
  wrap: "overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface",
  table: "w-full min-w-[720px] border-collapse text-sm",
  th: "border-b border-line bg-paper px-3 py-2.5 text-left text-xs font-semibold text-ink-soft",
  td: "border-b border-line px-3 py-2.5 align-middle",
};

/** GET form for search + filters on admin list pages (works without JS). */
export function AdminFilterBar({ children }: { children: React.ReactNode }) {
  return (
    <form method="get" className="mb-4 flex flex-wrap items-end gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-3">
      {children}
      <button type="submit" className="h-10 rounded-[var(--radius-control)] bg-ink px-4 text-sm font-semibold text-white">
        Apply
      </button>
    </form>
  );
}
