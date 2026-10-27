import { describe, expect, it } from "vitest";
import {
  ACTIONS,
  MEMBERSHIP_ROLES,
  ROLE_PERMISSIONS,
  can,
  grantFor,
  type Actor,
} from "./permissions";

function actor(
  overrides: Partial<Actor> & Pick<Actor, "role">,
): Actor {
  return {
    userId: "user-1",
    businessId: "biz-1",
    membershipId: "mem-1",
    locationIds: ["loc-a", "loc-b"],
    status: "active",
    ...overrides,
  };
}

describe("ROLE_PERMISSIONS", () => {
  it("defines every action for every role", () => {
    for (const role of MEMBERSHIP_ROLES) {
      for (const action of ACTIONS) {
        expect(ROLE_PERMISSIONS[role][action]).toBeDefined();
      }
    }
  });

  it("gives the owner every action across the business", () => {
    for (const action of ACTIONS) {
      expect(grantFor("owner", action)).toBe("all");
    }
  });

  it("keeps settings and the activity log to the owner", () => {
    expect(grantFor("branch_manager", "settings.manage")).toBe(false);
    expect(grantFor("branch_manager", "activity_log.view")).toBe(false);
    expect(grantFor("receptionist", "revenue.view")).toBe(false);
    expect(grantFor("stylist", "bookings.assign")).toBe(false);
  });
});

describe("can", () => {
  it("allows the owner anywhere", () => {
    const owner = actor({ role: "owner", locationIds: [] });
    expect(can(owner, "settings.manage")).toBe(true);
    expect(can(owner, "bookings.view", { locationId: "anywhere" })).toBe(true);
  });

  it("limits branch managers to their locations", () => {
    const manager = actor({ role: "branch_manager" });
    expect(can(manager, "bookings.view", { locationId: "loc-a" })).toBe(true);
    expect(can(manager, "bookings.view", { locationId: "loc-z" })).toBe(false);
    expect(can(manager, "settings.manage")).toBe(false);
  });

  it("denies branch scope when no locations are assigned", () => {
    const manager = actor({ role: "branch_manager", locationIds: [] });
    expect(can(manager, "bookings.view")).toBe(false);
  });

  it("limits stylists to their own records", () => {
    const stylist = actor({ role: "stylist", userId: "hana" });
    expect(can(stylist, "bookings.view", { professionalUserId: "hana" })).toBe(
      true,
    );
    expect(can(stylist, "bookings.view", { professionalUserId: "other" })).toBe(
      false,
    );
    expect(can(stylist, "bookings.assign")).toBe(false);
  });

  it("allows acting during notice, but not when ended or only invited", () => {
    expect(
      can(actor({ role: "owner", status: "notice" }), "bookings.view"),
    ).toBe(true);
    expect(
      can(
        { ...actor({ role: "owner" }), status: "ended" as Actor["status"] },
        "bookings.view",
      ),
    ).toBe(false);
  });

  it("blocks receptionists from revenue", () => {
    expect(can(actor({ role: "receptionist" }), "revenue.view")).toBe(false);
    expect(can(actor({ role: "receptionist" }), "bookings.create")).toBe(true);
  });
});
