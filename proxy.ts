import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Runs before matching requests (Next.js 16 "proxy", formerly middleware).
 * 1. Refreshes the Supabase session cookie.
 * 2. Sends signed-out visitors away from /admin and /account.
 * Role checks (staff vs customer) happen server-side in the admin layout
 * and again in the database through RLS.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isAdminArea = pathname.startsWith("/admin") && !pathname.startsWith("/admin/login");
  const isAccountArea = pathname.startsWith("/account");

  if (!user && (isAdminArea || isAccountArea)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = isAdminArea ? "/admin/login" : "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  // Only paths that need a session. Public catalog pages stay fully cacheable.
  matcher: ["/admin/:path*", "/account/:path*", "/login", "/register", "/checkout"],
};
