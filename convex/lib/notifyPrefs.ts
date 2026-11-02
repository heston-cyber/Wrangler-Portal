// Nov 2 · Settings › Notifications: reading and writing one person's switches in one business (emailPrefs rows).
// Versions, replies and notes keep their own columns (their unsubscribe links set those); every other switch is a
// key in `off`. The pages show every email for the person's side, the always-sent ones without a switch.
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { randomToken } from "./hash";
import { defaultBusiness } from "./business";
import { NOTICES, noticesFor, type Side } from "./notify";

type Row = Doc<"emailPrefs">;
export type NoticeView = { key: string; group: string; label: string; hint: string | null; always: boolean; on: boolean };

const LEGACY = { versions: "versionsOff", replies: "repliesOff", notes: "notesOff" } as const;
const notesOff = (p: Partial<Row>) => p.notesOff ?? (!!p.versionsOff && !!p.repliesOff);

export function isOn(row: Partial<Row> | null, key: string): boolean {
  if (!row) return true;
  if (key === "versions") return !row.versionsOff;
  if (key === "replies") return !row.repliesOff;
  if (key === "notes") return !notesOff(row);
  return !(row.off ?? []).includes(key);
}

export function viewFor(side: Side, row: Partial<Row> | null): NoticeView[] {
  return noticesFor(side).map((n) => ({ key: n.key, group: n.group, label: n.label, hint: n.hint ?? null, always: !!n.always, on: n.always ? true : isOn(row, n.key) }));
}

export async function prefRow(ctx: QueryCtx | MutationCtx, email: string, biz: Id<"businesses"> | null) {
  const def = (await defaultBusiness(ctx))?._id ?? null;
  const b = biz ?? def;
  return (await ctx.db.query("emailPrefs").withIndex("by_email", (q) => q.eq("email", email.trim().toLowerCase())).collect()).find((r) => (r.businessId ?? def) === b) ?? null;
}

/** Turn one switch on or off for this address in this business (the row is made on first use). */
export async function setSwitch(ctx: MutationCtx, email: string, biz: Id<"businesses"> | null, side: Side, key: string, on: boolean) {
  const n = NOTICES.find((x) => x.side === side && x.key === key);
  if (!n || n.always) throw new Error("That email is always sent.");
  const e = email.trim().toLowerCase();
  const now = Date.now();
  let row = await prefRow(ctx, e, biz);
  if (!row) {
    const id = await ctx.db.insert("emailPrefs", { ...(biz ? { businessId: biz } : {}), email: e, key: randomToken(18), updatedAt: now });
    row = (await ctx.db.get(id))!;
  }
  if (key in LEGACY) {
    const col = LEGACY[key as keyof typeof LEGACY];
    await ctx.db.patch(row._id, { [col]: !on, updatedAt: now });
  } else {
    const off = new Set(row.off ?? []);
    if (on) off.delete(key); else off.add(key);
    await ctx.db.patch(row._id, { off: [...off], updatedAt: now });
  }
}
