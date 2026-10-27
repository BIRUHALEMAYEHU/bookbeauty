import "server-only";
import { and, eq, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { resolveActor } from "@/modules/identity/actor";
import {
  assertCan,
  can,
  type Action,
  type Actor,
  type Resource,
} from "@/modules/identity/permissions";

export type BusinessScope = {
  businessId: string;
  actor: Actor;
  can: (action: Action, resource?: Resource) => boolean;
  require: (action: Action, resource?: Resource) => void;
  /**
   * Builds a WHERE fragment that always includes business_id. Callers pass
   * their table's businessId column so every business query is scoped.
   */
  whereBusiness: (businessIdColumn: PgColumn, extra?: SQL) => SQL;
};

/**
 * Entry point for all business-owned data access (technical-plan Section 3).
 * Returns null when the user has no active/notice membership in the business.
 */
export async function forBusiness(
  businessId: string,
  userId: string,
): Promise<BusinessScope | null> {
  const actor = await resolveActor(businessId, userId);
  if (!actor) return null;

  return {
    businessId,
    actor,
    can: (action, resource) => can(actor, action, resource),
    require: (action, resource) => assertCan(actor, action, resource),
    whereBusiness: (businessIdColumn, extra) => {
      const scoped = eq(businessIdColumn, businessId);
      return extra ? and(scoped, extra)! : scoped;
    },
  };
}
