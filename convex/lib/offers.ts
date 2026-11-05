// D149 (Heston, Nov 3–4; Design Log "Phase 3b (addition: proposals and quotes to anyone)", approved 13:16; built
// Nov 4): a quote or proposal can go to anyone. The pieces both share:
//   - To: one or more addresses, comma-separated; each gets their own link (offerRecipients), so opens and Accept are
//     named per person (Q97). A Name only with one address (Q98, Q102).
//   - Copy link: one link for anyone who has it (linkToken); its Accept asks for name, email and company (Q100).
//   - One person accepting closes every other link: "Already accepted on {date}", never who (Q99, Q103).
//   - One of several declining is recorded for them; it shows Declined only once everyone emailed has declined (Nov 4).
//   - Whoever accepts becomes the contact; someone who isn't a client becomes a quiet lead (Clients, not on the board).
//   - Stop one person's link; make a new copied link (Nov 4).
// A quote or proposal sent before D149 keeps its one link (the doc's own token), named for its contact.
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { randomToken } from "./hash";
import { bump } from "./rate";

export type Kind = "quote" | "proposal";
type Offer = Doc<"quotes"> | Doc<"proposals">;
type Row = Doc<"offerRecipients">;
export const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
const EMAIL = /^[^\s@<>,;"']+@[^\s@<>,;"']+\.[^\s@<>,;"']{2,}$/;
export const MAX_TO = 25;
const RESEND_GAP = 10 * 60_000;
const OPENISH = new Set(["draft", "waiting", "ready"]); // not yet sent (proposals have waiting and ready too)

const clean = (s: string | undefined | null, max = 120) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** To and Name from the Send dialog: addresses separated by commas; the name only when there's one (Q102). */
export function parseTo(to: string, name?: string): Array<{ email: string; name?: string }> {
  const parts = to.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
  const out: Array<{ email: string; name?: string }> = [];
  for (const p of parts) {
    const m = /<([^<>]+)>\s*$/.exec(p); // "Priya Rao <priya@x.com>" is fine too
    const email = (m ? m[1] : p).trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 254) throw new ConvexError(`“${p.slice(0, 60)}” isn't an email address.`);
    if (!out.some((x) => x.email === email)) out.push({ email });
  }
  if (out.length > MAX_TO) throw new ConvexError(`Up to ${MAX_TO} people at a time.`);
  const n = clean(name);
  if (out.length === 1 && n) out[0].name = n;
  return out;
}

export const rowsOf = (ctx: QueryCtx, kind: Kind, id: Id<"quotes"> | Id<"proposals">) =>
  kind === "quote" ? ctx.db.query("offerRecipients").withIndex("by_quote", (q) => q.eq("quoteId", id as Id<"quotes">)).collect()
    : ctx.db.query("offerRecipients").withIndex("by_proposal", (q) => q.eq("proposalId", id as Id<"proposals">)).collect();

/** Adds each person (their own link). Someone already on it keeps their link and is emailed again, but not twice in
 *  10 minutes; a stopped link someone is sent again starts working again. At most 200 emails an hour per business. */
export async function addPeople(ctx: MutationCtx, kind: Kind, doc: Offer, list: Array<{ email: string; name?: string }>, now: number) {
  const have = await rowsOf(ctx, kind, doc._id);
  const sends: Array<{ rowId: Id<"offerRecipients">; email: string; name: string | null; token: string }> = [];
  if (have.length + list.filter((t) => !have.some((r) => r.email === t.email)).length > 200) throw new ConvexError("That's a lot of people for one. Make a copy for the rest.");
  for (const t of list) {
    const old = have.find((r) => r.email === t.email);
    if (old && !old.stoppedAt && old.sentAt > now - RESEND_GAP) continue;
    await bump(ctx, "offerSend", String(doc.businessId ?? "default"));
    if (old) {
      // L1 (review): a stopped link stays stopped. Sending to that person again gives them a new link.
      const token = old.stoppedAt ? randomToken(18) : old.token;
      await ctx.db.patch(old._id, { sentAt: now, stoppedAt: undefined, token, ...(t.name && !old.name ? { name: t.name } : {}) });
      sends.push({ rowId: old._id, email: old.email, name: old.name ?? t.name ?? null, token });
      continue;
    }
    const token = randomToken(18);
    const rowId = await ctx.db.insert("offerRecipients", { ...(kind === "quote" ? { quoteId: doc._id as Id<"quotes"> } : { proposalId: doc._id as Id<"proposals"> }), email: t.email, ...(t.name ? { name: t.name } : {}), token, sentAt: now, opens: 0 });
    sends.push({ rowId, email: t.email, name: t.name ?? null, token });
  }
  return sends;
}

/** M1/M2 (review): the first time D149 sends to more people or copies a link for one sent before D149, its contact
 *  moves onto a person row with the same link (their opens and answer come too), so they show on the owner's card,
 *  can be stopped, and one accept closes every link. Returns the doc as it now is. */
export async function adoptLegacy<T extends Offer>(ctx: MutationCtx, kind: Kind, doc: T): Promise<T> {
  if (!doc.token || !doc.contact || doc.status === "draft") return doc;
  const have = await rowsOf(ctx, kind, doc._id);
  if (!have.some((r) => r.token === doc.token)) {
    const resp = doc.response && doc.response.via !== "link" ? { ...doc.response, via: "email" as const } : undefined;
    await ctx.db.insert("offerRecipients", { ...(kind === "quote" ? { quoteId: doc._id as Id<"quotes"> } : { proposalId: doc._id as Id<"proposals"> }),
      email: doc.contact.email.toLowerCase(), name: doc.contact.name, token: doc.token, sentAt: doc.sentAt ?? doc.updatedAt ?? Date.now(),
      ...(doc.viewedAt ? { openedAt: doc.viewedAt } : {}), opens: doc.viewedAt ? 1 : 0, ...(resp ? { response: resp } : {}) });
  }
  await ctx.db.patch(doc._id, { token: undefined } as never);
  return (await ctx.db.get(doc._id)) as T;
}

export type Found = { doc: Offer; r: Row | null; via: "legacy" | "email" | "link" };

/** A link's quote or proposal: a person's own (not stopped), the copied link, or one sent before D149. Never a draft. */
export async function resolve(ctx: QueryCtx | MutationCtx, kind: Kind, token: string): Promise<Found | null> {
  if (!TOKEN.test(token)) return null;
  const table = kind === "quote" ? "quotes" : "proposals";
  const sent = (d: Offer | null) => (d && !OPENISH.has(d.status) ? d : null);
  const legacy = sent(await ctx.db.query(table).withIndex("by_token", (x) => x.eq("token", token)).first() as Offer | null);
  if (legacy && legacy.contact) return { doc: legacy, r: null, via: "legacy" };
  const r = await ctx.db.query("offerRecipients").withIndex("by_token", (x) => x.eq("token", token)).first();
  if (r) {
    if (r.stoppedAt) return null;
    const d = sent(await ctx.db.get((kind === "quote" ? r.quoteId : r.proposalId) as Id<"quotes">) as Offer | null);
    return d ? { doc: d, r, via: "email" } : null;
  }
  const l = sent(await ctx.db.query(table).withIndex("by_link_token", (x) => x.eq("linkToken", token)).first() as Offer | null);
  return l ? { doc: l, r: null, via: "link" } : null;
}

/** Who this page is for, as that viewer sees it (never anyone else, Q103). */
export function forWho(f: Found): { name: string | null; company: string | null; anyone: boolean } {
  if (f.via === "legacy") return { name: f.doc.contact?.name ?? null, company: f.doc.contact?.company ?? null, anyone: false };
  if (f.via === "email") { // the client's own link shows their company; anyone else's shows only their own name
    const mine = !!f.doc.contact && f.r!.email === f.doc.contact.email && f.doc.status !== "accepted";
    return { name: f.r!.name ?? (mine ? f.doc.contact!.name : f.r!.email), company: mine ? f.doc.contact!.company ?? null : null, anyone: false }; // their own address at most
  }
  return { name: null, company: null, anyone: true };
}

/** The page's answer state for this viewer: Open, their own answer, or "Already accepted on {date}" (no name). */
export function stateFor(f: Found) {
  const d = f.doc, mine = f.via === "email" ? f.r!.response ?? null : f.via === "legacy" ? d.response ?? null : null;
  if (d.status === "accepted" && d.response) {
    const byMe = f.via === "legacy" || (f.via === "email" && f.r!.response?.kind === "accepted");
    return byMe ? { kind: "accepted_by_you" as const, at: d.response.at, name: d.response.name } : { kind: "already_accepted" as const, at: d.response.at, name: null };
  }
  if (mine?.kind === "declined") return { kind: "declined_by_you" as const, at: mine.at, name: mine.name };
  if (d.status === "declined") return { kind: "declined" as const, at: d.response?.at ?? 0, name: null };
  return null;
}

/** The page opened: counted for its person, for the copied link, or (before D149) the doc. The owner looking isn't. */
export async function noteOpen(ctx: MutationCtx, f: Found) {
  if ((ctx as unknown as { scope?: { isOwner: boolean } | null }).scope?.isOwner) return;
  const now = Date.now(), d = f.doc;
  if (f.via === "email") {
    try { await bump(ctx, "offerLink", `open:${f.r!.token}`); } catch { return; }
    await ctx.db.patch(f.r!._id, { opens: f.r!.opens + 1, ...(f.r!.openedAt ? {} : { openedAt: now }) });
    if (!f.r!.openedAt) await ctx.db.patch(d._id, { ...(d.viewedAt ? {} : { viewedAt: now }), history: [...d.history, { kind: "viewed", at: now, detail: f.r!.name || f.r!.email }].slice(-60) } as never);
  } else if (f.via === "link") {
    try { await bump(ctx, "offerLink", `open:${d.linkToken}`); } catch { return; }
    await ctx.db.patch(d._id, { linkOpens: Math.min((d.linkOpens ?? 0) + 1, 1_000_000), ...(d.viewedAt ? {} : { viewedAt: now }) } as never);
  } else if (!d.viewedAt && d.status === "sent") {
    await ctx.db.patch(d._id, { viewedAt: now, history: [...d.history, { kind: "viewed", at: now, detail: d.contact?.name }].slice(-60) } as never);
  }
}

type Answer = { kind: "accepted" | "declined"; name: string; email?: string; company?: string; reason?: string; ip?: string; userAgent?: string };

/** Accept or decline through a link. The caller checks the doc is open (not expired or withdrawn). Returns who to tell
 *  the owner about, or an error for the page. */
export async function answer(ctx: MutationCtx, kind: Kind, f: Found, a: Answer, closed: string | null): Promise<{ error: string } | { ok: true; status: string; tell: { key: string; kind: "accepted" | "declined"; who: string; company: string | null; reason: string | null; at: number } }> {
  const d = f.doc, now = Date.now(), thing = kind === "quote" ? "quote" : "proposal";
  if (d.status === "accepted") return { error: `This ${thing} was already accepted.` };
  if (f.via === "email" && f.r!.response) return { error: `You already ${f.r!.response.kind} this ${thing}.` };
  if (closed) return { error: closed };
  if (d.status !== "sent") return { error: `This ${thing} was already ${d.status}.` };
  await bump(ctx, "offerAnswer", `${f.r?.token ?? d.linkToken ?? d.token}`); // M3: at most 20 tries an hour per link
  // M5 (review): a typed name or company lands in contracts, invoices and emails, so no braces (template markers),
  // angle brackets or control characters.
  const plain = (s?: string) => clean((s ?? "").replace(/[{}<>\u0000-\u001f\u007f]/g, " "));
  const name = plain(a.name), company = plain(a.company) || undefined;
  let email = f.via === "email" ? f.r!.email : f.via === "legacy" ? d.contact!.email : clean(a.email, 254).toLowerCase();
  if (a.kind === "accepted") {
    if (name.length < 2) return { error: "Type your full name to accept." };
    if (f.via === "link" && (!EMAIL.test(email) || email.length > 254)) return { error: "Type your email, so they can send the next steps." };
  } else if (f.via === "link" && email && !EMAIL.test(email)) email = "";
  const who = name || f.r?.name || (f.via === "legacy" ? d.contact!.name : "") || email || "Someone with the link";
  const response = { kind: a.kind, name: who.slice(0, 120), ...(email ? { email } : {}), ...(company ? { company } : {}), at: now, via: f.via === "link" ? "link" as const : "email" as const,
    ...(a.reason?.trim() ? { reason: a.reason.trim().slice(0, 1000) } : {}), ...(a.ip ? { ip: a.ip } : {}), ...(a.userAgent ? { userAgent: a.userAgent.slice(0, 300) } : {}) };
  const hist = (k: string, detail: string) => [...d.history, { kind: k, at: now, detail }].slice(-60);
  if (f.r) await ctx.db.patch(f.r._id, { response, ...(f.r.openedAt ? {} : { openedAt: now }) });
  if (a.kind === "accepted") {
    // Q100: whoever accepted is the other party now; someone who isn't a client becomes a quiet lead (Nov 4).
    const contact = { name: response.name, email: email || d.contact?.email || "", ...(company ? { company } : d.contact?.company && f.via !== "link" ? { company: d.contact.company } : {}) };
    let dealId = d.dealId;
    if (!d.clientId && !d.dealId) {
      // H1 (review): stamp the quote's own business. The link pages run with no identity, where an unstamped insert
      // would land in the default business.
      dealId = await ctx.db.insert("deals", { ...(d.businessId ? { businessId: d.businessId } : {}), title: (d as { title?: string }).title?.slice(0, 160) || `Accepted ${thing}`, ...(contact.email ? { contactEmail: contact.email } : {}), stage: "lead", source: "accepted", quiet: true,
        lead: { name: contact.name, email: contact.email, ...(company ? { company } : {}), fields: [], at: now }, history: [{ kind: "created", at: now, detail: `accepted ${thing} ${d.number}` }], createdAt: now, updatedAt: now });
    }
    await ctx.db.patch(d._id, { status: "accepted", response, contact, ...(dealId ? { dealId } : {}), updatedAt: now, history: hist("accepted", `${response.name}${company ? `, for ${company}` : ""}`) } as never);
  } else {
    // Declined: closes only once every person it was emailed to has declined (a copied link never closes it).
    const rows = (await rowsOf(ctx, kind, d._id)).filter((r) => !r.stoppedAt).map((r) => (f.r && r._id === f.r._id ? { ...r, response } : r));
    const all = f.via === "legacy" || (f.via === "email" && rows.length > 0 && rows.every((r) => r.response?.kind === "declined"));
    // M3 (review): declines on the copied link can't fill the history. The first one is written; later ones aren't.
    const LINK_DECLINE = " (copied link)";
    const repeat = f.via === "link" && d.history.some((h) => h.kind === "declined" && (h as { detail?: string }).detail?.endsWith(LINK_DECLINE));
    await ctx.db.patch(d._id, { ...(all ? { status: "declined", response } : {}), updatedAt: now, ...(repeat ? {} : { history: hist("declined", `${response.name}${f.via === "link" ? LINK_DECLINE : ""}`) }) } as never);
  }
  // M3: the owner hears about copied-link declines at most once an hour per link.
  const key = `${thing}-${a.kind}:${d._id}:${f.r?._id ?? (f.via === "link" ? `link:${d.linkToken}:${Math.floor(now / 3_600_000)}` : "legacy")}`;
  return { ok: true, status: a.kind === "accepted" ? "accepted" : (await ctx.db.get(d._id))!.status, tell: { key, kind: a.kind, who: response.name, company: company ?? (f.via === "legacy" ? d.contact?.company ?? null : null), reason: response.reason ?? null, at: now } };
}

/** For the owner's "Opened and accepted" card: everyone with a link, and the copied link. */
export async function peopleOf(ctx: QueryCtx, kind: Kind, d: Offer) {
  const rows = (await rowsOf(ctx, kind, d._id)).sort((a, b) => a.sentAt - b.sentAt);
  const people = rows.map((r) => ({ _id: r._id as string, name: r.name ?? null, email: r.email, openedAt: r.openedAt ?? null, opens: r.opens, stopped: !!r.stoppedAt,
    response: r.response ? { kind: r.response.kind, at: r.response.at, name: r.response.name, company: r.response.company ?? null } : null }));
  if (d.token && d.contact && !rows.length) people.push({ _id: `legacy:${d._id}`, name: d.contact.name, email: d.contact.email, openedAt: d.viewedAt ?? null, opens: d.viewedAt ? 1 : 0, stopped: false,
    response: d.response ? { kind: d.response.kind, at: d.response.at, name: d.response.name, company: d.response.company ?? null } : null });
  const linkAnswer = d.response?.via === "link" ? { kind: d.response.kind, at: d.response.at, name: d.response.name, email: d.response.email ?? null, company: d.response.company ?? null } : null;
  return { people, link: { copied: !!d.linkToken, opens: d.linkOpens ?? 0, answer: linkAnswer } };
}

/** Owner: stop one person's link (Nov 4). */
export async function stopPerson(ctx: MutationCtx, kind: Kind, d: Offer, rowId: Id<"offerRecipients">, by: string) {
  const r = await ctx.db.get(rowId);
  if (!r || (kind === "quote" ? r.quoteId : r.proposalId) !== d._id) throw new ConvexError("That person isn't on it.");
  if (r.stoppedAt) return;
  // L3 (review): only while it's open, and never the link someone accepted on (their page shows what they accepted).
  if (r.response?.kind === "accepted") throw new ConvexError("They accepted on that link, so it stays.");
  if (d.status !== "sent") throw new ConvexError(`Links can only be stopped while it's open.`);
  const now = Date.now();
  await ctx.db.patch(r._id, { stoppedAt: now });
  await ctx.db.patch(d._id, { updatedAt: now, history: [...d.history, { kind: "link_stopped", at: now, by, detail: r.email }].slice(-60) } as never);
}

/** Owner: a new copied link; the old one stops working (Nov 4). */
export async function newCopiedLink(ctx: MutationCtx, d: Offer, by: string) {
  if (!d.linkToken) throw new ConvexError("There's no copied link yet. Use Copy link.");
  if (d.status !== "sent") throw new ConvexError("A new copied link can only be made while it's open."); // L3
  const now = Date.now();
  const linkToken = randomToken(18);
  await ctx.db.patch(d._id, { linkToken, linkOpens: 0, updatedAt: now, history: [...d.history, { kind: "link_replaced", at: now, by }].slice(-60) } as never);
  return linkToken;
}
