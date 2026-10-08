"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-8 text-center" role="alert">
      <h1 className="text-xl font-bold">This admin page didn&rsquo;t load</h1>
      <p className="mt-2 text-ink-soft">
        The database may be unreachable or your session may have ended. Try again, or sign in again if it keeps happening.
      </p>
      <div className="mt-5 flex justify-center gap-2">
        <Button onClick={reset}>Try again</Button>
        <a href="/admin/login" className="inline-flex h-11 items-center rounded-[var(--radius-control)] border border-line-strong px-4 font-semibold">
          Sign in again
        </a>
      </div>
      {error.digest ? <p className="mt-4 text-xs text-ink-mute">Reference: {error.digest}</p> : null}
    </div>
  );
}
