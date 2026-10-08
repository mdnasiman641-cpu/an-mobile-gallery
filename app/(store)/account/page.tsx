import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ProfileForm } from "@/components/store/profile-form";

export default async function AccountProfilePage() {
  const user = await requireUser("/account");
  const supabase = await createClient();
  const { data } = await supabase
    .from("customers")
    .select("full_name, phone, address, city, area")
    .eq("user_id", user.id)
    .maybeSingle();
  const c = (data ?? {}) as Partial<Record<"full_name" | "phone" | "address" | "city" | "area", string | null>>;

  return (
    <section aria-labelledby="profile-h">
      <h2 id="profile-h" className="mb-4 text-lg font-bold">
        Profile
      </h2>
      <ProfileForm
        profile={{
          full_name: c.full_name || (user.user_metadata?.full_name as string | undefined) || "",
          phone: c.phone ?? "",
          address: c.address ?? "",
          city: c.city ?? "",
          area: c.area ?? "",
        }}
      />
    </section>
  );
}
