"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { bdPhone } from "@/lib/validation";

/** Only allow same-site relative redirects (prevents open-redirect abuse). */
export function safeNext(next: string | null | undefined, fallback: string): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}

export function AuthForm({
  mode,
  next,
  audience = "customer",
}: {
  mode: "login" | "register";
  next?: string;
  audience?: "customer" | "admin";
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fallback = audience === "admin" ? "/admin/dashboard" : "/account";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const password = String(form.get("password") ?? "");
    setLoading(true);

    try {
      // Loaded on submit only: the sign-in page renders without the Supabase library
      // (less work for the server on every visit, smaller first download).
      const { getBrowserClient } = await import("@/lib/supabase/browser");
      const supabase = getBrowserClient();
      if (mode === "login") {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) {
          setError(err.message.toLowerCase().includes("invalid") ? "Email or password is incorrect." : err.message);
          return;
        }
        router.replace(safeNext(next, fallback));
        router.refresh();
        return;
      }

      const fullName = String(form.get("full_name") ?? "").trim();
      const phoneRaw = String(form.get("phone") ?? "").trim();
      if (fullName.length < 2) return setError("Enter your full name.");
      let phone: string | undefined;
      if (phoneRaw) {
        const parsed = bdPhone.safeParse(phoneRaw);
        if (!parsed.success) return setError("Enter a valid Bangladeshi mobile number (01XXXXXXXXX).");
        phone = parsed.data;
      }
      if (password.length < 8) return setError("Use at least 8 characters for your password.");

      const { data, error: err } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName, phone },
          emailRedirectTo: `${window.location.origin}/account`,
        },
      });
      if (err) {
        setError(err.message);
        return;
      }
      if (data.session) {
        router.replace(safeNext(next, "/account"));
        router.refresh();
      } else {
        setInfo("Account created. Check your email to confirm it, then sign in.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {mode === "register" ? (
        <>
          <Field label="Full name" htmlFor="full_name" required>
            <Input id="full_name" name="full_name" autoComplete="name" required />
          </Field>
          <Field label="Mobile number" htmlFor="phone" hint="Used to link your previous orders">
            <Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="01XXXXXXXXX" />
          </Field>
        </>
      ) : null}
      <Field label="Email" htmlFor="email" required>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Password" htmlFor="password" required hint={mode === "register" ? "At least 8 characters" : undefined}>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          minLength={mode === "register" ? 8 : undefined}
          required
        />
      </Field>
      {error ? (
        <p className="rounded-lg bg-deal-tint p-3 text-sm text-deal" role="alert">
          {error}
        </p>
      ) : null}
      {info ? (
        <p className="rounded-lg bg-signal-tint p-3 text-sm text-signal-dark" role="status">
          {info}
        </p>
      ) : null}
      <Button type="submit" size="lg" loading={loading}>
        {mode === "login" ? "Sign in" : "Create account"}
      </Button>
      {audience === "customer" ? (
        <p className="text-center text-sm text-ink-soft">
          {mode === "login" ? (
            <>
              New here?{" "}
              <Link href={`/register${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-semibold text-signal hover:underline">
                Create an account
              </Link>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <Link href={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-semibold text-signal hover:underline">
                Sign in
              </Link>
            </>
          )}
        </p>
      ) : null}
    </form>
  );
}
