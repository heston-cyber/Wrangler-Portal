// Phase 5e step 1 (Nov 5): what a team member's menu and pages show. The server checks every call again; this only keeps
// the menu to what the role allows ("nothing greyed", Design Log › Role views) and sends a direct link to a page the role
// can't use to the no-access page.
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { PERMS, type Perm, type Perms } from "../../convex/lib/perms";

export type { Perm, Perms };
const ALL = Object.fromEntries(PERMS.map((p) => [p, true])) as Perms;
const NONE = Object.fromEntries(PERMS.map((p) => [p, false])) as Perms;

/** The caller's switches: everything for the owner, their role's for a team member, nothing while loading. */
export function usePerms(): { perms: Perms; team: boolean; role: string | null; loading: boolean } {
  const me = useQuery(api.users.me);
  if (me === undefined) return { perms: NONE, team: false, role: null, loading: true };
  if (me?.role === "team" && me.team) return { perms: me.team.perms as Perms, team: true, role: me.team.role, loading: false };
  return { perms: ALL, team: false, role: null, loading: false };
}

const starts = (p: string, ...xs: string[]) => xs.some((x) => p === x || p.startsWith(`${x}/`) || p.startsWith(`${x}?`));

/**
 * What an address needs: a list of switches (any one opens it), "any" (every team member: Dashboard, Account), or
 * "owner" (the owner only, whatever the switches say).
 */
export function pathNeeds(path: string): Perm[] | "any" | "owner" {
  if (path === "/" || path === "" || starts(path, "/more", "/settings/account", "/settings/security")) return "any";
  if (starts(path, "/v", "/review", "/register")) return ["review"];
  if (starts(path, "/projects")) return ["projects", "review"];
  if (starts(path, "/activity")) return "owner";
  if (starts(path, "/production/call-sheets", "/production/shoots", "/production/calendar", "/production/prin-pro")) return ["shoots"];
  if (starts(path, "/production")) return ["production", "shoots"];
  if (starts(path, "/vendors/payments")) return ["vendorPayments"];
  if (starts(path, "/vendors")) return ["production"];
  if (starts(path, "/clients/pipeline", "/clients/deals", "/clients/estimates")) return ["clients"]; // the server also wants project value
  if (starts(path, "/clients", "/messages", "/sent")) return ["clients"];
  if (starts(path, "/sign/signature", "/sign/connector")) return "owner";
  if (starts(path, "/sign", "/proposals")) return ["docs"];
  if (starts(path, "/payments")) return ["payments"];
  if (starts(path, "/settings/business", "/settings/brand", "/settings/calls")) return ["settings"];
  if (starts(path, "/settings")) return "owner";
  return "owner";
}

/** May a viewer with these switches open this address? */
export function canOpen(path: string, perms: Perms, team: boolean, role?: string | null): boolean {
  if (!team) return true;
  const n = pathNeeds(path);
  if (n === "any") return true;
  if (n === "owner") return false;
  // An Editor (D157: Review on assigned projects only) gets Review's own page and the videos there, nothing else.
  if (role === "editor") return perms.review && (path === "/review" || path === "/review/" || starts(path, "/v"));
  return n.some((p) => perms[p]);
}

export const isNotAllowed = (e: unknown) => /Not allowed/.test(String((e as Error)?.message ?? e));
