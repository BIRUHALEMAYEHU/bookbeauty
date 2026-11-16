import "server-only";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db, type DbExecutor } from "@/db/client";
import { authIdentities, telegramChats, telegramLinks, users } from "@/db/schema";

/**
 * Where a message goes. Telegram first when the person can be reached there,
 * then email (D90). SMS joins with F27.
 */

export type Target = { channel: "telegram" | "email"; recipient: string };

/** The chat a customer's messages from this business go to, if she linked one and has not blocked the bot. */
export async function customerTelegramChat(
  customerRecordId: string,
  executor: DbExecutor = db,
): Promise<string | null> {
  const [row] = await executor
    .select({ chatId: telegramChats.chatId })
    .from(telegramLinks)
    .innerJoin(telegramChats, eq(telegramChats.id, telegramLinks.telegramChatId))
    .where(
      and(
        eq(telegramLinks.customerRecordId, customerRecordId),
        isNull(telegramLinks.unlinkedAt),
        isNull(telegramChats.blockedAt),
      ),
    )
    .orderBy(desc(telegramLinks.linkedAt))
    .limit(1);
  return row?.chatId ?? null;
}

/** A customer's channel: her linked Telegram chat, else the email she gave with this booking. */
export async function customerTarget(
  booking: { customerRecordId: string | null; customerEmail: string | null },
  executor: DbExecutor = db,
): Promise<Target | null> {
  const chat = booking.customerRecordId
    ? await customerTelegramChat(booking.customerRecordId, executor)
    : null;
  if (chat) return { channel: "telegram", recipient: chat };
  if (booking.customerEmail) return { channel: "email", recipient: booking.customerEmail };
  return null;
}

/**
 * Where each staff member hears about bookings. Professionals who log in with
 * Telegram gave the bot permission to message them when they logged in, and
 * for a private chat the chat id is the Telegram user id; the others get
 * email, if it is verified (names and phone numbers never go to an address
 * nobody confirmed).
 */
export async function staffTargets(
  userIds: (string | null)[],
  executor: DbExecutor = db,
): Promise<{ userId: string; target: Target }[]> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return [];

  const [identities, people] = await Promise.all([
    executor
      .select({ userId: authIdentities.userId, telegramId: authIdentities.providerUserId })
      .from(authIdentities)
      .where(and(inArray(authIdentities.userId, ids), eq(authIdentities.provider, "telegram"))),
    executor
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(inArray(users.id, ids), isNotNull(users.email), isNotNull(users.emailVerifiedAt))),
  ]);
  const blocked = identities.length
    ? new Set(
        (
          await executor
            .select({ chatId: telegramChats.chatId })
            .from(telegramChats)
            .where(
              and(
                inArray(
                  telegramChats.chatId,
                  identities.map((row) => row.telegramId),
                ),
                isNotNull(telegramChats.blockedAt),
              ),
            )
        ).map((row) => row.chatId),
      )
    : new Set<string>();
  const telegram = new Map(
    identities.filter((row) => !blocked.has(row.telegramId)).map((row) => [row.userId, row.telegramId]),
  );
  const email = new Map(people.map((person) => [person.id, person.email!]));

  return ids.flatMap((userId): { userId: string; target: Target }[] => {
    const chat = telegram.get(userId);
    if (chat) return [{ userId, target: { channel: "telegram", recipient: chat } }];
    const address = email.get(userId);
    return address ? [{ userId, target: { channel: "email", recipient: address } }] : [];
  });
}
