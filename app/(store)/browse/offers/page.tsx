import type { Metadata } from "next";
import { OffersView, offersMetadata } from "@/components/store/listing-pages";
import type { RawSearchParams } from "@/lib/listing";

// Internal: /offers?<filters> is rewritten here (next.config.ts).
type Props = { searchParams: Promise<RawSearchParams> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  return offersMetadata(await searchParams);
}

export default async function FilteredOffersPage({ searchParams }: Props) {
  return <OffersView sp={await searchParams} />;
}
