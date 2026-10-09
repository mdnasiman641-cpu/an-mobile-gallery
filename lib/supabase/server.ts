import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabaseAnonKey, supabaseUrl } from "@/lib/env";

/**
 * Supabase client bound to the visitor's auth cookies.
 * Use in Server Components, Server Actions and Route Handlers that need
 * to know who the user is (account pages, admin). RLS applies.
 *
 * One client per request while rendering (React cache): an admin page used
 * to build 3-6 clients (auth check, layout, page, helpers). Outside a render
 * (Server Actions, Route Handlers) React's cache is not active and every call
 * still gets its own client, exactly as before.
 */
export const createClient = cache(async () => {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: cookies are read-only there.
          // The proxy refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
});
