// Phase 8a (Heston, Nov 18, D209): anything Claude does through the connector that sends something to someone, or
// deletes something, waits for Heston. Claude asks him in chat first and passes his words (`said`); that makes a
// request here and nothing else. It runs only when the owner, signed in on the site, presses Confirm on its page
// (/confirm/<id>). Claude can't press it: the connector's key has no sign-in, and confirm() needs the owner's own
// session. So text inside an email, note or document claiming "Heston said yes" can never send anything on its own.
// Money never moves this way either (D209: Claude prepares, Heston pays on the site).
//
// Security review (H1): the Confirm page shows exactly what will go out, read live from the record (the full text,
// the link, who it reaches, whether it emails), and the request is bound to that content: a hash is kept when Claude
// asks, and Confirm refuses if anything changed since (Claude, or anyone, editing the draft after the ask).
//
// Each kind of request is a line in KINDS: `preview` (what goes out, live) and `run` (does it with the same code as
// the site's own button).
import { v, ConvexError } from "convex/values";
import { internalMutation, mutation, query } from "./lib/functions";
import { action, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireOwner, viewerOf } from "./lib/access";
import { audit } from "./lib/audit";
import { SITE } from "./lib/site";
import { sha256Hex } from "./lib/hash";
import { noteAudience, sendNoteCore } from "./inbox";
import { resendCore, sentDoc } from "./sign";
import { docLabel } from "./lib/wsLayout";
import { ACTIONS, argsOf } from "./lib/siteActions";
import { BUSINESS_TABLES } from "./lib/tenancy";
import { argsProblem, idPaths, recording, sameReach, summarize, type Outbound } from "./lib/siteGuard";

const HOURS = 24;
export const CONFIRM_MS = HOURS * 3_600_000;
const MAX_WAITING = 20; // review L2: Claude can't pile up requests
// Review L7: control, bidi and zero-width characters out of anything shown on the Confirm page.
// Review L7 / re-review L-4: control, bidi and zero-width characters out of anything shown on the Confirm page (written
// as \u escapes so no editor can change them). `clip` makes one line; `body` keeps line breaks for multi-line text.
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
export const clip = (s: string, n: number) => s.replace(INVISIBLE, "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const body = (s: string, n: number) => s.replace(INVISIBLE, "").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").slice(0, n);

type Ctx = QueryCtx | MutationCtx;
type Line = { label: string; value: string };
/** bind: what the request is tied to besides what's shown (the records it acts on), so Confirm refuses if they changed. */
type Preview = { title: string; lines: Line[]; open?: string; bind?: string };
type Kind = {
  /** What will go out, read live from the record. Throws when it can't be done (gone, already sent, not their turn). */
  preview: (ctx: Ctx, targetId: string, payload: string | undefined) => Promise<Preview>;
  /** Does it. The owner has just pressed Confirm, and the preview still matches what was asked. */
  run: (ctx: MutationCtx, targetId: string, payload: string | undefined) => Promise<Record<string, unknown>>;
};

const note = async (ctx: Ctx, id: string) => {
  const nid = ctx.db.normalizeId("inboxNotes", id);
  const n = nid ? await ctx.db.get(nid) : null; // another business's note is invisible here
  if (!n) throw new ConvexError("That note isn't here.");
  if (n.status !== "draft") throw new ConvexError(n.status === "sent" ? "That note was already sent." : "That note was discarded.");
  if (n.draftedBy !== "claude") throw new ConvexError("That note wasn't drafted by Claude. Heston sends his own drafts on the site."); // re-review L-6
  return n;
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

// ---------- Phase 8b: any site action that sends or deletes (lib/siteActions.ts) ----------
// The request holds the action, its arguments and what it would send (siteRun.tryOut ran it once as the owner and
// undid it). The page shows all three, with the names of the records it acts on; Confirm runs it as Heston, watching
// what it sends, and undoes it if it would now reach anyone different.
type SitePayload = { args: Record<string, unknown>; outbound: Outbound[] };
const VOLATILE = /opened|views|seen|readat|lastused|lastopened/i;

/** "<action>|<a short hash of its arguments>": two asks of one action for different things are two requests. */
export const siteAction = (target: string) => target.split("|")[0] ?? "";

function siteParts(target: string, payload: string | undefined) {
  const action = siteAction(target);
  const act = Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : undefined;
  if (!act || act.mode === "read") throw new ConvexError("That can't be asked for.");
  let p: SitePayload;
  try { p = JSON.parse(payload ?? "") as SitePayload; } catch { throw new ConvexError("That request is damaged. Ask Claude again."); }
  if (!p || typeof p.args !== "object" || !Array.isArray(p.outbound)) throw new ConvexError("That request is damaged. Ask Claude again.");
  return { act, action, args: p.args, outbound: summarize(p.outbound) };
}

const TABLE_NAMES: Record<string, string> = { callSheets: "a call sheet", shoots: "a shoot", tasks: "a task", vendorBookings: "a booking", canvases: "a canvas", deliveries: "a delivery", shotSetups: "a setup", shots: "a shot", packLines: "a packing line" };
/** Re-review High-1/Med-4: a creative doc, briefing, call sheet or release is named by its page's title. */
const labelOf = async (ctx: Ctx, d: Record<string, unknown> | null, table: string) => {
  if (!d) return "(not found)";
  if (typeof d.buildId === "string" && ["creativeDocs", "briefings", "callSheets", "releases"].includes(table)) {
    const bid = ctx.db.normalizeId("wsBuilds", d.buildId);
    const b = bid ? await ctx.db.get(bid) : null;
    if (b?.title) return clip(`${b.title}${table === "creativeDocs" ? ` (${String(d.kind ?? "creative")} doc)` : ""}`, 120);
  }
  const t = [d.name, d.title, d.heading, d.label, d.description, d.date && `${TABLE_NAMES[table] ?? "the one"} on ${d.date}`].find((x) => typeof x === "string" && x.trim());
  return clip(String(t ?? TABLE_NAMES[table] ?? "(untitled)"), 120);
};
/** Never cut silently (re-review High-1): a long value says how much more there is. The whole of it is bound by the hash. */
const cut = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}… (and ${t.length - n} more characters; open it to see all)` : t);
const shown = (x: unknown) => (typeof x === "string" ? cut(body(x, 100_000), 1500) : cut(clip(JSON.stringify(x), 100_000), 1500));

async function sitePreview(ctx: Ctx, target: string, payload: string | undefined): Promise<Preview> {
  const { act, action, args, outbound } = siteParts(target, payload);
  const v = argsOf(action);
  const problem = argsProblem(v, args, "args", (table, id) => !!(table.startsWith("_") ? ctx.db.system.normalizeId(table as never, id) : ctx.db.normalizeId(table as never, id)));
  if (problem) throw new ConvexError(`${problem}. Ask Claude again.`);
  // Ids the validator names, and any other text argument that is an id of this business's records (many site
  // functions take ids as plain text).
  const ids = idPaths(v, args);
  const textIds = (x: unknown, depth = 0): void => {
    if (depth > 4 || ids.length > 40) return;
    if (typeof x === "string") { if (!ids.some((i) => i.id === x)) for (const t of BUSINESS_TABLES) if (ctx.db.normalizeId(t as never, x)) { ids.push({ table: t, id: x }); break; } return; }
    if (Array.isArray(x)) x.forEach((y) => textIds(y, depth + 1));
    else if (x && typeof x === "object") Object.values(x).forEach((y) => textIds(y, depth + 1));
  };
  textIds(args);
  const recs: Record<string, unknown> = {};
  const names = new Map<string, string>();
  for (const { table, id } of ids) {
    if (table.startsWith("_")) { names.set(id, "a file"); continue; } // a stored file: shown, not bound (it can't change)
    const nid = ctx.db.normalizeId(table as never, id);
    const d = nid ? ((await ctx.db.get(nid)) as Record<string, unknown> | null) : null; // another business's is invisible
    if (!d) throw new ConvexError("Something it acts on isn't here any more.");
    names.set(id, await labelOf(ctx, d, table));
    recs[id] = Object.fromEntries(Object.entries(d).filter(([k]) => !VOLATILE.test(k)));
  }
  const named = (t: string) => { let out = t; for (const [id, n] of names) out = out.split(id).join(n); return out; };
  const details = Object.entries(args).filter(([, x]) => x !== undefined).map(([k, x]) => `${k}: ${named(shown(x))}`);
  const first = ids[0] ? names.get(ids[0].id) : undefined;
  // Review M6: why it needs Heston (a link turned on, a shared board, a client's task), and what else it shows.
  const why = act.askWhen?.(args) ?? (act.outside ? await act.outside(ctx as QueryCtx, args) : null);
  const more = act.shows ? await act.shows(ctx as QueryCtx, args) : [];
  const PAGES: Record<string, (id: string) => string> = { callSheets: (id) => `/production/call-sheets/${id}`, projects: (id) => `/projects/${id}`, shotLists: (id) => `/production/shot-lists/${id}`, canvases: (id) => `/creative/canvas/${id}`, creativeDocs: (id) => `/creative/docs/${id}`, briefings: (id) => `/vendors/briefings/${id}` };
  const page = ids.find((x) => PAGES[x.table]);
  return {
    title: `${act.does}${first ? `: ${first}` : ""}`,
    ...(page ? { open: PAGES[page.table](page.id) } : {}),
    lines: [
      { label: "Does", value: act.does },
      ...(details.length ? [{ label: "Details", value: cut(details.join("\n"), 6000) }] : []),
      ...(act.mode === "delete" ? [{ label: "Deletes", value: ids.length ? ids.map((x) => names.get(x.id)!).join(", ") : "What's named above" }] : []),
      ...(why ? [{ label: "Why it asks", value: why }] : []),
      ...(act.note ? [{ label: "Also", value: act.note }] : []),
      // 8c review M3: never cut silently; past this much it isn't asked at all (Heston does it on the site).
      ...more.map((l) => { if (l.value.length > 20_000) throw new ConvexError("That's too much to show on one page. Heston does this on the site."); return { label: clip(l.label, 60), value: body(l.value, 20_000) }; }),
      ...(outbound.length
        ? outbound.map((o) => ({ label: "Sends", value: clip(`${o.what}${o.to.length ? ` to ${o.to.slice(0, 300).join(", ")}${o.to.length > 300 ? ` and ${o.to.length - 300} more` : ""}` : ""}`, 40_000) }))
        : act.onPage || more.some((l) => l.label === "Sends") ? [] : [{ label: "Sends", value: "No email or message" }]), // an ask that says what it sends itself
    ],
    bind: JSON.stringify({ recs, args }), // everything it acts on and with, even what the page shortens
  };
}

export const KINDS: Record<string, Kind> = {
  site: {
    preview: sitePreview,
    run: async (ctx, target, payload) => {
      const { act, action, args, outbound } = siteParts(target, payload);
      // Phase 8c: a Stripe action can't run inside Confirm; the page runs it next, signed in as Heston (`runOnPage`).
      if (act.onPage) return { runOnPage: true };
      const seen: Outbound[] = [];
      const result = await act.fn._handler(recording(ctx, seen), args);
      if (!sameReach(seen, outbound)) throw new ConvexError("It would now send to different people than when Claude asked. Nothing was done: ask Claude again.");
      return { done: action, ...(result && typeof result === "object" && !Array.isArray(result) ? { result: JSON.parse(JSON.stringify(result, (_k, x) => (typeof x === "bigint" ? Number(x) : x))) } : {}) };
    },
  },
  "note.send": {
    preview: async (ctx, id) => {
      const n = await note(ctx, id);
      const c = await ctx.db.get(n.clientId);
      if (!c) throw new ConvexError("That client isn't here.");
      const reach = (await noteAudience(ctx, c)).filter((p) => p.access && (!n.to || n.to.includes(p.email)));
      return {
        title: `Send the note “${clip(n.title, 120)}” to ${clip(c.name, 80)}`,
        open: `/sent/new?note=${n._id}`,
        lines: [
          { label: "Title", value: clip(n.title, 200) },
          { label: "Text", value: body(n.text, 4000) },
          // Re-review L-1: everything that changes what they get is shown, and so bound by the hash.
          ...(n.testimonialProjectId ? [{ label: "Asks for a testimonial", value: `About ${clip((await ctx.db.get(n.testimonialProjectId))?.name ?? "a project", 120)}, with the link to the testimonial form` }] : []),
          ...(n.link && !n.testimonialProjectId ? [{ label: "Link", value: clip(n.link, 500) }] : []),
          ...(n.linkLabel ? [{ label: "Button says", value: clip(n.linkLabel, 120) }] : []),
          ...(n.to ? [{ label: "Only to", value: n.to.join(", ") }] : []),
          { label: "Reaches", value: reach.length ? reach.map((p) => `${clip(p.name ?? "", 60)} <${p.email}>`.trim()).join(", ") : "No one with portal access yet (it can't be sent)" },
          { label: "Email", value: n.emailThem === false ? "Inbox only, no email" : "Inbox and an email to each of them" },
        ],
      };
    },
    run: async (ctx, id) => { const n = await note(ctx, id); return await sendNoteCore(ctx, n._id); },
  },
  // Wrangler Sign's "Send a reminder" (the signing steps themselves are unchanged; this is the reminder email only).
  "sign.remind": {
    preview: async (ctx, id) => {
      const { doc, x } = await signer(ctx as MutationCtx, id);
      return {
        title: `Email ${clip(x.name, 80)} a reminder to sign ${docLabel(doc.number)}`,
        open: `/sign/d/${doc._id}`,
        lines: [
          { label: "To", value: `${clip(x.name, 80)} <${x.email}>` },
          { label: "Document", value: `${docLabel(doc.number)}, “${clip(doc.title, 120)}”` },
          { label: "Email", value: "Their signing link again" },
        ],
      };
    },
    run: async (ctx, id) => { const { doc, x } = await signer(ctx, id); await resendCore(ctx, doc._id, x.signerKey, "heston"); return { reminded: x.name }; },
  },
  // Review (M3): a version's description shows on share links and in "new cut ready" emails, so it waits too.
  "version.describe": {
    preview: async (ctx, id, payload) => {
      const vid = ctx.db.normalizeId("versions", id);
      const ver = vid ? await ctx.db.get(vid) : null;
      const video = ver ? await ctx.db.get(ver.videoId) : null;
      if (!ver || !video) throw new ConvexError("That version isn't here.");
      return {
        title: `Change what v${ver.number} of “${clip(video.title, 100)}” says changed`,
        open: `/v/${video._id}`,
        lines: [
          { label: "Now", value: ver.description ? body(ver.description, 2000) : "(nothing)" },
          { label: "New", value: body((payload ?? "").trim().slice(0, 2000), 2000) || "(nothing)" },
          { label: "Shows", value: "On share links to this video, and in the next “new cut” emails" },
        ],
      };
    },
    run: async (ctx, id, payload) => {
      const vid = ctx.db.normalizeId("versions", id);
      const ver = vid ? await ctx.db.get(vid) : null;
      if (!ver) throw new ConvexError("That version isn't here.");
      const text = (payload ?? "").trim().slice(0, 2000);
      await ctx.db.patch(ver._id, { description: text || undefined });
      return { version: ver.number, description: text || null };
    },
  },
};

const hashOf = (p: Preview) => sha256Hex(JSON.stringify(p.bind === undefined ? [p.title, p.lines] : [p.title, p.lines, p.bind]));

// 8c review L2 / re-review N2: confirmed and handed to the page. It must start within 2 minutes (claim) or it ran out
// and nothing went; started but never reported back after 15 minutes, it's "unknown" (check the site).
export const CLAIM_MS = 2 * 60_000;
export const REPORT_MS = 15 * 60_000;
const status = (r: { status: string; expiresAt: number; doneAt?: number; claimedAt?: number }, now = Date.now()) =>
  r.status === "waiting" && r.expiresAt <= now ? "expired"
  : r.status === "running" && !r.claimedAt && (r.doneAt ?? 0) < now - CLAIM_MS ? "expired"
  : r.status === "running" && r.claimedAt && r.claimedAt < now - REPORT_MS ? "unknown" : r.status;

/** The connector: make a request (nothing happens yet). The same kind and record already waiting is renewed. */
export const request = internalMutation({
  args: { kind: v.string(), targetId: v.string(), said: v.string(), payload: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const k = KINDS[a.kind];
    if (!k) throw new ConvexError("That can't be asked for.");
    const said = clip(a.said, 500);
    if (said.length < 3) throw new ConvexError("Ask Heston first, and pass his words in `said`.");
    if (a.payload !== undefined && a.payload.length > (a.kind === "site" ? 200_000 : 4000)) throw new ConvexError("That's too much to ask for in one go.");
    const payload = a.payload;
    const p = await k.preview(ctx, a.targetId, payload);
    const hash = await hashOf(p);
    const now = Date.now();
    const waiting = (await ctx.db.query("pendingActions").withIndex("by_status", (q) => q.eq("status", "waiting")).collect()).filter((r) => r.expiresAt > now);
    const same = waiting.find((r) => r.kind === a.kind && r.targetId === a.targetId);
    let id: Id<"pendingActions">;
    if (same && same.hash === hash) { id = same._id; await ctx.db.patch(id, { said, requestedAt: now, expiresAt: now + CONFIRM_MS }); }
    else {
      // Re-review M-1: different content is a new request with its own link; the old one stops working.
      if (same) await ctx.db.patch(same._id, { status: "replaced", doneAt: now });
      if (waiting.length >= MAX_WAITING) throw new ConvexError(`Heston already has ${MAX_WAITING} requests waiting. Ask him to go through them first (they're on his Dashboard).`);
      id = await ctx.db.insert("pendingActions", { kind: a.kind, targetId: a.targetId, summary: p.title, said, payload, hash, status: "waiting", requestedAt: now, expiresAt: now + CONFIRM_MS });
    }
    await audit(ctx, { kind: "claude", text: `asked Heston to confirm: ${p.title}`, where: "Claude connector", link: `/confirm/${id}`, by: { name: "Claude", role: "Connector" } });
    return { request_id: id, summary: p.title, what_goes_out: p.lines, confirm_at: `${SITE()}/confirm/${id}`, expires_in_hours: HOURS };
  },
});

/** The connector: has Heston confirmed it yet? */
export const statusOf = internalMutation({
  args: { requestId: v.string() },
  handler: async (ctx, a) => {
    const id = ctx.db.normalizeId("pendingActions", a.requestId);
    const r = id ? await ctx.db.get(id) : null;
    if (!r) throw new ConvexError("That request isn't here.");
    return { request_id: r._id, summary: r.summary, status: status(r), requested_at: new Date(r.requestedAt).toISOString(), ...(r.error ? { error: r.error } : {}) };
  },
});

/** The Confirm page: the request, and what goes out read live now (with whether it still matches the ask). Owner only. */
export const get = query({
  args: { id: v.string() },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const id = ctx.db.normalizeId("pendingActions", a.id);
    const r = id ? await ctx.db.get(id) : null;
    if (!r) return null;
    const base = { claimed: !!r.claimedAt, _id: r._id, kind: r.kind, summary: r.summary, said: r.said, requestedAt: r.requestedAt, expiresAt: r.expiresAt, doneAt: r.doneAt ?? null, status: status(r) };
    if (base.status !== "waiting") return { ...base, preview: null, hash: null, changed: false, problem: null };
    const k = KINDS[r.kind];
    if (!k) return { ...base, preview: null, hash: null, changed: false, problem: "This can't be done here." };
    try {
      const p = await k.preview(ctx, r.targetId, r.payload);
      const h = await hashOf(p);
      const { bind: _bind, ...shownPreview } = p; // review L6: only its hash, never the records themselves, goes to the page
      void _bind;
      return { ...base, preview: shownPreview, hash: h, changed: h !== r.hash, problem: null };
    } catch (e) {
      return { ...base, preview: null, hash: null, changed: false, problem: ((e as Error).message || "It can't be done now.").replace(/^.*ConvexError: /, "").split("\n")[0] };
    }
  },
});

/** The Dashboard's "Claude is waiting for your OK" rows. The owner only; anyone else gets none (the Dashboard asks). */
export const waiting = query({
  args: {},
  handler: async (ctx) => {
    if ((await viewerOf(ctx)).kind !== "owner") return [];
    const now = Date.now();
    const asks = (await ctx.db.query("pendingActions").withIndex("by_status", (q) => q.eq("status", "waiting")).order("desc").take(50))
      .filter((r) => r.expiresAt > now).map((r) => ({ _id: r._id, summary: r.summary, requestedAt: r.requestedAt, check: false }));
    // Re-review L-f: a confirmed send that never reported back: Heston checks it went out.
    const unknown = (await ctx.db.query("pendingActions").withIndex("by_status", (q) => q.eq("status", "running").gt("requestedAt", now - 2 * CONFIRM_MS)).take(50))
      .filter((r) => status(r, now) === "unknown").map((r) => ({ _id: r._id, summary: r.summary, requestedAt: r.requestedAt, check: true }));
    return [...unknown, ...asks];
  },
});

/** Confirm: the owner, signed in on the site. Runs it the same way the site's own button does, only if what goes out
 *  is still exactly what was asked. */
export const confirm = mutation({
  // `hash`: the content the page showed (re-review M-1): a click that lands as the page changes confirms nothing.
  args: { id: v.string(), hash: v.string() },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const id = ctx.db.normalizeId("pendingActions", a.id);
    const r = id ? await ctx.db.get(id) : null;
    if (!r) throw new ConvexError("That request isn't here.");
    if (r.status !== "waiting") throw new ConvexError(r.status === "done" ? "That's already done." : r.status === "running" ? "That's already been confirmed." : "That request was cancelled.");
    if (r.expiresAt <= Date.now()) throw new ConvexError("That request ran out. Ask Claude again.");
    const k = KINDS[r.kind];
    if (!k) throw new ConvexError("That can't be done here.");
    const p = await k.preview(ctx, r.targetId, r.payload); // throws when it can't be done any more
    const live = await hashOf(p);
    if (live !== r.hash) throw new ConvexError("It changed since Claude asked. Check it, then ask Claude again (or do it yourself).");
    if (a.hash !== live) throw new ConvexError("It changed while you were looking. Check it again, then confirm.");
    const result = await k.run(ctx, r.targetId, r.payload); // throws (and changes nothing) when it can't be done
    const onPage = "runOnPage" in result; // re-review N2: the page now calls runConfirmed, which claims it within 2 minutes
    await ctx.db.patch(r._id, onPage ? { status: "running", doneAt: Date.now() } : { status: "done", doneAt: Date.now() }); // running: doneAt is when it was confirmed
    const siteMode = r.kind === "site" ? ACTIONS[siteAction(r.targetId)]?.mode : undefined;
    // Second re-review L4: a Stripe send isn't "sent" until it starts and goes (claim / settle say how it went).
    await audit(ctx, { kind: onPage ? "claude" : siteMode === "delete" || r.kind.endsWith(".delete") ? "deleted" : siteMode === "ask" || r.kind.endsWith(".send") || r.kind.endsWith(".remind") ? "sent" : "claude", text: `confirmed Claude's request: ${r.summary}${onPage ? " (starting from the Confirm page)" : ""}`, where: "Claude connector", link: `/confirm/${r._id}` });
    return { ok: true, ...result };
  },
});

/** Phase 8c (re-review N2): a confirmed Stripe send starts here, on the server, signed in as the owner who confirmed it:
 *  only within 2 minutes of Confirm, only once, and only if what goes out is still exactly what Heston saw. A page
 *  that wakes up late, or a replayed call, gets nothing. */
export const claim = internalMutation({
  args: { id: v.string() },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const id = ctx.db.normalizeId("pendingActions", a.id);
    const r = id ? await ctx.db.get(id) : null;
    if (!r || r.kind !== "site") throw new ConvexError("That request isn't here.");
    if (r.status !== "running" || r.claimedAt) throw new ConvexError(r.status === "running" ? "That's already going out." : "That isn't waiting to go out.");
    const { act, action: name, args } = siteParts(r.targetId, r.payload);
    if (!act.onPage) throw new ConvexError("That can't be run here.");
    if ((r.doneAt ?? 0) < Date.now() - CLAIM_MS) throw new ConvexError("It's been too long since you confirmed it, so nothing was sent. Ask Claude again.");
    const live = await hashOf(await KINDS.site.preview(ctx, r.targetId, r.payload));
    if (live !== r.hash) throw new ConvexError("It changed since you confirmed it, so nothing was sent. Ask Claude again.");
    // Second re-review L5: a one-time ticket says how it went, even if the session ends while it's sending.
    const ticket = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
    await ctx.db.patch(r._id, { claimedAt: Date.now(), ticket: await sha256Hex(ticket) });
    return { action: name, args, ticket };
  },
});
/** A start that was refused (too late, changed, gone): nothing went, and Activity says so. */
export const noStart = internalMutation({
  args: { id: v.string(), why: v.string() },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const id = ctx.db.normalizeId("pendingActions", a.id);
    const r = id ? await ctx.db.get(id) : null;
    if (!r || r.status !== "running" || r.claimedAt) return null;
    await ctx.db.patch(r._id, { status: "failed", doneAt: Date.now(), error: clip(a.why, 300) });
    await audit(ctx, { kind: "claude", text: `Claude's confirmed request didn't start, so nothing was sent: ${r.summary}`, where: "Claude connector", link: `/confirm/${r._id}` });
    return null;
  },
});
export const settle = internalMutation({
  args: { id: v.string(), ticket: v.string(), ok: v.boolean(), error: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const id = ctx.db.normalizeId("pendingActions", a.id);
    const r = id ? await ctx.db.get(id) : null;
    if (!r || r.status !== "running" || !r.claimedAt || !r.ticket || r.ticket !== (await sha256Hex(a.ticket))) return null;
    await ctx.db.patch(r._id, { status: a.ok ? "done" : "failed", doneAt: Date.now(), ticket: undefined, ...(a.ok ? {} : { error: clip(a.error ?? "It didn't go through.", 300) }) });
    await audit(ctx, { kind: a.ok ? "sent" : "claude", text: a.ok ? `sent Claude's confirmed request: ${r.summary}` : `Claude's confirmed request didn't go through: ${r.summary}`, where: "Claude connector", link: `/confirm/${r._id}`, by: { name: "Heston (confirmed)", role: "Owner" } });
    return null;
  },
});
/** The Confirm page calls this right after Confirm: it runs the site's own Stripe action (sending an invoice or a
 *  quote), as Heston, exactly as its button on the site would, and records how it went. */
export const runConfirmed = action({
  args: { id: v.string() },
  handler: async (ctx, a): Promise<{ done: boolean; error?: string; link?: string | null }> => {
    const msg = (e: unknown) => ((e as Error).message || "It didn't go through.").replace(/^.*ConvexError: /, "").split("\n")[0];
    let c: { action: string; args: Record<string, unknown>; ticket: string };
    try { c = await ctx.runMutation(internal.confirm.claim, { id: a.id }); } catch (e) {
      await ctx.runMutation(internal.confirm.noStart, { id: a.id, why: msg(e) }).catch(() => null);
      throw e;
    }
    const act = ACTIONS[c.action]!;
    let out: { failed?: string[]; held?: boolean; link?: string | null } | null;
    try { out = await act.fn._handler(ctx, c.args) as typeof out; } catch (e) {
      await ctx.runMutation(internal.confirm.settle, { id: a.id, ticket: c.ticket, ok: false, error: msg(e) }).catch(() => null);
      throw e;
    }
    const missed = out?.failed?.length ? `It didn't reach ${out.failed.join(", ")}.` : out?.held ? "The email was held (the preview doesn't send)." : null;
    await ctx.runMutation(internal.confirm.settle, { id: a.id, ticket: c.ticket, ok: !missed, ...(missed ? { error: missed } : {}) }).catch(() => null);
    return { done: !missed, ...(missed ? { error: missed } : {}), link: out?.link ?? null };
  },
});

export const cancel = mutation({
  args: { id: v.string() },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const id = ctx.db.normalizeId("pendingActions", a.id);
    const r = id ? await ctx.db.get(id) : null;
    if (!r) throw new ConvexError("That request isn't here.");
    if (r.status === "waiting") {
      await ctx.db.patch(r._id, { status: "cancelled", doneAt: Date.now() });
      await audit(ctx, { kind: "claude", text: `said no to Claude's request: ${r.summary}`, where: "Claude connector", link: `/confirm/${r._id}` });
    }
    return null;
  },
});
