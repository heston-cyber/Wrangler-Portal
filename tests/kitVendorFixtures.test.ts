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
    await jordan.mutation(api.vendorPortal.saveDetails, { businessId: w.A, name: "Jordan Ellis", businessName: "Ellis Films LLC", phone: "405-555-0142", address: "1200 NW 16th St\nOklahoma City, OK 73106", portfolio: "ellisfilms.com", payMethod: "ACH", payNote: "Bank of Example · account ending 0000" });
    await w.heston.mutation(api.notifications.setOwner, { key: "briefing_read", on: false });
    await jordan.mutation(api.vendorPortal.setNotification, { businessId: w.A, key: "briefings", on: false });
    await w.maya.mutation(api.notifications.setClient, { key: "invoice_reminders", on: false });

    const OWNER: [string, Record<string, unknown>][] = [
      ["vendors.list", {}], ["vendors.get#" + a, { vendorId: a }], ["vendors.get#" + r, { vendorId: r }], ["vendors.invoices#" + a, { vendorId: a }], ["vendors.invoices#" + r, { vendorId: r }],
      ["bookings.list", {}], ["bookings.forVendor#" + a, { vendorId: a }], ["bookings.forVendor#" + r, { vendorId: r }], ["bookings.get#" + k1, { bookingId: k1 }], ["bookings.forProject#" + w.p, { projectId: w.p }],
      ["briefings.forVendor#" + a, { vendorId: a }], ["briefings.forVendor#" + r, { vendorId: r }], ["briefings.list", {}], ["briefings.templates", {}],
      ["vendorPayments.list", {}], ["vendorPayments.totals1099", {}], ["vendorPayments.get#" + inv1, { invoiceId: inv1 }], ["vendorPayments.get#" + inv2, { invoiceId: inv2 }], ["vendorPayments.get#" + inv3, { invoiceId: inv3 }],
      ["notifications.owner", {}],
    ];
    const VENDOR: [string, Record<string, unknown>][] = [
      ["users.me", {}], ["vendorPortal.businesses", {}], ["vendorPortal.counts", { businessId: w.A }], ["vendorPortal.home", { businessId: w.A }], ["vendorPortal.bookings", { businessId: w.A }],
      ["vendorPortal.booking#" + k1, { bookingId: k1 }], ["vendorPortal.booking#" + k2, { bookingId: k2 }], ["vendorPortal.briefings", { businessId: w.A }], ["vendorPortal.reviews", { businessId: w.A }],
      ["vendorPortal.invoices", { businessId: w.A }], ["vendorPortal.invoiceForm", { businessId: w.A }], ["vendorPortal.invoice#" + inv1, { invoiceId: inv1 }], ["vendorPortal.invoice#" + inv2, { invoiceId: inv2 }], ["vendorPortal.invoice#" + inv3, { invoiceId: inv3 }],
      ["vendorPortal.settings", { businessId: w.A }], ["vendorPortal.notifications", { businessId: w.A }], ["business.brand", {}],
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
    fx.ids = { ...fx.ids, vendor: { jordan: a, riley: r, bookings: [k1, k2, k3], invoices: { toApprove: inv1, approved: inv2, paid: inv3 } } };
    writeFileSync(file, JSON.stringify(fx, null, 1));
  });
});
