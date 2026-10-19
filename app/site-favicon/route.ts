import { getFaviconIco, getFaviconId } from "@/lib/favicon-server";
import { DEFAULT_FAVICON } from "@/lib/favicon";

/**
 * /favicon.ico (rewritten here in next.config.ts).
 * The icon uploaded in Admin → Settings → Branding & Favicon as a real
 * .ico file (16, 32 and 48 px), or the built-in brand icon when none is set
 * (or if the uploaded files can't be read: never a broken icon).
 * The address stays the same; pages link to it with ?v=<version>, so a
 * replaced icon is fetched again at once, and plain /favicon.ico is
 * re-checked by browsers after at most an hour.
 */
export const dynamic = "force-dynamic";

const CACHE = "public, max-age=3600, stale-while-revalidate=86400";

export async function GET(request: Request) {
  const id = await getFaviconId();
  const ico = id ? await getFaviconIco(id) : null;
  if (ico) {
    return new Response(ico as BodyInit, {
      headers: {
        "content-type": "image/x-icon",
        "content-length": String(ico.length),
        "cache-control": CACHE,
        etag: `"${id}"`,
      },
    });
  }
  return new Response(null, {
    status: 302,
    headers: { location: new URL(DEFAULT_FAVICON.ico, request.url).toString(), "cache-control": CACHE },
  });
}
