// Hierarchy 3c (D204): kickoff briefs and file requests live on a project, or on a client with no project, or on
// nothing yet (a draft). Where one is, who it goes to, and which signed-in client may open it.
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { businessOf, hasAccess } from "./inbox";
import { sameBusiness, shareState } from "./shareAccess";
import { label } from "./bookingRows";
import { myProjects, portalPeople } from "../projects";

type Ctx = QueryCtx | MutationCtx;
export type Placed = {
  p: Doc<"projects"> | null;
  c: Doc<"clients"> | null;
  clientId: Id<"clients"> | undefined;
  businessId: Id<"businesses"> | null;
  /** "26127 Harbor Coffee Launch" on a project, "Harbor Coffee" on a client */
  label: string;
};

/** Where a brief or request is now (null: on nothing, or its home is gone). */
export async function placeOf(ctx: Ctx, r: { projectId?: Id<"projects">; clientId?: Id<"clients"> }): Promise<Placed | null> {
  if (r.projectId) {
    const p = await ctx.db.get(r.projectId);
    if (!p) return null;
    const c = p.clientId ? await ctx.db.get(p.clientId) : null;
    return { p, c, clientId: p.clientId, businessId: await businessOf(ctx, p), label: label(p) };
  }
  if (r.clientId) {
    const c = await ctx.db.get(r.clientId);
    if (!c) return null;
    return { p: null, c, clientId: c._id, businessId: await businessOf(ctx, c), label: c.name };
  }
  return null;
}

/** The invited members of the client's live client shares (with a live invite): who a client-level brief goes to. */
export async function clientPeople(ctx: Ctx, c: Doc<"clients">) {
  const biz = await businessOf(ctx, c);
  if (!biz) return [];
  const seen = new Set<string>();
  const out: Array<{ email: string }> = [];
  for (const s of await ctx.db.query("shares").collect()) {
    if (s.kind !== "client" || s.who !== "invited" || s.clientId !== c._id || shareState(s) || !sameBusiness(s, c)) continue;
    for (const m of await ctx.db.query("shareMembers").withIndex("by_share", (q) => q.eq("shareId", s._id)).collect()) {
      const e = m.email.toLowerCase();
      if (seen.has(e) || !(await hasAccess(ctx, biz, m.email))) continue;
      seen.add(e); out.push({ email: m.email });
    }
  }
  return out;
}

/** Who it goes to where it is: the project's portal people, or the client's people. */
export async function peopleAt(ctx: Ctx, w: Placed) {
  return w.p ? await portalPeople(ctx, w.p) : w.c ? await clientPeople(ctx, w.c) : [];
}

/** May this signed-in client open a brief or request placed at `w`? The same people it goes to. */
export async function clientMayOpen(ctx: Ctx, email: string, w: Placed) {
  if (w.p) return (await myProjects(ctx as QueryCtx, email)).has(w.p._id);
  if (!w.c) return false;
  const e = email.toLowerCase();
  return (await clientPeople(ctx, w.c)).some((x) => x.email.toLowerCase() === e);
}
