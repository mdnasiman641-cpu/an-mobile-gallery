export default function AdminLoading() {
  return (
    <div aria-busy="true">
      <span className="sr-only">Loading…</span>
      <div className="skeleton h-8 w-56 rounded" />
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-20 rounded-[var(--radius-card)]" />
        ))}
      </div>
      <div className="skeleton mt-6 h-72 rounded-[var(--radius-card)]" />
    </div>
  );
}
