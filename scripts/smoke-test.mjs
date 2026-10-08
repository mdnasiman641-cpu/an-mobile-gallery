#!/usr/bin/env node
/**
 * Route smoke test for a running build.
 *
 *   node scripts/smoke-test.mjs http://localhost:8787            (npm run preview)
 *   node scripts/smoke-test.mjs https://anmobilegallery.com      (production)
 *
 * Options:
 *   --site=https://anmobilegallery.com   expected NEXT_PUBLIC_SITE_URL (canonicals/sitemap)
 *   --product=apple-iphone-15-pro-max    a product slug that exists
 *   --image=<public Supabase image URL>  also test next/image through Cloudflare Images
 *
 * Read-only: only GET requests, no logins, no orders.
 */
const args = process.argv.slice(2);
const base = (args.find((a) => !a.startsWith("--")) ?? "http://localhost:8787").replace(/\/+$/, "");
const opt = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? fallback;
const site = opt("site", base).replace(/\/+$/, "");
const product = opt("product", "apple-iphone-15-pro-max");
const image = opt("image", "");

const results = [];
async function check(path, expect) {
  const url = `${base}${path}`;
  let res, body = "";
  const started = Date.now();
  try {
    res = await fetch(url, { redirect: "manual", headers: { "user-agent": "an-mobile-gallery-smoke-test" } });
    if (!expect.skipBody) body = await res.text();
  } catch (e) {
    results.push({ path, ok: false, detail: `request failed: ${e.message}` });
    return;
  }
  const problems = [];
  const status = res.status;
  if (expect.status && !expect.status.includes(status)) problems.push(`status ${status}, expected ${expect.status.join("/")}`);
  if (expect.redirectTo) {
    const loc = res.headers.get("location") ?? "";
    if (!loc.includes(expect.redirectTo)) problems.push(`redirects to "${loc}", expected "${expect.redirectTo}"`);
  }
  for (const s of expect.contains ?? []) if (!body.includes(s)) problems.push(`body missing: ${s.slice(0, 70)}`);
  for (const s of expect.notContains ?? []) if (body.includes(s)) problems.push(`body must not contain: ${s.slice(0, 50)}`);
  for (const [h, re] of Object.entries(expect.headers ?? {})) {
    const v = res.headers.get(h) ?? "";
    if (!re.test(v)) problems.push(`header ${h}="${v}" does not match ${re}`);
  }
  if (/eyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/.test(body)) {
    for (const m of body.matchAll(/eyJ[\w-]{10,}\.(eyJ[\w-]{10,})\.[\w-]{10,}/g)) {
      try {
        if (JSON.parse(Buffer.from(m[1], "base64url").toString()).role === "service_role") problems.push("SERVICE ROLE KEY IN RESPONSE");
      } catch {}
    }
  }
  results.push({ path, ok: problems.length === 0, detail: problems.join("; ") || `${status} in ${Date.now() - started} ms` });
}

const html = { status: [200], headers: { "content-type": /text\/html/ } };
const toLogin = (to) => ({ status: [302, 303, 307, 308], redirectTo: to, skipBody: true });

await check("/", { ...html, contains: [`<link rel="canonical" href="${site}/"`, "application/ld+json"] });
await check("/products", { ...html, contains: [`${site}/products"`] });
await check(`/products/${product}`, {
  ...html,
  contains: [`<link rel="canonical" href="${site}/products/${product}"`, '"@type":"Product"', '"@type":"BreadcrumbList"', "Price in Bangladesh"],
});
await check("/products?ram=12GB", { ...html, contains: ['name="robots" content="noindex'] });
await check("/brands", html);
await check("/categories", html);
await check("/offers", html);
await check("/cart", { ...html, contains: ['name="robots" content="noindex'] });
await check("/checkout", html);
await check("/login", html);
await check("/register", html);
await check("/account", toLogin("/login"));
await check("/admin/login", { ...html, headers: { "x-robots-tag": /noindex/, "cache-control": /no-store/ } });
await check("/admin/dashboard", toLogin("/admin/login"));
await check("/admin/products", toLogin("/admin/login"));
await check("/admin/products/new", toLogin("/admin/login"));
await check("/admin/banners", toLogin("/admin/login"));
await check("/sitemap.xml", { status: [200], headers: { "content-type": /xml/ }, contains: [`<loc>${site}/</loc>`, `${site}/brands/`] });
await check("/robots.txt", { status: [200], contains: ["Disallow: /admin", "Disallow: /browse", `Sitemap: ${site}/sitemap.xml`], notContains: ["Disallow: /products"] });
await check("/feeds/google-merchant.xml", { status: [200], headers: { "content-type": /xml/ }, contains: ['xmlns:g="http://base.google.com/ns/1.0"'] });
await check("/this-page-does-not-exist", { status: [404] });
await check("/_next/static/does-not-exist.js", { status: [404], skipBody: true });
if (image) await check(`/_next/image?url=${encodeURIComponent(image)}&w=640&q=75`, { status: [200], headers: { "content-type": /^image\// }, skipBody: true });

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.path.padEnd(34)} ${r.detail}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed against ${base}${site !== base ? ` (expecting canonical ${site})` : ""}`);
process.exit(failed ? 1 : 0);
