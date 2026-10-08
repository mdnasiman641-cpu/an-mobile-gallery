import type { Metadata } from "next";
import { CategoryView, categoryMetadata } from "@/components/store/listing-pages";
import type { RawSearchParams } from "@/lib/listing";

// Internal: /categories/[slug]?<filters> is rewritten here (next.config.ts).
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<RawSearchParams> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  return categoryMetadata(slug, sp);
}

export default async function FilteredCategoryPage({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  return <CategoryView slug={slug} sp={sp} />;
}
