/**
 * Mirrors public.slugify() in the database.
 * "Apple iPhone 15 Pro Max 256GB" -> "apple-iphone-15-pro-max-256gb"
 * The database trigger makes the final slug unique (-2, -3 ...).
 */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}
