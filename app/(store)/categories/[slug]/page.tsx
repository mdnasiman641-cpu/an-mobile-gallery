import type { Metadata } from "next";
import { CategoryView, categoryMetadata } from "@/components/store/listing-pages";
import { getCategories } from "@/services/catalog";

type Props = { params: Promise<{ slug: string }> };

// Cached category page (no filters). Filtered URLs go to /browse/categories/[slug].
export const revalidate = 3600;
export const dynamicParams = true;

export async function generateStaticParams() {
  try {
    return (await getCategories()).map((c) => ({ slug: c.slug }));
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return categoryMetadata(slug, {});
}

export default async function CategoryPage({ params }: Props) {
  const { slug } = await params;
  return <CategoryView slug={slug} sp={{}} />;
}
