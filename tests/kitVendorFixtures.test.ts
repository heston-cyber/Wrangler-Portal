// Dev only (KIT_FIXTURES=1): Phase 3c sample data for the kit (src/dev/KitApp.tsx), so the vendor pages can be checked
// at phone width without signing in: ?kit=owner for Vendors, Bookings, Payments, a vendor invoice, Settings ›
// Notifications; ?kit=vendor for the vendor side; ?kit=client for the client's Notifications. Merged into
// src/dev/fixtures.json next to what tests/kitFixtures.test.ts writes.
import { beforeAll, describe, test, vi } from "vitest";
import { anyApi } from "convex/server";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Id } from "../convex/_generated/dataModel";
import { world } from "./payHarness";
import { todayCentral } from "../convex/lib/bookings";

const api = anyApi;
beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_ONLY_TO = "";
});

describe.skipIf(!process.env.KIT_FIXTURES)("kit fixtures (Phase 3c)", () => {
  test("write", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "em" }), { status: 200 })));
    const w = await world();
    const JORDAN = "jordan@ellisfilms.com";
    const a = await w.heston.mutation(api.vendors.add, { name: "Jordan Ellis", email: JORDAN, roles: ["Shooter", "Editor"], rates: [{ role: "Shooter", unit: "day", cents: 85_000 }], invite: true, phone: "405-555-0142", basedIn: "Oklahoma City" } as never) as Id<"vendors">;
    const r = await w.heston.mutation(api.vendors.add, { name: "Riley Chen", email: "riley@chen.example", roles: ["Editor"], rates: [{ role: "Editor", unit: "hour", cents: 6_500 }], invite: false } as never) as Id<"vendors">;
    const sub = await w.t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { email: JORDAN, name: "Jordan Ellis", role: "vendor" });
      await ctx.db.insert("memberships", { businessId: w.A, email: JORDAN, userId, role: "vendor", createdAt: Date.now() });
      return `${userId}|${await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 })}`;
    });
    const jordan = w.t.withIdentity({ subject: sub });
    const book = (vendorId: Id<"vendors">, role: string, start: string, end: string, cents: number, unit: "day" | "hour", hours?: number) =>
      w.heston.mutation(api.bookings.create, { vendorId, projectId: w.p, role, start, end, cents, unit, ...(hours ? { hours } : {}), location: "Harbor Coffee, Plaza District", note: "Run and gun. Bring the gimbal." }) as Promise<Id<"vendorBookings">>;
    const k1 = await book(a, "Shooter", "2026-11-06", "2026-11-07", 85_000, "day");
    const k2 = await book(a, "Shooter", "2026-12-02", "2026-12-02", 85_000, "day");
    const k3 = await book(a, "Editor", "2026-11-10", "2026-11-14", 6_500, "hour", 18);
    await book(r, "Editor", "2026-11-17", "2026-11-21", 6_500, "hour", 18);
    for (const k of [k1, k3]) await jordan.mutation(api.vendorPortal.accept, { bookingId: k });
    const inv1 = await jordan.mutation(api.vendorPortal.saveInvoice, { bookingId: k1, mode: "hours", hours: [{ label: "Shooting day · Nov 6", qty: 1 }, { label: "Shooting day · Nov 7", qty: 1 }], lines: [], number: "JE-014", note: "Thanks for having me on this one.", send: true }) as Id<"vendorInvoices">;
    const inv2 = await jordan.mutation(api.vendorPortal.saveInvoice, { bookingId: k3, mode: "hours", hours: [{ label: "Assembly · Nov 10–11", qty: 10 }, { label: "Fine cut · Nov 12–13", qty: 8 }], lines: [], number: "JE-015", send: true }) as Id<"vendorInvoices">;
    const inv3 = await jordan.mutation(api.vendorPortal.saveInvoice, { bookingId: k1, mode: "lines", hours: [], lines: [{ description: "Gimbal rental", cents: 12_500 }, { description: "Mileage", cents: 4_350 }], number: "JE-013", send: true }) as Id<"vendorInvoices">;
    await w.heston.mutation(api.vendorPayments.approve, { invoiceId: inv2 });
    await w.heston.mutation(api.vendorPayments.approve, { invoiceId: inv3 });
    await w.heston.mutation(api.vendorPayments.markPaid, { invoiceId: inv3, paidOn: todayCentral(), method: "Zelle", reference: "Conf 88213" });
    // Pay in portal (Nov 2): connected (test mode); Jordan's direct deposit ready; JE-016 on its way through Stripe.
    process.env.STRIPE_PAYOUTS_KEY = "rk_test_kit";
    const inv4 = await jordan.mutation(api.vendorPortal.saveInvoice, { bookingId: k3, mode: "lines", hours: [], lines: [{ description: "Drive rental", cents: 9_000 }], number: "JE-016", send: true }) as Id<"vendorInvoices">;
    await w.heston.mutation(api.vendorPayments.approve, { invoiceId: inv4 });
    await w.t.run(async (ctx) => {
      await ctx.db.patch(a, { payout: { recipientId: "acct_kit", mode: "test", ready: true, payoutMethodId: "pm_kit", last4: "6789", bankName: "STRIPE TEST BANK", checkedAt: Date.now() } });
      await ctx.db.patch(inv4, { payout: { id: "obp_kit", status: "processing", attempt: 1, mode: "test", startedAt: Date.now(), by: "Heston", expectedArrival: "2026-11-05" } });
    });
    await jordan.mutation(api.vendorPortal.saveDetails, { businessId: w.A, name: "Jordan Ellis", businessName: "Ellis Films LLC", phone: "405-555-0142", address: "1200 NW 16th St\nOklahoma City, OK 73106", portfolio: "ellisfilms.com", payMethod: "ACH", payNote: "Bank of Example · account ending 0000" });
    await w.heston.mutation(api.notifications.setOwner, { key: "briefing_read", on: false });
    await jordan.mutation(api.vendorPortal.setNotification, { businessId: w.A, key: "briefings", on: false });
    await w.maya.mutation(api.notifications.setClient, { key: "invoice_reminders", on: false });

    // Phone pass (Nov 4): the Nov 6 shoot has a call sheet, sent to Jordan (the vendor side's reader page and home list).
    const { shootId } = await w.heston.mutation(api.shoots.schedule, { projectId: w.p, date: "2026-11-06", call: "07:30", wrap: "16:00", location: "Harbor Coffee, Plaza District", parking: "Behind the shop", prepare: [], withOwner: true, bookingIds: [k1], calendar: false }) as { shootId: Id<"shoots"> };
    await w.heston.mutation(api.callSheets.ensureStarters, {});
    const sheet = await w.heston.mutation(api.callSheets.create, { shootId, how: "questions" }) as Id<"callSheets">;
    await w.heston.mutation(api.callSheets.saveAnswers, { callSheetId: sheet, step: 4, answers: { templateId: null, crewCall: "07:30", talentCall: "09:00", wrap: "16:00", locationName: "Harbor Coffee", address: "412 Main St, Oklahoma City, OK 73102", parking: "Behind the shop. Load-in is through the side door.", weather: true,
      schedule: [{ id: "r1", time: "07:30", what: "Crew call and load-in", who: "Crew" }, { id: "r2", time: "09:00", what: "Talent call", who: "Talent" }, { id: "r3", time: "12:30", what: "Lunch", who: "Everyone" }, { id: "r4", time: "15:30", what: "Wrap", who: "Crew" }], notes: "Run and gun. Bring the gimbal." } });
    await w.heston.mutation(api.callSheets.make, { callSheetId: sheet });
    await w.heston.mutation(api.callSheets.send, { callSheetId: sheet, crew: true, client: false, guests: false, message: "See you Friday." });

    // D147 (Nov 4): briefings sent freely. Read by its one booked vendor; emailed to two (one opened); a draft with no
    // project; and one only shared by a copied link (4 opens). Each one's page, and the no-login page by a link.
    const pdfId = () => w.t.run((ctx) => ctx.storage.store(new Blob(["%PDF-1.4 kit"], { type: "application/pdf" })));
    const fill = async (id: Id<"briefings">) => {
      const g = await w.heston.query(api.briefings.get, { briefingId: id });
      const bd = await w.heston.query(api.builder.getBuild, { buildId: g.buildId });
      const custom = bd.fields.custom.map((c: { key: string; label: string; value: string }) => (c.key === "dates" && !c.value ? { ...c, value: "Nov 6 – 7, 2026" } : c));
      await w.heston.mutation(api.builder.saveBuild, { buildId: g.buildId, title: bd.title, blocks: bd.blocks, fields: { ...bd.fields, custom }, signers: [], style: bd.style });
    };
    const b1 = await w.heston.mutation(api.briefings.create, { bookingId: k1 }) as Id<"briefings">;
    await w.heston.action(api.briefings.share, { briefingId: b1, storageId: await pdfId(), to: [{ vendorId: a, email: JORDAN }] });
    await jordan.mutation(api.vendorPortal.markRead, { briefingId: b1 });
    const b2 = await w.heston.mutation(api.briefings.create, { projectId: w.p, starter: "edit" }) as Id<"briefings">;
    await fill(b2);
    await w.heston.action(api.briefings.share, { briefingId: b2, storageId: await pdfId(), to: [{ vendorId: r, email: "riley@chen.example" }, { email: "sam@ortega.example", name: "Sam Ortega" }], copyLink: true });
    const b2who = await w.t.run((ctx) => ctx.db.query("briefingRecipients").collect());
    const samTok = b2who.find((x) => x.email === "sam@ortega.example")!.token;
    await w.t.mutation(api.briefings.opened, { token: samTok });
    const b3 = await w.heston.mutation(api.briefings.create, {}) as Id<"briefings">;
    await w.heston.mutation(api.briefings.setDetails, { briefingId: b3, projectId: null, sendTo: [{ vendorId: r, email: "" }, { email: "ana@studiofour.com" }] });
    const b4 = await w.heston.mutation(api.briefings.create, { projectId: w.p }) as Id<"briefings">;
    await fill(b4);
    const l4 = await w.heston.action(api.briefings.share, { briefingId: b4, storageId: await pdfId(), to: [], copyLink: true });
    const linkTok = String(l4.link).split("/b/")[1];
    for (let i = 0; i < 4; i++) await w.t.mutation(api.briefings.opened, { token: linkTok });
    const briefs = [b1, b2, b3, b4];
    const builds: string[] = [];
    for (const id of briefs) builds.push((await w.heston.query(api.briefings.get, { briefingId: id })).buildId);

    // D149 (Nov 4): a quote to anyone: two emailed people and a copied link; Lee accepts for Park Studio LLC.
    const qId = await w.heston.mutation(api.quotes.save, { title: "Menu board refresh", lines: [{ id: "a", description: "Shooting · 1 day (8 h)", qty: 1, unitCents: 160_000 }, { id: "b", description: "Editing · simple (12 h)", qty: 1, unitCents: 240_000 }], deposit: { kind: "percent", value: 50 } }) as Id<"quotes">;
    const qs = await w.heston.action(api.quotes.send, { quoteId: qId, to: "priya@rao.example, lee@parkstudio.example", copyLink: true });
    const qRows = await w.t.run((ctx) => ctx.db.query("offerRecipients").collect());
    const priyaTok = qRows.find((x) => x.email === "priya@rao.example")!.token, leeTok = qRows.find((x) => x.email === "lee@parkstudio.example")!.token;
    const qLink = String(qs.link).split("/q/")[1];
    await w.t.mutation(api.quotes.markViewed, { token: priyaTok });
    const q2 = await w.heston.mutation(api.quotes.save, { title: "Spring promo", lines: [{ id: "a", description: "Shooting · 2 days", qty: 2, unitCents: 160_000 }], deposit: { kind: "percent", value: 25 } }) as Id<"quotes">;
    const q2s = await w.heston.action(api.quotes.send, { quoteId: q2, to: "", copyLink: true }).catch(() => w.heston.action(api.quotes.send, { quoteId: q2, copyLink: true }));
    const q2Link = String(q2s.link).split("/q/")[1];
    const openQuote = { id: q2, link: q2Link };
    await w.t.fetch("/q-respond", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: leeTok, action: "accept", name: "Lee Park", company: "Park Studio LLC" }) });

    const OWNER: [string, Record<string, unknown>][] = [
      ["quotes.get#" + qId, { quoteId: qId }], ["quotes.get#" + q2, { quoteId: q2 }], ["quotes.page#" + priyaTok, { token: priyaTok }], ["quotes.page#" + leeTok, { token: leeTok }], ["quotes.page#" + openQuote.link, { token: openQuote.link }], ["quotes.list", {}],
      ...briefs.map((id): [string, Record<string, unknown>] => ["briefings.get#" + id, { briefingId: id }]),
      ...builds.map((id): [string, Record<string, unknown>] => ["builder.getBuild#" + id, { buildId: id }]),
      ["briefings.page#" + samTok, { token: samTok }], ["briefings.page#" + linkTok, { token: linkTok }], ["bookings.form", {}],
      ["vendors.list", {}], ["vendors.get#" + a, { vendorId: a }], ["vendors.get#" + r, { vendorId: r }], ["vendors.invoices#" + a, { vendorId: a }], ["vendors.invoices#" + r, { vendorId: r }],
      ["bookings.list", {}], ["bookings.forVendor#" + a, { vendorId: a }], ["bookings.forVendor#" + r, { vendorId: r }], ["bookings.get#" + k1, { bookingId: k1 }], ["bookings.forProject#" + w.p, { projectId: w.p }],
      ["briefings.forVendor#" + a, { vendorId: a }], ["briefings.forVendor#" + r, { vendorId: r }], ["briefings.list", {}], ["briefings.templates", {}],
      ["vendorPayments.list", {}], ["vendorPayments.totals1099", {}], ["vendorPayments.get#" + inv1, { invoiceId: inv1 }], ["vendorPayments.get#" + inv2, { invoiceId: inv2 }], ["vendorPayments.get#" + inv3, { invoiceId: inv3 }],
      ["notifications.owner", {}], ["vendorPayments.get#" + inv4, { invoiceId: inv4 }], ["vendorPayouts.status", {}],
      ["vendorPayouts.forInvoice#" + inv1, { invoiceId: inv1 }], ["vendorPayouts.forInvoice#" + inv2, { invoiceId: inv2 }], ["vendorPayouts.forInvoice#" + inv3, { invoiceId: inv3 }], ["vendorPayouts.forInvoice#" + inv4, { invoiceId: inv4 }],
    ];
    const VENDOR: [string, Record<string, unknown>][] = [
      ["users.me", {}], ["vendorPortal.businesses", {}], ["vendorPortal.counts", { businessId: w.A }], ["vendorPortal.home", { businessId: w.A }], ["vendorPortal.bookings", { businessId: w.A }],
      ["vendorPortal.booking#" + k1, { bookingId: k1 }], ["vendorPortal.booking#" + k2, { bookingId: k2 }], ["vendorPortal.briefings", { businessId: w.A }], ["vendorPortal.reviews", { businessId: w.A }],
      ["vendorPortal.invoices", { businessId: w.A }], ["vendorPortal.invoiceForm", { businessId: w.A }], ["vendorPortal.invoice#" + inv1, { invoiceId: inv1 }], ["vendorPortal.invoice#" + inv2, { invoiceId: inv2 }], ["vendorPortal.invoice#" + inv3, { invoiceId: inv3 }],
      ["vendorPortal.settings", { businessId: w.A }], ["vendorPortal.notifications", { businessId: w.A }], ["business.brand", {}], ["vendorPayouts.mine", { businessId: w.A }], ["vendorPortal.invoice#" + inv4, { invoiceId: inv4 }], ["vendorPortal.callSheet#" + sheet, { callSheetId: sheet }],
    ];
    const run = async (as: typeof w.heston, list: [string, Record<string, unknown>][]) => {
      const out: Record<string, unknown> = {};
      for (const [key, args] of list) {
        const [m, f] = key.split("#")[0].split(".");
        try { out[key] = await as.query((api as never)[m][f], args as never); } catch (e) { out[key] = null; console.warn(`kit: ${key} refused: ${(e as Error).message.slice(0, 120)}`); }
      }
      return out;
    };
    const file = join(__dirname, "..", "src", "dev", "fixtures.json");
    const fx = JSON.parse(readFileSync(file, "utf8"));
    // The vendor and booking ids differ from the main kit's data; the owner's other pages keep theirs.
    Object.assign(fx.owner, await run(w.heston, OWNER));
    fx.vendor = await run(jordan, VENDOR);
    Object.assign(fx.client, await run(w.maya, [["notifications.client", {}]]));
    fx.ids = { ...fx.ids, vendor: { jordan: a, riley: r, bookings: [k1, k2, k3], invoices: { toApprove: inv1, approved: inv2, paid: inv3, paying: inv4 }, callSheet: sheet }, briefings: { ids: briefs, emailed: samTok, link: linkTok }, offers: { quote: qId, priya: priyaTok, lee: leeTok, link: qLink, open: openQuote.link } };
    delete process.env.STRIPE_PAYOUTS_KEY;
    writeFileSync(file, JSON.stringify(fx, null, 1));
  });
});
