import type { Metadata } from "next";
import Link from "next/link";
import { NotFoundContent } from "@/components/store/not-found-content";

export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

// Used for URLs that match no route at all.
export default function RootNotFound() {
  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="container-page flex h-16 items-center">
          <Link href="/" className="text-xl font-extrabold">
            AN<span className="text-signal">.</span>
          </Link>
        </div>
      </header>
      <main>
        <NotFoundContent />
      </main>
    </>
  );
}
