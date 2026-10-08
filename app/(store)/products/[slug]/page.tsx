import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { BadgeCheck, RotateCcw, ShieldCheck, Truck } from "lucide-react";
import {
  getApprovedReviews,
  getPopularProductSlugs,
  getProductBySlug,
  getProductRecommendations,
  getSlugRedirect,
} from "@/services/catalog";
import { getSiteSettings } from "@/services/settings";
import { ProductGallery } from "@/components/store/product-gallery";
import { ProductPurchase } from "@/components/store/product-purchase";
import { ProductGrid } from "@/components/store/product-card";
import { PriceTag, RatingStars } from "@/components/store/product-bits";
import { ReviewForm } from "@/components/store/review-form";
import { ViewTracker } from "@/components/store/view-tracker";
import { WishlistButton } from "@/components/store/wishlist-button";
import { Badge, Breadcrumbs, SectionHeading } from "@/components/ui/misc";
import { RichText } from "@/components/ui/rich-text";
import { JsonLd } from "@/components/seo/json-ld";
import { breadcrumbJsonLd, productJsonLd } from "@/lib/jsonld";
import { absoluteUrl, buildMetadata, productSeoDescription, productSeoTitle } from "@/lib/seo";
import { conditionLabel, formatDate, formatPrice } from "@/lib/utils";
import type { ProductSpecification } from "@/types";

type Props = { params: Promise<{ slug: string }> };

// Statically generated and cached; refreshed on admin edits, orders that
// change stock, or at most hourly.
export const revalidate = 3600;
export const dynamicParams = true;

export async function generateStaticParams() {
  // Pre-render the most popular products at build time; others are rendered
  // on first visit and then cached.
  const slugs = await getPopularProductSlugs(40);
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return { title: "Product not found", robots: { index: false } };
  const meta = buildMetadata({
    title: productSeoTitle(product),
    description: productSeoDescription(product),
    path: `/products/${product.slug}`,
    image: product.images[0]?.url,
    imageAlt: product.images[0]?.alt_text ?? product.name,
    // Demo products (seed data) stay browsable for testing but are never indexed.
    noIndex: product.is_demo,
  });
  if (product.canonical_url) meta.alternates = { canonical: product.canonical_url };
  return meta;
}

function groupSpecs(specs: ProductSpecification[]) {
  const groups = new Map<string, ProductSpecification[]>();
  for (const s of specs) {
    const key = s.group_name || "General";
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return Array.from(groups.entries());
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) {
    const target = await getSlugRedirect("product", slug);
    if (target) permanentRedirect(`/products/${target}`);
    notFound();
  }

  const [settings, reviews, recommendations] = await Promise.all([
    getSiteSettings(),
    getApprovedReviews(product.id),
    getProductRecommendations(product),
  ]);

  const url = product.canonical_url || absoluteUrl(`/products/${product.slug}`);
  const images = product.images.map((i) => ({ url: i.url, alt: i.alt_text || product.name }));
  const specGroups = groupSpecs(product.specifications);
  const keySpecs = product.specifications.slice(0, 6);

  const crumbs = [
    { name: "Home", path: "/" },
    ...(product.category ? [{ name: product.category.name, path: `/categories/${product.category.slug}` }] : []),
    ...(product.brand ? [{ name: product.brand.name, path: `/brands/${product.brand.slug}` }] : []),
    { name: product.name, path: `/products/${product.slug}` },
  ];

  return (
    <div className="container-page py-5 lg:py-8">
      <Breadcrumbs items={crumbs.map((c, i) => ({ name: c.name, href: i < crumbs.length - 1 ? c.path : undefined }))} />

      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10">
        <ProductGallery images={images} productName={product.name} />

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            {product.brand ? (
              <Link href={`/brands/${product.brand.slug}`} className="text-sm font-semibold text-signal hover:underline">
                {product.brand.name}
              </Link>
            ) : null}
            {product.condition !== "new" ? <Badge tone="ink">{conditionLabel[product.condition]}</Badge> : null}
            {product.is_new ? <Badge tone="signal">New arrival</Badge> : null}
            {product.is_best_seller ? <Badge tone="taka">Best seller</Badge> : null}
          </div>
          <h1 className="mt-1.5 text-2xl font-bold leading-tight md:text-[2rem]">{product.name}</h1>
          <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-soft">
            {product.model ? (
              <div className="flex gap-1">
                <dt>Model:</dt>
                <dd className="font-medium text-ink">{product.model}</dd>
              </div>
            ) : null}
            {product.sku ? (
              <div className="flex gap-1">
                <dt>SKU:</dt>
                <dd className="font-medium text-ink">{product.sku}</dd>
              </div>
            ) : null}
            <div className="flex gap-1">
              <dt>Condition:</dt>
              <dd className="font-medium text-ink">{conditionLabel[product.condition]}</dd>
            </div>
          </dl>
          {product.rating_count > 0 ? (
            <a href="#reviews" className="mt-2 inline-flex">
              <RatingStars value={product.rating_avg} count={product.rating_count} size="md" />
            </a>
          ) : null}

          {product.short_description ? <p className="mt-3 text-ink-soft">{product.short_description}</p> : null}

          <div className="mt-5 rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:p-5">
            <Suspense fallback={<PriceTag price={product.price} salePrice={product.sale_price} size="lg" />}>
              <ProductPurchase
                product={{
                  id: product.id,
                  slug: product.slug,
                  name: product.name,
                  price: product.price,
                  sale_price: product.sale_price,
                  stock_quantity: product.stock_quantity,
                  low_stock_threshold: product.low_stock_threshold,
                  status: product.status,
                  image: product.images[0]?.url ?? null,
                }}
                variants={product.variants}
                whatsapp={settings.whatsapp}
              />
            </Suspense>
            <div className="mt-1 border-t border-line pt-2">
              <WishlistButton productId={product.id} productSlug={product.slug} />
            </div>
          </div>

          <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            {product.warranty ? (
              <li className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-signal" aria-hidden />
                {product.warranty}
              </li>
            ) : null}
            <li className="flex items-start gap-2">
              <Truck className="mt-0.5 h-4 w-4 shrink-0 text-signal" aria-hidden />
              <span>
                Delivery {formatPrice(settings.delivery_charge_inside_dhaka)} inside Dhaka,{" "}
                {formatPrice(settings.delivery_charge_outside_dhaka)} outside
              </span>
            </li>
            {settings.return_days ? (
              <li className="flex items-start gap-2">
                <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-signal" aria-hidden />
                {settings.return_days}-day return for manufacturing faults
              </li>
            ) : null}
            <li className="flex items-start gap-2">
              <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-signal" aria-hidden />
              Cash on delivery available
            </li>
          </ul>

          {keySpecs.length ? (
            <div className="mt-5">
              <p className="text-sm font-semibold">Key specs</p>
              <ul className="mt-2 grid grid-cols-2 gap-2">
                {keySpecs.map((s) => (
                  <li key={s.id} className="rounded-lg bg-surface px-3 py-2 ring-1 ring-line">
                    <span className="block text-xs text-ink-mute">{s.name}</span>
                    <span className="block text-sm font-medium text-ink">{s.value}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      {/* in-page navigation */}
      <nav aria-label="Product sections" className="no-scrollbar sticky top-[116px] z-20 mt-10 flex gap-1 overflow-x-auto border-b border-line bg-paper/95 backdrop-blur md:top-[72px] lg:top-[152px]">
        {[
          specGroups.length ? ["specifications", "Specifications"] : null,
          product.description || product.features.length ? ["description", "Description"] : null,
          ["reviews", `Reviews (${product.rating_count})`],
        ]
          .filter((x): x is string[] => Boolean(x))
          .map(([id, label]) => (
            <a key={id} href={`#${id}`} className="shrink-0 px-3 py-3 text-sm font-semibold text-ink-soft hover:text-ink">
              {label}
            </a>
          ))}
      </nav>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          {specGroups.length ? (
            <section id="specifications" className="scroll-mt-48 pt-8">
              <h2 className="text-xl font-bold">Specifications</h2>
              <div className="mt-4 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
                {specGroups.map(([group, specs]) => (
                  <table key={group} className="w-full border-collapse text-sm">
                    <caption className="bg-paper px-4 py-2 text-left text-sm font-semibold text-ink">{group}</caption>
                    <tbody>
                      {specs.map((s) => (
                        <tr key={s.id} className="border-t border-line">
                          <th scope="row" className="w-2/5 px-4 py-2.5 text-left align-top font-normal text-ink-soft sm:w-1/3">
                            {s.name}
                          </th>
                          <td className="px-4 py-2.5 text-ink">{s.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ))}
              </div>
            </section>
          ) : null}

          {product.description || product.features.length ? (
            <section id="description" className="scroll-mt-48 pt-10">
              <h2 className="text-xl font-bold">Description</h2>
              {product.features.length ? (
                <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                  {product.features.map((f) => (
                    <li key={f.id} className="flex items-start gap-2 text-sm">
                      <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-signal" aria-hidden />
                      {f.feature}
                    </li>
                  ))}
                </ul>
              ) : null}
              <RichText content={product.description} className="mt-4 text-ink-soft" />
            </section>
          ) : null}

          <section id="reviews" className="scroll-mt-48 pt-10">
            <h2 className="text-xl font-bold">Customer reviews</h2>
            {reviews.length ? (
              <>
                <div className="mt-2 flex items-center gap-2">
                  <RatingStars value={product.rating_avg} size="md" />
                  <span className="text-sm text-ink-soft">
                    {Number(product.rating_avg).toFixed(1)} out of 5, {product.rating_count} review
                    {product.rating_count === 1 ? "" : "s"}
                  </span>
                </div>
                <ul className="mt-5 space-y-4">
                  {reviews.map((r) => (
                    <li key={r.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <RatingStars value={r.rating} />
                        {r.title ? <span className="font-semibold">{r.title}</span> : null}
                      </div>
                      <p className="mt-2 whitespace-pre-line text-sm text-ink-soft">{r.body}</p>
                      <p className="mt-2 text-xs text-ink-mute">
                        {r.customer_name}, {formatDate(r.created_at)}
                        {r.is_verified_purchase ? <span className="ml-2 font-semibold text-signal-dark">Verified purchase</span> : null}
                      </p>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="mt-2 text-ink-soft">No reviews yet. Bought this phone from us? Share your experience.</p>
            )}
            <div className="mt-5">
              <ReviewForm productId={product.id} productSlug={product.slug} />
            </div>
          </section>
        </div>

        <aside className="hidden pt-8 lg:block" aria-label="Need help">
          <div className="sticky top-52 rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <p className="font-semibold">Questions about this phone?</p>
            <p className="bn mt-1 text-sm text-ink-soft">ফোন সম্পর্কে জানতে কল করুন</p>
            {settings.phone ? (
              <a href={`tel:${settings.phone}`} className="mt-3 block text-lg font-bold text-signal">
                {settings.phone}
              </a>
            ) : null}
            {settings.opening_hours ? <p className="mt-1 text-sm text-ink-mute">{settings.opening_hours}</p> : null}
          </div>
        </aside>
      </div>

      {recommendations.related.length ? (
        <section className="mt-14" aria-labelledby="related">
          <SectionHeading id="related" title="Related products" href={product.category ? `/categories/${product.category.slug}` : "/products"} />
          <ProductGrid products={recommendations.related.slice(0, 5)} />
        </section>
      ) : null}

      {recommendations.frequentlyViewed.length ? (
        <section className="mt-12" aria-labelledby="viewed">
          <SectionHeading
            id="viewed"
            title={product.brand ? `Frequently viewed ${product.brand.name} products` : "Frequently viewed"}
            href={product.brand ? `/brands/${product.brand.slug}` : "/products"}
          />
          <ProductGrid products={recommendations.frequentlyViewed.slice(0, 5)} />
        </section>
      ) : null}

      <ViewTracker productId={product.id} />
      <JsonLd data={productJsonLd(product, { settings, storeName: settings.store_name, reviews, url })} />
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
    </div>
  );
}
