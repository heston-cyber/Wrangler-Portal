// Nov 4 · screen states (Q88 call-sheet details, Q93/Q94 footage paid late). T6.1: a guest's ended sheets stay in their
// list, flagged ended, with the day access ended; the "Sheets from" switcher has data for more than one business only,
// with the right "N new" counts. T6.2: "Updated today" shows only on the day of the update (client, vendor and guest).
// T6.3: Send an update and Remind can leave a group out. T6.4: footage paid late, Keep it for a year: kept until a year
// from the day it was PAID, no new invoice. T6.5: I'll refund it: marked to refund with a link to that invoice in
// Stripe (test mode), and the box closes when Stripe reports the refund (an existing, signature-checked webhook);
// another Stripe account's refund doesn't close it. T6.6: another business's owner sees and changes none of it;
// clients and vendors can't call the owner's functions.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { world } from "./payHarness";
import { todayCentral } from "../convex/lib/bookings";
import { addDays, addYear } from "../convex/footage";

const api = anyApi;
const internal = anyApi;
beforeAll(async () => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_ONLY_TO = "";
  process.env.CONVEX_SITE_URL = "https://handsome-hummingbird-11.convex.site";
  // Convex Auth mints a JWT once sign-in succeeds; a throwaway RSA pair made here, never a real key.
  const { generateKeyPairSync } = await import("node:crypto");
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.JWT_PRIVATE_KEY = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  process.env.JWKS = JSON.stringify({ keys: [{ use: "sig", alg: "RS256", ...pair.publicKey.export({ format: "jwk" }) }] });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

type W = Awaited<ReturnType<typeof world>>;
type Sent = { to: string; subject: string; text: string };
const stub = (mails: Sent[]) => vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url === "https://api.resend.com/emails") { const b = JSON.parse(String(init?.body)); mails.push({ to: b.to[0], subject: b.subject, text: b.text }); return new Response(JSON.stringify({ id: "em" }), { status: 200 }); }
  return new Response("{}", { status: 500 }); // nothing else may be reached: no Stripe call, no refund
}));
const settle = async (w: W) => { vi.useFakeTimers(); await w.t.finishAllScheduledFunctions(vi.runAllTimers); vi.useRealTimers(); };
const day = (n: number) => addDays(todayCentral(), n);
const RILEY = "riley@example.com", JORDAN = "jordan@ellis.example";
const codeOf = (mails: Sent[], to: string) => { const m = [...mails].reverse().find((x) => x.to === to && /is your WranglerPortal code$/.test(x.subject)); return m ? /\b(\d{6})\b/.exec(m.text)![1] : null; };

/** Maya reads the client side; Jordan is a vendor booked on the shoot day; a sheet for day 4 from a template. */
async function sheetSetup(w: W) {
  await w.t.run(async (ctx) => {
    const owner = (await ctx.db.query("users").first())!._id;
    const s = await ctx.db.insert("shares", { businessId: w.A, token: "tok-proj-1", kind: "project", projectId: w.p, access: "comment", who: "invited", allVersions: true, downloads: false, emailNewVersions: true, createdAt: 0, createdBy: owner });
    await ctx.db.insert("shareMembers", { businessId: w.A, shareId: s, email: "maya@harbor.example", addedAt: 0 });
  });
  const jordan = await w.heston.mutation(api.vendors.add, { name: "Jordan Ellis", email: JORDAN, roles: ["Camera"], rates: [], invite: true }) as Id<"vendors">;
  const kJ = await w.heston.mutation(api.bookings.create, { vendorId: jordan, projectId: w.p, role: "Camera", start: day(4), end: day(4), cents: 100_000, unit: "day" }) as Id<"vendorBookings">;
  const sub = await w.t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: JORDAN, name: "Jordan Ellis", role: "vendor" });
    await ctx.db.insert("memberships", { businessId: w.A, email: JORDAN, userId, role: "vendor", createdAt: Date.now() });
    await ctx.db.patch(kJ, { status: "accepted" });
    return `${userId}|${await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 })}`;
  });
  const { shootId } = await w.heston.mutation(api.shoots.schedule, { projectId: w.p, date: day(4), call: "07:30", wrap: "13:00", location: "Studio B", parking: "", prepare: [], withOwner: true, bookingIds: [kJ], calendar: false }) as { shootId: Id<"shoots"> };
  await w.heston.mutation(api.callSheets.ensureStarters, {});
  const tpl = (await w.heston.query(api.callSheets.newOptions, {})).templates.find((t: { name: string }) => t.name === "Standard shoot day")._id;
  const cs = await w.heston.mutation(api.callSheets.create, { shootId, how: "template", templateId: tpl }) as Id<"callSheets">;
  return { cs, shootId, jordan: w.t.withIdentity({ subject: sub }) };
}
const tokenOf = (w: W, callSheetId: Id<"callSheets">, personId: string) =>
  w.t.run(async (ctx) => (await ctx.db.query("guestPasses").withIndex("by_sheet", (q) => q.eq("callSheetId", callSheetId)).collect()).find((p) => p.personId === personId)!.token);
async function signInAsGuest(w: W, mails: Sent[], token: string, email: string) {
  await w.t.action(api.guests.sendCode, { token });
  const r = await w.t.action(api.auth.signIn, { provider: "guest", params: { token, code: codeOf(mails, email)! } }) as { tokens?: unknown };
  expect(r.tokens).toBeTruthy();
  const sub = await w.t.run(async (ctx) => {
    const u = (await ctx.db.query("users").withIndex("email", (q) => q.eq("email", email)).collect())[0];
    const s = (await ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", u._id)).collect()).sort((a, b) => b._creationTime - a._creationTime)[0];
    return `${u._id}|${s._id}`;
  });
  return w.t.withIdentity({ subject: sub });
}
/** A sent sheet from business B for the same guest email (made directly: B's owner has nothing else here). */
const bSheet = (w: W, date: string) => w.t.run(async (ctx) => {
  const B = (await ctx.db.query("businesses").withIndex("by_slug", (q) => q.eq("slug", "other")).unique())!._id;
  const p = await ctx.db.insert("projects", { businessId: B, name: "Juniper", createdAt: 0 });
  const s = await ctx.db.insert("shoots", { businessId: B, projectId: p, date, call: "08:00", location: "Riverside Loft", prepare: [], crew: [], status: "scheduled", history: [], createdAt: 0, updatedAt: 0 });
  const c = await ctx.db.insert("callSheets", { businessId: B, shootId: s, projectId: p, how: "blank", status: "sent", sentAt: 0, updates: 0,
    recipients: [{ id: "guest:b", kind: "guest", name: "Riley Quinn", email: RILEY, on: true, sentAt: 1, addedAt: 0 }],
    sent: { title: "Call sheet", page: { type: "doc", content: [] }, fields: {}, style: {}, at: 1, round: 0, heading: "Brand film · Juniper Table", date }, history: [], createdAt: 0, updatedAt: 0 });
  await ctx.db.insert("guestPasses", { businessId: B, callSheetId: c, personId: "guest:b", email: RILEY, token: "juniperjuniperjuniper1", createdAt: 0, sentAt: 1, date });
  return { B, c };
});

describe("Q88 call-sheet details", () => {
  test("T6.1 ended sheets stay listed (flagged, with the day access ended); the switcher only with more than one business, with N new", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const { cs, shootId } = await sheetSetup(w);
    const riley = await w.heston.mutation(api.callSheets.addGuest, { callSheetId: cs, name: "Riley Quinn", email: RILEY, role: "Talent" }) as string;
    await w.heston.mutation(api.callSheets.send, { callSheetId: cs, crew: true, client: true, guests: true });
    await settle(w);
    const tok = await tokenOf(w, cs, riley);
    const rileyIn = await signInAsGuest(w, mails, tok, RILEY);

    // One business: its sheet under Upcoming, new (not opened); one business means no switcher (the page hides it).
    let h = await rileyIn.query(api.guests.home, {});
    expect(h.businesses).toEqual([{ businessId: w.A, name: "Wrangler Productions", fresh: 1 }]);
    expect(h.sheets).toEqual([expect.objectContaining({ token: tok, state: "upcoming", isNew: true, updatedToday: false, endedOn: null })]);

    // A second business sends her a sheet: two businesses, each with one new; A is shown (its shoot is sooner).
    const { B } = await bSheet(w, day(9));
    h = await rileyIn.query(api.guests.home, {});
    expect(h.businessId).toBe(w.A);
    expect(h.businesses.map((b: { name: string; fresh: number }) => [b.name, b.fresh])).toEqual([["Wrangler Productions", 1], ["Other Films", 1]]);
    expect(JSON.stringify(h.sheets)).not.toContain("Juniper"); // one business's sheets at a time
    // Opening A's sheet: A has none new; B's still counts.
    await rileyIn.mutation(api.guests.opened, { token: tok });
    h = await rileyIn.query(api.guests.home, {});
    expect(h.businesses.map((b: { fresh: number }) => b.fresh)).toEqual([0, 1]);
    expect(h.sheets[0].isNew).toBe(false);
    // Switching to B: only B's sheet.
    const hb = await rileyIn.query(api.guests.home, { businessId: B });
    expect(hb.businessId).toBe(B);
    expect(hb.sheets).toEqual([expect.objectContaining({ token: "juniperjuniperjuniper1", title: "Brand film · Juniper Table", state: "upcoming", isNew: true })]);
    expect(JSON.stringify(hb.sheets)).not.toContain(tok);

    // Today: the shoot day itself.
    await w.t.run(async (ctx) => { await ctx.db.patch(shootId, { date: day(0) }); });
    expect((await rileyIn.query(api.guests.home, {})).sheets[0].state).toBe("today");
    // The day after the shoot: Ended, access ended the day after; the link opens Access ended (title and day only).
    await w.t.run(async (ctx) => { await ctx.db.patch(shootId, { date: day(-2) }); });
    h = await rileyIn.query(api.guests.home, { businessId: w.A });
    expect(h.sheets).toEqual([{ token: tok, title: "Launch · Harbor Coffee", date: day(4), call: "", place: "", state: "ended", endedOn: day(-1), updatedToday: false, isNew: false }]);
    expect(await rileyIn.query(api.guests.sheet, { token: tok })).toMatchObject({ ended: true, title: "Launch · Harbor Coffee" });
    // Ended by hand: still listed (the pass keeps its hint), access ended today.
    await w.t.run(async (ctx) => { await ctx.db.patch(shootId, { date: day(4) }); });
    await w.heston.mutation(api.callSheets.endGuest, { callSheetId: cs, id: riley });
    h = await rileyIn.query(api.guests.home, { businessId: w.A });
    expect(h.sheets).toEqual([expect.objectContaining({ token: tok, state: "ended", endedOn: todayCentral() })]);
    expect(h.businesses.map((b: { businessId: string }) => b.businessId).sort()).toEqual([w.A, B].sort()); // both still listed
    // Restored but not sent again: not in the list until it goes to her.
    await w.heston.mutation(api.callSheets.restoreGuest, { callSheetId: cs, id: riley });
    expect((await rileyIn.query(api.guests.home, { businessId: w.A })).sheets).toEqual([]);
  }, 60_000);

  test("T6.2 'Updated today' only on the day of the update, for the client, the vendor and the guest; T6.3 groups can be left out", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const { cs, jordan } = await sheetSetup(w);
    const riley = await w.heston.mutation(api.callSheets.addGuest, { callSheetId: cs, name: "Riley Quinn", email: RILEY, role: "Talent" }) as string;
    const sent = await w.heston.mutation(api.callSheets.send, { callSheetId: cs, crew: true, client: true, guests: true });
    expect(sent.sent).toBe(3);
    await settle(w);
    const tok = await tokenOf(w, cs, riley);
    const rileyIn = await signInAsGuest(w, mails, tok, RILEY);
    // Not updated yet: no banner anywhere.
    expect(await w.maya.query(api.callSheets.forClient, { callSheetId: cs })).toMatchObject({ updatedToday: false, change: null });
    expect(await jordan.query(api.vendorPortal.callSheet, { callSheetId: cs })).toMatchObject({ updatedToday: false, change: null });
    expect(await rileyIn.query(api.guests.sheet, { token: tok })).toMatchObject({ updatedToday: false, change: null });

    // T6.3: an update that leaves the guests out of the email; everyone reads the new copy.
    mails.length = 0;
    const up = await w.heston.mutation(api.callSheets.sendUpdate, { callSheetId: cs, changed: "The talent call moved to 9:00 AM", guests: false });
    expect(up.sent).toBe(2);
    await settle(w);
    expect(mails.filter((m) => /call sheet/i.test(m.subject)).map((m) => m.to).sort()).toEqual([JORDAN, "maya@harbor.example"]);
    await expect(w.heston.mutation(api.callSheets.sendUpdate, { callSheetId: cs, changed: "x", crew: false, client: false, guests: false })).rejects.toThrow(/at least one group/);

    // The day of the update: the banner, with what changed, for all three readers.
    for (const v of [await w.maya.query(api.callSheets.forClient, { callSheetId: cs }), await jordan.query(api.vendorPortal.callSheet, { callSheetId: cs }), await rileyIn.query(api.guests.sheet, { token: tok })])
      expect(v).toMatchObject({ updatedToday: true, change: { text: "The talent call moved to 9:00 AM" } });
    expect((await rileyIn.query(api.guests.home, {})).sheets[0].updatedToday).toBe(true);

    // The next day (Central): no banner, no change line, and the guest's list chip is gone.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${day(1)}T18:00:00Z`));
    for (const v of [await w.maya.query(api.callSheets.forClient, { callSheetId: cs }), await jordan.query(api.vendorPortal.callSheet, { callSheetId: cs }), await rileyIn.query(api.guests.sheet, { token: tok })])
      expect(v).toMatchObject({ updatedToday: false, change: null, updated: true });
    expect((await rileyIn.query(api.guests.home, {})).sheets[0].updatedToday).toBe(false);
    vi.useRealTimers();

    // Remind, groups left out: only the client's people who haven't opened it (Maya), not the guest or the crew.
    mails.length = 0;
    const r = await w.heston.mutation(api.callSheets.remind, { callSheetId: cs, crew: false, guests: false });
    expect(r.sent).toBe(1);
    await settle(w);
    expect(mails.filter((m) => /call sheet/i.test(m.subject)).map((m) => m.to)).toEqual(["maya@harbor.example"]);

    // Owners only: a client, a vendor, a guest and another business's owner can't send updates or reminders.
    for (const who of [w.maya, jordan, rileyIn, w.boss]) {
      await expect(who.mutation(api.callSheets.sendUpdate, { callSheetId: cs, changed: "x" })).rejects.toThrow();
      await expect(who.mutation(api.callSheets.remind, { callSheetId: cs })).rejects.toThrow();
    }
  }, 60_000);
});

// ---------- Q93 / Q94: raw footage paid late ----------

async function footageSetup(w: W) {
  await w.t.run(async (ctx) => {
    const s = await ctx.db.insert("shares", { businessId: w.A, token: "tok-proj-1", kind: "project", projectId: w.p, access: "comment", who: "invited", allVersions: true, downloads: false, emailNewVersions: true, createdAt: 0, createdBy: (await ctx.db.query("users").first())!._id });
    await ctx.db.insert("shareMembers", { businessId: w.A, shareId: s, email: "maya@harbor.example", addedAt: 0 });
    await ctx.db.insert("deliveryFiles", { businessId: w.A, projectId: w.p, name: "Launch_FINAL.mov", kind: "dropbox", dropboxPath: "/launch_final.mov", createdAt: 0 });
  });
}
const markSent = (w: W, id: Id<"invoices">, sid: string) => w.t.run(async (ctx) => { await ctx.db.patch(id, { status: "open", stripe: { accountId: "acct_A", invoiceId: sid, customerId: "cus_1", livemode: false } }); });
const webhook = (w: W, sid: string, status: string) => w.t.mutation(internal.invoices.applyStripeInvoice, { accountId: "acct_A", invoice: { id: sid, status, total: 10000, amount_paid: status === "paid" ? 10000 : 0, amount_remaining: status === "paid" ? 0 : 10000 }, eventType: `invoice.${status}` });
const row = (w: W) => w.t.run(async (ctx) => (await ctx.db.query("footageStorage").collect())[0]);
const invoices = (w: W) => w.t.run(async (ctx) => (await ctx.db.query("invoices").collect()));
const runDue = async (w: W) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${todayCentral()}T19:00:00Z`));
  await w.t.action(internal.footage.runDue, {});
  vi.useRealTimers();
  await settle(w);
};
/** Keep it, the first year paid, the renewal drafted and sent, Stop storing, then the renewal paid late (5 days ago). */
async function paidLate(w: W) {
  await footageSetup(w);
  await w.heston.mutation(api.projects.setDelivery, { projectId: w.p, unlocked: true });
  await w.maya.mutation(api.footage.keep, { projectId: w.p });
  const [first] = await invoices(w);
  await markSent(w, first._id, "in_1");
  await webhook(w, "in_1", "paid");
  await w.t.run(async (ctx) => { const [r] = await ctx.db.query("footageStorage").collect(); await ctx.db.patch(r._id, { paidUntil: addDays(todayCentral(), 30) }); });
  await runDue(w);
  const renewal = (await invoices(w)).find((x) => x._id !== first._id)!;
  await markSent(w, renewal._id, "in_r");
  await w.heston.mutation(api.footage.stop, { projectId: w.p });
  await webhook(w, "in_r", "paid");
  await settle(w);
  const paidAt = Date.now() - 5 * 86_400_000;
  await w.t.run(async (ctx) => { await ctx.db.patch(renewal._id, { paidAt }); });
  expect(await row(w)).toMatchObject({ status: "stopped", latePaid: { invoiceId: renewal._id, was: "stopped" } });
  return { renewal, paidAt };
}

describe("Q93/Q94 raw footage paid late: after the choice", () => {
  test("T6.4 Keep it for a year: kept until a year from the day they PAID; no new invoice; the Kept banner", async () => {
    const w = await world();
    stub([]);
    const { renewal, paidAt } = await paidLate(w);
    const before = (await invoices(w)).length;
    // Owners of this business only.
    await expect(w.maya.mutation(api.footage.reinstate, { projectId: w.p })).rejects.toThrow();
    await expect(w.boss.mutation(api.footage.reinstate, { projectId: w.p })).rejects.toThrow();
    expect(await row(w)).toMatchObject({ status: "stopped" });

    const r = await w.heston.mutation(api.footage.reinstate, { projectId: w.p });
    const until = addYear(todayCentral(paidAt));
    expect(until).not.toBe(addYear(todayCentral())); // the paid day, not today
    expect(r).toEqual({ paidUntil: until });
    expect(await row(w)).toMatchObject({ status: "paid", paidUntil: until, invoiceId: renewal._id, lateChoice: { kind: "kept", invoiceId: renewal._id, paidAt, until } });
    expect((await row(w)).latePaid).toBeUndefined();
    expect((await invoices(w)).length).toBe(before); // no new invoice
    const card = (await w.heston.query(api.footage.forProject, { projectId: w.p })).storage;
    expect(card).toMatchObject({ status: "paid", paidUntil: until, latePaid: null, lateChoice: { kind: "kept", until, paidAt } });
    // The Dashboard alert is gone; the next renewal still runs from paidUntil (the paid day's anniversary).
    expect((await w.heston.query(api.home.needs, {})).filter((n: { kind: string }) => n.kind === "footage")).toEqual([]);
    // Another business's owner sees nothing of it.
    expect(await w.boss.query(api.footage.forProject, { projectId: w.p })).toBeNull();
    // Once the kept year moves on (renewed), the banner is over.
    await w.t.run(async (ctx) => { const [x] = await ctx.db.query("footageStorage").collect(); await ctx.db.patch(x._id, { paidUntil: addYear(until) }); });
    expect((await w.heston.query(api.footage.forProject, { projectId: w.p })).storage.lateChoice).toBeNull();
  }, 60_000);

  test("T6.5 I'll refund it: marked to refund, the invoice's Stripe link, and the box closes when Stripe reports the refund", async () => {
    const w = await world();
    stub([]);
    const { renewal, paidAt } = await paidLate(w);
    await expect(w.maya.mutation(api.footage.dismissLatePaid, { projectId: w.p })).rejects.toThrow();
    await expect(w.boss.mutation(api.footage.dismissLatePaid, { projectId: w.p })).rejects.toThrow();
    expect((await row(w)).latePaid).toBeTruthy();

    await w.heston.mutation(api.footage.dismissLatePaid, { projectId: w.p });
    const r = await row(w);
    expect(r).toMatchObject({ status: "stopped", lateChoice: { kind: "refund", invoiceId: renewal._id, paidAt, was: "stopped" } });
    expect(r.latePaid).toBeUndefined();
    let card = (await w.heston.query(api.footage.forProject, { projectId: w.p })).storage;
    expect(card.lateChoice).toEqual({ kind: "refund", paidAt, at: expect.any(Number), wasUntil: r.paidUntil, invoice: { _id: renewal._id, number: null }, stripeUrl: "https://dashboard.stripe.com/test/invoices/in_r" });
    expect(await w.boss.query(api.footage.forProject, { projectId: w.p })).toBeNull();
    expect((await w.heston.query(api.home.needs, {})).filter((n: { kind: string }) => n.kind === "footage")).toEqual([]);

    // Stripe reports a refund (charge.refunded, recorded on the invoice by the existing webhook). Another account's event
    // with the same payment id changes nothing; this account's closes the box.
    await w.t.run(async (ctx) => { await ctx.db.patch(renewal._id, { payments: [{ id: "pi_1", at: paidAt, method: "Visa •••• 4242", cents: 10_000, status: "paid" }] }); });
    await w.t.mutation(internal.invoicePay.applyChargeEvent, { accountId: "acct_B", type: "charge.refunded", object: { payment_intent: "pi_1", amount_refunded: 10_000 } });
    card = (await w.heston.query(api.footage.forProject, { projectId: w.p })).storage;
    expect(card.lateChoice).toMatchObject({ kind: "refund" });
    await w.t.mutation(internal.invoicePay.applyChargeEvent, { accountId: "acct_A", type: "charge.refunded", object: { payment_intent: "pi_1", amount_refunded: 10_000 } });
    expect((await invoices(w)).find((i) => i._id === renewal._id)!.refundedCents).toBe(10_000);
    card = (await w.heston.query(api.footage.forProject, { projectId: w.p })).storage;
    expect(card.lateChoice).toBeNull();
    expect(card.status).toBe("stopped"); // the status stays as it was; nothing else changed
  }, 60_000);

  test("T6.5b a live-mode invoice links to the live Stripe dashboard", async () => {
    const w = await world();
    stub([]);
    const { renewal } = await paidLate(w);
    await w.t.run(async (ctx) => { const i = (await ctx.db.get(renewal._id))!; await ctx.db.patch(renewal._id, { stripe: { ...i.stripe!, livemode: true } }); });
    await w.heston.mutation(api.footage.dismissLatePaid, { projectId: w.p });
    expect((await w.heston.query(api.footage.forProject, { projectId: w.p })).storage.lateChoice.stripeUrl).toBe("https://dashboard.stripe.com/invoices/in_r");
  }, 60_000);
});
