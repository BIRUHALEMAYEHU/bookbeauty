import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { POST as webhook } from "@/app/api/telegram/webhook/route";
import { db } from "@/db/client";
import { authIdentities, memberships, messages, telegramChats, users } from "@/db/schema";
import { forBusiness } from "@/db/scope";
import { env } from "@/env";
import { capturedEmails } from "@/integrations/email";
import { capturedTelegramMessages } from "@/integrations/telegram";
import { zonedTimeToUtc } from "@/lib/time";
import { setWeeklyHours } from "@/modules/availability/hours";
import { holdSlot, loadBookingContext, submitBooking, type BookingContext } from "@/modules/booking/engine";
import { createSalon } from "@/modules/businesses/create";
import { createService } from "@/modules/catalog/services";
import { createProfessionalProfile } from "@/modules/identity/profiles";
import { deliverDueMessages } from "./deliver";
import { createTelegramLink, handleTelegramUpdate, telegramLinkedForBooking } from "./telegram";

// Lets a test make Telegram answer "blocked" for one chat.
const bot = vi.hoisted(() => ({ blockedChat: "" }));
vi.mock("@/integrations/telegram", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/integrations/telegram")>();
  return {
    ...real,
    sendTelegramMessage: async (chatId: string, text: string) =>
      chatId === bot.blockedChat
        ? { ok: false as const, blocked: true, error: "Telegram 403: Forbidden: bot was blocked by the user" }
        : real.sendTelegramMessage(chatId, text),
  };
});

const TZ = "Africa/Addis_Ababa";
// "Now" is Monday 16 November 2026, 9:00 AM; visits are Wednesday; reminders are due Tuesday.
const now = zonedTimeToUtc("2026-11-16", 540, TZ);
const dayBefore = zonedTimeToUtc("2026-11-17", 600, TZ);

beforeAll(() => {
  env.TELEGRAM_BOT_USERNAME = "book_test_bot";
  env.TELEGRAM_BOT_TOKEN = "";
  env.TELEGRAM_WEBHOOK_SECRET = "test-webhook-secret-123";
});

function stamp() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
const uniquePhone = () => `09${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const uniqueChat = () => String(Math.floor(1_000_000_000 + Math.random() * 8_999_999_999));

async function seedSalon() {
  const [owner] = await db
    .insert(users)
    .values({ displayName: "Owner", email: `owner-${stamp()}@example.com`, emailVerifiedAt: now })
    .returning();
  const salon = await createSalon(owner!.id, { name: "Selam Hair", slug: `tg-${stamp()}`, category: "hair" });
  if (!salon.ok) throw new Error(salon.error);
  const scope = (await forBusiness(salon.business.id, owner!.id))!;
  // Hana logs in with Telegram only: no email.
  const [hana] = await db.insert(users).values({ displayName: "Hana" }).returning();
  const hanaChat = uniqueChat();
  await db.insert(authIdentities).values({ userId: hana!.id, provider: "telegram", providerUserId: hanaChat });
  await createProfessionalProfile(hana!.id, { handle: `hana-${stamp()}`, displayName: "Hana" });
  const [membership] = await db
    .insert(memberships)
    .values({ businessId: salon.business.id, userId: hana!.id, role: "stylist" })
    .returning();
  await setWeeklyHours(scope, membership!.id, [{ weekday: 3, startMinute: 540, endMinute: 1080 }]);
  const service = await createService(scope, {
    name: "Braids",
    durationMinutes: 60,
    bufferMinutes: 0,
    locationType: "studio",
    priceStudio: 50_000,
    priceClientPlace: null,
    providerMembershipIds: [membership!.id],
  });
  if (!service.ok) throw new Error(service.error);
  return {
    owner: owner!,
    hanaChat,
    membershipId: membership!.id,
    context: (await loadBookingContext(salon.business.id, service.service.id))!,
  };
}

async function book(context: BookingContext, membershipId: string, guest: { phone: string; email?: string }, minutes = 600) {
  const held = await holdSlot(context, {
    startsAt: zonedTimeToUtc("2026-11-18", minutes, TZ),
    membershipId,
    atClientPlace: false,
    source: "business_page",
    now,
  });
  if (!held.ok) throw new Error(held.error);
  const done = await submitBooking(held.token, { name: "Tigist", ...guest }, now);
  if (!done.ok) throw new Error(done.error);
  return { token: held.token, id: held.bookingId };
}

/** She taps the button, then Start in the bot. Returns what the bot replied. */
async function linkTelegram(token: string, chatId: string) {
  const url = await createTelegramLink(token, now);
  expect(url).toMatch(/^https:\/\/t\.me\/book_test_bot\?start=[0-9a-f]{64}$/);
  const code = url!.split("start=")[1]!;
  await handleTelegramUpdate(
    { message: { chat: { id: Number(chatId), type: "private" }, from: { id: Number(chatId) }, text: `/start ${code}` } },
    now,
  );
  return { code, reply: capturedTelegramMessages().filter((m) => m.chatId === chatId).at(-1)?.text };
}

const rowsFor = async (bookingId: string) =>
  (await db.select().from(messages).where(eq(messages.bookingId, bookingId)))
    .map((row) => `${row.kind}:${row.channel}:${row.status}`)
    .sort();

describe("Get reminders on Telegram (D89, D90)", () => {
  it("links her chat, moves her reminder to Telegram, and sends it there", async () => {
    const { context, membershipId } = await seedSalon();
    const email = `tigist-${stamp()}@example.com`;
    const booking = await book(context, membershipId, { phone: uniquePhone(), email });
    const chat = uniqueChat();
    expect(await telegramLinkedForBooking(booking.id)).toBe(false);

    const { reply } = await linkTelegram(booking.token, chat);
    expect(reply).toContain("Selam Hair");
    expect(await telegramLinkedForBooking(booking.id)).toBe(true);
    expect(await rowsFor(booking.id)).toContain("booking_reminder:email:cancelled");
    expect(await rowsFor(booking.id)).toContain("booking_reminder:telegram:queued");

    await deliverDueMessages(dayBefore, { businessId: context.business.id });
    const sent = capturedTelegramMessages().filter((m) => m.chatId === chat);
    expect(sent.at(-1)?.text).toContain("A reminder of your booking at Selam Hair");
    expect(sent.at(-1)?.text).toContain("Wed, 18 Nov 2026, 10:00 AM");
    expect(capturedEmails().filter((m) => m.to === email && m.subject.startsWith("Reminder"))).toEqual([]);
  });

  it("gives a reminder to a customer who left no email, once she links Telegram", async () => {
    const { context, membershipId } = await seedSalon();
    const booking = await book(context, membershipId, { phone: uniquePhone() });
    expect((await rowsFor(booking.id)).filter((row) => !row.startsWith("new_booking"))).toEqual([]);

    await linkTelegram(booking.token, uniqueChat());
    expect(await rowsFor(booking.id)).toContain("booking_reminder:telegram:queued");
  });

  it("sends her next booking at that business straight to Telegram, link included", async () => {
    const { context, membershipId } = await seedSalon();
    const phone = uniquePhone();
    const first = await book(context, membershipId, { phone, email: `t-${stamp()}@example.com` });
    const chat = uniqueChat();
    await linkTelegram(first.token, chat);

    const second = await book(context, membershipId, { phone, email: `t-${stamp()}@example.com` }, 720);
    expect(await rowsFor(second.id)).toContain("booking_confirmation:telegram:queued");
    await deliverDueMessages(now, { businessId: context.business.id });
    expect(capturedTelegramMessages().filter((m) => m.chatId === chat).at(-1)?.text).toContain(
      `/booking/${second.token}`,
    );
    // Her page for the second booking does not claim a link she did not make there (D91).
    expect(await telegramLinkedForBooking(second.id)).toBe(false);
  });

  it("refuses a used, made-up or expired code", async () => {
    const { context, membershipId } = await seedSalon();
    const booking = await book(context, membershipId, { phone: uniquePhone() });
    const chat = uniqueChat();
    const { code } = await linkTelegram(booking.token, chat);

    for (const text of [`/start ${code}`, `/start ${"a".repeat(64)}`, "/start nonsense"]) {
      await handleTelegramUpdate({ message: { chat: { id: Number(chat), type: "private" }, text } }, now);
      expect(capturedTelegramMessages().filter((m) => m.chatId === chat).at(-1)?.text).toContain("expired");
    }
    const late = await createTelegramLink(booking.token, now);
    const lateCode = late!.split("start=")[1]!;
    await handleTelegramUpdate(
      { message: { chat: { id: Number(chat), type: "private" }, text: `/start ${lateCode}` } },
      new Date(now.getTime() + 25 * 60 * 60_000),
    );
    expect(capturedTelegramMessages().filter((m) => m.chatId === chat).at(-1)?.text).toContain("expired");
    expect(await createTelegramLink("f".repeat(64), now)).toBeNull();
  });

  it("falls back to email when she blocks the bot", async () => {
    const { context, membershipId } = await seedSalon();
    const phone = uniquePhone();
    const email = `t-${stamp()}@example.com`;
    const first = await book(context, membershipId, { phone, email });
    const chat = uniqueChat();
    await linkTelegram(first.token, chat);

    bot.blockedChat = chat;
    try {
      await deliverDueMessages(dayBefore, { businessId: context.business.id });
    } finally {
      bot.blockedChat = "";
    }
    expect(await rowsFor(first.id)).toContain("booking_reminder:telegram:failed");
    // The email copy goes out in the same run.
    expect(await rowsFor(first.id)).toContain("booking_reminder:email:sent");
    expect(
      capturedEmails().filter((m) => m.to === email && m.subject.startsWith("Reminder")),
    ).toHaveLength(1);
    const [stored] = await db.select().from(telegramChats).where(eq(telegramChats.chatId, chat));
    expect(stored?.blockedAt).not.toBeNull();

    // Her next booking goes by email again.
    const second = await book(context, membershipId, { phone, email }, 720);
    expect(await rowsFor(second.id)).toContain("booking_confirmation:email:queued");
  });

  it("tells a professional who logs in with Telegram on Telegram", async () => {
    const { context, membershipId, hanaChat, owner } = await seedSalon();
    const booking = await book(context, membershipId, { phone: uniquePhone() });
    const rows = await db.select().from(messages).where(eq(messages.bookingId, booking.id));
    expect(rows.map((row) => `${row.kind}:${row.channel}:${row.recipient}`).sort()).toEqual(
      [`new_booking_notice:email:${owner.email}`, `new_booking_notice:telegram:${hanaChat}`].sort(),
    );
  });
});

describe("the webhook", () => {
  const request = (secret: string | null, body: object) =>
    new Request("http://localhost/api/telegram/webhook", {
      method: "POST",
      headers: secret ? { "x-telegram-bot-api-secret-token": secret } : {},
      body: JSON.stringify(body),
    });

  it("only accepts updates that carry the secret", async () => {
    const hello = { message: { chat: { id: 42, type: "private" }, text: "/start" } };
    expect((await webhook(request(null, hello))).status).toBe(401);
    expect((await webhook(request("wrong-secret-value-123", hello))).status).toBe(401);
    expect((await webhook(request("test-webhook-secret-123", hello))).status).toBe(200);
    expect(capturedTelegramMessages().filter((m) => m.chatId === "42").at(-1)?.text).toContain("booking reminders");
  });
});
