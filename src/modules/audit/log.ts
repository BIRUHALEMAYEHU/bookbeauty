import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { activityLog, type ActivityLogEntry } from "@/db/schema";

export type LogActivityInput = {
  businessId?: string | null;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ipAddress?: string | null;
};

/** Append one activity log row. This is the only write path (D60). */
export async function logActivity(
  input: LogActivityInput,
): Promise<ActivityLogEntry> {
  const [row] = await db
    .insert(activityLog)
    .values({
      businessId: input.businessId ?? null,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      before: input.before ?? null,
      after: input.after ?? null,
      ipAddress: input.ipAddress ?? null,
    })
    .returning();

  if (!row) throw new Error("Failed to write activity log entry");
  return row;
}

/** Newest-first entries for a business. Caller must already have checked permission. */
export async function listActivityForBusiness(
  businessId: string,
  options: { limit?: number } = {},
): Promise<ActivityLogEntry[]> {
  const limit = Math.min(options.limit ?? 50, 200);
  return db
    .select()
    .from(activityLog)
    .where(eq(activityLog.businessId, businessId))
    .orderBy(desc(activityLog.createdAt))
    .limit(limit);
}

export async function listActivityForEntity(
  businessId: string,
  entityType: string,
  entityId: string,
): Promise<ActivityLogEntry[]> {
  return db
    .select()
    .from(activityLog)
    .where(
      and(
        eq(activityLog.businessId, businessId),
        eq(activityLog.entityType, entityType),
        eq(activityLog.entityId, entityId),
      ),
    )
    .orderBy(desc(activityLog.createdAt));
}
