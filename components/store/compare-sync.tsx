"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { useStore } from "@/components/providers";

/** Keeps /compare?ids=… in step with the compare list saved in this browser. */
export function CompareSync({ currentIds }: { currentIds: string[] }) {
  const router = useRouter();
  const { compare, ready } = useStore();
  const hadLocalItems = useRef(false);

  useEffect(() => {
    if (!ready) return;
    const ids = compare.map((c) => c.id);
    if (ids.length) hadLocalItems.current = true;
    // a shared comparison link opened in a fresh browser: keep it as is
    if (ids.length === 0 && currentIds.length > 0 && !hadLocalItems.current) return;
    if (ids.join(",") !== currentIds.join(",")) {
      router.replace(ids.length ? `/compare?ids=${ids.join(",")}` : "/compare", { scroll: false });
    }
  }, [ready, compare, currentIds, router]);

  return null;
}

export function RemoveFromCompare({ id, name }: { id: string; name: string }) {
  const { removeCompare } = useStore();
  return (
    <button
      type="button"
      onClick={() => removeCompare(id)}
      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-mute hover:bg-paper hover:text-ink"
      aria-label={`Remove ${name} from compare`}
    >
      <X className="h-4 w-4" />
    </button>
  );
}
