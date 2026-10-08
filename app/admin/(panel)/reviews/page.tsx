import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AdminPageHeader } from "@/components/admin/page-header";
import { ReviewActions } from "@/components/admin/review-actions";
import { RatingStars } from "@/components/store/product-bits";
import { Badge, EmptyState, Pagination } from "@/components/ui/misc";
import { formatDate } from "@/lib/utils";
import type { Review, ReviewStatus } from "@/types";

export const metadata: Metadata = { title: "Reviews" };
const PER_PAGE = 20;
const TABS: { value: ReviewStatus; label: string }[] = [
  { value: "pending", label: "Waiting" },
  { value: "approved", label: "Published" },
  { value: "rejected", label: "Rejected" },
];

export default async function AdminReviewsPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  await requireStaff("editor");
  const sp = await searchParams;
  const status = (TABS.find((t) => t.value === sp.status)?.value ?? "pending") as ReviewStatus;
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();
  const { data, count } = await supabase
    .from("reviews")
    .select("id, customer_name, rating, title, body, status, is_verified_purchase, created_at, product:products(id, name, slug)", { count: "exact" })
    .eq("status", status)
    .order("created_at", { ascending: false })
    .range((page - 1) * PER_PAGE, page * PER_PAGE - 1);
  const reviews = (data ?? []) as unknown as (Review & { product: { id: string; name: string; slug: string } | null })[];

  return (
    <>
      <AdminPageHeader title="Reviews" description="Only approved reviews appear on the store and in Google rich results." />
      <nav aria-label="Review status" className="mb-4 flex gap-1">
        {TABS.map((t) => (
          <Link
            key={t.value}
            href={`/admin/reviews?status=${t.value}`}
            aria-current={status === t.value ? "page" : undefined}
            className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ${status === t.value ? "bg-ink text-white" : "bg-surface text-ink-soft ring-1 ring-line hover:text-ink"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {reviews.length === 0 ? (
        <EmptyState title={status === "pending" ? "No reviews waiting" : "Nothing here"} description="Reviews written by customers on product pages appear here first." />
      ) : (
        <ul className="space-y-3">
          {reviews.map((r) => (
            <li key={r.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  {r.product ? (
                    <Link href={`/admin/products/${r.product.id}`} className="text-sm font-semibold text-signal hover:underline">
                      {r.product.name}
                    </Link>
                  ) : null}
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <RatingStars value={r.rating} />
                    {r.title ? <span className="font-semibold">{r.title}</span> : null}
                    {r.is_verified_purchase ? <Badge tone="signal">Verified purchase</Badge> : null}
                  </div>
                  <p className="mt-2 whitespace-pre-line text-sm text-ink-soft">{r.body}</p>
                  <p className="mt-2 text-xs text-ink-mute">
                    {r.customer_name}, {formatDate(r.created_at, true)}
                  </p>
                </div>
                <ReviewActions id={r.id} status={r.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} totalPages={Math.ceil((count ?? 0) / PER_PAGE)} buildHref={(n) => `/admin/reviews?status=${status}&page=${n}`} />
    </>
  );
}
