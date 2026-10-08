import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";

export function NotFoundContent() {
  return (
    <div className="container-page flex flex-col items-center py-20 text-center">
      <p className="price text-6xl font-extrabold text-line-strong">404</p>
      <h1 className="mt-4 text-2xl font-bold">This page isn&rsquo;t here</h1>
      <p className="bn mt-1 text-ink-soft">পৃষ্ঠাটি খুঁজে পাওয়া যায়নি</p>
      <p className="mt-3 max-w-md text-ink-soft">
        The product may have sold out and been removed, or the link is mistyped. Try searching for the phone instead.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <ButtonLink href="/products">Browse all phones</ButtonLink>
        <ButtonLink href="/" variant="outline">
          Go to home page
        </ButtonLink>
      </div>
      <Link href="/contact" className="mt-4 text-sm font-semibold text-signal hover:underline">
        Ask the shop
      </Link>
    </div>
  );
}
