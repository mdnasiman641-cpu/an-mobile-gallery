import type { Metadata } from "next";
import { ProductsView, productsMetadata } from "@/components/store/listing-pages";

// Unfiltered /products is a cached page. URLs with filter, sort or page
// parameters are rewritten to /browse/products (next.config.ts).
export const revalidate = 3600;

export const metadata: Metadata = productsMetadata({});

export default function ProductsPage() {
  return <ProductsView sp={{}} />;
}
