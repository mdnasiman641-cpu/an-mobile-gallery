"use server";

// Admin → Guides. Staff (editor and up) write guides like Admin → Pages;
// deleting needs an admin. Row-level security enforces the same rules.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { articleSchema, type Article } from "@/lib/articles";
import { firstFieldErrors } from "@/lib/validation";
import type { ActionResult } from "@/types";

const MIGRATION = "Guides need database migration 0019 (supabase/migrations/20261021000019_guides_and_collections.sql). Run it in the Supabase SQL editor first.";
const missing = (m: string) => /relation .*articles.* does not exist|could not find the table .*articles/i.test(m);

/** Only the guide pages that changed, plus the list and the sitemap. */
function refresh(slugs: (string | null | undefined)[]) {
  revalidatePath("/guides");
  for (const s of new Set(slugs)) if (s) revalidatePath(`/guides/${s}`);
  revalidatePath("/sitemap.xml");
}

export async function saveArticleAction(id: string | null, values: unknown): Promise<ActionResult<Article>> {
  const session = await assertStaff("editor");
  if ("error" in session) return { ok: false, message: session.error };
  if (id !== null && !z.string().uuid().safeParse(id).success) return { ok: false, message: "Invalid guide." };
  const parsed = articleSchema.safeParse(values);
  if (!parsed.success) return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: firstFieldErrors(parsed.error) };
  const v = parsed.data;
  const row = {
    ...v,
    // publishing without a date = now; a draft keeps the planned date
    published_at: v.status === "published" ? (v.published_at ?? new Date().toISOString()) : v.published_at,
  };

  const supabase = await createClient();
  let previousSlug: string | null = null;
  if (id) {
    const { data: prev, error } = await supabase.from("articles").select("slug").eq("id", id).maybeSingle();
    if (error) return { ok: false, message: missing(error.message) ? MIGRATION : "The guide couldn't be saved." };
    if (!prev) return { ok: false, message: "This guide no longer exists." };
    previousSlug = (prev as { slug: string }).slug;
  }
  const query = id
    ? supabase.from("articles").update(row).eq("id", id).select("*").single()
    : supabase.from("articles").insert({ ...row, author_id: session.userId }).select("*").single();
  const { data, error } = await query;
  if (error) {
    if (error.code === "23505") return { ok: false, message: "Another guide already uses this URL.", fieldErrors: { slug: "Already in use" } };
    if (missing(error.message)) return { ok: false, message: MIGRATION };
    return { ok: false, message: "The guide couldn't be saved." };
  }
  const saved = data as Article;
  refresh([previousSlug, saved.slug]);
  const scheduled = saved.status === "published" && saved.published_at && Date.parse(saved.published_at) > Date.now();
  return {
    ok: true,
    message: saved.status === "draft" ? "Draft saved (not on the website)" : scheduled ? "Scheduled: it appears on the website at its publication date" : "Published",
    data: saved,
  };
}

export async function deleteArticleAction(id: string): Promise<ActionResult> {
  const session = await assertStaff("admin");
  if ("error" in session) return { ok: false, message: session.error };
  if (!z.string().uuid().safeParse(id).success) return { ok: false, message: "Invalid guide." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("articles").delete().eq("id", id).select("slug");
  if (error) return { ok: false, message: missing(error.message) ? MIGRATION : "The guide couldn't be deleted." };
  if (!data?.length) return { ok: false, message: "The guide couldn't be deleted (already gone or no permission)." };
  refresh([(data[0] as { slug: string }).slug]);
  return { ok: true, message: "Guide deleted" };
}
