"use server";

import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/modules/identity/session";
import { moveBusinessToFreePlan, recordSubscriptionPayment, setUserStatus } from "./admin";
import { isPlatformAdmin } from "./admins";

/** Every admin action re-checks the caller; hiding the screens is not protection. */
async function requireAdmin() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!(await isPlatformAdmin(user.id))) notFound();
  return user;
}

export async function recordPaymentAction(businessId: string, formData: FormData) {
  const admin = await requireAdmin();
  const text = (name: string) => String(formData.get(name) ?? "");
  const result = await recordSubscriptionPayment(admin.id, businessId, {
    planKey: text("planKey"),
    amount: text("amount"),
    method: text("method") as "telebirr",
    reference: text("reference") || undefined,
    paidUntil: text("paidUntil"),
  });
  redirect(`/admin/businesses/${businessId}?notice=${result.ok ? "payment_recorded" : result.error}`);
}

export async function moveToFreeAction(businessId: string) {
  const admin = await requireAdmin();
  const ok = await moveBusinessToFreePlan(admin.id, businessId);
  redirect(`/admin/businesses/${businessId}?notice=${ok ? "moved_to_free" : "not_found"}`);
}

export async function setUserStatusAction(userId: string, status: "active" | "suspended") {
  const admin = await requireAdmin();
  const result = await setUserStatus(admin.id, userId, status);
  const notice = result.ok ? (status === "suspended" ? "user_suspended" : "user_restored") : result.error;
  redirect(`/admin/users?notice=${notice}`);
}
