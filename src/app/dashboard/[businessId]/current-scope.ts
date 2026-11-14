import "server-only";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { z } from "zod";
import { forBusiness } from "@/db/scope";
import { getSessionUser } from "@/modules/identity/session";

const businessIdSchema = z.uuid();

/**
 * The signed-in person acting in the business named in the address. Shared by
 * the dashboard layout and pages within one request. Someone with no active
 * membership there gets a plain "not found", so the page does not reveal
 * that the business exists.
 */
export const currentScope = cache(async (businessId: string) => {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  if (!businessIdSchema.safeParse(businessId).success) notFound();
  const scope = await forBusiness(businessId, user.id);
  if (!scope) notFound();

  return { user, scope };
});
