import type { Metadata } from "next";
import { CheckoutForm } from "@/components/store/checkout-form";
import { Breadcrumbs } from "@/components/ui/misc";
import { getSiteSettings } from "@/services/settings";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Checkout", robots: { index: false, follow: false } };

export default async function CheckoutPage() {
  const [settings, user] = await Promise.all([getSiteSettings(), getCurrentUser()]);

  // Signed-in customers get their saved details pre-filled.
  let prefill = { name: "", phone: "", email: "", address: "", city: "", area: "" };
  if (user) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("customers")
      .select("full_name, phone, email, address, city, area")
      .eq("user_id", user.id)
      .maybeSingle();
    const c = data as { full_name: string; phone: string | null; email: string | null; address: string | null; city: string | null; area: string | null } | null;
    prefill = {
      name: c?.full_name || (user.user_metadata?.full_name as string | undefined) || "",
      phone: c?.phone ?? "",
      email: c?.email ?? user.email ?? "",
      address: c?.address ?? "",
      city: c?.city ?? "",
      area: c?.area ?? "",
    };
  }

  return (
    <div className="container-page py-5 lg:py-8">
      <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Cart", href: "/cart" }, { name: "Checkout" }]} />
      <h1 className="mt-3 text-2xl font-bold md:text-3xl">Checkout</h1>
      <CheckoutForm
        deliveryInside={settings.delivery_charge_inside_dhaka}
        deliveryOutside={settings.delivery_charge_outside_dhaka}
        freeThreshold={settings.free_delivery_threshold}
        storeName={settings.store_name}
        phone={settings.phone}
        prefill={prefill}
      />
    </div>
  );
}
