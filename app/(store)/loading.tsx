import { ProductGridSkeleton } from "@/components/store/product-card";

export default function StoreLoading() {
  return (
    <div className="container-page py-5 lg:py-8" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <div className="skeleton h-4 w-40 rounded" />
      <div className="skeleton mt-3 h-8 w-64 rounded" />
      <div className="mt-6">
        <ProductGridSkeleton count={10} />
      </div>
    </div>
  );
}
