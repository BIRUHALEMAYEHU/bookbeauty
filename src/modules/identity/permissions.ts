/**
 * Role × action permissions from playbook Section 14.3.
 * Change who can do what by editing ROLE_PERMISSIONS only.
 */

export const MEMBERSHIP_ROLES = [
  "owner",
  "branch_manager",
  "receptionist",
  "stylist",
] as const;

export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

/** Actions the product checks. New features add a row here and in ROLE_PERMISSIONS. */
export const ACTIONS = [
  "revenue.view",
  "bookings.view",
  "customers.view",
  "bookings.create",
  "bookings.assign",
  "bookings.complete",
  "services.edit",
  "staff.manage",
  "activity_log.view",
  "settings.manage",
] as const;

export type Action = (typeof ACTIONS)[number];

/**
 * How far a grant reaches:
 * - all: every branch / every record in the business
 * - branch: only locations on the membership
 * - own: only the actor's own records
 * - false: not allowed
 */
export type Grant = "all" | "branch" | "own" | false;

export const ROLE_PERMISSIONS: Record<MembershipRole, Record<Action, Grant>> = {
  owner: {
    "revenue.view": "all",
    "bookings.view": "all",
    "customers.view": "all",
    "bookings.create": "all",
    "bookings.assign": "all",
    "bookings.complete": "all",
    "services.edit": "all",
    "staff.manage": "all",
    "activity_log.view": "all",
    "settings.manage": "all",
  },
  branch_manager: {
    "revenue.view": "branch",
    "bookings.view": "branch",
    "customers.view": "branch",
    "bookings.create": "branch",
    "bookings.assign": "branch",
    "bookings.complete": "branch",
    "services.edit": "branch",
    "staff.manage": "branch",
    "activity_log.view": false,
    "settings.manage": false,
  },
  receptionist: {
    "revenue.view": false,
    "bookings.view": "branch",
    "customers.view": "branch",
    "bookings.create": "branch",
    "bookings.assign": "branch",
    "bookings.complete": "branch",
    "services.edit": false,
    "staff.manage": false,
    "activity_log.view": false,
    "settings.manage": false,
  },
  stylist: {
    "revenue.view": "own",
    "bookings.view": "own",
    "customers.view": "own",
    "bookings.create": "own",
    "bookings.assign": false,
    "bookings.complete": "own",
    "services.edit": false,
    "staff.manage": false,
    "activity_log.view": false,
    "settings.manage": false,
  },
};

export type Actor = {
  userId: string;
  businessId: string;
  membershipId: string;
  role: MembershipRole;
  /** Location ids this membership covers. Empty means none assigned. */
  locationIds: string[];
  /** Membership statuses that may act: active and notice (still working out her last days). */
  status: "active" | "notice";
};

export type Resource = {
  locationId?: string | null;
  /** The professional who owns the record (for "own" grants). */
  professionalUserId?: string | null;
};

const ACTING_STATUSES = new Set(["active", "notice"]);

export function grantFor(role: MembershipRole, action: Action): Grant {
  return ROLE_PERMISSIONS[role][action];
}

/**
 * Whether the actor may perform the action on the optional resource.
 * Branch-scoped roles need a matching location when a locationId is given.
 * Own-scoped actions need the resource's professionalUserId to match the actor.
 */
export function can(actor: Actor, action: Action, resource: Resource = {}): boolean {
  if (!ACTING_STATUSES.has(actor.status)) return false;

  const grant = grantFor(actor.role, action);
  if (!grant) return false;

  if (grant === "all") return true;

  if (grant === "branch") {
    if (actor.locationIds.length === 0) return false;
    if (resource.locationId == null) return true;
    return actor.locationIds.includes(resource.locationId);
  }

  // grant === "own"
  if (resource.professionalUserId == null) {
    // Listing "own" without a target: allowed; callers must still filter by user.
    return true;
  }
  return resource.professionalUserId === actor.userId;
}

export function assertCan(
  actor: Actor,
  action: Action,
  resource: Resource = {},
): void {
  if (!can(actor, action, resource)) {
    throw new PermissionDeniedError(action);
  }
}

export class PermissionDeniedError extends Error {
  readonly action: Action;

  constructor(action: Action) {
    super(`Permission denied for ${action}`);
    this.name = "PermissionDeniedError";
    this.action = action;
  }
}
