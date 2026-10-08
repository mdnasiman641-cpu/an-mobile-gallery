import type { Metadata } from "next";
import { BrandView, brandMetadata } from "@/components/store/listing-pages";
import { getBrands } from "@/services/catalog";

type Props = { params: Promise<{ slug: string }> };

// Cached brand page (no filters). Filtered URLs go to /browse/brands/[slug].
export const revalidate = 3600;
export const dynamicParams = true;

export async function generateStaticParams() {
  try {
    return (await getBrands()).filter((b) => b.is_featured).map((b) => ({ slug: b.slug }));
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return brandMetadata(slug, {});
}

export default async function BrandPage({ params }: Props) {
  const { slug } = await params;
  return <BrandView slug={slug} sp={{}} />;
}
