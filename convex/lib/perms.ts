// Phase 5e step 1 (Nov 5): team members and what each role can use (Design Log, Phase 5e › Member page and Roles;
// D146). The owner can use everything. A team member's switches start from their role's switches and can be adjusted
// one by one ("Reset to the role" copies the role's again). Anything a switch doesn't cover stays owner-only.
//
// How a switch reaches the backend: a function that a team member may call names its switch in its owner check
// (requireMe(ctx, "review")). A function that names no switch stays owner-only, so a new function is closed to the
// team until someone decides otherwise. The privacy test calls every function as each role (tests/access.test.ts).

export const PERMS = ["projects", "shoots", "production", "clients", "review", "docs", "payments", "reports", "vendorPayments", "settings", "value"] as const;
export type Perm = (typeof PERMS)[number];
export type Perms = Record<Perm, boolean>;

export const TEAM_ROLES = ["producer", "editor", "bookkeeper"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export const ROLE_NAMES: Record<TeamRole, string> = { producer: "Producer", editor: "Editor", bookkeeper: "Bookkeeper" };

/** The rows of the Roles card, in the frame's order and words. */
export const PERM_NAMES: Record<Perm, string> = {
  projects: "Projects", shoots: "Shoots and call sheets", production: "Production and Gear", clients: "Clients and leads", review: "Review", docs: "Docs",
  payments: "Payments", reports: "Reports", vendorPayments: "Vendor payments", settings: "Settings", value: "See what a project is worth",
};

const none: Perms = { projects: false, shoots: false, production: false, clients: false, review: false, docs: false, payments: false, reports: false, vendorPayments: false, settings: false, value: false };

/** The suggested switches (the Roles frame, 814:11079; "Reset all to suggested"). */
export const SUGGESTED: Record<TeamRole, Perms> = {
  // Heston (Nov 5, 17:30): "Producer can see budgets": what a project is worth is on for a Producer too.
  producer: { ...none, projects: true, shoots: true, production: true, clients: true, review: true, docs: true, value: true },
  // Projects is "Assigned only" for an Editor: they see Review on the projects they're assigned to, nothing else.
  editor: { ...none, projects: true, review: true },
  bookkeeper: { ...none, payments: true, reports: true, vendorPayments: true, value: true },
};

/**
 * Switches a role can't have. Heston (Nov 3): an Editor never sees what a project is worth (Nov 5: a Producer now may).
 * Heston (Nov 5, 17:31, option A): an Editor works in Review on their assigned projects only, so every other switch is
 * locked off for Editors (those areas aren't split by project; a broader role is a Producer).
 */
export const LOCKED_OFF: Record<TeamRole, Perm[]> = {
  producer: [],
  editor: ["shoots", "production", "clients", "docs", "payments", "reports", "vendorPayments", "settings", "value"],
  bookkeeper: [],
};

/** An Editor only ever sees the projects they're assigned to (the Roles frame's "Assigned only"). */
export const assignedOnly = (role: TeamRole) => role === "editor";

/** A stored set of switches, cleaned: unknown keys dropped, missing ones off, locked ones off. */
export function cleanPerms(role: TeamRole, p: Partial<Record<string, unknown>> | null | undefined): Perms {
  const out = { ...none };
  for (const k of PERMS) out[k] = p?.[k] === true;
  for (const k of LOCKED_OFF[role]) out[k] = false;
  return out;
}

/** A business's role switches (its saved ones, else the suggested ones). */
export function rolePerms(saved: Partial<Record<TeamRole, unknown>> | null | undefined, role: TeamRole): Perms {
  const s = saved?.[role];
  return s && typeof s === "object" ? cleanPerms(role, s as Record<string, unknown>) : { ...SUGGESTED[role] };
}

export const isTeamRole = (r: unknown): r is TeamRole => typeof r === "string" && (TEAM_ROLES as readonly string[]).includes(r);
