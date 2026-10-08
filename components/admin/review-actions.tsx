"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { moderateReviewAction } from "@/app/admin/(panel)/reviews/actions";
import { ConfirmButton, toastResult } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import type { ReviewStatus } from "@/types";

export function ReviewActions({ id, status }: { id: string; status: ReviewStatus }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (op: "approved" | "rejected" | "pending") =>
    start(async () => {
      if (toastResult(await moderateReviewAction(id, op))) router.refresh();
    });

  return (
    <div className="flex flex-wrap gap-1.5">
      {status !== "approved" ? (
        <Button size="sm" loading={pending} onClick={() => run("approved")}>
          Approve
        </Button>
      ) : null}
      {status !== "rejected" ? (
        <Button size="sm" variant="outline" loading={pending} onClick={() => run("rejected")}>
          Reject
        </Button>
      ) : null}
      <ConfirmButton
        title="Delete this review?"
        description="It will be removed permanently and the product rating recalculated."
        confirmLabel="Delete"
        variant="ghost"
        onConfirm={async () => {
          const res = await moderateReviewAction(id, "delete");
          if (res.ok) router.refresh();
          return res;
        }}
      >
        Delete
      </ConfirmButton>
    </div>
  );
}
