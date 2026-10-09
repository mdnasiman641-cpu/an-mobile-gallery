import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { getProductsForCompare } from "@/services/catalog";
import { CompareSync, RemoveFromCompare } from "@/components/store/compare-sync";
import { AvailabilityBadge, PriceTag } from "@/components/store/product-bits";
import { Breadcrumbs, EmptyState } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { buildMetadata } from "@/lib/seo";
import { conditionLabel, isSvg } from "@/lib/utils";
import { withSiteDefaults } from "@/lib/page-metadata";

type Props = { searchParams: Promise<{ ids?: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return withSiteDefaults(buildMetadata({
  title: "Compare Phones",
  description: "Compare prices and specifications of phones side by side.",
  path: "/compare",
  noIndex: true,
  }));
}

export default async function ComparePage({ searchParams }: Props) {
  const { ids: rawIds } = await searchParams;
  const ids = (rawIds ?? "").split(",").filter(Boolean).slice(0, 4);
  const products = await getProductsForCompare(ids);

  // union of spec names in first-seen order
  const specNames: string[] = [];
  for (const p of products) for (const s of p.specifications) if (!specNames.includes(s.name)) specNames.push(s.name);
  const specValue = (pIndex: number, name: string) =>
    products[pIndex].specifications.find((s) => s.name === name)?.value ?? "—";

  return (
    <div className="container-page py-5 lg:py-8">
      <CompareSync currentIds={ids} />
      <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Compare" }]} />
      <h1 className="mt-3 text-2xl font-bold md:text-3xl">Compare phones</h1>

      {products.length === 0 ? (
        <EmptyState
          className="mt-6"
          title="Nothing to compare yet"
          description="Tap “Compare” on up to four product pages, then come back here to see them side by side."
          action={<ButtonLink href="/products">Browse phones</ButtonLink>}
        />
      ) : (
        <div className="mt-6 overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <caption className="sr-only">Side-by-side comparison</caption>
            <thead>
              <tr>
                <th scope="col" className="w-36 p-3 text-left align-bottom text-ink-mute">
                  <span className="sr-only">Feature</span>
                </th>
                {products.map((p) => (
                  <th key={p.id} scope="col" className="p-3 text-left align-top font-normal">
                    <div className="flex justify-end">
                      <RemoveFromCompare id={p.id} name={p.name} />
                    </div>
                    <Link href={`/products/${p.slug}`} className="block">
                      <span className="relative mx-auto block aspect-square w-28">
                        {p.images[0] ? (
                          <Image src={p.images[0].url} alt={p.name} fill sizes="112px" className="object-contain" unoptimized={isSvg(p.images[0].url)} />
                        ) : null}
                      </span>
                      <span className="mt-2 block font-semibold text-ink hover:underline">{p.name}</span>
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-line">
                <th scope="row" className="p-3 text-left font-medium text-ink-soft">Price</th>
                {products.map((p) => (
                  <td key={p.id} className="p-3">
                    <PriceTag price={p.price} salePrice={p.sale_price} size="sm" />
                  </td>
                ))}
              </tr>
              <tr className="border-t border-line">
                <th scope="row" className="p-3 text-left font-medium text-ink-soft">Availability</th>
                {products.map((p) => (
                  <td key={p.id} className="p-3">
                    <AvailabilityBadge stock={p.stock_quantity} threshold={p.low_stock_threshold} status={p.status} />
                  </td>
                ))}
              </tr>
              <tr className="border-t border-line">
                <th scope="row" className="p-3 text-left font-medium text-ink-soft">Brand</th>
                {products.map((p) => (
                  <td key={p.id} className="p-3">{p.brand?.name ?? "—"}</td>
                ))}
              </tr>
              <tr className="border-t border-line">
                <th scope="row" className="p-3 text-left font-medium text-ink-soft">Condition</th>
                {products.map((p) => (
                  <td key={p.id} className="p-3">{conditionLabel[p.condition]}</td>
                ))}
              </tr>
              {specNames.map((name) => (
                <tr key={name} className="border-t border-line">
                  <th scope="row" className="p-3 text-left font-medium text-ink-soft">{name}</th>
                  {products.map((p, i) => (
                    <td key={p.id} className="p-3 text-ink">{specValue(i, name)}</td>
                  ))}
                </tr>
              ))}
              <tr className="border-t border-line">
                <th scope="row" className="p-3 text-left font-medium text-ink-soft">Warranty</th>
                {products.map((p) => (
                  <td key={p.id} className="p-3">{p.warranty ?? "—"}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
