import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { activityLog, memberships, users, workingHours } from "@/db/schema";
import { forBusiness } from "@/db/scope";
import { createIndependentPractice, createSalon } from "@/modules/businesses/create";
import { createProfessionalProfile } from "@/modules/identity/profiles";
import {
  addClosure,
  addException,
  getBookingRules,
  getTravelBuffer,
  getWeeklyHours,
  listUpcomingClosures,
  listUpcomingExceptions,
  removeClosure,
  removeException,
  setTravelBuffer,
  setWeeklyHours,
  updateBookingRules,
} from "./hours";

function stamp() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function seedUser(label: string) {
  const [user] = await db
    .insert(users)
    .values({ displayName: label, email: `hours-${stamp()}@example.com` })
    .returning();
  return user!;
}

/** A salon with an owner (no profile) and one stylist, Hana, who has a profile. */
async function seedSalon() {
  const owner = await seedUser("Owner");
  const hana = await seedUser("Hana Account");
  const salon = await createSalon(owner.id, {
    name: "Hours Salon",
    slug: `hours-${stamp()}`,
    category: "hair",
  });
  if (!salon.ok) throw new Error(salon.error);
  await createProfessionalProfile(hana.id, { handle: `hana-${stamp()}`, displayName: "Hana" });
  const [membership] = await db
    .insert(memberships)
    .values({ businessId: salon.business.id, userId: hana.id, role: "stylist" })
    .returning();
  return {
    salon,
    scope: (await forBusiness(salon.business.id, owner.id))!,
    hanaScope: (await forBusiness(salon.business.id, hana.id))!,
    hana: membership!.id,
    ownerMembership: salon.membership.id,
  };
}

const NINE = 9 * 60;
const SIX = 18 * 60;
// Addis Ababa is UTC+3 all year.
const now = new Date("2026-11-16T06:00:00Z");

describe("weekly hours", () => {
  it("saves a week with a split shift and replaces it on the next save", async () => {
    const { scope, hana } = await seedSalon();

    const saved = await setWeeklyHours(scope, hana, [
      { weekday: 2, startMinute: 810, endMinute: SIX },
      { weekday: 1, startMinute: NINE, endMinute: SIX },
      { weekday: 2, startMinute: NINE, endMinute: 750 },
    ]);
    expect(saved).toEqual({ ok: true });
    expect(await getWeeklyHours(scope, hana)).toEqual([
      { weekday: 1, startMinute: NINE, endMinute: SIX },
      { weekday: 2, startMinute: NINE, endMinute: 750 },
      { weekday: 2, startMinute: 810, endMinute: SIX },
    ]);

    await setWeeklyHours(scope, hana, [{ weekday: 6, startMinute: 600, endMinute: 840 }]);
    expect(await getWeeklyHours(scope, hana)).toEqual([
      { weekday: 6, startMinute: 600, endMinute: 840 },
    ]);

    const logged = await db.select().from(activityLog).where(eq(activityLog.entityId, hana));
    expect(logged.map((entry) => entry.action)).toEqual([
      "working_hours.updated",
      "working_hours.updated",
    ]);
  });

  it("rejects overlapping shifts and impossible times", async () => {
    const { scope, hana } = await seedSalon();
    expect(
      await setWeeklyHours(scope, hana, [
        { weekday: 1, startMinute: NINE, endMinute: 780 },
        { weekday: 1, startMinute: 720, endMinute: SIX },
      ]),
    ).toEqual({ ok: false, error: "shifts_overlap" });

    for (const shift of [
      { weekday: 7, startMinute: NINE, endMinute: SIX },
      { weekday: 1, startMinute: SIX, endMinute: NINE },
      { weekday: 1, startMinute: NINE, endMinute: NINE },
      { weekday: 1, startMinute: NINE, endMinute: 1500 },
      { weekday: 1, startMinute: 541, endMinute: SIX },
    ]) {
      expect(await setWeeklyHours(scope, hana, [shift]), JSON.stringify(shift)).toEqual({
        ok: false,
        error: "invalid_input",
      });
    }
    expect(await getWeeklyHours(scope, hana)).toEqual([]);
  });

  it("is set by the owner, not by the stylist, and only for people who serve customers", async () => {
    const { scope, hanaScope, hana, ownerMembership } = await seedSalon();
    const week = [{ weekday: 1, startMinute: NINE, endMinute: SIX }];

    expect(await setWeeklyHours(hanaScope, hana, week)).toEqual({ ok: false, error: "forbidden" });
    // The owner has no professional profile here.
    expect(await setWeeklyHours(scope, ownerMembership, week)).toEqual({
      ok: false,
      error: "member_invalid",
    });
  });

  it("cannot set hours for someone in another business", async () => {
    const mine = await seedSalon();
    const theirs = await seedSalon();
    expect(
      await setWeeklyHours(mine.scope, theirs.hana, [
        { weekday: 1, startMinute: NINE, endMinute: SIX },
      ]),
    ).toEqual({ ok: false, error: "member_invalid" });
    expect(
      await db.select().from(workingHours).where(eq(workingHours.membershipId, theirs.hana)),
    ).toEqual([]);
  });
});

describe("time off and extra hours", () => {
  it("stores whole days on the business's clock", async () => {
    const { scope, hana } = await seedSalon();
    const added = await addException(scope, hana, {
      kind: "time_off",
      startDate: "2026-12-24",
      endDate: "2026-12-25",
      note: "Family",
    });
    if (!added.ok) throw new Error(added.error);
    // Midnight in Addis is 21:00 UTC the evening before.
    expect(added.exception.startsAt.toISOString()).toBe("2026-12-23T21:00:00.000Z");
    expect(added.exception.endsAt.toISOString()).toBe("2026-12-25T21:00:00.000Z");
    expect(added.exception.note).toBe("Family");
  });

  it("stores part of a day, lists what is still ahead and removes it", async () => {
    const { scope, hana } = await seedSalon();
    const past = await addException(scope, hana, {
      kind: "time_off",
      startDate: "2026-11-10",
      endDate: "2026-11-10",
    });
    const extra = await addException(scope, hana, {
      kind: "extra_hours",
      startDate: "2026-11-22",
      endDate: "2026-11-22",
      startMinute: 600,
      endMinute: 840,
    });
    if (!past.ok || !extra.ok) throw new Error("setup failed");
    expect(extra.exception.startsAt.toISOString()).toBe("2026-11-22T07:00:00.000Z");
    expect(extra.exception.endsAt.toISOString()).toBe("2026-11-22T11:00:00.000Z");

    expect((await listUpcomingExceptions(scope, hana, now)).map((row) => row.id)).toEqual([
      extra.exception.id,
    ]);

    expect(await removeException(scope, extra.exception.id)).toEqual({ ok: true });
    expect(await listUpcomingExceptions(scope, hana, now)).toEqual([]);
    expect(await removeException(scope, extra.exception.id)).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("rejects dates that do not make sense", async () => {
    const { scope, hana } = await seedSalon();
    for (const input of [
      { startDate: "2026-12-25", endDate: "2026-12-24" },
      { startDate: "2026-02-30", endDate: "2026-03-01" },
      { startDate: "tomorrow", endDate: "tomorrow" },
      { startDate: "2026-12-24", endDate: "2026-12-24", startMinute: 840, endMinute: 600 },
      { startDate: "2026-01-01", endDate: "2028-01-01" },
    ]) {
      expect(
        await addException(scope, hana, { kind: "time_off", ...input }),
        JSON.stringify(input),
      ).toEqual({ ok: false, error: "dates_invalid" });
    }
  });

  it("cannot be added or removed by a stylist, or from another business", async () => {
    const mine = await seedSalon();
    const theirs = await seedSalon();
    const day = { kind: "time_off" as const, startDate: "2026-12-24", endDate: "2026-12-24" };

    expect(await addException(mine.hanaScope, mine.hana, day)).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await addException(mine.scope, theirs.hana, day)).toEqual({
      ok: false,
      error: "member_invalid",
    });

    const added = await addException(theirs.scope, theirs.hana, day);
    if (!added.ok) throw new Error(added.error);
    expect(await removeException(mine.scope, added.exception.id)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await listUpcomingExceptions(theirs.scope, theirs.hana, now)).toHaveLength(1);
  });
});

describe("closed days", () => {
  it("adds, lists and removes a closure, only for this business", async () => {
    const mine = await seedSalon();
    const theirs = await seedSalon();

    const added = await addClosure(mine.scope, {
      startDate: "2027-01-07",
      endDate: "2027-01-07",
      reason: "Genna",
    });
    if (!added.ok) throw new Error(added.error);
    expect(added.closure.startsAt.toISOString()).toBe("2027-01-06T21:00:00.000Z");
    expect(added.closure.endsAt.toISOString()).toBe("2027-01-07T21:00:00.000Z");

    expect(await listUpcomingClosures(mine.scope, now)).toHaveLength(1);
    expect(await listUpcomingClosures(theirs.scope, now)).toEqual([]);

    expect(await removeClosure(theirs.scope, added.closure.id)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await addClosure(mine.hanaScope, { startDate: "2027-01-19", endDate: "2027-01-19" })).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await removeClosure(mine.scope, added.closure.id)).toEqual({ ok: true });
    expect(await listUpcomingClosures(mine.scope, now)).toEqual([]);
  });
});

describe("booking rules and travel time", () => {
  it("start at 2 hours' notice and 60 days ahead, and can be changed by the owner", async () => {
    const { scope, hanaScope } = await seedSalon();
    expect(await getBookingRules(scope)).toEqual({ minNoticeMinutes: 120, maxAdvanceDays: 60 });

    expect(await updateBookingRules(scope, { minNoticeMinutes: 1440, maxAdvanceDays: 30 })).toEqual({
      ok: true,
    });
    expect(await getBookingRules(scope)).toEqual({ minNoticeMinutes: 1440, maxAdvanceDays: 30 });

    expect(await updateBookingRules(scope, { minNoticeMinutes: -1, maxAdvanceDays: 30 })).toEqual({
      ok: false,
      error: "invalid_input",
    });
    expect(await updateBookingRules(scope, { minNoticeMinutes: 0, maxAdvanceDays: 0 })).toEqual({
      ok: false,
      error: "invalid_input",
    });
    expect(
      await updateBookingRules(hanaScope, { minNoticeMinutes: 0, maxAdvanceDays: 7 }),
    ).toEqual({ ok: false, error: "forbidden" });
  });

  it("lets an independent set her own travel time", async () => {
    const user = await seedUser("Meron");
    const practice = await createIndependentPractice(user.id, {
      handle: `meron-${stamp()}`,
      displayName: "Meron",
      category: "makeup",
    });
    if (!practice.ok) throw new Error(practice.error);
    const scope = (await forBusiness(practice.business.id, user.id))!;
    const me = practice.membership.id;

    expect(await getTravelBuffer(scope, me)).toBe(0);
    expect(await setTravelBuffer(scope, me, 45)).toEqual({ ok: true });
    expect(await getTravelBuffer(scope, me)).toBe(45);
    expect(await setTravelBuffer(scope, me, 47)).toEqual({ ok: false, error: "invalid_input" });

    // She sets her own week too: in a solo practice she is the owner.
    expect(
      await setWeeklyHours(scope, me, [{ weekday: 6, startMinute: NINE, endMinute: SIX }]),
    ).toEqual({ ok: true });
  });
});
