import type { Metadata } from "next";
import { CartView } from "@/components/store/cart-view";
import { Breadcrumbs } from "@/components/ui/misc";
import { getSiteSettings } from "@/services/settings";

export const metadata: Metadata = { title: "Your cart", robots: { index: false, follow: true } };

export default async function CartPage() {
  const settings = await getSiteSettings();
  return (
    <div className="container-page py-5 lg:py-8">
      <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Cart" }]} />
      <h1 className="mt-3 text-2xl font-bold md:text-3xl">Your cart</h1>
      <CartView insideDhaka={settings.delivery_charge_inside_dhaka} freeThreshold={settings.free_delivery_threshold} />
    </div>
  );
}
