import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AdminPageHeader } from "@/components/admin/page-header";
import { CouponManager } from "@/components/admin/coupon-manager";
import type { Coupon } from "@/types";

export const metadata: Metadata = { title: "Coupons" };

export default async function AdminCouponsPage() {
  await requireStaff("admin");
  const supabase = await createClient();
  const { data } = await supabase.from("coupons").select("*").order("created_at", { ascending: false });
  const coupons = ((data ?? []) as Coupon[]).map((c) => ({
    ...c,
    discount_value: Number(c.discount_value),
    min_order_amount: Number(c.min_order_amount),
    max_discount_amount: c.max_discount_amount === null ? null : Number(c.max_discount_amount),
  }));
  return (
    <>
      <AdminPageHeader title="Coupons" description="Discount codes customers can apply at checkout. The discount is always checked again on the server." />
      <CouponManager coupons={coupons} />
    </>
  );
}
