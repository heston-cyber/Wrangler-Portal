// Phase 4 (Nov 2): Settings › Calendar (frame 741:1953). Each business connects its own Google account and picks a
// calendar (D32). Shoots ticked "Add to {calendar}" go on it, move with it and come off it when cancelled; booked
// vendors and the client's people can be invited (Google sends the invites). Tokens stay in the backend.
// Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Convex (Heston's own Google Cloud sign-in setup) and the
// redirect address below added to it. Until then the section says so and shoots save without a calendar event.
import { action, httpAction } from "./_generated/server";
import { forBusiness, internalAction, internalMutation, internalQuery, mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { requireMe } from "./lib/access";
import { portalPeople } from "./projects";
import { label } from "./lib/bookingRows";
import { SITE } from "./lib/site";

const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.calendarlist.readonly", "https://www.googleapis.com/auth/calendar.events"];
const TZ = "America/Chicago"; // the businesses' wall clock (shoot times are local)
const creds = () => ({ id: process.env.GOOGLE_CLIENT_ID ?? "", secret: process.env.GOOGLE_CLIENT_SECRET ?? "" });
const hasKeys = () => !!(creds().id && creds().secret);
export const redirectUri = () => `${(process.env.CONVEX_SITE_URL ?? "").replace(/\/+$/, "")}/calendar/callback`;
const randomToken = () => { const b = new Uint8Array(24); crypto.getRandomValues(b); return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(""); };

// ---------- the owner's settings ----------

export const settings = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const c = await ctx.db.query("calendars").first();
    return {
      keys: hasKeys(), redirect: redirectUri(),
      connection: c ? { email: c.email, calendarId: c.calendarId ?? null, calendarName: c.calendarName ?? null, inviteVendors: c.inviteVendors, inviteClient: c.inviteClient, connectedAt: c.connectedAt, lastError: c.lastError ?? null } : null,
    };
  },
});

export const authUrl = action({
  args: {},
  handler: async (ctx): Promise<string> => {
    const me: { userId: string } = await ctx.runQuery(internal.users.assertAllowed, {});
    if (!hasKeys()) throw new ConvexError("Google Calendar isn't set up for the portal yet (the Google sign-in keys go in Convex).");
    const state = randomToken();
    await ctx.runMutation(internal.dropbox.insertState, { state, userId: me.userId });
    const q = new URLSearchParams({ client_id: creds().id, redirect_uri: redirectUri(), response_type: "code", scope: SCOPES.join(" "), access_type: "offline", prompt: "consent", include_granted_scopes: "true", state });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  },
});

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: creds().id, client_secret: creds().secret, ...params }) });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; refresh_token?: string; id_token?: string; error?: string; error_description?: string };
  if (!res.ok || !body.access_token) throw new Error(`Google sign-in failed: ${body.error_description || body.error || res.status}`);
  return body;
}
const emailOf = (idToken?: string) => {
  try { return String(JSON.parse(atob((idToken ?? "").split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).email ?? ""); } catch { return ""; }
};

export const callback = httpAction(async (ctx, req) => {
  const u = new URL(req.url);
  const back = (q: string) => new Response(null, { status: 302, headers: { location: `${SITE()}/settings/calendar?${q}` } });
  if (u.searchParams.get("error")) return back(`calendar=error&reason=${encodeURIComponent(u.searchParams.get("error") || "declined")}`);
  const code = u.searchParams.get("code"), state = u.searchParams.get("state");
  const st = code && state ? await ctx.runMutation(internal.dropbox.takeState, { state }) : false;
  if (!code || !st) return back("calendar=error&reason=expired");
  ctx = forBusiness(ctx, st.businessId);
  try {
    const tok = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri() });
    if (!tok.refresh_token) throw new Error("Google didn't send a refresh token. Remove the portal from your Google account's third-party access, then connect again.");
    await ctx.runMutation(internal.calendar.saveConnection, { email: emailOf(tok.id_token) || "your Google account", refreshToken: tok.refresh_token, accessToken: tok.access_token!, accessExpiresAt: Date.now() + (tok.expires_in ?? 3600) * 1000 });
    return back("calendar=connected");
  } catch (e) {
    return back(`calendar=error&reason=${encodeURIComponent(String((e as Error).message).slice(0, 200))}`);
  }
});

export const saveConnection = internalMutation({
  args: { email: v.string(), refreshToken: v.string(), accessToken: v.string(), accessExpiresAt: v.number() },
  handler: async (ctx, a) => {
    const old = await ctx.db.query("calendars").first();
    const keep = old ? { calendarId: old.calendarId, calendarName: old.calendarName, inviteVendors: old.inviteVendors, inviteClient: old.inviteClient } : { inviteVendors: true, inviteClient: false };
    if (old) await ctx.db.delete(old._id);
    await ctx.db.insert("calendars", { ...a, ...keep, connectedAt: Date.now() });
  },
});
export const getConnection = internalQuery({ args: {}, handler: async (ctx) => ctx.db.query("calendars").first() });
export const patchConnection = internalMutation({
  args: { accessToken: v.optional(v.string()), accessExpiresAt: v.optional(v.number()), lastError: v.optional(v.string()), clearError: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const c = await ctx.db.query("calendars").first();
    if (!c) return;
    await ctx.db.patch(c._id, { ...(a.accessToken ? { accessToken: a.accessToken, accessExpiresAt: a.accessExpiresAt } : {}), ...(a.lastError ? { lastError: a.lastError.slice(0, 300) } : {}), ...(a.clearError ? { lastError: undefined } : {}) });
  },
});

async function accessToken(ctx: ActionCtx): Promise<string> {
  const c: Doc<"calendars"> | null = await ctx.runQuery(internal.calendar.getConnection, {});
  if (!c) throw new Error("Google Calendar isn't connected.");
  if (c.accessToken && (c.accessExpiresAt ?? 0) > Date.now() + 120_000) return c.accessToken;
  const tok = await tokenRequest({ grant_type: "refresh_token", refresh_token: c.refreshToken });
  await ctx.runMutation(internal.calendar.patchConnection, { accessToken: tok.access_token, accessExpiresAt: Date.now() + (tok.expires_in ?? 3600) * 1000 });
  return tok.access_token!;
}
async function gcal(token: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`https://www.googleapis.com/calendar/v3${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: r.status, json, text };
}

/** The calendars to pick from (ones the account can add events to). */
export const calendars = action({
  args: {},
  handler: async (ctx): Promise<Array<{ id: string; name: string; primary: boolean }>> => {
    await ctx.runQuery(internal.users.assertAllowed, {});
    const r = await gcal(await accessToken(ctx), "GET", "/users/me/calendarList?minAccessRole=writer&maxResults=250");
    if (r.status !== 200) throw new ConvexError("Google didn't list your calendars. Try connecting again.");
    return (r.json?.items ?? []).map((c: any) => ({ id: String(c.id), name: String(c.summaryOverride ?? c.summary ?? c.id), primary: !!c.primary }));
  },
});

export const save = mutation({
  args: { calendarId: v.string(), calendarName: v.string(), inviteVendors: v.boolean(), inviteClient: v.boolean() },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const c = await ctx.db.query("calendars").first();
    if (!c) throw new ConvexError("Connect Google Calendar first.");
    await ctx.db.patch(c._id, { calendarId: a.calendarId.slice(0, 300), calendarName: a.calendarName.slice(0, 120), inviteVendors: a.inviteVendors, inviteClient: a.inviteClient });
    return null;
  },
});

export const disconnect = action({
  args: {},
  handler: async (ctx) => {
    await ctx.runQuery(internal.users.assertAllowed, {});
    const c: Doc<"calendars"> | null = await ctx.runQuery(internal.calendar.getConnection, {});
    if (c) { try { await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(c.refreshToken)}`, { method: "POST" }); } catch { /* already gone */ } }
    await ctx.runMutation(internal.calendar.removeConnection, {});
    return null;
  },
});
export const removeConnection = internalMutation({ args: {}, handler: async (ctx) => { for (const c of await ctx.db.query("calendars").collect()) await ctx.db.delete(c._id); } });

// ---------- shoots on the calendar ----------

/** What the event should be (null: it shouldn't be on the calendar). */
export const eventFor = internalQuery({
  args: { shootId: v.id("shoots") },
  handler: async (ctx, { shootId }) => {
    const s = await ctx.db.get(shootId);
    if (!s) return null;
    const c = await ctx.db.query("calendars").first();
    const p = await ctx.db.get(s.projectId);
    const want = !!c?.calendarId && s.status === "scheduled" && !!s.calendar && !!p;
    if (!want) return { want: false as const, event: s.calendarEvent ?? null };
    const attendees: string[] = [];
    if (c!.inviteVendors) for (const m of s.crew) if (m.vendorId) { const vd = await ctx.db.get(m.vendorId); if (vd?.email) attendees.push(vd.email); }
    if (c!.inviteClient) for (const x of await portalPeople(ctx, p!)) attendees.push(x.email);
    const end = s.wrap ?? `${String(Math.min(23, Number(s.call.slice(0, 2)) + 2)).padStart(2, "0")}${s.call.slice(2)}`;
    return {
      want: true as const, calendarId: c!.calendarId!, event: s.calendarEvent ?? null,
      body: {
        summary: `Shoot · ${label(p!)}`, location: s.location,
        description: [s.prepare.length ? `What to prepare:\n${s.prepare.map((l) => `• ${l}`).join("\n")}` : "", s.crew.length ? `Who's coming: ${s.crew.map((m) => `${m.name} (${m.role})`).join(", ")}` : "", `${SITE()}/projects/${p!._id}`].filter(Boolean).join("\n\n"),
        start: { dateTime: `${s.date}T${s.call}:00`, timeZone: TZ }, end: { dateTime: `${s.date}T${end}:00`, timeZone: TZ },
        attendees: [...new Set(attendees.map((e) => e.toLowerCase()))].map((email) => ({ email })),
        extendedProperties: { private: { portalShoot: String(s._id) } },
      },
    };
  },
});
export const setEvent = internalMutation({
  args: { shootId: v.id("shoots"), event: v.optional(v.object({ id: v.string(), calendarId: v.string() })) },
  handler: async (ctx, { shootId, event }) => { if (await ctx.db.get(shootId)) await ctx.db.patch(shootId, { calendarEvent: event }); },
});

/** Puts a shoot on the calendar, moves it, or takes it off: whatever its state calls for now. */
export const syncShoot = internalAction({
  args: { shootId: v.id("shoots") },
  handler: async (ctx, { shootId }): Promise<string> => {
    if (!hasKeys()) return "off";
    const d = await ctx.runQuery(internal.calendar.eventFor, { shootId });
    if (!d) return "gone";
    const conn = await ctx.runQuery(internal.calendar.getConnection, {});
    if (!conn) return "off";
    try {
      const token = await accessToken(ctx);
      const path = (cal: string, id?: string) => `/calendars/${encodeURIComponent(cal)}/events${id ? `/${encodeURIComponent(id)}` : ""}?sendUpdates=all`;
      if (!d.want) {
        if (d.event) { const r = await gcal(token, "DELETE", path(d.event.calendarId, d.event.id)); if (r.status >= 300 && r.status !== 404 && r.status !== 410) throw new Error(`delete ${r.status}`); await ctx.runMutation(internal.calendar.setEvent, { shootId }); }
        return "removed";
      }
      // A different calendar picked since: take it off the old one first.
      if (d.event && d.event.calendarId !== d.calendarId) { await gcal(token, "DELETE", path(d.event.calendarId, d.event.id)); }
      const same = d.event && d.event.calendarId === d.calendarId;
      let r = same ? await gcal(token, "PATCH", path(d.calendarId, d.event!.id), d.body) : await gcal(token, "POST", path(d.calendarId), d.body);
      if (same && (r.status === 404 || r.status === 410)) r = await gcal(token, "POST", path(d.calendarId), d.body); // deleted by hand: add it again
      if (r.status >= 300 || !r.json?.id) throw new Error(`${r.status}: ${r.json?.error?.message ?? r.text.slice(0, 120)}`);
      await ctx.runMutation(internal.calendar.setEvent, { shootId, event: { id: String(r.json.id), calendarId: d.calendarId } });
      await ctx.runMutation(internal.calendar.patchConnection, { clearError: true });
      return same ? "moved" : "added";
    } catch (e) {
      const m = String((e as Error).message);
      await ctx.runMutation(internal.calendar.patchConnection, { lastError: `A shoot didn't reach your calendar: ${m}` });
      return "failed";
    }
  },
});
/** For shoots.ts: line up a calendar sync (after the shoot's own write). */
export async function queueCalendar(ctx: { scheduler: { runAfter: (d: number, f: any, a: any) => Promise<unknown> } }, shootId: Id<"shoots">) {
  await ctx.scheduler.runAfter(0, internal.calendar.syncShoot, { shootId });
}
