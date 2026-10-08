"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/button";

// Shown when a page can't load its data. Never displays raw database errors.
export default function StoreError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="container-page flex flex-col items-center py-20 text-center" role="alert">
      <h1 className="text-2xl font-bold">This page didn&rsquo;t load</h1>
      <p className="bn mt-1 text-ink-soft">পৃষ্ঠাটি লোড হয়নি</p>
      <p className="mt-3 max-w-md text-ink-soft">
        Our store is having trouble reaching its product list. Try again in a moment, or call the shop to order.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button onClick={reset}>Try again</Button>
        <ButtonLink href="/" variant="outline">
          Go to home page
        </ButtonLink>
      </div>
      {error.digest ? <p className="mt-4 text-xs text-ink-mute">Reference: {error.digest}</p> : null}
    </div>
  );
}
