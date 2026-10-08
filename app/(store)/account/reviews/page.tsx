import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, EmptyState } from "@/components/ui/misc";
import { RatingStars } from "@/components/store/product-bits";
import { formatDate } from "@/lib/utils";
import type { Review } from "@/types";

const TONE = { pending: "warn", approved: "signal", rejected: "deal" } as const;
const LABEL = { pending: "Waiting for approval", approved: "Published", rejected: "Not published" } as const;

export default async function MyReviewsPage() {
  const user = await requireUser("/account/reviews");
  const supabase = await createClient();
  const { data } = await supabase
    .from("reviews")
    .select("id, rating, title, body, status, created_at, product:products(name, slug)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  const reviews = (data ?? []) as unknown as (Pick<Review, "id" | "rating" | "title" | "body" | "status" | "created_at"> & {
    product: { name: string; slug: string } | null;
  })[];

  return (
    <section aria-labelledby="my-reviews-h">
      <h2 id="my-reviews-h" className="mb-4 text-lg font-bold">
        My reviews
      </h2>
      {reviews.length === 0 ? (
        <EmptyState title="No reviews yet" description="Open a product you bought and tap “Write a review”." />
      ) : (
        <ul className="space-y-3">
          {reviews.map((r) => (
            <li key={r.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {r.product ? (
                  <Link href={`/products/${r.product.slug}`} className="font-semibold hover:underline">
                    {r.product.name}
                  </Link>
                ) : (
                  <span className="font-semibold">Removed product</span>
                )}
                <Badge tone={TONE[r.status]}>{LABEL[r.status]}</Badge>
              </div>
              <div className="mt-1.5">
                <RatingStars value={r.rating} />
              </div>
              {r.title ? <p className="mt-1 font-medium">{r.title}</p> : null}
              <p className="mt-1 text-sm text-ink-soft">{r.body}</p>
              <p className="mt-2 text-xs text-ink-mute">{formatDate(r.created_at)}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
