import type { Metadata } from "next";
import { OffersView, offersMetadata } from "@/components/store/listing-pages";

// Unfiltered /offers is a cached page; filtered URLs go to /browse/offers.
export const revalidate = 3600;

export const metadata: Metadata = offersMetadata({});

export default function OffersPage() {
  return <OffersView sp={{}} />;
}
