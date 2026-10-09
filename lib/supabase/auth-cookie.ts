/**
 * True when the request carries a Supabase session cookie
 * ("sb-<project-ref>-auth-token", or its chunks ".0", ".1", …).
 *
 * Without one there is no session to validate or refresh, so the proxy and
 * the auth helpers skip Supabase entirely. That avoids creating a Supabase
 * client (and, on a fresh Worker isolate, compiling the Supabase library) on
 * requests from signed-out visitors, e.g. /admin/login, /login, /checkout.
 * The result is the same as before: no cookie means no user.
 */
const AUTH_COOKIE = /^sb-[A-Za-z0-9_-]+-auth-token(?:\.\d+)?$/;

export function hasSupabaseAuthCookie(cookies: { name: string }[]): boolean {
  return cookies.some((c) => AUTH_COOKIE.test(c.name));
}
