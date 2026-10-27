import { describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import {
  grantPlatformAdmin,
  isPlatformAdmin,
  revokePlatformAdmin,
} from "./admins";

async function seedUser(label: string) {
  const [user] = await db
    .insert(users)
    .values({
      displayName: label,
      email: `admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    })
    .returning();
  return user!;
}

describe("platform admins", () => {
  it("grants, checks and revokes admin access", async () => {
    const granter = await seedUser("Granter");
    const target = await seedUser("Target Admin");

    expect(await isPlatformAdmin(target.id)).toBe(false);

    const granted = await grantPlatformAdmin(target.id, granter.id);
    expect(granted).toEqual({ ok: true });
    expect(await isPlatformAdmin(target.id)).toBe(true);

    const again = await grantPlatformAdmin(target.id, granter.id);
    expect(again).toEqual({ ok: false, error: "already_admin" });

    expect(await revokePlatformAdmin(target.id, granter.id)).toBe(true);
    expect(await isPlatformAdmin(target.id)).toBe(false);
  });
});
