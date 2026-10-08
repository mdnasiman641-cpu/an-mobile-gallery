import type { Metadata } from "next";
import { NotFoundContent } from "@/components/store/not-found-content";

export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

export default function StoreNotFound() {
  return <NotFoundContent />;
}
