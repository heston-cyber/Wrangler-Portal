// Phase 5b step 4 (Nov 3) · call-sheet guests (D127): talent and other one-off people added to a call sheet.
//
// A guest signs in with the link in email 41 (/guest/<token>, one token per guest per sheet) and a 6-digit code emailed
// to them; there's no password. The login is a users row with role "guest", which lib/access.ts and lib/functions.ts
// treat as nobody (never an owner, client or vendor, whatever its email gets later). It passes only the guest
// functions (convex/guests.ts), and each of those re-checks, on every call, that the sheet is still theirs and active.
//
// A guest's sheet is active while all of these hold (checked from the sheet, never from the pass alone):
//   - the guest is still on the sheet (ticked), it was sent to them, and the owner hasn't ended their access by hand;
//   - the shoot is still scheduled (a cancelled shoot ends it) and its date hasn't passed (Central time: access runs
//     through the shoot day and ends the day after);
//   - the project isn't closed: delivery stage with the final files unlocked, the app's own meaning of a closed project
//     (Production's New shoot leaves exactly these out).
// An email that already has its own login (an owner, a client or vendor account, a live membership in any business, or
// any account that isn't a guest's) can't get a guest login: it keeps its own, and gets no guest powers.
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import { allowedEmails } from "./owners";
import { todayCentral } from "./bookings";
import { defaultBusiness } from "./business";
import { randomToken } from "./hash";

type Db = QueryCtx["db"];
export type Pass = Doc<"guestPasses">;
export const CODE_MINUTES = 10;
export const MAX_TRIES = 5;
export const MAX_WRONG_A_DAY = 15; // review L5: then the pass is locked until the owner sends it to them again
export const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** A project is closed when it's in Delivery with the final files unlocked (as Production › New shoot reads it). */
export const projectClosed = (p: Pick<Doc<"projects">, "stage" | "deliveryUnlockedAt"> | null | undefined) => !p || (p.stage === "delivery" && !!p.deliveryUnlockedAt);

/** True when this email has a login of its own (or will be an owner): then it never gets a guest login. Reads only
 *  global tables, so it answers the same whoever asks. */
export async function hasOwnLogin(db: Db, email: string): Promise<boolean> {
  const e = email.trim().toLowerCase();
  if (!e) return true;
  if (allowedEmails().includes(e)) return true;
  if ((await db.query("memberships").withIndex("by_email", (q) => q.eq("email", e)).collect()).some((m) => !m.revokedAt)) return true;
  return (await db.query("users").withIndex("email", (q) => q.eq("email", e)).collect()).some((u) => u.role !== "guest");
}

/** Review L1: whether the login an email has belongs to this business (an owner, client or vendor membership here, or
 *  Wrangler's allow list for the default business). Only then may the owner's page say why it can't be a guest; for a
 *  login elsewhere it gets a neutral note, so one business can't learn who has logins with another. */
export async function ownLoginHere(db: Db, email: string, biz: Id<"businesses">, defaultBiz: Id<"businesses"> | null): Promise<boolean> {
  const e = email.trim().toLowerCase();
  if (allowedEmails().includes(e) && biz === defaultBiz) return true;
  return (await db.query("memberships").withIndex("by_email", (q) => q.eq("email", e)).collect()).some((m) => !m.revokedAt && m.businessId === biz);
}

export type Why = "gone" | "notSent" | "ended" | "cancelled" | "over" | "closed";
export type SheetState =
  | { ok: true; cs: Doc<"callSheets">; r: Doc<"callSheets">["recipients"][number]; shoot: Doc<"shoots">; project: Doc<"projects"> }
  | { ok: false; why: Why; cs: Doc<"callSheets"> | null; shoot: Doc<"shoots"> | null };

/** Whether a pass's sheet is readable by its guest right now, read from the sheet itself. `db` is either the guarded
 *  reader (focused on the pass's business) or trusted server code's; the pass's business must match the sheet's. */
export async function sheetState(db: Db, pass: Pass, defaultBiz: Id<"businesses"> | null): Promise<SheetState> {
  const cs = await db.get(pass.callSheetId);
  if (!cs || (cs.businessId ?? defaultBiz) !== pass.businessId) return { ok: false, why: "gone", cs: null, shoot: null };
  const r = cs.recipients.find((x) => x.id === pass.personId && x.kind === "guest" && x.email === pass.email);
  if (!r) return { ok: false, why: "gone", cs: null, shoot: null };
  const shoot = await db.get(cs.shootId);
  if (r.endedAt || !r.on) return { ok: false, why: "ended", cs, shoot };
  if (cs.status !== "sent" || !cs.sent || !r.sentAt) return { ok: false, why: "notSent", cs, shoot };
  if (!shoot || shoot.status !== "scheduled") return { ok: false, why: "cancelled", cs, shoot };
  if (shoot.date < todayCentral()) return { ok: false, why: "over", cs, shoot };
  const project = await db.get(cs.projectId);
  if (!project || projectClosed(project)) return { ok: false, why: "closed", cs, shoot };
  return { ok: true, cs, r, shoot, project };
}

/** The business a sheet's guests belong to (a record with no businessId counts as the default business's). */
export async function sheetBusiness(ctx: QueryCtx | MutationCtx, cs: Doc<"callSheets">): Promise<Id<"businesses">> {
  const b = cs.businessId ?? (await defaultBusiness(ctx))?._id;
  if (!b) throw new ConvexError("This call sheet has no business.");
  return b;
}

/** The signed-in guest: a guest login (role "guest") whose email still has no login of its own. Anyone else is refused
 *  with the matrix's usual words. */
export async function requireGuest(ctx: QueryCtx | MutationCtx): Promise<{ userId: Id<"users">; email: string; name: string | null }> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Sign in first.");
  const user = await ctx.db.get(userId);
  const email = (user?.email ?? "").toLowerCase();
  if (!user || user.role !== "guest" || !email || (await hasOwnLogin(ctx.db, email))) throw new ConvexError("Not allowed.");
  return { userId, email, name: (user.name as string | undefined) ?? null };
}

/** "r•••@example.com" (the sign-in page never shows the whole address). */
export const masked = (email: string) => { const [local, domain] = email.split("@"); return `${(local ?? "").slice(0, 1)}•••@${domain ?? ""}`; };

// The owner's side keeps the passes in step with the sheet (callSheets.ts): one per guest, removed with the guest.
/** A new guest's pass, with their link token. */
export async function addPass(ctx: MutationCtx, cs: Doc<"callSheets">, personId: string, email: string) {
  await ctx.db.insert("guestPasses", { businessId: await sheetBusiness(ctx, cs), callSheetId: cs._id, personId, email, token: randomToken(18), createdAt: Date.now() });
}
export async function dropPasses(ctx: MutationCtx, callSheetId: Id<"callSheets">, personId?: string) {
  for (const p of await ctx.db.query("guestPasses").withIndex("by_sheet", (q) => q.eq("callSheetId", callSheetId)).collect()) if (!personId || p.personId === personId) await ctx.db.delete(p._id);
}
/** Review L12: a guest's pass while they can't open the sheet (or, `false`, can again): the switcher's "N new" hint. */
export async function passesOff(ctx: MutationCtx, callSheetId: Id<"callSheets">, off: boolean, personId?: string) {
  const now = Date.now();
  for (const p of await ctx.db.query("guestPasses").withIndex("by_sheet", (q) => q.eq("callSheetId", callSheetId)).collect())
    if ((!personId || p.personId === personId) && !!p.offAt !== off) await ctx.db.patch(p._id, { offAt: off ? now : undefined });
}
