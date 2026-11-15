import "server-only";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { serviceProviders, services, type Service } from "@/db/schema";
import type { BusinessScope, ScopedMember } from "@/db/scope";

/** Services (F13): what can be booked, what it costs, how long it takes, who does it. */

/** 1,000,000 ETB in santim: far above any real price, low enough to catch a slip of the thumb. */
export const MAX_PRICE = 100_000_000;
export const MAX_DURATION_MINUTES = 12 * 60;
export const MAX_BUFFER_MINUTES = 4 * 60;

const price = z.number().int().min(0).max(MAX_PRICE).nullable();

export const serviceSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
  durationMinutes: z.number().int().min(5).max(MAX_DURATION_MINUTES).multipleOf(5),
  bufferMinutes: z.number().int().min(0).max(MAX_BUFFER_MINUTES).multipleOf(5),
  locationType: z.enum(["studio", "client_place", "both"]),
  /** Santim. Needed when the service is offered at her place. */
  priceStudio: price,
  /** Santim, travel fee included. Needed when the service is offered at the customer's place. */
  priceClientPlace: price,
  /** Ignored for a solo practice, where she is always the one performing. */
  providerMembershipIds: z.array(z.uuid()).max(500),
});

export type ServiceInput = z.input<typeof serviceSchema>;

export type ServiceError =
  | "forbidden"
  | "invalid_input"
  | "price_required"
  | "provider_invalid"
  | "not_found";

export type ServiceResult = { ok: true; service: Service } | { ok: false; error: ServiceError };

export type ServiceWithProviders = Service & { providerMembershipIds: string[] };

/** "800" or "1,250.50" as santim; null when it is not a sensible price. */
export function parsePrice(text: string): number | null {
  const cleaned = text.replace(/[,\s]/g, "");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  // Built from the digits, not by multiplying a float, so 19.99 is exactly 1999.
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/** Members who can be chosen to perform services: those with a professional profile. */
export async function listServiceProviderChoices(scope: BusinessScope): Promise<ScopedMember[]> {
  return (await scope.members()).filter((member) => member.hasProfile);
}

/** This business's services in display order, each with who performs it. */
export async function listServices(
  scope: BusinessScope,
  options: { includeArchived?: boolean } = {},
): Promise<ServiceWithProviders[]> {
  const [rows, links, members] = await Promise.all([
    options.includeArchived
      ? scope.select(services)
      : scope.select(services, eq(services.status, "active")),
    scope.select(serviceProviders),
    scope.members(),
  ]);
  // Someone who has left the business no longer performs anything.
  const current = new Set(members.map((member) => member.membershipId));

  return rows
    .sort(
      (a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime(),
    )
    .map((service) => ({
      ...service,
      providerMembershipIds: links
        .filter((link) => link.serviceId === service.id && current.has(link.membershipId))
        .map((link) => link.membershipId),
    }));
}

export async function getService(
  scope: BusinessScope,
  serviceId: string,
): Promise<ServiceWithProviders | null> {
  if (!z.uuid().safeParse(serviceId).success) return null;
  const all = await listServices(scope, { includeArchived: true });
  return all.find((service) => service.id === serviceId) ?? null;
}

type Checked =
  | { ok: false; error: ServiceError }
  | {
      ok: true;
      values: {
        name: string;
        description: string | null;
        durationMinutes: number;
        bufferMinutes: number;
        locationType: Service["locationType"];
        priceStudio: number | null;
        priceClientPlace: number | null;
      };
      providerMembershipIds: string[];
    };

async function check(scope: BusinessScope, input: ServiceInput): Promise<Checked> {
  if (!scope.can("services.edit")) return { ok: false, error: "forbidden" };

  const parsed = serviceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const data = parsed.data;

  const atStudio = data.locationType !== "client_place";
  const atClientPlace = data.locationType !== "studio";
  if ((atStudio && data.priceStudio === null) || (atClientPlace && data.priceClientPlace === null)) {
    return { ok: false, error: "price_required" };
  }

  const [business, choices] = await Promise.all([
    scope.business(),
    listServiceProviderChoices(scope),
  ]);
  const allowed = new Set(choices.map((member) => member.membershipId));
  let providerMembershipIds = [...new Set(data.providerMembershipIds)];
  if (business.kind === "independent") {
    // A solo practice has one professional (D96); she performs everything.
    providerMembershipIds = [...allowed];
  } else if (providerMembershipIds.some((id) => !allowed.has(id))) {
    return { ok: false, error: "provider_invalid" };
  }

  return {
    ok: true,
    values: {
      name: data.name,
      description: data.description || null,
      durationMinutes: data.durationMinutes,
      bufferMinutes: data.bufferMinutes,
      locationType: data.locationType,
      // A price for a place the service is not offered at is dropped, not kept hidden.
      priceStudio: atStudio ? data.priceStudio : null,
      priceClientPlace: atClientPlace ? data.priceClientPlace : null,
    },
    providerMembershipIds,
  };
}

export async function createService(
  scope: BusinessScope,
  input: ServiceInput,
): Promise<ServiceResult> {
  const checked = await check(scope, input);
  if (!checked.ok) return checked;

  const existing = await scope.select(services);
  const sortOrder = existing.reduce((max, row) => Math.max(max, row.sortOrder + 1), 0);

  const service = await scope.transaction(async (scoped) => {
    const values = { ...checked.values, sortOrder };
    const [row] = await scoped.insert(services, values);
    if (!row) throw new Error("Service was not saved");
    if (checked.providerMembershipIds.length > 0) {
      await scoped.insert(
        serviceProviders,
        checked.providerMembershipIds.map((membershipId) => ({ serviceId: row.id, membershipId })),
      );
    }
    await scoped.log({
      action: "service.created",
      entityType: "service",
      entityId: row.id,
      after: { ...checked.values, providerMembershipIds: checked.providerMembershipIds },
    });
    return row;
  });

  return { ok: true, service };
}

export async function updateService(
  scope: BusinessScope,
  serviceId: string,
  input: ServiceInput,
): Promise<ServiceResult> {
  const checked = await check(scope, input);
  if (!checked.ok) return checked;

  const current = await getService(scope, serviceId);
  if (!current) return { ok: false, error: "not_found" };

  const before = {
    name: current.name,
    description: current.description,
    durationMinutes: current.durationMinutes,
    bufferMinutes: current.bufferMinutes,
    locationType: current.locationType,
    priceStudio: current.priceStudio,
    priceClientPlace: current.priceClientPlace,
    providerMembershipIds: [...current.providerMembershipIds].sort(),
  };
  const after = {
    ...checked.values,
    providerMembershipIds: [...checked.providerMembershipIds].sort(),
  };
  const priceChanged =
    before.priceStudio !== after.priceStudio || before.priceClientPlace !== after.priceClientPlace;

  const service = await scope.transaction(async (scoped) => {
    const [row] = await scoped.update(
      services,
      { ...checked.values, updatedAt: new Date() },
      eq(services.id, serviceId),
    );
    if (!row) throw new Error("Service was not saved");

    await scoped.delete(serviceProviders, eq(serviceProviders.serviceId, serviceId));
    if (checked.providerMembershipIds.length > 0) {
      await scoped.insert(
        serviceProviders,
        checked.providerMembershipIds.map((membershipId) => ({ serviceId, membershipId })),
      );
    }
    // Price edits get their own name in the log: they are what disputes are about (D60).
    await scoped.log({
      action: priceChanged ? "service.price_changed" : "service.updated",
      entityType: "service",
      entityId: serviceId,
      before,
      after,
    });
    return row;
  });

  return { ok: true, service };
}

/**
 * Archiving takes a service off the public page without deleting it, so past
 * bookings keep pointing at something. Restoring puts it back.
 */
export async function setServiceArchived(
  scope: BusinessScope,
  serviceId: string,
  archived: boolean,
): Promise<ServiceResult> {
  if (!scope.can("services.edit")) return { ok: false, error: "forbidden" };
  const current = await getService(scope, serviceId);
  if (!current) return { ok: false, error: "not_found" };

  const status = archived ? "archived" : "active";
  if (current.status === status) return { ok: true, service: current };

  const service = await scope.transaction(async (scoped) => {
    const [row] = await scoped.update(
      services,
      { status, updatedAt: new Date() },
      eq(services.id, serviceId),
    );
    if (!row) throw new Error("Service was not saved");
    await scoped.log({
      action: archived ? "service.archived" : "service.restored",
      entityType: "service",
      entityId: serviceId,
      before: { name: current.name, status: current.status },
      after: { name: current.name, status },
    });
    return row;
  });
  return { ok: true, service };
}

/** Moves a service one place up or down the list customers see. */
export async function moveService(
  scope: BusinessScope,
  serviceId: string,
  direction: "up" | "down",
): Promise<{ ok: true } | { ok: false; error: ServiceError }> {
  if (!scope.can("services.edit")) return { ok: false, error: "forbidden" };

  const ordered = await listServices(scope);
  const from = ordered.findIndex((service) => service.id === serviceId);
  if (from === -1) return { ok: false, error: "not_found" };
  const to = direction === "up" ? from - 1 : from + 1;
  if (to < 0 || to >= ordered.length) return { ok: true };

  [ordered[from], ordered[to]] = [ordered[to]!, ordered[from]!];
  const moved = ordered
    .map((service, index) => ({ id: service.id, sortOrder: index, was: service.sortOrder }))
    .filter((row) => row.sortOrder !== row.was);

  await scope.transaction(async (scoped) => {
    for (const row of moved) {
      await scoped.update(services, { sortOrder: row.sortOrder }, inArray(services.id, [row.id]));
    }
  });
  return { ok: true };
}
