// Phase 8b (Heston, Nov 18, D208): what the connector can do on the site, one line per site function it may run as the
// business owner. Each is one of:
//   read    answers, changes nothing
//   change  done directly (Activity says "Claude"); if the run would send anything to anyone it's undone, and Claude
//           is told to ask (siteGuard.ts)
//   ask     always a request Heston confirms on the site: it reaches someone even when no email goes (a shoot on the
//           client's portal, a link opened to anyone, a booking offered)
//   delete  always a request Heston confirms
// Not here on purpose: signing (releases are signed in person, contracts through Sign's own tools), money (8c), W-9s and
// tax details, moving work to another client (Heston does that on the site), and the client's, vendor's and guest's own
// pages. 8c and 8d add the rest of the site to this same list.
import * as library from "../library";
import * as projects from "../projects";
import * as homes from "../homes";
import * as production from "../production";
import * as shoots from "../shoots";
import * as shootPage from "../shootPage";
import * as callSheets from "../callSheets";
import * as shotLists from "../shotLists";
import * as releases from "../releases";
import * as gear from "../gear";
import * as packing from "../packing";
import * as places from "../places";
import * as vendors from "../vendors";
import * as bookings from "../bookings";
import * as briefings from "../briefings";
import * as work from "../work";
import * as creative from "../creative";
import * as canvas from "../canvas";
import * as delivery from "../delivery";
import * as invoices from "../invoices";
import * as invoiceReminders from "../invoiceReminders";
import * as quotes from "../quotes";
import * as proposals from "../proposals";
import * as plans from "../plans";
import * as subscriptions from "../subscriptions";
import * as payments from "../payments";
import * as vendorPayments from "../vendorPayments";
import * as vendorPayouts from "../vendorPayouts";
import * as crm from "../crm";
import * as reports from "../reports";
import * as footage from "../footage";
import * as business from "../business";
import * as brandKit from "../brandKit";
import * as calendarMod from "../calendar";
import * as clients from "../clients";
import * as messages from "../messages";
import * as calls from "../calls";
import * as testimonials from "../testimonials";
import * as briefs from "../briefs";
import * as fileRequests from "../fileRequests";
import * as shares from "../shares";
import * as notifications from "../notifications";
import * as bell from "../bell";
import * as prefs from "../prefs";
import * as team from "../team";
import * as help from "../help";
import * as siteWatch from "../siteWatch";
import * as home from "../home";
import * as overviews from "../overviews";
import * as activity from "../activity";
import * as auditLog from "../auditLog";
import * as pageText from "../pageText";
import { parseTo } from "./offers";
import { KICKOFF_BRIEF } from "./kickoff";
import { briefingHeadings } from "./wsBriefing";
import { pageOf } from "./wsBuilder";
import { portalPeople } from "../projects";
import type { Questionnaire } from "./questionnaire";
import { quoteTotals } from "../quotes";
import type { QueryCtx } from "../_generated/server";
import { ConvexError } from "convex/values";

export type Mode = "read" | "change" | "ask" | "delete";
export type Area = "projects" | "production" | "crew" | "work" | "creative" | "delivery" | "money" | "sales" | "clients" | "settings" | "home";
/** A registered Convex function, as the runtime keeps it. */
export type SiteFn = { _handler: (ctx: unknown, args: unknown) => Promise<unknown>; exportArgs: () => string; isQuery?: boolean; isMutation?: boolean; isAction?: boolean };
type Args = Record<string, unknown>;
export type Entry = {
  mode: Mode; area: Area; does: string; fn: SiteFn;
  /** For a change: when these arguments make it reach someone, it's an ask (the reason, shown to Claude). */
  askWhen?: (a: Args) => string | null;
  /** For a change: when the record as it is now makes it reach someone (a shared board, a client's task), it's an ask. */
  outside?: (ctx: QueryCtx, a: Args) => Promise<string | null>;
  /** Fields of the answer that never leave (beyond the W-9, tax, bank and secret ones every answer drops). */
  hide?: string[];
  /** Never through the connector with these arguments (the reason). */
  refuse?: (a: Args) => string | null;
  /** Shown on the Confirm page: what this does beyond what's listed as sent. */
  note?: string;
  /** Phase 8c: a site function that talks to Stripe (an action). It can't be tried first or run by the connector: it
   *  runs from Heston's own Confirm page, signed in as him, exactly as his button on the site would. `shows` says what
   *  goes out (its Sends lines), read live and bound like everything else. */
  onPage?: boolean;
  /** More lines for the Confirm page, read live (which files a delivery releases, which tasks a template makes). */
  shows?: (ctx: QueryCtx, a: Args) => Promise<Array<{ label: string; value: string }>>;
};

const get = async (ctx: QueryCtx, table: string, id: unknown) => {
  if (typeof id !== "string") return null;
  const nid = ctx.db.normalizeId(table as never, id);
  return nid ? ((await ctx.db.get(nid)) as Record<string, any> | null) : null;
};
/** Review H3: a board with people on it or its view link on is seen outside the business. */
const sharedBoard = async (ctx: QueryCtx, a: Args) => {
  const c = await get(ctx, "canvases", a.canvasId);
  if (!c) return null;
  const people = await ctx.db.query("canvasPeople").withIndex("by_canvas", (q) => q.eq("canvasId", c._id as never)).first();
  return people || c.link?.on ? "This board is shared: what's saved on it shows to the people it's shared with at once." : null;
};
/** Review M4 (built as the build suggests, Heston to confirm): a task the client or a vendor sees is a message to them. */
/** A creative doc's name as Heston knows it: its build's title and kind. */
export const docName = async (ctx: QueryCtx, docId: unknown) => {
  const d = await get(ctx, "creativeDocs", docId);
  const b = d?.buildId ? await get(ctx, "wsBuilds", d.buildId) : null;
  return d ? `the ${String(d.kind ?? "creative")} doc “${String(b?.title ?? "Creative doc")}”` : "a doc that isn't here";
};
const tooMany = (n: number) => { if (n > 200) throw new ConvexError("That's too much to show on one page. Heston does this on the site."); };
/** Re-review High-1: what a save changes on a board, item by item (docs named), so nothing goes up unseen. */
const boardChanges = async (ctx: QueryCtx, a: Args) => {
  const c = await get(ctx, "canvases", a.canvasId);
  const before = new Map<string, Record<string, unknown>>((Array.isArray(c?.items) ? c!.items : []).map((i: Record<string, unknown>) => [String(i.id), i]));
  const after = (Array.isArray(a.items) ? a.items : []) as Array<Record<string, unknown>>;
  const what = async (i: Record<string, unknown>) => {
    const bits = [String(i.type ?? "item")];
    if (i.type === "doc") bits.push(await docName(ctx, i.docId));
    if (typeof i.text === "string" && i.text.trim()) bits.push(`“${i.text.trim().slice(0, 300)}”`);
    if (typeof i.url === "string") bits.push(i.url.slice(0, 300));
    return bits.join(": ");
  };
  const key = (i: Record<string, unknown>) => JSON.stringify([i.type, i.text ?? null, i.url ?? null, i.docId ?? null, i.fileId ?? null]);
  const lines: string[] = [];
  for (const i of after) {
    const was = before.get(String(i.id));
    if (!was) lines.push(`Adds ${await what(i)}`);
    else if (key(was) !== key(i)) lines.push(`Changes ${await what(i)}`);
  }
  const kept = new Set(after.map((i) => String(i.id)));
  for (const [id, i] of before) if (!kept.has(id)) lines.push(`Removes ${await what(i)}`);
  tooMany(lines.length);
  return [{ label: "On the board", value: lines.join("\n") || "Only moves and restyles what's there" }];
};
const theirTask = async (ctx: QueryCtx, a: Args) => {
  const t = await get(ctx, "tasks", a.taskId);
  return t && (t.audience === "client" || t.audience === "vendor" || t.vendorId) ? "This task shows in the client's or a vendor's portal, so changing it reaches them." : null;
};

const fn = (x: unknown) => x as SiteFn;
const r = (area: Area, f: unknown, does: string): Entry => ({ mode: "read", area, does, fn: fn(f) });
const c = (area: Area, f: unknown, does: string, more: Partial<Entry> = {}): Entry => ({ mode: "change", area, does, fn: fn(f), ...more });
const ask = (area: Area, f: unknown, does: string, note: string, more: Partial<Entry> = {}): Entry => ({ mode: "ask", area, does, fn: fn(f), note, ...more });
const del = (area: Area, f: unknown, does: string, note?: string): Entry => ({ mode: "delete", area, does, fn: fn(f), ...(note ? { note } : {}) });

const reaches = (a: Args) => a.audience === "client" || a.audience === "vendor" || (typeof a.vendorId === "string" && !!a.vendorId)
  ? "A task for the client or a vendor shows in their portal." : null;
const MOVE_CLIENT = "Moving a project to another client is done by Heston on the site.";


// ---------- Phase 8c: money ----------
const usd = (cents: unknown) => `$${(Number(cents ?? 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const linesOf = (ls: unknown) => (Array.isArray(ls) ? ls : []).map((l: Record<string, unknown>) => `${String(l.description ?? "")} · ${String(l.qty ?? 1)} × ${usd(l.unitCents)}`).join("\n");
/** What an invoice says, as the client will get it (8c review M2: its kind and project too, and what paying it does). */
const invoiceLines = async (ctx: QueryCtx, id: unknown) => {
  const i = await get(ctx, "invoices", id);
  if (!i) return [];
  const p = i.projectId ? await get(ctx, "projects", i.projectId) : null;
  return [
    { label: "Invoice", value: `${String(i.number ?? "Draft")} · ${String(i.title ?? "")}` },
    { label: "Kind", value: `${String(i.kind ?? "other")} invoice${p ? ` for the project ${String(p.name ?? "")}` : ""}` },
    ...(i.kind === "final" && p ? [{ label: "When paid", value: `Paid in full, it opens ${String(p.name ?? "the project")}'s final files to the client.` }] : []),
    { label: "Bill to", value: `${String(i.billTo?.name ?? "")}${i.billTo?.company ? ` (${i.billTo.company})` : ""} <${String(i.billTo?.email ?? "")}>` },
    { label: "Lines", value: linesOf(i.lines) || "None" },
    ...(i.discountCents ? [{ label: "Discount", value: usd(i.discountCents) }] : []),
    ...(i.taxPercent ? [{ label: "Tax", value: `${i.taxPercent}%` }] : []),
    { label: "Total", value: usd(i.totalCents) },
    { label: "Due", value: String(i.dueDate ?? "") },
    ...(i.memo ? [{ label: "Memo", value: String(i.memo) }] : []),
  ];
};
/** Who a quote's Send reaches, by the very rule quotes.markSent uses (8c review H1, M4), and what the email carries. */
const quoteLines = async (ctx: QueryCtx, a: Args) => {
  const q = await get(ctx, "quotes", a.quoteId);
  if (!q) return [];
  const legacy = a.resend === true && !!q.token && a.to === undefined && a.copyLink !== true;
  const list = legacy ? (q.contact?.email ? [{ email: String(q.contact.email), name: String(q.contact.name ?? "") }] : [])
    : a.to !== undefined ? parseTo(String(a.to), typeof a.name === "string" ? a.name : undefined)
    : a.copyLink !== true && q.contact?.email ? [{ email: String(q.contact.email), name: String(q.contact.name ?? "") }] : [];
  if (!list.length && a.copyLink !== true) throw new ConvexError("Add who it goes to (or copy its link): it can't be sent to no one.");
  // Re-review L-e: the name a person already on the quote has is the one the email greets.
  const rows = await ctx.db.query("offerRecipients").withIndex("by_quote", (qq) => qq.eq("quoteId", q._id as never)).collect();
  const people = list.map((x) => { const old = rows.find((r) => String(r.email).toLowerCase() === x.email.toLowerCase()); const n = old?.name ?? x.name; return `${n ? `${n} ` : ""}<${x.email}>`; });
  const sends = [
    ...(people.length ? [`Quote email with their own link to ${people.join(", ")}`] : []),
    ...(a.copyLink === true ? ["a link for Heston to copy and send himself"] : []),
  ];
  const t = Array.isArray(q.lines) && q.deposit ? quoteTotals({ lines: q.lines, discountCents: q.discountCents, taxPercent: q.taxPercent, deposit: q.deposit }) : null;
  return [
    { label: "Quote", value: `${String(q.number ?? "")} · ${String(q.title ?? "")}` },
    { label: "Lines", value: linesOf(q.lines) || "None" },
    ...(t?.discount ? [{ label: "Discount", value: usd(t.discount) }] : []),
    ...(t?.tax ? [{ label: "Tax", value: `${q.taxPercent}%: ${usd(t.tax)}` }] : []),
    { label: "Total", value: usd(t?.total ?? q.totalCents) },
    ...(t && q.deposit ? [{ label: "Deposit to book", value: `${q.deposit.kind === "percent" ? `${q.deposit.value}%: ` : ""}${usd(t.deposit)}` }] : []),
    ...(q.validUntil ? [{ label: "Valid until", value: String(q.validUntil) }] : []),
    ...(q.terms ? [{ label: "Terms (in the email and on the page)", value: String(q.terms) }] : []),
    { label: "Sends", value: sends.join("; and ") },
  ];
};
/** A vendor invoice, with whose and how much (8c review M7). */
const vendorInvoiceLines = async (ctx: QueryCtx, a: Args, tell: string) => {
  const vi = await get(ctx, "vendorInvoices", a.invoiceId);
  if (!vi) return [];
  const vd = vi.vendorId ? await get(ctx, "vendors", vi.vendorId) : null;
  const p = vi.projectId ? await get(ctx, "projects", vi.projectId) : null;
  return [
    { label: "Vendor", value: `${String(vd?.name ?? "A vendor")} <${String(vd?.email ?? "")}>` },
    { label: "Their invoice", value: `${String(vi.number ?? vi.title ?? "")}${p ? ` for ${String(p.name ?? "")}` : ""}` },
    { label: "Total", value: usd(vi.totalCents ?? vi.cents) },
    ...(typeof a.paidOn === "string" ? [{ label: "Paid on", value: `${a.paidOn} by ${String(a.method ?? "")}${a.reference ? ` (${String(a.reference)})` : ""}` }] : []),
    { label: "Sends", value: `${tell} to ${String(vd?.name ?? "the vendor")} <${String(vd?.email ?? "")}>` },
  ];
};

// ---------- Phase 8d: sending a proposal or briefing again (the first send makes its PDF in Heston's browser) ----------
const noFile = (a: Args) => (a.storageId !== undefined ? "A file can't be handed in here." : null);
const proposalSend = async (ctx: QueryCtx, a: Args) => {
  const p = await get(ctx, "proposals", a.proposalId);
  if (!p) return [];
  if (p.status !== "sent") throw new ConvexError("The first send makes the proposal's PDF in your browser: send it from the proposal's page on the site.");
  // 8d review M5: once it's out, the original message goes with it, and the links' expiry changes on its page.
  if (a.message !== undefined || a.move !== undefined || a.expiresInDays !== undefined) throw new ConvexError("Sending it again uses its original message; leave out message, move and expiresInDays.");
  const b = p.buildId ? await get(ctx, "wsBuilds", p.buildId) : null;
  const client = b?.fields?.client ?? {};
  const legacy = a.resend === true && !!p.token && a.to === undefined && a.copyLink !== true;
  const list = legacy ? (p.contact?.email ? [{ email: String(p.contact.email), name: String(p.contact.name ?? "") }] : [])
    : a.to !== undefined ? parseTo(String(a.to), typeof a.name === "string" ? a.name : undefined)
    : a.copyLink === true ? [] : client.email ? [{ email: String(client.email).trim().toLowerCase(), name: String(client.name ?? "") }] : [];
  if (!list.length && a.copyLink !== true) throw new ConvexError("Add who it goes to (or copy its link): it can't be sent to no one.");
  const rows = await ctx.db.query("offerRecipients").withIndex("by_proposal", (q) => q.eq("proposalId", p._id as never)).collect();
  const now = Date.now();
  const named = list.map((x) => { const old = rows.find((r) => String(r.email).toLowerCase() === x.email.toLowerCase()); const n = old?.name ?? x.name;
    return `${n ? `${n} ` : ""}<${x.email}>${old?.stoppedAt ? " (their link was stopped: they get a new one)" : old && now - Number(old.sentAt ?? 0) < 10 * 60_000 ? " (emailed in the last 10 minutes: skipped)" : ""}`; });
  const sends = [...(named.length ? [`Proposal email with their own link to ${named.join(", ")}`] : []), ...(a.copyLink === true ? ["a link for Heston to copy and send himself"] : [])];
  return [
    { label: "Proposal", value: `${String(p.number ?? "")} · ${String(b?.title ?? p.title ?? "")} (the copy already sent)` },
    ...(p.message ? [{ label: "Its message", value: String(p.message) }] : []),
    { label: "Sends", value: sends.join("; and ") },
  ];
};
const briefingSend = async (ctx: QueryCtx, a: Args) => {
  const br = await get(ctx, "briefings", a.briefingId);
  if (!br) return [];
  if (br.status === "draft" || !br.pdfId) throw new ConvexError("The first share makes the briefing's PDF in your browser: share it from the briefing's page on the site.");
  const b = br.buildId ? await get(ctx, "wsBuilds", br.buildId) : null;
  const to = Array.isArray(a.to) ? (a.to as Array<{ email?: string; name?: string; vendorId?: string }>) : [];
  const people: string[] = [];
  for (const t of to) { const vd = t.vendorId ? await get(ctx, "vendors", t.vendorId) : null; people.push(`${vd?.name ?? t.name ?? ""} <${String(vd?.email ?? t.email ?? "").toLowerCase()}>`.trim()); }
  if (!people.length && a.copyLink !== true) throw new ConvexError("Add who it goes to (or copy its link).");
  // 8d review M5: the email lists the live page's headings; they're shown (and so bound) here.
  const heads = b ? briefingHeadings(pageOf(b.blocks)).slice(0, 4) : [];
  return [
    { label: "Briefing", value: `${String(br.shown?.title ?? b?.title ?? "Briefing")} (the copy already shared)` },
    ...(heads.length ? [{ label: "The email lists", value: heads.join("\n") }] : []),
    ...(typeof a.note === "string" && a.note.trim() ? [{ label: "Note", value: a.note.trim() }] : []),
    { label: "Sends", value: [...(people.length ? [`Briefing email with their own link to ${people.join(", ")}`] : []), ...(a.copyLink === true ? ["a link for Heston to copy"] : [])].join("; and ") },
  ];
};


// ---------- 8d review ----------
/** H3: the kickoff brief's questions as they'll be sent (shown, and so bound: a change after Heston's OK is caught). */
const briefQuestions = async (ctx: QueryCtx) => {
  // This business's own (the Confirm page's caller is its owner; businesses aren't scoped, so it's named here).
  const biz = (ctx as unknown as { scope?: { owner?: string | null } }).scope?.owner;
  const b = biz ? await get(ctx, "businesses", biz) : null;
  if (!b) throw new ConvexError("This business's kickoff brief isn't here.");
  const qn = ((b as Record<string, any> | null)?.kickoff as Questionnaire | undefined) ?? KICKOFF_BRIEF;
  // 8d re-review R2: the whole brief as the client gets it (titles, headings, notes, help and choices), so all of it is bound.
  const lines = qn.steps.flatMap((st) => [
    `${st.title}${st.heading ? ` · ${st.heading}` : ""}${st.sub ? ` · ${st.sub}` : ""}`,
    ...st.questions.map((q) => `  ${q.label} [${q.type}${q.required ? ", required" : ""}]${q.help ? ` · ${q.help}` : ""}${q.placeholder ? ` · e.g. ${q.placeholder}` : ""}${q.options?.length ? ` · ${q.options.join(" / ")}` : ""}`),
  ]);
  tooMany(lines.length);
  return [{ label: "The questions", value: lines.join("\n") }];
};
/** M1: who a message reaches, as the site works it out: the project's portal people, or the lead. */
const messageReach = async (ctx: QueryCtx, a: Args) => {
  const t = await get(ctx, "msgThreads", a.threadId);
  if (!t) return [];
  let to: string[] = [];
  if (t.projectId) { const p = await get(ctx, "projects", t.projectId); if (p) to = (await portalPeople(ctx as never, p as never)).map((x: { email: string; name?: string }) => `${x.name ? `${x.name} ` : ""}<${x.email}>`); }
  else if (t.leadEmail) to = [`${t.leadName ? `${t.leadName} ` : ""}<${String(t.leadEmail).toLowerCase()}>`];
  tooMany(to.length);
  return [{ label: "Sends", value: to.length ? `The message, and an email about it, to ${to.join(", ")}` : "The message (no one to email yet)" }];
};
/** M3: a creative brand kit with its link on is seen outside the business at once. */
const sharedKit = async (ctx: QueryCtx, a: Args) => {
  const k = typeof a.kitId === "string" ? await get(ctx, "brandKits", a.kitId) : null;
  return k?.share?.on ? "This brand kit's link is on: what's saved shows to anyone with it at once." : null;
};
/** L2: a new title on something already shared shows to outsiders at once. */
const sharedTitle = async (ctx: QueryCtx, a: Args) => {
  if (a.title === undefined) return null;
  const d = typeof a.creativeDocId === "string" ? await get(ctx, "creativeDocs", a.creativeDocId) : null;
  const br = typeof a.briefingId === "string" ? await get(ctx, "briefings", a.briefingId) : null;
  return d?.share?.on || (br && br.status !== "draft") ? "It's shared: a new title shows to the people who have it at once." : null;
};
// 8d re-review R4: only colours are the look; the watermark's text and strength are on every client's cuts.
const LOOK = new Set(["accent", "background"]);
/** 8d re-review R1: an estimate for a lead with no company yet files the lead under a company (an existing one with
 *  the same name included), and the lead's email becomes one of its people, who then see its invoices. */
const leadFiling = async (ctx: QueryCtx, a: Args) => {
  if (a.clientId) return null;
  const est = typeof a.estimateId === "string" ? await get(ctx, "estimates", a.estimateId) : null;
  let deal = await get(ctx, "deals", a.dealId ?? est?.dealId);
  if (!deal && typeof (a.projectId ?? est?.projectId) === "string") deal = ((await ctx.db.query("deals").withIndex("by_project", (q) => q.eq("projectId", (a.projectId ?? est?.projectId) as never)).collect()) as Array<Record<string, any>>).find((x) => !x.closedAt) ?? null;
  if (!deal?.lead || deal.clientId || est?.clientId) return null;
  return `Saving this estimate files the lead ${String(deal.lead.email ?? "")} under ${String(deal.lead.company || deal.lead.name || "a company")} (an existing company with that name included); as one of its people, once they can sign in they see its invoices.`;
};

export const ACTIONS: Record<string, Entry> = {
  // ---- projects ----
  "library.projectNames": r("projects", library.projectNames, "Every project's name and client (for picking one)"),
  "library.overview": r("projects", library.overview, "Review's library: clients, projects and their videos"),
  "homes.projectsBoard": r("projects", homes.projectsBoard, "Projects grouped by client, and the ones on their own"),
  "homes.clientChoices": r("projects", homes.clientChoices, "The clients a project can be filed under"),
  "homes.loose": r("projects", homes.loose, "Things not attached to a client, project or shoot day"),
  "projects.page": r("projects", projects.page, "One project's page: stage, next step, key dates, rounds, delivery"),
  "projects.nextRound": r("projects", projects.nextRound, "The revision round the next version would be"),
  "library.createProject": c("projects", library.createProject, "Make a project (with no client: filing one under a client is an ask)", {
    askWhen: (a) => (typeof a.client === "string" && a.client.trim() ? "Filing a new project under a client lets that client's people see its cuts." : null),
  }),
  "library.renameProject": c("projects", library.renameProject, "Rename a project or change its job number", {
    refuse: (a) => (a.client !== undefined ? MOVE_CLIENT : null),
  }),
  "projects.setStage": c("projects", projects.setStage, "Move a project to a stage (posting it to the client's Inbox is an ask)", {
    // Review M3: a project out of Delivery is open again, so its call-sheet guests can sign in again.
    outside: async (ctx, a) => ((await get(ctx, "projects", a.projectId))?.stage === "delivery" && a.stage !== "delivery" ? "Moving a project out of Delivery opens it again: its call-sheet guests can sign in again." : null),
  }),
  "projects.setNextStep": c("projects", projects.setNextStep, "Set a project's next step"),
  "projects.setKeyDates": c("projects", projects.setKeyDates, "Set a project's key dates"),
  "projects.setRounds": c("projects", projects.setRounds, "Set how many revision rounds a project includes"),
  "projects.addDeliveryFile": ask("projects", projects.addDeliveryFile, "Add a final file to a project's delivery", "If the project's final files are unlocked, the client's people can download it at once."),
  "projects.setDelivery": ask("projects", projects.setDelivery, "Unlock (or lock) a project's final files for the client", "Unlocking lets the client's people download the final files.", {
    shows: async (ctx, a) => {
      const p = await get(ctx, "projects", a.projectId);
      if (!p) return [];
      const files = await ctx.db.query("deliveryFiles").withIndex("by_project", (q) => q.eq("projectId", p._id as never)).collect();
      tooMany(files.length);
      return [{ label: "Final files", value: files.length ? files.map((f) => `${f.name}${f.dropboxPath ? ` (${f.dropboxPath})` : ""}`).join("\n") : "None yet" }];
    },
  }),
  "projects.removeDeliveryFile": del("projects", projects.removeDeliveryFile, "Take a file off a project's delivery"),
  "library.deleteProject": del("projects", library.deleteProject, "Delete a project with its videos and every version from Review", "Its videos and versions leave Review for good. Files in Dropbox stay."),

  // ---- production ----
  "production.overview": r("production", production.overview, "The Production page: each stage's live line and today's tiles"),
  "production.shoots": r("production", production.shoots, "Every shoot (Production › Shoots)"),
  "production.projectsForShoot": r("production", production.projectsForShoot, "Projects a new shoot can go under"),
  "shoots.forProject": r("production", shoots.forProject, "A project's shoots"),
  "shoots.page": r("production", shoots.page, "One shoot's details"),
  "shootPage.get": r("production", shootPage.get, "A shoot day's hub: overview, call sheet, shot list, gear, releases, places"),
  "shoots.schedule": ask("production", shoots.schedule, "Schedule a shoot", "The client's people are told and it goes on their portal; the calendar invite goes from Google."),
  "shoots.update": ask("production", shoots.update, "Change a shoot's details", "A new date, call time or place asks the client to confirm again; the calendar event updates."),
  "shoots.cancel": ask("production", shoots.cancel, "Cancel a shoot", "The client's people and the calendar are told."),
  "shoots.askClientConfirm": ask("production", shoots.askClientConfirm, "Ask the client to confirm a shoot", "The client's people are asked to confirm."),
  "callSheets.list": r("production", callSheets.list, "Every call sheet"),
  "callSheets.newOptions": r("production", callSheets.newOptions, "What a new call sheet can be made from"),
  "callSheets.get": r("production", callSheets.get, "One call sheet: its questions, people and state"),
  "callSheets.create": c("production", callSheets.create, "Start a call sheet for a shoot day"),
  "callSheets.saveAnswers": c("production", callSheets.saveAnswers, "Save a call sheet's answers"),
  "callSheets.make": c("production", callSheets.make, "Build the call sheet's page from its answers"),
  "callSheets.toggle": c("production", callSheets.toggle, "Turn a person on or off a call sheet's list", { askWhen: (a) => (a.on === true ? "Turning someone back on a call sheet can give them its page again." : null) }),
  "callSheets.addGuest": c("production", callSheets.addGuest, "Add a guest (talent) to a call sheet (nothing is sent until the sheet is)"),
  "callSheets.removeGuest": c("production", callSheets.removeGuest, "Take a guest off a call sheet"),
  "callSheets.endGuest": c("production", callSheets.endGuest, "End a guest's access to a call sheet"),
  "callSheets.restoreGuest": c("production", callSheets.restoreGuest, "Give a guest their access back"),
  "callSheets.refreshWeather": c("production", callSheets.refreshWeather, "Refresh a call sheet's forecast"),
  "callSheets.send": ask("production", callSheets.send, "Send a call sheet", "The people ticked get the call sheet.", {
    // Review M5: what goes out is the sheet as built now; its last change is shown, so an edit after the ask is caught.
    shows: async (ctx, a) => {
      const cs = await get(ctx, "callSheets", a.callSheetId);
      const b = cs?.buildId ? await get(ctx, "wsBuilds", cs.buildId) : null;
      return b ? [{ label: "The call sheet", value: `${String(b.title ?? "Call sheet")}, last changed ${new Date(Number(b.updatedAt ?? 0)).toISOString()} (open it to read it)` }] : [];
    },
  }),
  "callSheets.sendUpdate": ask("production", callSheets.sendUpdate, "Send a call sheet update", "Everyone it went to gets the update.", {
    // Review M5: what goes out is the sheet as built now; its last change is shown, so an edit after the ask is caught.
    shows: async (ctx, a) => {
      const cs = await get(ctx, "callSheets", a.callSheetId);
      const b = cs?.buildId ? await get(ctx, "wsBuilds", cs.buildId) : null;
      return b ? [{ label: "The call sheet", value: `${String(b.title ?? "Call sheet")}, last changed ${new Date(Number(b.updatedAt ?? 0)).toISOString()} (open it to read it)` }] : [];
    },
  }),
  "callSheets.remind": ask("production", callSheets.remind, "Remind people to open a call sheet", "Those who haven't opened it are reminded."),
  "callSheets.deleteDraft": del("production", callSheets.deleteDraft, "Delete a call sheet that hasn't been sent"),
  "shotLists.all": r("production", shotLists.all, "Every shot list"),
  "shotLists.newOptions": r("production", shotLists.newOptions, "What a new shot list can be attached to"),
  "shotLists.forProject": r("production", shotLists.forProject, "A project's shot lists"),
  "shotLists.get": r("production", shotLists.get, "One shot list with its setups and shots"),
  "shotLists.forShoot": r("production", shotLists.forShoot, "A shoot day's shot list"),
  "shotLists.create": c("production", shotLists.create, "Make a shot list"),
  "shotLists.update": c("production", shotLists.update, "Rename a shot list or link it to a shoot day"),
  "shotLists.addSetup": c("production", shotLists.addSetup, "Add a setup"),
  "shotLists.editSetup": c("production", shotLists.editSetup, "Edit a setup"),
  "shotLists.moveSetup": c("production", shotLists.moveSetup, "Move a setup"),
  "shotLists.addShots": c("production", shotLists.addShots, "Add shots (one per line)"),
  "shotLists.editShot": c("production", shotLists.editShot, "Edit a shot"),
  "shotLists.moveShot": c("production", shotLists.moveShot, "Move a shot"),
  "shotLists.tick": c("production", shotLists.tick, "Tick or untick a shot"),
  "shotLists.reset": del("production", shotLists.reset, "Clear every tick on a shot list"),
  "shotLists.removeSetup": del("production", shotLists.removeSetup, "Delete a setup and its shots"),
  "shotLists.removeShot": del("production", shotLists.removeShot, "Delete a shot"),
  "shotLists.remove": del("production", shotLists.remove, "Delete a shot list"),
  "releases.forShoot": r("production", releases.forShoot, "A shoot day's releases (who signed what)"),
  "releases.get": r("production", releases.get, "One release and its trail"),
  "releases.create": c("production", releases.create, "Prepare a release for someone to sign in person (it's signed on Heston's phone, never through Claude)"),
  "releases.markShot": c("production", releases.markShot, "Mark whether a shot needs a release"),
  "releases.remove": del("production", releases.remove, "Delete a release that hasn't been signed"),
  "gear.list": r("production", gear.list, "The gear inventory"),
  "gear.get": r("production", gear.get, "One gear item with its maintenance"),
  "gear.exportCsv": r("production", gear.exportCsv, "The insurance list as CSV"),
  "gear.forShoot": r("production", gear.forShoot, "A shoot's gear"),
  "gear.add": c("production", gear.add, "Add a gear item"),
  "gear.update": c("production", gear.update, "Edit a gear item"),
  "gear.setStatus": c("production", gear.setStatus, "Set a gear item in service, in repair or retired"),
  "gear.logMaintenance": c("production", gear.logMaintenance, "Log maintenance on a gear item"),
  "gear.addToShoot": c("production", gear.addToShoot, "Book a gear item to a shoot"),
  "gear.removeFromShoot": c("production", gear.removeFromShoot, "Take a gear item off a shoot"),
  "packing.lists": r("production", packing.lists, "Saved packing lists"),
  "packing.get": r("production", packing.get, "One packing list"),
  "packing.gearChoices": r("production", packing.gearChoices, "Gear that can go on a packing list"),
  "packing.forShoot": r("production", packing.forShoot, "A shoot's packing list"),
  "packing.create": c("production", packing.create, "Make a packing list"),
  "packing.rename": c("production", packing.rename, "Rename a packing list"),
  "packing.duplicate": c("production", packing.duplicate, "Duplicate a packing list"),
  "packing.addGear": c("production", packing.addGear, "Add gear to a packing list"),
  "packing.addLine": c("production", packing.addLine, "Add a line to a packing list"),
  "packing.editLine": c("production", packing.editLine, "Edit a packing line"),
  "packing.moveLine": c("production", packing.moveLine, "Move a packing line"),
  "packing.useOnShoot": c("production", packing.useOnShoot, "Use a packing list on a shoot (the shoot gets its own copy)"),
  "packing.tick": c("production", packing.tick, "Tick a packing line at load-in or wrap"),
  "packing.flag": c("production", packing.flag, "Mark an item lost or in repair at wrap"),
  "packing.removeLine": del("production", packing.removeLine, "Delete a packing line"),
  "packing.remove": del("production", packing.remove, "Delete a packing list"),
  "places.list": r("production", places.list, "Saved locations"),
  "places.get": r("production", places.get, "One location"),
  "places.forShoot": r("production", places.forShoot, "A shoot's locations"),
  "places.create": c("production", places.create, "Add a location"),
  "places.update": c("production", places.update, "Edit a location"),
  "places.coverPhoto": c("production", places.coverPhoto, "Pick a location's cover photo"),
  // Re-review Med-2: as the shoot's place it moves the shoot: the client is asked to confirm again, the call sheet and calendar change.
  "places.useForShoot": c("production", places.useForShoot, "Use a location for a shoot (as the shoot's place it's an ask)", { askWhen: (a) => (a.asPlace === true ? "Making it the shoot's place moves the shoot: the client is asked to confirm again, and the call sheet and calendar change." : null) }),
  "places.unlink": c("production", places.unlink, "Take a location off a shoot"),
  "places.removePhoto": del("production", places.removePhoto, "Delete a location's photo"),
  "places.remove": del("production", places.remove, "Delete a location"),

  // ---- crew (vendors, bookings, briefings) ----
  "vendors.list": { ...r("crew", vendors.list, "Saved vendors (crew)"), hide: ["address"] },
  "vendors.get": { ...r("crew", vendors.get, "One vendor: roles, rates, gear, bookings (whether a W-9 is on file; never the W-9, the 1099 address or how they're paid)"), hide: ["address"] },
  "vendors.add": c("crew", vendors.add, "Add a vendor (inviting them is an ask)", { askWhen: (a) => (a.invite === true ? "Inviting a vendor emails them." : null) }),
  "vendors.update": c("crew", vendors.update, "Edit a vendor's details"),
  "vendors.archive": c("crew", vendors.archive, "Archive or restore a vendor", { askWhen: (a) => (a.archived === false ? "Restoring a vendor gives them their portal back." : null) }),
  "vendors.invite": ask("crew", vendors.invite, "Invite a vendor to their portal", "The vendor gets an invite to their portal."),
  "bookings.form": r("crew", bookings.form, "What a new booking can use: vendors, roles, rates, projects"),
  "bookings.list": r("crew", bookings.list, "Every booking"),
  "bookings.forProject": r("crew", bookings.forProject, "A project's crew"),
  "bookings.forVendor": r("crew", bookings.forVendor, "A vendor's bookings"),
  "bookings.get": r("crew", bookings.get, "One booking"),
  "bookings.create": ask("crew", bookings.create, "Book a vendor", "The vendor is offered the booking."),
  "bookings.cancel": ask("crew", bookings.cancel, "Cancel a booking", "The vendor is told."),
  "briefings.templates": r("crew", briefings.templates, "Briefing templates"),
  "briefings.list": r("crew", briefings.list, "Every briefing"),
  "briefings.forVendor": r("crew", briefings.forVendor, "A vendor's briefings"),
  "briefings.get": r("crew", briefings.get, "One briefing: who it went to, opens, read"),
  "briefings.create": c("crew", briefings.create, "Start a briefing (then write its text with pageText.write)"),
  "briefings.setDetails": c("crew", briefings.setDetails, "Set a briefing's project or details"),
  "briefings.copy": c("crew", briefings.copy, "Copy a briefing"),
  "briefings.setLinkOff": c("crew", briefings.setLinkOff, "Turn a briefing's links off or on (on is an ask)", { askWhen: (a) => (a.off === false ? "Turning the links back on lets everyone who has one read it again." : null) }),
  // Review M2: a later (or no) expiry can open links that had stopped working.
  "briefings.setLinkExpiry": ask("crew", briefings.setLinkExpiry, "Change when a briefing's links stop working", "A later date, or none, lets everyone who has a link read it again."),
  "briefings.deleteDraft": del("crew", briefings.deleteDraft, "Delete a briefing that hasn't been sent"),

  // ---- work (tasks) ----
  "work.mine": r("work", work.mine, "Heston's own tasks"),
  "work.all": r("work", work.all, "Every task"),
  "work.forProject": r("work", work.forProject, "A project's tasks"),
  "work.get": r("work", work.get, "One task with its subtasks"),
  "work.people": r("work", work.people, "Who a task can be given to"),
  "work.lists": r("work", work.lists, "To-do lists"),
  "work.templates": r("work", work.templates, "Task templates"),
  "work.create": c("work", work.create, "Make a task (one for the client or a vendor is an ask)", { askWhen: reaches }),
  "work.update": c("work", work.update, "Edit a task (one the client or a vendor sees is an ask)", { askWhen: reaches, outside: theirTask }),
  "work.done": c("work", work.done, "Mark a task done or not", { outside: theirTask }),
  "work.place": c("work", work.place, "Move a task on the board", { outside: theirTask }),
  "work.createList": c("work", work.createList, "Make a to-do list"),
  "work.saveList": c("work", work.saveList, "Save a to-do list"),
  "work.duplicateList": c("work", work.duplicateList, "Duplicate a to-do list"),
  "work.itemToTask": c("work", work.itemToTask, "Turn a to-do item into a task"),
  "work.saveTemplate": c("work", work.saveTemplate, "Save a task template"),
  "work.useTemplate": ask("work", work.useTemplate, "Make a project's tasks from a template", "A template's tasks for the client or a vendor show in their portal.", {
    shows: async (ctx, a) => {
      const t = await get(ctx, "taskTemplates", a.templateId);
      const items = Array.isArray(t?.items) ? (t!.items as Array<{ title?: string; audience?: string }>) : [];
      tooMany(items.length);
      return [{ label: "Tasks", value: items.length ? items.map((x) => `${x.title ?? "A task"}${x.audience && x.audience !== "team" ? ` (for the ${x.audience})` : ""}`).join("\n") : "None" }];
    },
  }),
  "work.remove": del("work", work.remove, "Delete a task"),
  "work.removeList": del("work", work.removeList, "Delete a to-do list"),
  "work.removeTemplate": del("work", work.removeTemplate, "Delete a task template"),

  // ---- creative planning ----
  "creative.overview": r("creative", creative.overview, "Creative planning overview: recent work and where it's attached"),
  "creative.docs": r("creative", creative.docs, "Creative docs (treatments, scripts, interview questions, briefs)"),
  "creative.doc": r("creative", creative.doc, "One creative doc (its text: pageText.get)"),
  "creative.kits": r("creative", creative.kits, "Brand kits"),
  "creative.kit": r("creative", creative.kit, "One brand kit"),
  "creative.newDoc": c("creative", creative.newDoc, "Make a creative doc (then write its text with pageText.write)"),
  "creative.startBriefing": c("creative", creative.startBriefing, "Start a briefing from a creative doc"),
  "creative.newKit": c("creative", creative.newKit, "Make a brand kit"),
  "creative.renameKit": c("creative", creative.renameKit, "Rename a brand kit (a shared one is an ask)", { outside: sharedKit }),
  "creative.shareOn": c("creative", creative.shareOn, "Turn a creative doc's view link off or on (on is an ask)", { askWhen: (a) => (a.on === true ? "Turning the link on lets anyone with it read the doc." : null) }),
  "creative.shareKit": c("creative", creative.shareKit, "Turn a brand kit's view link off or on (on is an ask)", { askWhen: (a) => (a.on === true ? "Turning the link on lets anyone with it see the kit." : null) }),
  "creative.removeDoc": del("creative", creative.removeDoc, "Delete a creative doc"),
  "creative.removeKit": del("creative", creative.removeKit, "Delete a brand kit"),
  "canvas.list": r("creative", canvas.list, "Canvases and mood boards"),
  "canvas.get": r("creative", canvas.get, "One canvas with everything on it"),
  "canvas.shareChoices": r("creative", canvas.shareChoices, "Who a canvas can be shared with"),
  "canvas.create": c("creative", canvas.create, "Make a canvas or mood board"),
  "canvas.save": c("creative", canvas.save, "Save a canvas's board (a shared board is an ask)", { outside: sharedBoard, shows: boardChanges }),
  "canvas.rename": c("creative", canvas.rename, "Rename a canvas (a shared one is an ask)", { outside: sharedBoard }),
  "canvas.duplicate": c("creative", canvas.duplicate, "Duplicate a canvas"),
  "canvas.setRole": c("creative", canvas.setRole, "Change what a person a canvas is shared with can do (letting them edit is an ask)", { askWhen: (a) => (a.role === "edit" ? "Letting someone outside the business edit the board." : null) }),
  "canvas.removePerson": c("creative", canvas.removePerson, "Stop sharing a canvas with a person"),
  "canvas.stopSharing": c("creative", canvas.stopSharing, "Stop sharing a canvas with everyone"),
  "canvas.addPerson": ask("creative", canvas.addPerson, "Share a canvas with a person", "They get their own link to the canvas (Heston copies it to them)."),
  "canvas.setLink": c("creative", canvas.setLink, "Turn a canvas's view link off or on (on is an ask)", { askWhen: (a) => (a.on === true ? "Turning the link on lets anyone with it see the canvas." : null) }),
  "canvas.remove": del("creative", canvas.remove, "Delete a canvas"),

  // ---- delivery ----
  "delivery.list": r("delivery", delivery.list, "Deliveries"),
  "delivery.get": r("delivery", delivery.get, "One delivery: folders, albums, files, links"),
  "delivery.ensure": c("delivery", delivery.ensure, "Start a project's delivery"),
  "delivery.addAlbum": c("delivery", delivery.addAlbum, "Add a video folder or photo album"),
  "delivery.editItem": c("delivery", delivery.editItem, "Edit a folder or album"),
  "delivery.addFiles": c("delivery", delivery.addFiles, "Add files to a folder or album (not published yet)"),
  "delivery.editAsset": c("delivery", delivery.editAsset, "Edit a delivered file's details"),
  "delivery.publish": ask("delivery", delivery.publish, "Publish a delivery's changes", "The project's people see the new delivery; with tell: true they're emailed too.", {
    shows: async (ctx, a) => {
      const d = await get(ctx, "deliveries", a.deliveryId);
      if (!d) return [];
      const items = await ctx.db.query("deliveryItems").withIndex("by_delivery", (q) => q.eq("deliveryId", d._id as never)).collect();
      const assets = await ctx.db.query("deliveryAssets").withIndex("by_delivery", (q) => q.eq("deliveryId", d._id as never)).collect();
      tooMany(items.length + assets.length);
      return [{ label: "What's in it", value: items.map((i) => `${String(i.title ?? "A folder")}${i.published ? "" : " (new)"}: ${assets.filter((x) => x.itemId === i._id).map((x) => String((x as Record<string, unknown>).name ?? (x as Record<string, unknown>).title ?? "a file")).join(", ") || "no files"}`).join("\n") || "Nothing yet" }];
    },
  }),
  "delivery.removeItem": del("delivery", delivery.removeItem, "Delete a folder or album from a delivery", "It leaves the delivery. Files in Dropbox stay."),
  "delivery.removeAsset": del("delivery", delivery.removeAsset, "Delete a file from a delivery", "It leaves the delivery. The file in Dropbox stays."),

  // ---- money (Phase 8c, D209: Claude prepares; paying, charging and refunding are Heston's own buttons on the site) ----
  "invoices.list": r("money", invoices.list, "Invoices"),
  "invoices.overview": r("money", invoices.overview, "The Payments overview: outstanding, paid, needs you"),
  "invoices.forProject": r("money", invoices.forProject, "A project's invoices"),
  "invoices.get": { ...r("money", invoices.get, "One invoice with its history and payments (its pay links stay on the site)"), hide: ["hostedUrl", "pdfUrl", "link", "url"] },
  "invoices.options": r("money", invoices.options, "Who and what a new invoice can be for"),
  "invoices.finalOptions": r("money", invoices.finalOptions, "What a project's final invoice would hold"),
  "invoices.saveDraft": c("money", invoices.saveDraft, "Make or change a draft invoice (nothing is sent)"),
  "invoices.draftFinal": c("money", invoices.draftFinal, "Draft a project's final invoice (nothing is sent)"),
  "invoices.deleteDraft": del("money", invoices.deleteDraft, "Delete a draft invoice"),
  "invoices.send": ask("money", invoices.send, "Send an invoice", "It's finalized in Stripe and can be paid from its link.", {
    onPage: true, shows: async (ctx, a) => {
      const l = await invoiceLines(ctx, a.invoiceId);
      const to = l.find((x) => x.label === "Bill to")?.value;
      return [...l, { label: "Sends", value: to ? `Invoice email with its pay link to ${to}` : "Nothing (it isn't here)" }];
    },
  }),
  "invoices.voidInvoice": ask("money", invoices.voidInvoice, "Void an invoice", "It's voided in Stripe: it can't be paid any more. Money already paid isn't refunded (Heston refunds on the site).", {
    onPage: true, shows: async (ctx, a) => [...(await invoiceLines(ctx, a.invoiceId)), { label: "Sends", value: "No email" }],
  }),
  "invoiceReminders.setReminders": ask("money", invoiceReminders.setReminders, "Set the automatic invoice reminders", "", {
    // Re-review L-d: the numbers as the site will keep them.
    shows: async (_ctx, a) => {
      const n = (x: unknown, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number(x) || 0)));
      return [{ label: "Sends", value: a.on === true ? `From now on, on their own: a reminder email to each client with an open invoice ${n(a.beforeDays, 0, 30)} days before it's due, then every ${n(a.everyDays, 1, 60)} days once it's ${n(a.afterDays, 0, 30)} days overdue, up to ${n(a.stopAfter, 1, 12)} times` : "No more automatic reminders" }];
    },
  }),
  "invoiceReminders.sendReminder": ask("money", invoiceReminders.sendReminder, "Email a reminder about an invoice", "The client gets a reminder with the pay link.", { shows: async (ctx, a) => invoiceLines(ctx, a.invoiceId) }),
  "quotes.list": r("money", quotes.list, "Quotes"),
  "quotes.get": { ...r("money", quotes.get, "One quote, who it went to, opens and answers (its links stay on the site)"), hide: ["link", "linkUrl", "ip", "userAgent"] },
  "quotes.options": r("money", quotes.options, "Who and what a new quote can be for"),
  "quotes.save": c("money", quotes.save, "Make or change a draft quote (nothing is sent)"),
  "quotes.answerMove": c("money", quotes.answerMove, "Answer “Move the company to Quoted?”"),
  "quotes.later": c("money", quotes.later, "Put off a quote's question for later"),
  "quotes.stopLink": c("money", quotes.stopLink, "Turn off a quote's link for one person"),
  "quotes.deleteDraft": del("money", quotes.deleteDraft, "Delete a draft quote"),
  "quotes.send": ask("money", quotes.send, "Send a quote", "Each person gets their own link to read and accept it.", { onPage: true, shows: quoteLines }),
  "quotes.newLink": ask("money", quotes.newLink, "Make a new link for a quote", "The old link stops; the new one opens the quote to anyone who has it."),
  "quotes.voidQuote": ask("money", quotes.voidQuote, "Void a quote", "It can't be accepted any more; its page says it was voided."),
  "plans.list": r("money", plans.list, "Subscription plans"),
  "plans.get": r("money", plans.get, "One plan"),
  "subscriptions.list": r("money", subscriptions.list, "Subscriptions (starting, changing, pausing and cancelling them are Heston's own buttons on the site)"),
  "subscriptions.get": { ...r("money", subscriptions.get, "One subscription (its link stays on the site)"), hide: ["link", "url", "hostedUrl"] },
  "subscriptions.failRules": r("money", subscriptions.failRules, "What happens when a subscription payment fails"),
  "payments.settings": r("money", payments.settings, "Whether Stripe is connected and ready (never its keys)"),
  "vendorPayments.list": r("money", vendorPayments.list, "Vendor invoices"),
  "vendorPayments.get": { ...r("money", vendorPayments.get, "One vendor invoice"), hide: ["address"] },
  "vendorPayments.totals1099": { ...r("money", vendorPayments.totals1099, "Each vendor's total paid this year, and whether a W-9 is on file (never the W-9 or the 1099 address)"), hide: ["address"] },
  "vendorPayments.approve": ask("money", vendorPayments.approve, "Approve a vendor's invoice", "It goes in the project's Ledger as a cost.", { shows: (ctx, a) => vendorInvoiceLines(ctx, a, "Email saying it was approved") }),
  "vendorPayments.decline": ask("money", vendorPayments.decline, "Decline a vendor's invoice", "", { shows: (ctx, a) => vendorInvoiceLines(ctx, a, "Email saying it was declined") }),
  "vendorPayments.markPaid": ask("money", vendorPayments.markPaid, "Record that a vendor was paid (another way: no money moves here)", "It's recorded as paid and counts toward their 1099 total.", { shows: (ctx, a) => vendorInvoiceLines(ctx, a, "Email saying it was paid") }),
  "vendorPayouts.status": r("money", vendorPayouts.status, "Whether Pay in portal is set up (paying is Heston's own button)"),
  "vendorPayouts.forInvoice": r("money", vendorPayouts.forInvoice, "Whether a vendor invoice can be paid in the portal"),
  "vendorPayouts.askSetup": ask("money", vendorPayouts.askSetup, "Ask a vendor to set up direct deposit", "The vendor gets an email asking them to add their bank on Stripe's form."),
  "reports.page": r("money", reports.page, "Reports: revenue, profit by project, outstanding, lead to job, vendor costs"),
  "reports.widgets": r("money", reports.widgets, "The Dashboard's money tiles"),
  "footage.settings": r("money", footage.settings, "Raw footage storage: the offer and its price"),
  "footage.forProject": r("money", footage.forProject, "A project's raw footage storage"),
  "footage.recordDrive": c("money", footage.recordDrive, "Record that the client is sending a hard drive"),
  "footage.stop": ask("money", footage.stop, "Stop a project's raw footage storage", "A paid storage plan ends: no renewal is drafted, and it leaves the client's page."),
  "footage.markDone": ask("money", footage.markDone, "Mark the raw footage deleted or moved", "Once it's marked, a late storage payment can only be refunded, not kept."),
  "footage.reinstate": ask("money", footage.reinstate, "A storage invoice paid late: keep the payment and the footage for a year", "The client's card says it's kept until the new date."),
  "footage.dismissLatePaid": ask("money", footage.dismissLatePaid, "A storage invoice paid late: mark it to refund (Heston refunds on the site)", "Closing it takes away the reminder that a refund is owed."),
  "delivery.setTerm": ask("money", delivery.setTerm, "Change how long a delivery is kept and its renewal price", "A later date can open an ended delivery again; a date within 30 days can show the client the renewal offer; an earlier one ends it sooner; the price is what the client sees."),
  "delivery.renewal": ask("money", delivery.renewal, "Choose what happens when a delivery's year ends", "Offering a renewal tells the client, with Renew and pay in their portal."),
  "delivery.renewed": ask("money", delivery.renewed, "Mark a delivery renewed", "It's kept another year (and opens again if it had ended), whether or not it was paid."),

  // ---- sales (pipeline, follow-ups, estimates, ledger, proposals) ----
  "crm.board": r("sales", crm.board, "The pipeline"),
  "crm.deal": r("sales", crm.deal, "One lead or deal"),
  "crm.companies": r("sales", crm.companies, "Client companies"),
  "crm.company": r("sales", crm.company, "One client company"),
  "crm.contact": r("sales", crm.contact, "One contact"),
  "crm.followUps": r("sales", crm.followUps, "Follow-ups"),
  "crm.due": r("sales", crm.due, "What's due today"),
  "crm.rates": r("sales", crm.rates, "The pricing model (rates, discounts)"),
  "crm.getEstimate": r("sales", crm.getEstimate, "One estimate"),
  "crm.ledger": r("sales", crm.ledger, "A project's job ledger"),
  "crm.addDeal": c("sales", crm.addDeal, "Add a lead"),
  "crm.moveDeal": c("sales", crm.moveDeal, "Move a lead or deal to a stage"),
  "crm.linkProject": c("sales", crm.linkProject, "Link a deal to its project"),
  "crm.closeDeal": c("sales", crm.closeDeal, "Close a deal (won or lost)"),
  "crm.addFollowUp": c("sales", crm.addFollowUp, "Add a follow-up"),
  "crm.doneFollowUp": c("sales", crm.doneFollowUp, "Mark a follow-up done (removing one, or confirming Claude's draft, is an ask)", {
    askWhen: (a) => (a.remove === true ? "It deletes the follow-up." : a.confirm === true ? "A follow-up Claude drafted counts once Heston confirms it." : null),
  }),
  "crm.saveEstimate": c("sales", crm.saveEstimate, "Save an estimate (the first one for a lead with no company is an ask)", { outside: leadFiling }),
  // 8c review L3 (D67): a ledger entry from Claude counts only once Heston confirms it.
  "crm.logEntry": ask("sales", crm.logEntry, "Log hours or a cost in a project's ledger", "It counts in the project's profit at once."),
  "crm.entryAction": ask("sales", crm.entryAction, "Confirm or remove a draft ledger entry", "A draft entry counts only once Heston confirms it."),
  "proposals.list": r("sales", proposals.list, "Proposals"),
  "proposals.get": { ...r("sales", proposals.get, "One proposal, who it went to, opens and answers (its links stay on the site)"), hide: ["link", "linkUrl", "ip", "userAgent"] },
  "proposals.templates": r("sales", proposals.templates, "Proposal templates"),
  "proposals.questionnaire": r("sales", proposals.questionnaire, "The proposal questionnaire"),
  "proposals.forCompany": r("sales", proposals.forCompany, "A company's proposals and quotes"),
  "proposals.create": c("sales", proposals.create, "Start a proposal"),
  "proposals.copy": c("sales", proposals.copy, "Copy a proposal"),
  "proposals.newTemplate": c("sales", proposals.newTemplate, "Make a proposal template"),
  "proposals.startQuestionnaire": c("sales", proposals.startQuestionnaire, "Start a proposal from the questionnaire"),
  "proposals.saveAnswers": c("sales", proposals.saveAnswers, "Save a proposal's questionnaire answers"),
  "proposals.finish": c("sales", proposals.finish, "Finish the questionnaire (Draft with Claude)", {
    // 8c review L4: never take over a proposal Heston is writing himself.
    outside: async (ctx, a) => { const p = await get(ctx, "proposals", a.proposalId); return p && p.status === "draft" && !p.filling ? "Heston is writing this proposal himself: handing it to Claude replaces what he's written." : null; },
  }),
  "proposals.fillInstead": c("sales", proposals.fillInstead, "Fill the proposal in by hand instead"),
  "proposals.dismissDrafted": c("sales", proposals.dismissDrafted, "Clear the “Drafted by Claude” banner"),
  "proposals.setDeck": c("sales", proposals.setDeck, "Pick the brand kit for the pitch deck"),
  "proposals.later": c("sales", proposals.later, "Put off a proposal's question for later"),
  "proposals.stopLink": c("sales", proposals.stopLink, "Turn off a proposal's link for one person"),
  "proposals.saveQuestionnaire": c("sales", proposals.saveQuestionnaire, "Change the questionnaire's questions"),
  "proposals.newLink": ask("sales", proposals.newLink, "Make a new link for a proposal", "The old link stops; the new one opens the proposal to anyone who has it."),
  "proposals.setLinkExpiry": ask("sales", proposals.setLinkExpiry, "Change when a proposal's links stop working", "A later date, or none, lets everyone who has a link read it again."),
  "proposals.withdraw": ask("sales", proposals.withdraw, "Withdraw a proposal", "Its page says it was withdrawn."),
  "proposals.resetQuestionnaire": del("sales", proposals.resetQuestionnaire, "Put the questionnaire back to Wrangler's set"),
  "proposals.deleteDraft": del("sales", proposals.deleteDraft, "Delete a draft proposal"),

  // ---- Phase 8d: clients and their people, messages, booking calls, review links, kickoff briefs, file requests ----
  "clients.page": r("clients", clients.page, "One client: their people, projects, invites and settings"),
  "clients.people": r("clients", clients.people, "A client's people"),
  "clients.listInvites": r("clients", clients.listInvites, "Portal invites"),
  "clients.directory": r("clients", clients.directory, "Every client and their people"),
  // 8d review H1: a person on a client sees that client's invoices and more once they can sign in, so adding one asks.
  "clients.addPerson": ask("clients", clients.addPerson, "Add a person to a client", "Once they can sign in, they see the client's invoices, subscriptions and project pages."),
  "clients.updatePerson": c("clients", clients.updatePerson, "Change a client person's name or role"),
  "clients.revokeInvite": ask("clients", clients.revokeInvite, "Take back a portal invite", "They lose the portal at once."),
  "clients.setSettings": ask("clients", clients.setSettings, "A client's revision rounds or watermark", "The client's people see the change on their cuts at once."),
  "clients.invitePerson": ask("clients", clients.invitePerson, "Invite a client's person to the portal", "They get an invite to the portal."),
  "clients.invite": ask("clients", clients.invite, "Invite someone to the portal", "They get an invite to the portal."),
  "clients.removePerson": del("clients", clients.removePerson, "Take a person off a client (their portal invite stays: take it back with clients.revokeInvite)"),
  "messages.threads": r("clients", messages.threads, "Message threads"),
  "messages.thread": r("clients", messages.thread, "One thread's messages"),
  "messages.unread": r("clients", messages.unread, "Unread messages"),
  "messages.startOptions": r("clients", messages.startOptions, "Projects and leads a thread can be started for"),
  "messages.start": c("clients", messages.start, "Open a project's or lead's thread (nothing is sent)"),
  "messages.send": ask("clients", messages.send, "Send a message", "It goes to everyone on the thread.", { shows: messageReach }),
  "messages.setLeadLink": c("clients", messages.setLeadLink, "Turn a lead's message link off or on (on is an ask)", { askWhen: (a) => (a.off === false ? "Turning the link back on lets whoever has it read and write the thread again." : null) }),
  "calls.settings": r("clients", calls.settings, "Booking call settings"),
  "calls.forDeal": r("clients", calls.forDeal, "A lead's booked calls"),
  "calls.saveSettings": ask("clients", calls.saveSettings, "Change the booking call settings", "The public booking page offers the new hours at once (the first save opens it)."),
  "calls.setPaused": c("clients", calls.setPaused, "Pause or open the booking page (opening is an ask)", { askWhen: (a) => (a.paused === false ? "Opening the booking page lets anyone with the link book a call." : null) }),
  "calls.done": c("clients", calls.done, "Mark a booked call done"),
  "testimonials.list": r("clients", testimonials.list, "Testimonials"),
  "testimonials.markRead": c("clients", testimonials.markRead, "Mark a testimonial read"),
  "testimonials.saveAgain": c("clients", testimonials.saveAgain, "Save a testimonial to the vault again"),
  "shares.list": { ...r("clients", shares.list, "Review links (their addresses stay on the site)"), hide: ["url"] },
  "shares.forTarget": { ...r("clients", shares.forTarget, "The review links for a client, project or video (their addresses stay on the site)"), hide: ["url"] },
  "shares.activity": r("clients", shares.activity, "Who opened and watched a review link"),
  "shares.create": ask("clients", shares.create, "Make a review link", "Whoever it's for (or anyone with the link) can open the cuts."),
  "shares.update": ask("clients", shares.update, "Change a review link's access", "Who can comment or download, and which versions they see, changes at once."),
  "shares.setOff": c("clients", shares.setOff, "Turn a review link off or on (on is an ask)", { askWhen: (a) => (a.off === false ? "Turning the link back on opens the cuts again to everyone it had." : null) }),
  "shares.addMember": ask("clients", shares.addMember, "Add someone to a review link", "They get an email with the link."),
  "shares.resendInvite": ask("clients", shares.resendInvite, "Send a review link's email again", "They get the email again."),
  "shares.removeMember": ask("clients", shares.removeMember, "Take someone off a review link", "They lose the cuts at once."),
  "shares.remove": del("clients", shares.remove, "Delete a review link (it stops working)"),
  "briefs.settings": r("clients", briefs.settings, "The kickoff brief's questions"),
  "briefs.forProject": r("clients", briefs.forProject, "A project's kickoff brief"),
  "briefs.forEstimate": r("clients", briefs.forEstimate, "A kickoff brief's answers for an estimate"),
  "briefs.create": c("clients", briefs.create, "Start a kickoff brief (nothing is sent)"),
  "briefs.saveSettings": c("clients", briefs.saveSettings, "Change the kickoff brief's questions (for briefs sent after)"),
  "briefs.send": ask("clients", briefs.send, "Send a project's kickoff brief", "The client gets the kickoff brief to fill in.", { shows: briefQuestions }),
  "briefs.sendDraft": ask("clients", briefs.sendDraft, "Send a kickoff brief draft", "The client gets the kickoff brief to fill in.", { shows: briefQuestions }),
  "briefs.remind": ask("clients", briefs.remind, "Remind the client about their kickoff brief", "The client gets a reminder."),
  "briefs.resetSettings": del("clients", briefs.resetSettings, "Put the kickoff brief's questions back to Wrangler's set"),
  "fileRequests.forProject": r("clients", fileRequests.forProject, "A project's file requests"),
  "fileRequests.create": c("clients", fileRequests.create, "Make a file request with no project yet (one for a project is an ask)", { askWhen: (a) => (typeof a.projectId === "string" && a.projectId ? "A file request for a project opens the upload page to its people, and its reminders email them." : null) }),
  "fileRequests.setStatus": c("clients", fileRequests.setStatus, "Close a file request (reopening is an ask)", { askWhen: (a) => (a.status === "open" ? "Reopening a file request opens its upload page again and restarts its reminders." : null) }),
  "fileRequests.sendDraft": ask("clients", fileRequests.sendDraft, "Send a file request", "The client gets the upload link."),
  "proposals.send": ask("sales", proposals.send, "Send a proposal again, or to more people", "Each person gets their own link to read and accept it.", { onPage: true, refuse: noFile, shows: proposalSend }),
  "briefings.share": ask("crew", briefings.share, "Share a briefing with more people", "Each person gets their own link to read it.", { onPage: true, refuse: noFile, shows: briefingSend }),
  "pageText.get": r("creative", pageText.get, "A creative doc's or briefing's text, as page markdown"),
  "pageText.write": c("creative", pageText.write, "Write a creative doc's or briefing's text (page markdown; the shared copy changes only when Heston shares again; a new title on a shared one is an ask)", { outside: sharedTitle }),

  // ---- settings ----
  "business.settings": r("settings", business.settings, "Business settings: name, legal name, email name, reply-to, look"),
  "business.brand": r("settings", business.brand, "The business's look"),
  // 8d review H2: the business's details go on every client email and page (its reply-to above all): only its look is direct.
  "business.updateSettings": c("settings", business.updateSettings, "Change the business's look (its details, emails and modules are an ask)", {
    askWhen: (a) => (Object.keys(a).some((k) => a[k] !== undefined && !LOOK.has(k)) ? "The business's name, emails, reply-to, address, privacy link, modules and rounds go on every client email and page." : null),
  }),
  "brandKit.get": r("settings", brandKit.get, "The business's brand kit"),
  "brandKit.save": c("settings", brandKit.save, "Change a brand kit (a shared one is an ask)", { outside: sharedKit }),
  "brandKit.addFile": c("settings", brandKit.addFile, "Add a file to a brand kit (one site_upload made; a shared kit is an ask)", { outside: sharedKit }),
  "brandKit.removeFile": del("settings", brandKit.removeFile, "Take a file out of the brand kit"),
  "crm.saveRates": c("settings", crm.saveRates, "Change the pricing model (rates, discounts, formula)"),
  "delivery.settings": r("settings", delivery.settings, "Delivery's term and price"),
  "delivery.saveSettings": ask("settings", delivery.saveSettings, "Change Delivery's term, price, renewal offer and reminders", "Clients see the price and renewal offer at once; reminders post to their Inbox on their own."),
  "footage.saveSettings": ask("settings", footage.saveSettings, "Change the raw footage offer and its price", "The offer and price go to clients from then on."),
  "subscriptions.setFailRule": ask("settings", subscriptions.setFailRule, "Choose what happens when a subscription payment fails for good", "Cancelling ends a client's subscription without asking you each time."),
  "subscriptions.setClientFailRule": ask("settings", subscriptions.setClientFailRule, "Choose what happens for one client when their subscription payment fails", "Cancelling ends their subscription without asking you each time."),
  "notifications.owner": r("settings", notifications.owner, "Which emails Heston gets"),
  "notifications.setOwner": c("settings", notifications.setOwner, "Turn one of Heston's emails on (turning one off is an ask)", { askWhen: (a) => (a.on === false ? "Heston stops getting that email." : null) }),
  "prefs.mine": r("settings", prefs.mine, "The menu order, Dashboard cards and other choices"),
  "prefs.set": c("settings", prefs.set, "Change the menu order, Dashboard cards or another choice"),
  "calendar.settings": r("settings", calendarMod.settings, "The Google Calendar connection"),
  "calendar.save": ask("settings", calendarMod.save, "Pick the calendar and who gets invites", "Every shoot moves to that calendar; with invites on, Google emails the crew or the client's people for every shoot."),
  "team.page": r("settings", team.page, "The team: members, invites, roles"),
  "team.member": r("settings", team.member, "One team member"),
  "team.projectPeople": r("settings", team.projectPeople, "Who's on a project"),
  "team.cancelInvite": c("settings", team.cancelInvite, "Cancel a team invite"),
  "team.invite": ask("settings", team.invite, "Invite a team member", "They get an invite and the access their role gives."),
  "team.resendInvite": ask("settings", team.resendInvite, "Send a team invite again", "They get the invite again."),
  "team.remove": ask("settings", team.remove, "Take a team member off the business", "They lose access at once."),
  "team.setRole": ask("settings", team.setRole, "Change a team member's role", "What they can see and do changes at once."),
  "team.setPerm": ask("settings", team.setPerm, "Turn one of a team member's switches on or off", "What they can see and do changes at once."),
  "team.resetToRole": ask("settings", team.resetToRole, "Put a team member back to their role's switches", "What they can see and do changes at once."),
  "team.setRolePerm": ask("settings", team.setRolePerm, "Change what a role can do", "Everyone with that role changes at once."),
  "team.resetRoles": ask("settings", team.resetRoles, "Put every role back to its starting switches", "Everyone's access changes at once."),
  "team.assign": ask("settings", team.assign, "Put team members on a project", "They can open the project."),
  "help.list": r("settings", help.list, "Help guides"),
  "help.guide": r("settings", help.guide, "One help guide"),
  "help.edit": c("settings", help.edit, "Start editing a help guide"),
  "help.reset": del("settings", help.reset, "Put a help guide back to Wrangler's"),
  "siteWatch.report": r("settings", siteWatch.report, "Site watch: what it found"),
  "siteWatch.finding": r("settings", siteWatch.finding, "One Site watch finding"),
  "siteWatch.summary": r("settings", siteWatch.summary, "Site watch in a line"),
  "siteWatch.markDone": ask("settings", siteWatch.markDone, "Mark a Site watch finding done", "It leaves the report."),
  "siteWatch.setPaused": ask("settings", siteWatch.setPaused, "Pause or resume Site watch's checks", "While paused, nothing is checked and no alert is sent."),

  // ---- home ----
  "home.dashboard": r("home", home.dashboard, "The Dashboard"),
  "home.needs": r("home", home.needs, "Needs you today"),
  "overviews.clients": r("home", overviews.clients, "The Clients overview"),
  "overviews.review": r("home", overviews.review, "The Review overview"),
  "overviews.docs": r("home", overviews.docs, "The Docs overview"),
  "overviews.proposals": r("home", overviews.proposals, "The Proposals overview"),
  "overviews.vendors": r("home", overviews.vendors, "The Vendors overview"),
  "activity.feed": r("home", activity.feed, "Recent activity (who watched, read, signed)"),
  "activity.recent": r("home", activity.recent, "The latest activity"),
  "auditLog.list": r("home", auditLog.list, "The Activity log (Settings): who changed what"),
  "bell.feed": r("home", bell.feed, "Heston's notifications"),
  "bell.unread": r("home", bell.unread, "How many notifications are unread"),
  "bell.prefs": { ...r("home", bell.prefs, "Which notifications Heston gets"), hide: ["endpoint", "endpoints", "keys"] },
  "bell.markRead": c("home", bell.markRead, "Mark a notification read"),
  "bell.markAllRead": c("home", bell.markAllRead, "Mark every notification read"),
  "bell.setPref": c("home", bell.setPref, "Turn a kind of notification on (turning one off is an ask)", { askWhen: (a) => (a.bell === false || a.phone === false ? "Heston stops getting those notifications." : null) }),

  // ---- photos and files (from site_upload) ----
  "gear.setPhoto": c("production", gear.setPhoto, "Set a gear item's photo (one site_upload made)"),
  "places.addPhoto": c("production", places.addPhoto, "Add a photo to a location (one site_upload made)"),
  "canvas.addFile": c("creative", canvas.addFile, "Put a file on a canvas (one site_upload made; a shared board is an ask)", { outside: sharedBoard }),
};

export const AREAS: Record<Area, string> = {
  projects: "Projects: the list, a project's page, stage, next step, dates, rounds, final files",
  production: "Production: shoots, call sheets, shot lists, releases (prepared; signed in person), gear, packing lists, locations",
  crew: "Crew: vendors, bookings, briefings",
  work: "Work: tasks, to-do lists, templates",
  creative: "Creative planning: creative docs and their text (pageText), canvases and mood boards, brand kits",
  delivery: "Delivery: folders, albums, files, publishing",
  money: "Money: invoices (drafts; sending and voiding ask), quotes, plans and subscriptions (read), vendor invoices, reports, raw footage storage. Claude never pays, charges or refunds: Heston does on the site",
  sales: "Sales: the pipeline, follow-ups, estimates, the job ledger, proposals (a first send is on the site; sending again or to more people asks)",
  clients: "Clients: their people and portal invites, messages, booking calls, testimonials, review links, kickoff briefs, file requests",
  settings: "Settings: the business, brand kit, pricing, Delivery and storage offers, notifications, menu and Dashboard, calendar, team and roles, help guides, Site watch (never sign-in, passwords, connector keys, exports or deleting the business)",
  home: "Home: the Dashboard, Needs you, overviews, activity, the Activity log, notifications",
};

const argsJson = new Map<string, unknown>();
/** The function's argument validator, as Convex exports it. */
export function argsOf(name: string) {
  if (!argsJson.has(name)) argsJson.set(name, JSON.parse(ACTIONS[name].fn.exportArgs()));
  return argsJson.get(name) as Parameters<typeof import("./siteGuard").argsProblem>[0];
}
