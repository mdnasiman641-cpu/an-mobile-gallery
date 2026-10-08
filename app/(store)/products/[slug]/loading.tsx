export default function ProductLoading() {
  return (
    <div className="container-page py-5 lg:py-8" aria-busy="true">
      <span className="sr-only">Loading product…</span>
      <div className="skeleton h-4 w-56 rounded" />
      <div className="mt-4 grid gap-6 lg:grid-cols-2 lg:gap-10">
        <div className="skeleton aspect-square rounded-[var(--radius-card)]" />
        <div className="space-y-3">
          <div className="skeleton h-4 w-24 rounded" />
          <div className="skeleton h-9 w-4/5 rounded" />
          <div className="skeleton h-4 w-1/2 rounded" />
          <div className="skeleton mt-6 h-64 rounded-[var(--radius-card)]" />
        </div>
      </div>
    </div>
  );
}
