import type { Metadata } from "next";
import { BrandView, brandMetadata } from "@/components/store/listing-pages";
import type { RawSearchParams } from "@/lib/listing";

// Internal: /brands/[slug]?<filters> is rewritten here (next.config.ts).
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<RawSearchParams> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  return brandMetadata(slug, sp);
}

export default async function FilteredBrandPage({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  return <BrandView slug={slug} sp={sp} />;
}
