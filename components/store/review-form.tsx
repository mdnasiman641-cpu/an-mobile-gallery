"use client";

import { useState } from "react";
import Link from "next/link";
import { Star } from "lucide-react";
import { toast } from "sonner";
import { getBrowserClient } from "@/lib/supabase/browser";
import { reviewSchema, firstFieldErrors } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { cn } from "@/lib/utils";

type Phase = "idle" | "checking" | "signed-out" | "form" | "done";

/**
 * Review form. Only signed-in customers can post; every review starts as
 * "pending" (enforced by the database) and appears after admin approval.
 * Session is checked only when the visitor opens the form.
 */
export function ReviewForm({ productId, productSlug }: { productId: string; productSlug: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");

  async function open() {
    setPhase("checking");
    const supabase = getBrowserClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      setPhase("signed-out");
      return;
    }
    setUserId(data.user.id);
    setDisplayName((data.user.user_metadata?.full_name as string | undefined) || data.user.email?.split("@")[0] || "Customer");
    setPhase("form");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = reviewSchema.safeParse({ product_id: productId, rating, title, body });
    if (!parsed.success) {
      setErrors(firstFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setSaving(true);
    const supabase = getBrowserClient();
    const { error } = await supabase.from("reviews").insert({
      product_id: productId,
      user_id: userId,
      customer_name: displayName.slice(0, 80),
      rating: parsed.data.rating,
      title: parsed.data.title,
      body: parsed.data.body,
      status: "pending",
    });
    setSaving(false);
    if (error) {
      toast.error(error.code === "23505" ? "You've already reviewed this product." : "Your review couldn't be sent. Please try again.");
      return;
    }
    setPhase("done");
  }

  if (phase === "done") {
    return (
      <p className="rounded-[var(--radius-card)] bg-signal-tint p-4 text-sm text-signal-dark">
        Thanks! Your review was sent and will appear after a quick check.
      </p>
    );
  }

  if (phase === "signed-out") {
    return (
      <p className="text-sm text-ink-soft">
        <Link href={`/login?next=/products/${productSlug}`} className="font-semibold text-signal underline">
          Sign in
        </Link>{" "}
        to write a review.
      </p>
    );
  }

  if (phase !== "form") {
    return (
      <Button variant="outline" onClick={open} loading={phase === "checking"}>
        Write a review
      </Button>
    );
  }

  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-5" noValidate>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Your rating</legend>
        <div className="flex gap-1" role="radiogroup" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={`${n} star${n > 1 ? "s" : ""}`}
              onClick={() => setRating(n)}
              className="rounded p-0.5"
            >
              <Star className={cn("h-7 w-7", n <= rating ? "fill-taka text-taka" : "text-line-strong")} />
            </button>
          ))}
        </div>
        {errors.rating ? <p className="mt-1 text-sm text-deal">{errors.rating}</p> : null}
      </fieldset>
      <Field label="Title (optional)" htmlFor="review-title" error={errors.title}>
        <Input id="review-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
      </Field>
      <Field label="Your review" htmlFor="review-body" error={errors.body} required>
        <Textarea
          id="review-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={2000}
          aria-invalid={Boolean(errors.body)}
          placeholder="How is the battery, camera, performance? Would you recommend it?"
        />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" loading={saving}>
          Send review
        </Button>
        <Button type="button" variant="ghost" onClick={() => setPhase("idle")}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
