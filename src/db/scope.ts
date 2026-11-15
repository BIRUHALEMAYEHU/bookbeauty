import "server-only";
import { and, asc, eq, inArray, type InferInsertModel, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable, PgUpdateSetSource } from "drizzle-orm/pg-core";
import { db, type DbExecutor } from "@/db/client";
import {
  businesses,
  memberships,
  professionalProfiles,
  users,
  type Business,
} from "@/db/schema";
import { logActivity, type LogActivityInput } from "@/modules/audit/log";
import { resolveActor } from "@/modules/identity/actor";
import {
  assertCan,
  can,
  type Action,
  type Actor,
  type Resource,
} from "@/modules/identity/permissions";

/** A table whose rows belong to one business (it has a business_id column). */
export type TenantTable = PgTable & { businessId: PgColumn };

/** Someone working in the business, as staff screens list her. */
export type ScopedMember = {
  membershipId: string;
  userId: string;
  role: (typeof memberships.role.enumValues)[number];
  /** Her professional name when she has a profile, otherwise her account name. */
  displayName: string;
  /** Only people with a professional profile serve customers (data-model Section 2). */
  hasProfile: boolean;
};

type InsertValues<T extends TenantTable> = Omit<InferInsertModel<T>, "businessId">;

/**
 * Query helpers that always filter by, or stamp, the scope's business_id.
 * Feature code reads and writes business data only through these
 * (technical-plan Section 3): a lint rule stops feature modules importing the
 * database connection, so there is no other way in. If a feature needs a
 * query these cannot express (a join, a count), add a scoped helper here.
 */
export type ScopedQueries = ReturnType<typeof scopedQueries>;

function scopedQueries(executor: DbExecutor, businessId: string, actorUserId: string) {
  const own = (table: TenantTable, where?: SQL) => {
    const scoped = eq(table.businessId, businessId);
    return where ? and(scoped, where)! : scoped;
  };

  return {
    /** Records a change in this business's activity log (D60), as the person acting. */
    log(entry: Omit<LogActivityInput, "businessId" | "actorUserId">) {
      return logActivity({ ...entry, businessId, actorUserId }, executor);
    },

    /** This business's own row (settings, page content). */
    async business(): Promise<Business> {
      const [row] = await executor
        .select()
        .from(businesses)
        .where(eq(businesses.id, businessId))
        .limit(1);
      if (!row) throw new Error("Business in scope no longer exists");
      return row;
    },

    /** Changes this business's row. Its id and owner cannot be changed here. */
    async updateBusiness(set: PgUpdateSetSource<typeof businesses>): Promise<Business> {
      const { id: _id, ownerUserId: _owner, ...safe } = set as Record<string, unknown>;
      void _id;
      void _owner;
      const [row] = await executor
        .update(businesses)
        .set({ ...(safe as PgUpdateSetSource<typeof businesses>), updatedAt: new Date() })
        .where(eq(businesses.id, businessId))
        .returning();
      if (!row) throw new Error("Business in scope no longer exists");
      return row;
    },

    /** People working in this business now (active, or working out notice), in joining order. */
    async members(): Promise<ScopedMember[]> {
      const rows = await executor
        .select({
          membershipId: memberships.id,
          userId: memberships.userId,
          role: memberships.role,
          accountName: users.displayName,
          professionalName: professionalProfiles.displayName,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .leftJoin(professionalProfiles, eq(professionalProfiles.userId, memberships.userId))
        .where(
          and(
            eq(memberships.businessId, businessId),
            inArray(memberships.status, ["active", "notice"]),
          ),
        )
        .orderBy(asc(memberships.startedAt), asc(memberships.id));
      return rows.map((row) => ({
        membershipId: row.membershipId,
        userId: row.userId,
        role: row.role,
        displayName: row.professionalName ?? row.accountName,
        hasProfile: row.professionalName !== null,
      }));
    },

    /** Rows of this business only, optionally narrowed further. */
    select<T extends TenantTable>(table: T, where?: SQL) {
      return executor.select().from(table as PgTable).where(own(table, where)) as unknown as Promise<
        T["$inferSelect"][]
      >;
    },

    /** Inserts rows for this business. Any businessId the caller passes is overwritten. */
    insert<T extends TenantTable>(table: T, values: InsertValues<T> | InsertValues<T>[]) {
      const rows = (Array.isArray(values) ? values : [values]).map((row) => ({
        ...row,
        businessId,
      }));
      return executor
        .insert(table)
        .values(rows as InferInsertModel<T>[])
        .returning() as unknown as Promise<T["$inferSelect"][]>;
    },

    /** Updates only this business's rows; businessId itself can never be changed. */
    update<T extends TenantTable>(table: T, set: PgUpdateSetSource<T>, where?: SQL) {
      const { businessId: _ignored, ...safe } = set as Record<string, unknown>;
      void _ignored;
      return executor
        .update(table)
        .set(safe as PgUpdateSetSource<T>)
        .where(own(table, where))
        .returning() as unknown as Promise<T["$inferSelect"][]>;
    },

    /** Deletes only this business's rows. */
    delete<T extends TenantTable>(table: T, where?: SQL) {
      return executor
        .delete(table)
        .where(own(table, where))
        .returning() as unknown as Promise<T["$inferSelect"][]>;
    },
  };
}

export type BusinessScope = ScopedQueries & {
  businessId: string;
  actor: Actor;
  can: (action: Action, resource?: Resource) => boolean;
  require: (action: Action, resource?: Resource) => void;
  /** Runs several scoped writes in one transaction. */
  transaction: <R>(fn: (scoped: ScopedQueries) => Promise<R>) => Promise<R>;
};

/**
 * Entry point for all business-owned data access (technical-plan Section 3).
 * Returns null when the user has no active or notice membership in the business.
 */
export async function forBusiness(
  businessId: string,
  userId: string,
): Promise<BusinessScope | null> {
  const actor = await resolveActor(businessId, userId);
  if (!actor) return null;

  return {
    ...scopedQueries(db, businessId, userId),
    businessId,
    actor,
    can: (action, resource) => can(actor, action, resource),
    require: (action, resource) => assertCan(actor, action, resource),
    transaction: (fn) => db.transaction((tx) => fn(scopedQueries(tx, businessId, userId))),
  };
}
