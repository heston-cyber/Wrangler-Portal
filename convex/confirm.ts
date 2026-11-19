// Phase 8a (Heston, Nov 18, D209): anything Claude does through the connector that sends something to someone, or
// deletes something, waits for Heston. Claude asks him in chat first and passes his words (`said`); that makes a
// request here and nothing else. It runs only when the owner, signed in on the site, presses Confirm on its page
// (/confirm/<id>). Claude can't press it: the connector's key has no sign-in, and confirm() needs the owner's own
// session. So text inside an email, note or document claiming "Heston said yes" can never send anything on its own.
// Money never moves this way either (D209: Claude prepares, Heston pays on the site).
//
// Each kind of request is a line in KINDS: what its Confirm page says, and what Confirm does. A kind's `run` uses the
// same code as the site's own button (the note's Send, and so on), so a confirmed request behaves exactly the same.
import { v, ConvexError } from "convex/values";
import { internalMutation, mutation, query } from "./lib/functions";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireOwner, viewerOf } from "./lib/access";
import { audit } from "./lib/audit";
import { SITE } from "./lib/site";
import { sendNoteCore } from "./inbox";
import { resendCore, sentDoc } from "./sign";
import { docLabel } from "./lib/wsLayout";

const HOURS = 24;
export const CONFIRM_MS = HOURS * 3_600_000;
const clip = (s: string, n: number) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

type Kind = {
  /** What the Confirm page says, made fresh from the record (never from Claude's own words). Throws when it can't be done. */
  describe: (ctx: MutationCtx, targetId: string) => Promise<string>;
  /** Does it. The owner has just pressed Confirm. */
  run: (ctx: MutationCtx, targetId: string) => Promise<Record<string, unknown>>;
};

const note = async (ctx: MutationCtx, id: string) => {
  const nid = ctx.db.normalizeId("inboxNotes", id);
  const n = nid ? await ctx.db.get(nid) : null; // another business's note is invisible here
  if (!n) throw new ConvexError("That note isn't here.");
  if (n.status !== "draft") throw new ConvexError(n.status === "sent" ? "That note was already sent." : "That note was discarded.");
  return n;
};

export const KINDS: Record<string, Kind> = {
  "note.send": {
    describe: async (ctx, id) => {
      const n = await note(ctx, id);
      const c = await ctx.db.get(n.clientId);
      return `Send the note “${clip(n.title, 120)}” to ${c?.name ?? "the client"}`;
    },
    run: async (ctx, id) => { const n = await note(ctx, id); return await sendNoteCore(ctx, n._id); },
  },
  // Wrangler Sign's "Send a reminder" (the signing steps themselves are unchanged; this is the reminder email only).
  "sign.remind": {
    describe: async (ctx, id) => {
      const { doc, x } = await signer(ctx, id);
      return `Email ${x.name} (${x.email}) a reminder to sign ${docLabel(doc.number)}, “${clip(doc.title, 100)}”`;
    },
    run: async (ctx, id) => { const { doc, x } = await signer(ctx, id); await resendCore(ctx, doc._id, x.signerKey, "heston"); return { reminded: x.name }; },
  },
};

/** "<documentId>:<signerKey>": a signer whose turn it is on a document that's out for signature. */
async function signer(ctx: MutationCtx, id: string) {
  const [d, key] = id.split(":");
  const did = ctx.db.normalizeId("wsDocuments", d ?? "");
  if (!did || !key) throw new ConvexError("That document isn't here.");
  const { doc, signings } = await sentDoc(ctx, did);
  const x = signings.find((y) => y.signerKey === key);
  if (!x || x.status !== "sent") throw new ConvexError(x?.status === "signed" ? "They've already signed." : "It isn't their turn yet.");
  return { doc, x };
}

const view = (r: { _id: Id<"pendingActions">; kind: string; summary: string; said: string; status: string; requestedAt: number; expiresAt: number; doneAt?: number; error?: string }, now = Date.now()) => ({
  _id: r._id, kind: r.kind, summary: r.summary, said: r.said, requestedAt: r.requestedAt, expiresAt: r.expiresAt, doneAt: r.doneAt ?? null, error: r.error ?? null,
  status: r.status === "waiting" && r.expiresAt <= now ? "expired" : r.status,
});

/** The connector: make a request (nothing happens yet). The same kind and record already waiting is renewed. */
export const request = internalMutation({
  args: { kind: v.string(), targetId: v.string(), said: v.string() },
  handler: async (ctx, a) => {
    const k = KINDS[a.kind];
    if (!k) throw new ConvexError("That can't be asked for.");
    const said = clip(a.said, 500);
    if (said.length < 3) throw new ConvexError("Ask Heston first, and pass his words in `said`.");
    const summary = await k.describe(ctx, a.targetId);
    const now = Date.now();
    const same = (await ctx.db.query("pendingActions").withIndex("by_status", (q) => q.eq("status", "waiting")).collect())
      .find((r) => r.kind === a.kind && r.targetId === a.targetId);
    let id: Id<"pendingActions">;
    if (same) { id = same._id; await ctx.db.patch(id, { summary, said, requestedAt: now, expiresAt: now + CONFIRM_MS }); }
    else id = await ctx.db.insert("pendingActions", { kind: a.kind, targetId: a.targetId, summary, said, status: "waiting", requestedAt: now, expiresAt: now + CONFIRM_MS });
    return { request_id: id, summary, confirm_at: `${SITE()}/confirm/${id}`, expires_in_hours: HOURS };
  },
});

/** The connector: has Heston confirmed it yet? */
export const statusOf = internalMutation({
  args: { requestId: v.string() },
  handler: async (ctx, a) => {
    const id = ctx.db.normalizeId("pendingActions", a.requestId);
    const r = id ? await ctx.db.get(id) : null;
    if (!r) throw new ConvexError("That request isn't here.");
    return view(r);
  },
});

/** The Confirm page. The owner only. */
export const get = query({
  args: { id: v.string() },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const id = ctx.db.normalizeId("pendingActions", a.id);
    const r = id ? await ctx.db.get(id) : null;
    return r ? view(r) : null;
  },
});

/** The Dashboard's "Claude is waiting for your OK" rows. The owner only; anyone else gets none (the Dashboard asks). */
export const waiting = query({
  args: {},
  handler: async (ctx) => {
    if ((await viewerOf(ctx)).kind !== "owner") return [];
    const now = Date.now();
    return (await ctx.db.query("pendingActions").withIndex("by_status", (q) => q.eq("status", "waiting")).order("desc").take(50))
      .filter((r) => r.expiresAt > now).map((r) => view(r, now));
  },
});

/** Confirm: the owner, signed in on the site. Runs it the same way the site's own button does. */
export const confirm = mutation({
  args: { id: v.string() },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const id = ctx.db.normalizeId("pendingActions", a.id);
    const r = id ? await ctx.db.get(id) : null;
    if (!r) throw new ConvexError("That request isn't here.");
    if (r.status !== "waiting") throw new ConvexError(r.status === "done" ? "That's already done." : "That request was cancelled.");
    if (r.expiresAt <= Date.now()) throw new ConvexError("That request ran out. Ask Claude again.");
    const k = KINDS[r.kind];
    if (!k) throw new ConvexError("That can't be done here.");
    const result = await k.run(ctx, r.targetId); // throws (and changes nothing) when it can't be done
    await ctx.db.patch(r._id, { status: "done", doneAt: Date.now() });
    await audit(ctx, { kind: r.kind.endsWith(".delete") ? "deleted" : "sent", text: `confirmed Claude's request: ${r.summary}`, where: "Claude connector", link: `/confirm/${r._id}` });
    return { ok: true, ...result };
  },
});

export const cancel = mutation({
  args: { id: v.string() },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const id = ctx.db.normalizeId("pendingActions", a.id);
    const r = id ? await ctx.db.get(id) : null;
    if (!r) throw new ConvexError("That request isn't here.");
    if (r.status === "waiting") await ctx.db.patch(r._id, { status: "cancelled", doneAt: Date.now() });
    return null;
  },
});
