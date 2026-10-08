import type { Metadata } from "next";
import { ProductsView, productsMetadata } from "@/components/store/listing-pages";
import type { RawSearchParams } from "@/lib/listing";

// Internal: /products?<filters> is rewritten here (next.config.ts).
// Rendered per request; the product data itself is cached per query.
type Props = { searchParams: Promise<RawSearchParams> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  return productsMetadata(await searchParams);
}

export default async function FilteredProductsPage({ searchParams }: Props) {
  return <ProductsView sp={await searchParams} />;
}
