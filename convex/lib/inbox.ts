// Wrangler Portal Phase 1 (Oct 29): the one way anything reaches a client's Inbox.
//
// Every module posts through postToInbox: Review (a new cut, a reply on a note), Sign (a document to sign, signed,
// cancelled) and the owner's notes. One row per person, so each person's read status is their own.
//   - Only people with a live invite in that business get items (T1.2: guests on a link, and signers who were never
//     invited, get none; their emails go on as before).
//   - Each event posts once per person: `key` is checked first, so a retried job or a second run changes nothing.
//   - The row's business is set from the event's own record, never from whoever happens to be calling.
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { defaultBusiness } from "./business";

export type InboxKind = Doc<"inboxItems">["kind"];
export type InboxSource = Doc<"inboxItems">["source"];

const clean = (e: string) => e.trim().toLowerCase();

/** The business a record belongs to (an untagged record, only in tests, is the default business's). */
export async function businessOf(ctx: QueryCtx | MutationCtx, doc: { businessId?: Id<"businesses"> } | null | undefined): Promise<Id<"businesses"> | null> {
  if (!doc) return null;
  return doc.businessId ?? (await defaultBusiness(ctx))?._id ?? null;
}

/** Does this email have portal access in this business (a live invite)? */
export async function hasAccess(ctx: QueryCtx | MutationCtx, businessId: Id<"businesses">, email: string): Promise<boolean> {
  const def = (await defaultBusiness(ctx))?._id ?? null;
  const invites = await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", clean(email))).collect();
  return invites.some((i) => !i.revokedAt && (i.businessId ?? def) === businessId);
}

/** The client this person belongs to in this business, if they're one of a client's people. */
export async function clientOfEmail(ctx: QueryCtx | MutationCtx, businessId: Id<"businesses">, email: string): Promise<Id<"clients"> | undefined> {
  const def = (await defaultBusiness(ctx))?._id ?? null;
  const rows = await ctx.db.query("clientPeople").withIndex("by_email", (q) => q.eq("email", clean(email))).collect();
  return rows.find((r) => !r.removedAt && (r.businessId ?? def) === businessId)?.clientId;
}

export type Post = {
  businessId: Id<"businesses">;
  clientId?: Id<"clients">;
  email: string;
  kind: InboxKind;
  title: string;
  text: string;
  link?: string;
  source: InboxSource;
  key: string;               // the event; the person is added to it
  noteId?: Id<"inboxNotes">;
};

/** Posts one item to one person. Returns the new item's id, or null when they have no access or it's already there. */
export async function postToInbox(ctx: MutationCtx, p: Post): Promise<Id<"inboxItems"> | null> {
  const email = clean(p.email);
  if (!email || !(await hasAccess(ctx, p.businessId, email))) return null;
  const key = `${p.key}:${email}`;
  if (await ctx.db.query("inboxItems").withIndex("by_key", (q) => q.eq("key", key)).first()) return null;
  const clientId = p.clientId ?? (await clientOfEmail(ctx, p.businessId, email));
  return await ctx.db.insert("inboxItems", {
    businessId: p.businessId, email, kind: p.kind, title: p.title.slice(0, 160), text: p.text.slice(0, 400),
    source: p.source, key, createdAt: Date.now(),
    ...(clientId ? { clientId } : {}), ...(p.link ? { link: p.link } : {}), ...(p.noteId ? { noteId: p.noteId } : {}),
  });
}

/** An item as the portal shows it. */
export function itemView(i: Doc<"inboxItems">) {
  return { _id: i._id, kind: i.kind, title: i.title, text: i.text, link: i.link ?? null, createdAt: i.createdAt, read: !!i.readAt, readAt: i.readAt ?? null, emailed: !!i.emailedAt };
}
