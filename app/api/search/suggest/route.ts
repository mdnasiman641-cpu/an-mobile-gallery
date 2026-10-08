import { NextResponse, type NextRequest } from "next/server";
import { queryProducts } from "@/services/catalog";

/**
 * Autocomplete endpoint. Reads the database directly; responses may be cached
 * by a CDN for up to a minute (same query from many visitors = one database
 * call). The client also debounces keystrokes and keeps an in-memory cache.
 */
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80);
  if (q.length < 2) {
    return NextResponse.json({ items: [] }, { headers: { "Cache-Control": "public, max-age=3600" } });
  }

  try {
    const { items } = await queryProducts({ query: q, perPage: 6, sort: "relevance" });
    return NextResponse.json(
      {
        items: items.map((p) => ({
          id: p.id,
          slug: p.slug,
          name: p.name,
          brand_name: p.brand_name,
          image_url: p.image_url,
          price: p.price,
          sale_price: p.sale_price,
        })),
      },
      { headers: { "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=60" } },
    );
  } catch (e) {
    console.error("[suggest]", e);
    return NextResponse.json({ items: [] }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
