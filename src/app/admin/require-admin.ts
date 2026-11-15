import "server-only";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { getSessionUser } from "@/modules/identity/session";
import { isPlatformAdmin } from "@/modules/platform/admins";

/**
 * The signed-in platform administrator. Anyone else gets "not found", so the
 * admin area does not reveal that it exists.
 */
export const requireAdmin = cache(async () => {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!(await isPlatformAdmin(user.id))) notFound();
  return user;
});
