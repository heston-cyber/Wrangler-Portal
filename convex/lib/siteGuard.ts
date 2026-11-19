// Phase 8b (Heston, Nov 18, D208/D209): the connector runs the site's own functions as the business owner, so a change
// made by Claude goes through exactly the checks, privacy rules and side effects Heston's own click does. Around every
// such run sits a guard that sees everything the run would send to someone: a scheduled email or message job, an Inbox
// post, a review or portal invite, a calendar invite. Claude's direct changes may send nothing (the run is undone and
// Claude is told to ask); Claude's asks are tried once first (undone), and what they would send is what the Confirm page
// shows; Heston's Confirm then runs it for real and refuses if it would now reach anyone different.
import { ConvexError } from "convex/values";
import { getFunctionName } from "convex/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { allowedEmails } from "./owners";
import { defaultBusiness } from "./business";
import { portalPeople } from "../projects";

// ---------------- what a run sends ----------------

export type Outbound = { what: string; to: string[] };

/** Jobs that reach no one outside the business: the owner's own calendar copy (its invites are checked on the row),
 *  looking up a place's map position, a forecast, a link's own expiry clock, the owner's own bell. */
const QUIET_JOBS = new Set(["calendarSync:push", "calendarSync:pushDates", "calendarSync:purge", "calendarSync:pull", "places:locate", "callSheets:weatherOne", "briefings:expiryTick", "bell:post",
  "stills:cleanup"]); // a deleted video's stills and stream files: tidying, sends nothing

const JOB_NAMES: Record<string, string> = {
  "callSheets:mail": "Call sheet email",
  "shoots:mailData": "Shoot email", "shoots:mailOwner": "Email to the owner about a shoot", "shoots:mail": "Shoot email",
  "bookings:mailOffer": "Booking offer email to the vendor", "bookings:mailCancelled": "Booking cancelled email to the vendor",
  "vendors:mailInvite": "Vendor portal invite email", "vendors:mailEmailChanged": "Email to the vendor about their address",
  "briefings:mail": "Briefing email", "emails:portalInvite": "Portal invite email", "shares:sendInviteEmail": "Review link email",
  "emails:newVersion": "New cut email", "emails:replyToNote": "Reply email",
};

/** Tables whose new rows reach someone: their Inbox, an invite, a link with access. */
const REACHING_TABLES: Record<string, string> = {
  inboxItems: "Inbox post", shareMembers: "Review access", shares: "Review link", invites: "Portal invite", teamInvites: "Team invite",
  businessInvites: "Business invite", emailLog: "Email", canvasPeople: "Canvas shared with a person", offerRecipients: "Quote or proposal sent",
  briefingRecipients: "Briefing sent", guestPasses: "Call sheet guest login", messages: "Message", deliveryLinks: "Delivery link",
};

const EMAIL = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

/** The most people one line lists; past it the line says how many more, so it still can't be confirmed unseen. */
const MAX_PEOPLE = 2000;
const ADDRESS_KEYS = /^(email|emails|to|cc|bcc|guests|recipients|attendees|address)$/i;

/** The people a job's arguments or a row name: "Name <email>" where both are there, else the address. Review H1:
 *  every value under an address field counts, whatever its shape (the site accepts looser addresses than a strict
 *  pattern would), and loose text that looks like an address counts too. */
export function peopleIn(x: unknown, out = new Set<string>(), depth = 0, underAddress = false): Set<string> {
  if (depth > 8 || x === null || x === undefined) return out;
  const add = (v: string) => { if (out.size < MAX_PEOPLE) out.add(v); else out.add("(and more)"); };
  if (typeof x === "string") {
    const t = x.trim();
    if (t && (underAddress ? t.includes("@") : /^[^\s@:]+@[^\s@:]+\.[^\s@:]+$/.test(t))) add(t.toLowerCase());
    return out;
  }
  if (Array.isArray(x)) { for (const y of x) peopleIn(y, out, depth + 1, underAddress); return out; }
  if (typeof x === "object") {
    const o = x as Record<string, unknown>;
    if (typeof o.email === "string" && o.email.trim()) {
      const e = o.email.trim().toLowerCase();
      add(typeof o.name === "string" && o.name.trim() ? `${o.name.trim().slice(0, 60)} <${e}>` : e);
    }
    for (const [k, y] of Object.entries(o)) if (k !== "email") peopleIn(y, out, depth + 1, ADDRESS_KEYS.test(k));
  }
  return out;
}

/** One line per kind of thing sent, its people sorted (so two runs compare equal when they reach the same people). */
export function summarize(list: Outbound[]): Outbound[] {
  const by = new Map<string, Set<string>>();
  for (const o of list) { const s = by.get(o.what) ?? new Set<string>(); for (const t of o.to) s.add(t); by.set(o.what, s); }
  return [...by.entries()].map(([what, s]) => ({ what, to: [...s].sort() })).sort((a, b) => a.what.localeCompare(b.what));
}
export const sameReach = (a: Outbound[], b: Outbound[]) => JSON.stringify(summarize(a)) === JSON.stringify(summarize(b));

/**
 * A context whose scheduler and database note everything that would reach someone. The run itself goes ahead as usual;
 * the caller decides afterwards (undo by throwing, or compare with what was asked).
 */
/** Records a job names only by id that hold the people it goes to (a booking's vendor, a vendor, a client's person). */
const PEOPLE_TABLES = ["vendors", "vendorBookings", "clientPeople", "users", "memberships", "invites", "teamInvites", "canvasPeople", "guestPasses"] as const;

/** Who a shoot's Google event invites (as calendar.eventFor works it out). */
async function shootInvitees(ctx: MutationCtx, shootId: string): Promise<string[]> {
  const sid = ctx.db.normalizeId("shoots", shootId);
  const s = sid ? await ctx.db.get(sid) : null;
  if (!s) return [];
  // Re-review Med-3: this business's own calendar connection, never the first in the deployment.
  const biz = s.businessId ?? (await defaultBusiness(ctx))?._id ?? null;
  const dflt = (await defaultBusiness(ctx))?._id ?? null;
  const c = (await ctx.db.query("calendars").collect()).find((x) => (x.businessId ?? dflt) === biz);
  const p = s.projectId ? await ctx.db.get(s.projectId) : null;
  // Re-review L6: a shoot coming off the calendar (cancelled, unticked) emails its guests a cancellation too.
  if (!c?.calendarId || !p || (!s.calendar && !s.calendarEvent)) return [];
  const out = new Set<string>();
  if (c.inviteVendors) for (const m of s.crew) if (m.vendorId) { const vd = await ctx.db.get(m.vendorId); if (vd?.email) out.add(vd.email.toLowerCase()); }
  if (c.inviteClient && !s.clientHold) for (const x of await portalPeople(ctx, p)) out.add(x.email.toLowerCase());
  return [...out];
}

export function recording<C extends MutationCtx>(ctx: C, seen: Outbound[]): C {
  const note = (what: string, payload: unknown) => seen.push({ what, to: [...peopleIn(payload)] });
  const idsIn = (x: unknown, out: string[] = [], depth = 0): string[] => {
    if (depth > 4 || out.length > 20) return out;
    if (typeof x === "string") out.push(x);
    else if (Array.isArray(x)) x.forEach((y) => idsIn(y, out, depth + 1));
    else if (x && typeof x === "object") Object.values(x).forEach((y) => idsIn(y, out, depth + 1));
    return out;
  };
  const job = async (f: unknown, a: unknown) => {
    let name = "";
    try { name = getFunctionName(f as never); } catch { name = "a job"; }
    if (QUIET_JOBS.has(name)) return;
    // Review M5: a shoot's calendar sync with invites works out its guests later; work them out now, as it will.
    if (name === "calendar:syncShoot") {
      const sa = a as { shootId?: string; sendUpdates?: string };
      if (sa?.sendUpdates !== "all" || !sa.shootId) return;
      const to = await shootInvitees(ctx, sa.shootId);
      if (to.length) seen.push({ what: "Calendar invite from Google", to });
      return;
    }
    const people = peopleIn(a);
    for (const id of idsIn(a)) for (const t of PEOPLE_TABLES) {
      if (!ctx.db.normalizeId(t, id)) continue;
      const d = (await ctx.db.get(id as never)) as Record<string, unknown> | null;
      if (d) peopleIn(d, people);
      if (d && typeof d.vendorId === "string") peopleIn(await ctx.db.get(d.vendorId as never), people);
      break;
    }
    seen.push({ what: JOB_NAMES[name] ?? `Sends something (${name})`, to: [...people] });
  };
  const scheduler = new Proxy(ctx.scheduler, {
    get(t, prop, r) {
      if (prop === "runAfter") return async (d: number, f: never, a?: unknown) => { await job(f, a); return t.runAfter(d, f, a as never); };
      if (prop === "runAt") return async (d: number | Date, f: never, a?: unknown) => { await job(f, a); return t.runAt(d, f, a as never); };
      const v = Reflect.get(t, prop, r);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
  const calendarInvite = (doc: Record<string, unknown> | null | undefined) => {
    if (doc && doc.sendUpdates === "all") note("Calendar invite or update from Google", doc.guests);
  };
  const db = ctx.db;
  const gdb = new Proxy(db, {
    get(t, prop, r) {
      if (prop === "insert") return async (table: string, doc: Record<string, unknown>) => {
        // A call-sheet guest's pass is made when they're added and reaches them only once the sheet is sent to them.
        if (REACHING_TABLES[table] && !(table === "guestPasses" && !doc.sentAt)) note(REACHING_TABLES[table], doc);
        if (table === "calendarEvents") calendarInvite(doc);
        return t.insert(table as never, doc as never);
      };
      if (prop === "patch" || prop === "replace") return async (a0: unknown, a1: unknown, a2?: unknown) => {
        const [table, id, value] = a2 === undefined ? [null, a0, a1] : [a0 as string, a1, a2];
        const isCal = table === "calendarEvents" || (!table && t.normalizeId("calendarEvents", id as string));
        if (isCal) {
          const cur = (await t.get(id as never)) as Record<string, unknown> | null;
          calendarInvite({ ...(cur ?? {}), ...(value as Record<string, unknown>) });
        }
        const fn = (t as unknown as Record<string, (...x: unknown[]) => unknown>)[prop as string];
        return a2 === undefined ? fn.call(t, id, value) : fn.call(t, table, id, value);
      };
      const v = Reflect.get(t, prop, r);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
  return { ...ctx, scheduler, db: gdb } as C;
}

// ---------------- acting as the business owner ----------------

/**
 * The owner of this business, as a signed-in caller would be: the earliest live owner membership's login (or, for the
 * default business, an ALLOWED_EMAILS login). Checked afterwards with the site's own viewerOf and scope (siteRun.ts).
 */
export async function ownerUserOf(ctx: QueryCtx | MutationCtx, biz: Id<"businesses">): Promise<Id<"users">> {
  const ms = (await ctx.db.query("memberships").collect()).filter((m) => m.businessId === biz && m.role === "owner" && !m.revokedAt).sort((a, b) => a.createdAt - b.createdAt);
  const emails = ms.map((m) => m.email.toLowerCase());
  if (!emails.length && (await defaultBusiness(ctx))?._id === biz) emails.push(...allowedEmails());
  for (const e of emails) {
    const u = await ctx.db.query("users").withIndex("email", (q) => q.eq("email", e)).first();
    if (u && u.role !== "guest" && u.role !== "team") return u._id;
  }
  throw new ConvexError("This business's owner hasn't signed in to the site yet, so the connector can't act for them.");
}

/** A context signed in as that login, marked as Claude's (Activity lines say "Claude"). No session: nothing per-device. */
export function asUser<C extends QueryCtx | MutationCtx>(ctx: C, userId: Id<"users">): C {
  const identity = { subject: userId as string, issuer: "wrangler-portal-connector", tokenIdentifier: `wrangler-portal-connector|${userId}` };
  // Review L7: a nested run would lose this sign-in and the guard, so none is allowed.
  const no = async () => { throw new ConvexError("That can't be done through the connector."); };
  return { ...ctx, auth: { ...ctx.auth, getUserIdentity: async () => identity }, viaClaude: true, runQuery: no, runMutation: no, runAction: no } as C;
}

// ---------------- arguments, checked as Convex would ----------------

type VJson = { type: string; value?: unknown; tableName?: string; keys?: VJson; values?: { fieldType: VJson; optional: boolean } };

/** The reason these arguments don't fit the function's validator, or null. (Convex checks this before a call; a run
 *  through the handler doesn't, so it's done here.) */
export function argsProblem(v: VJson, x: unknown, at = "args", isId?: (table: string, id: string) => boolean): string | null {
  const bad = (want: string) => `${at} should be ${want}`;
  switch (v.type) {
    case "any": return null;
    case "null": return x === null ? null : bad("null");
    case "number": return typeof x === "number" && Number.isFinite(x) ? null : bad("a number");
    case "bigint": return typeof x === "bigint" ? null : bad("a whole number");
    case "boolean": return typeof x === "boolean" ? null : bad("true or false");
    case "string": return typeof x === "string" ? null : bad("text");
    case "bytes": return bad("bytes (not available here)");
    case "literal": return x === v.value ? null : bad(JSON.stringify(v.value));
    case "id": return typeof x === "string" && (!isId || isId(v.tableName!, x)) ? null : bad(`an id from ${v.tableName}`);
    case "array": {
      if (!Array.isArray(x)) return bad("a list");
      if (x.length > 2000) return `${at} is too long`;
      for (let i = 0; i < x.length; i++) { const p = argsProblem(v.value as VJson, x[i], `${at}[${i}]`, isId); if (p) return p; }
      return null;
    }
    case "object": {
      if (!x || typeof x !== "object" || Array.isArray(x)) return bad("an object");
      const fields = v.value as Record<string, { fieldType: VJson; optional: boolean }>;
      for (const k of Object.keys(x)) if (!Object.prototype.hasOwnProperty.call(fields, k)) return `${at}.${k} isn't one of: ${Object.keys(fields).join(", ") || "(none)"}`;
      for (const [k, f] of Object.entries(fields)) {
        const y = (x as Record<string, unknown>)[k];
        if (y === undefined) { if (!f.optional) return `${at}.${k} is needed`; continue; }
        const p = argsProblem(f.fieldType, y, `${at}.${k}`, isId);
        if (p) return p;
      }
      return null;
    }
    case "record": {
      if (!x || typeof x !== "object" || Array.isArray(x)) return bad("an object");
      for (const [k, y] of Object.entries(x)) {
        const kp = v.keys ? argsProblem(v.keys, k, `${at} key ${k}`, isId) : null;
        if (kp) return kp;
        const p = argsProblem(v.values!.fieldType, y, `${at}.${k}`, isId);
        if (p) return p;
      }
      return null;
    }
    case "union": {
      const opts = v.value as VJson[];
      for (const o of opts) if (!argsProblem(o, x, at, isId)) return null;
      return `${at} doesn't fit any of its allowed shapes`;
    }
    default: return `${at} can't be checked`;
  }
}

/** The tables of the ids this validator takes, with the paths to them (for showing names on the Confirm page). */
export function idPaths(v: VJson, x: unknown, path: string[] = [], out: Array<{ table: string; id: string }> = []) {
  if (x === undefined || x === null || out.length > 40) return out;
  if (v.type === "id" && typeof x === "string") out.push({ table: v.tableName!, id: x });
  else if (v.type === "array" && Array.isArray(x)) x.forEach((y) => idPaths(v.value as VJson, y, path, out));
  else if (v.type === "object" && typeof x === "object") {
    for (const [k, f] of Object.entries(v.value as Record<string, { fieldType: VJson }>)) idPaths(f.fieldType, (x as Record<string, unknown>)[k], [...path, k], out);
  } else if (v.type === "union") for (const o of v.value as VJson[]) if (!argsProblem(o, x)) { idPaths(o, x, path, out); break; }
  return out;
}

/** Plain JSON Schema for Claude, from the validator. */
export function toSchema(v: VJson): Record<string, unknown> {
  switch (v.type) {
    case "any": return {};
    case "null": return { type: "null" };
    case "number": return { type: "number" };
    case "bigint": return { type: "integer" };
    case "boolean": return { type: "boolean" };
    case "string": return { type: "string" };
    case "literal": return { const: v.value };
    case "id": return { type: "string", description: `an id from ${v.tableName}` };
    case "array": return { type: "array", items: toSchema(v.value as VJson) };
    case "record": return { type: "object", additionalProperties: toSchema(v.values!.fieldType) };
    case "union": {
      const opts = v.value as VJson[];
      if (opts.every((o) => o.type === "literal")) return { enum: opts.map((o) => o.value) };
      return { anyOf: opts.map(toSchema) };
    }
    case "object": {
      const fields = v.value as Record<string, { fieldType: VJson; optional: boolean }>;
      return { type: "object", properties: Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, toSchema(f.fieldType)])), required: Object.entries(fields).filter(([, f]) => !f.optional).map(([k]) => k), additionalProperties: false };
    }
    default: return {};
  }
}

// ---------------- what leaves through the connector ----------------

/** W-9s, tax ID numbers, bank details, passwords, keys and secret hashes never leave: only whether one is on file. */
// Review L2: link tokens (a person's own canvas link, a doc's share token) and how a vendor is paid stay out too; the
// pages' own links (url, link) still come through, for an email Heston sends himself.
const SECRET_KEY = /token|passcode|privatekey|guestkey|hash$|paymethod|address1099|w9address|taxaddress|w-?9|taxid|tax_id|^tin$|ssn|^ein$|bank|routing|iban|swift|accountnumber|account_number|last4|password|secret|apikey|api_key|codehash|keyhash|pinhash|^hash$|refreshtoken|accesstoken|stripeaccount|payout/i;

export function scrub(x: unknown, hide: string[] = [], depth = 0): unknown {
  if (depth > 30) return "(too deep)";
  if (Array.isArray(x)) return x.map((y) => scrub(y, hide, depth + 1));
  if (x && typeof x === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, y] of Object.entries(x as Record<string, unknown>)) {
      if (SECRET_KEY.test(k) || hide.includes(k)) out[k] = y === null || y === undefined || y === false || y === "" ? "(none)" : "(on file)";
      else out[k] = scrub(y, hide, depth + 1);
    }
    return out;
  }
  if (typeof x === "bigint") return Number(x);
  return x;
}
