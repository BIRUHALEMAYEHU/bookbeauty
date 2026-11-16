import "server-only";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import {
  bookings,
  businesses,
  telegramChats,
  telegramLinkCodes,
  telegramLinks,
} from "@/db/schema";
import { generateToken, hashToken } from "@/lib/tokens";
import { createTranslator } from "next-intl";
import { appUrl, env, telegramMessagesEnabled } from "@/env";
import { sendTelegramMessage, setTelegramWebhook } from "@/integrations/telegram";
import en from "@/messages/en.json";
import { requeueRemindersForRecord } from "./queue";

/**
 * Telegram for customers (D89): a bot can only message someone who started a
 * chat with it, so her booking page offers a button that opens the bot with a
 * one-time code. When she taps Start, the bot links her chat to her customer
 * record, and her messages from that business come by Telegram (D90).
 */

/** How long the code in the bot link works. */
const CODE_TTL_MS = 24 * 60 * 60_000;
/** Bookings worth linking: those still to come. */
const LINKABLE = ["pending_approval", "confirmed", "arrived"] as const;

const replies = () => {
  // The bot's replies live with the other message wording (F06, D103).
  const t = createTranslator({ locale: "en", messages: en, namespace: "notifications" });
  return {
    linked: (business: string) => t("telegram.linked", { business }),
    expired: t("telegram.expired"),
    hello: t("telegram.hello"),
  };
};

/**
 * Makes the bot link for her booking, from the secret in her booking link.
 * Null when the booking cannot be linked (not found, or already over).
 */
export async function createTelegramLink(bookingToken: string, now = new Date()): Promise<string | null> {
  if (!env.TELEGRAM_BOT_USERNAME || !/^[0-9a-f]{64}$/.test(bookingToken)) return null;
  const [booking] = await db
    .select({ id: bookings.id, businessId: bookings.businessId, customerRecordId: bookings.customerRecordId })
    .from(bookings)
    .where(and(eq(bookings.manageTokenHash, hashToken(bookingToken)), inArray(bookings.status, LINKABLE)))
    .limit(1);
  if (!booking?.customerRecordId) return null;

  // Telegram allows 64 characters in the start code; a token is 64 hex digits.
  const code = generateToken();
  await db.insert(telegramLinkCodes).values({
    businessId: booking.businessId,
    bookingId: booking.id,
    codeHash: hashToken(code),
    expiresAt: new Date(now.getTime() + CODE_TTL_MS),
  });
  return `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=${code}`;
}

/** Whether she linked Telegram from this booking's page. Says nothing about her record (D91). */
export async function telegramLinkedForBooking(bookingId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: telegramLinks.id })
    .from(telegramLinks)
    .innerJoin(telegramChats, eq(telegramChats.id, telegramLinks.telegramChatId))
    .where(
      and(
        eq(telegramLinks.bookingId, bookingId),
        isNull(telegramLinks.unlinkedAt),
        isNull(telegramChats.blockedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Tells Telegram where to send the bot's updates. Run when the server starts. */
export async function registerTelegramWebhook() {
  if (!telegramMessagesEnabled()) return;
  // A local run of the built app is "production" too; never point the real bot at a developer's machine.
  if (!appUrl().startsWith("https://")) return;
  await setTelegramWebhook(appUrl("/api/telegram/webhook"), env.TELEGRAM_WEBHOOK_SECRET!);
  console.info("[telegram] webhook set");
}

/** Records that she blocked the bot, so nothing more is sent there. */
export async function markChatBlocked(chatId: string, now = new Date()) {
  await db
    .insert(telegramChats)
    .values({ chatId, blockedAt: now })
    .onConflictDoUpdate({ target: telegramChats.chatId, set: { blockedAt: now } });
}

/** The parts of a Telegram update we use. */
export type TelegramUpdate = {
  message?: {
    chat?: { id?: number | string; type?: string };
    from?: { id?: number | string };
    text?: string;
  };
  my_chat_member?: {
    chat?: { id?: number | string; type?: string };
    new_chat_member?: { status?: string };
  };
};

async function rememberChat(chatId: string, telegramUserId: string | null, now: Date) {
  const [chat] = await db
    .insert(telegramChats)
    .values({ chatId, telegramUserId, startedAt: now })
    .onConflictDoUpdate({ target: telegramChats.chatId, set: { blockedAt: null, telegramUserId } })
    .returning();
  return chat!;
}

/** Uses a start code: links her chat to the booking's customer record. Returns the business name. */
async function redeemCode(code: string, chatRowId: string, now: Date): Promise<string | null> {
  if (!/^[0-9a-f]{64}$/.test(code)) return null;
  return db.transaction(async (tx) => {
    const [found] = await tx
      .update(telegramLinkCodes)
      .set({ usedAt: now })
      .where(
        and(
          eq(telegramLinkCodes.codeHash, hashToken(code)),
          isNull(telegramLinkCodes.usedAt),
          gt(telegramLinkCodes.expiresAt, now),
        ),
      )
      .returning();
    if (!found) return null;
    const [booking] = await tx
      .select({ customerRecordId: bookings.customerRecordId, businessName: businesses.name })
      .from(bookings)
      .innerJoin(businesses, eq(businesses.id, bookings.businessId))
      .where(eq(bookings.id, found.bookingId));
    if (!booking?.customerRecordId) return null;

    // One active link per chat and record: replace any older one.
    await tx
      .update(telegramLinks)
      .set({ unlinkedAt: now })
      .where(
        and(
          eq(telegramLinks.telegramChatId, chatRowId),
          eq(telegramLinks.customerRecordId, booking.customerRecordId),
          isNull(telegramLinks.unlinkedAt),
        ),
      );
    await tx.insert(telegramLinks).values({
      businessId: found.businessId,
      telegramChatId: chatRowId,
      customerRecordId: booking.customerRecordId,
      bookingId: found.bookingId,
      linkedAt: now,
    });
    // Reminders already waiting now go to Telegram, and one is added if she gave no email.
    await requeueRemindersForRecord(booking.customerRecordId, now, tx);
    return booking.businessName;
  });
}

/** Handles one update from Telegram: a Start with a code, or the bot being blocked or unblocked. */
export async function handleTelegramUpdate(update: TelegramUpdate, now = new Date()) {
  const member = update.my_chat_member;
  if (member?.chat?.type === "private" && member.chat.id !== undefined) {
    const chatId = String(member.chat.id);
    const status = member.new_chat_member?.status;
    if (status === "kicked") await markChatBlocked(chatId, now);
    if (status === "member") {
      await db.update(telegramChats).set({ blockedAt: null }).where(eq(telegramChats.chatId, chatId));
    }
    return;
  }

  const message = update.message;
  if (message?.chat?.type !== "private" || message.chat.id === undefined) return;
  const text = message.text?.trim() ?? "";
  if (!text.startsWith("/start")) return;

  const chatId = String(message.chat.id);
  const chat = await rememberChat(chatId, message.from?.id === undefined ? null : String(message.from.id), now);
  const code = text.slice("/start".length).trim();
  const say = replies();

  if (!code) {
    await sendTelegramMessage(chatId, say.hello);
    return;
  }
  const business = await redeemCode(code, chat.id, now);
  await sendTelegramMessage(chatId, business ? say.linked(business) : say.expired);
}
