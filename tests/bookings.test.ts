// Phase 3c step 2 · bookings (owner side). T3c.2: Book a vendor suggests the rate from Pricing (or the vendor's own
// rate), sending emails the vendor once (email 24) and adds the booking to the Crew card, Vendors › Bookings, the vendor
// page and the Ledger as an expected cost that isn't counted; cancelling takes it off. Isolation, bad input, and D102
// (one role per email).
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { world } from "./payHarness";
import { bookingState, daysIn, expectedCents, suggestRate } from "../convex/lib/bookings";
import { WRANGLER_RATES } from "../convex/lib/estimate";
import { dateRange } from "../convex/lib/mails";

const api = anyApi;
beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_ONLY_TO = "";
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

type W = Awaited<ReturnType<typeof world>>;
type Sent = { to: string; from: string; subject: string; text: string; html: string };
const stub = (mails: Sent[]) => vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url === "https://api.resend.com/emails") { const b = JSON.parse(String(init?.body)); mails.push({ to: b.to[0], from: b.from, subject: b.subject, text: b.text, html: b.html }); return new Response(JSON.stringify({ id: "em" }), { status: 200 }); }
  return new Response("{}", { status: 500 });
}));
const settle = async (w: W) => { vi.useFakeTimers(); await w.t.finishAllScheduledFunctions(vi.runAllTimers); vi.useRealTimers(); };
const jordan = { name: "Jordan Ellis", email: "jordan@ellisfilms.com", roles: ["Shooter", "Editor"], rates: [{ role: "Editor", unit: "hour", cents: 8_000 }] };
const shoot = (w: W, vendorId: Id<"vendors">, extra: Record<string, unknown> = {}) => w.heston.mutation(api.bookings.create, {
  vendorId, projectId: w.p, role: "Shooter", start: "2030-11-06", end: "2030-11-07", cents: 100_000, unit: "day", suggestedCents: 100_000,
  location: "Harbor Coffee, 412 Main St", note: "Two days, run and gun. Brief to follow.", ...extra,
}) as Promise<Id<"vendorBookings">>;

describe("bookings: the pure parts", () => {
  test("days, expected cost, state and the suggested rate", () => {
    expect(daysIn("2030-11-06", "2030-11-07")).toBe(2);
    expect(daysIn("2030-11-30", "2030-12-02")).toBe(3);
    expect(expectedCents({ start: "2030-11-06", end: "2030-11-07", rate: { cents: 100_000, unit: "day" } })).toBe(200_000);
    expect(expectedCents({ start: "2030-11-08", end: "2030-11-14", rate: { cents: 8_000, unit: "hour" }, hours: 30 })).toBe(240_000);
    expect(bookingState({ status: "accepted", end: "2030-11-07" }, "2030-11-08")).toBe("done");
    expect(bookingState({ status: "accepted", end: "2030-11-07" }, "2030-11-07")).toBe("accepted");
    expect(bookingState({ status: "offered", end: "2020-01-01" }, "2030-11-08")).toBe("offered");
    // Pricing first: Shooter $125 / hour × 8 h = $1,000 / day (the design's example); per hour it's $125.
    expect(suggestRate(WRANGLER_RATES, [], "Shooter", "day")).toMatchObject({ cents: 100_000, source: "pricing", baseCents: 12_500, baseUnit: "hour", hoursPerDay: 8 });
    expect(suggestRate(WRANGLER_RATES, [], "shooter", "hour")).toMatchObject({ cents: 12_500 });
    // No Pricing cost for the role: the vendor's own rate.
    expect(suggestRate(WRANGLER_RATES, [{ role: "Drone pilot", unit: "day", cents: 80_000 }], "Drone pilot", "hour")).toMatchObject({ cents: 10_000, source: "vendor" });
    expect(suggestRate(WRANGLER_RATES, [], "Drone pilot", "day")).toBeNull();
    expect(dateRange("2027-04-16", "2027-04-18")).toBe("Apr 16 – 18, 2027");
    expect(dateRange("2026-11-30", "2026-12-02")).toBe("Nov 30 – Dec 2, 2026");
    expect(dateRange("2026-11-20", "2026-11-20")).toBe("Nov 20, 2026");
  });
});

describe("bookings", () => {
  test("T3c.2 book a vendor: email 24 once, the Crew card, Bookings, the vendor page and the Ledger (expected, not counted)", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const vendorId = await w.heston.mutation(api.vendors.add, { ...jordan, invite: false }) as Id<"vendors">;
    const form = await w.heston.query(api.bookings.form, { projectId: w.p });
    expect(form.project).toMatchObject({ _id: w.p, label: "26127 Launch" });
    expect(form.vendors).toEqual([expect.objectContaining({ name: "Jordan Ellis", roles: ["Shooter", "Editor"] })]);
    expect(form.rates.fullDayHours).toBe(8);

    const id = await shoot(w, vendorId);
    await settle(w);
    expect(mails.map((m) => [m.to, m.subject, m.from])).toEqual([["jordan@ellisfilms.com", "Wrangler Productions would like to book you: Launch", "Wrangler Productions <updates@wranglerportal.com>"]]);
    expect(mails[0].text).toContain("Wrangler Productions would like to book you as a Shooter.");
    expect(mails[0].text).toContain("$1,000 / day");
    expect(mails[0].text).toContain("Nov 6 – 7, 2030");
    expect(mails[0].text).toContain("Harbor Coffee, 412 Main St. Two days, run and gun. Brief to follow.");
    expect(mails[0].text).toContain(`https://app.wranglerportal.com/vendor/bookings/${id}`);

    const row = expect.objectContaining({ _id: id, vendor: "Jordan Ellis", project: "26127 Launch", role: "Shooter", days: 2, expectedCents: 200_000, state: "offered" });
    expect(await w.heston.query(api.bookings.forProject, { projectId: w.p })).toEqual([row]);
    expect(await w.heston.query(api.bookings.list, {})).toEqual([row]);
    expect(await w.heston.query(api.bookings.forVendor, { vendorId })).toEqual([row]);
    expect(await w.heston.query(api.bookings.get, { bookingId: id })).toMatchObject({ vendorEmail: "jordan@ellisfilms.com", suggestedCents: 100_000, location: "Harbor Coffee, 412 Main St" });

    const L = await w.heston.query(api.crm.ledger, { projectId: w.p });
    expect(L.expected).toEqual([expect.objectContaining({ vendor: "Jordan Ellis", role: "Shooter", cents: 200_000, state: "offered" })]);
    expect(L.expectedCents).toBe(200_000);
    expect(L.actual.expenseCents).toBe(0); // expected costs aren't counted until the vendor's invoice is approved

    // An hourly booking needs the hours it's expected to take.
    await expect(shoot(w, vendorId, { role: "Editor", unit: "hour", cents: 8_000 })).rejects.toThrow(/hours you expect/);
    const ed = await shoot(w, vendorId, { role: "Editor", unit: "hour", cents: 8_000, hours: 30, start: "2030-11-08", end: "2030-11-14" });
    expect((await w.heston.query(api.crm.ledger, { projectId: w.p })).expectedCents).toBe(200_000 + 240_000);
    await settle(w);

    // Cancel: off the Crew card and the Ledger, kept in Bookings as cancelled; no second cancel.
    await w.heston.mutation(api.bookings.cancel, { bookingId: ed });
    expect((await w.heston.query(api.bookings.forProject, { projectId: w.p })).map((x: { _id: string }) => x._id)).toEqual([id]);
    expect((await w.heston.query(api.crm.ledger, { projectId: w.p })).expectedCents).toBe(200_000);
    expect((await w.heston.query(api.bookings.list, {})).find((x: { _id: string }) => x._id === ed).state).toBe("cancelled");
    await expect(w.heston.mutation(api.bookings.cancel, { bookingId: ed })).rejects.toThrow(/already cancelled/);
    await settle(w);
    expect(mails).toHaveLength(2); // one offer email each; cancelling doesn't email
  });

  test("bad input is refused; an archived vendor can't be booked", async () => {
    const w = await world();
    const vendorId = await w.heston.mutation(api.vendors.add, { ...jordan, invite: false }) as Id<"vendors">;
    await expect(shoot(w, vendorId, { end: "2030-11-05" })).rejects.toThrow(/before the first/);
    await expect(shoot(w, vendorId, { start: "2030-02-30" })).rejects.toThrow(/Pick the dates/);
    await expect(shoot(w, vendorId, { cents: 0 })).rejects.toThrow(/agreed rate/);
    await expect(shoot(w, vendorId, { role: " " })).rejects.toThrow(/Pick a role/);
    await expect(shoot(w, vendorId, { end: "2032-01-01" })).rejects.toThrow(/a year at most/);
    await w.heston.mutation(api.vendors.archive, { vendorId, archived: true });
    await expect(shoot(w, vendorId)).rejects.toThrow(/isn't on your list/);
  });

  test("T3c.2 isolation: another business and clients see and change none of it", async () => {
    const w = await world();
    stub([]);
    const vendorId = await w.heston.mutation(api.vendors.add, { ...jordan, invite: false }) as Id<"vendors">;
    const id = await shoot(w, vendorId);
    expect(await w.boss.query(api.bookings.list, {})).toEqual([]);
    expect(await w.boss.query(api.bookings.get, { bookingId: id })).toBeNull();
    expect(await w.boss.query(api.bookings.forProject, { projectId: w.p })).toBeNull();
    await expect(w.boss.mutation(api.bookings.cancel, { bookingId: id })).rejects.toThrow();
    const theirs = await w.boss.mutation(api.vendors.add, { ...jordan, invite: false }) as Id<"vendors">;
    await expect(w.boss.mutation(api.bookings.create, { vendorId: theirs, projectId: w.p, role: "Shooter", start: "2030-11-06", end: "2030-11-07", cents: 100_000, unit: "day" })).rejects.toThrow();
    await expect(w.maya.query(api.bookings.list, {})).rejects.toThrow();
    await expect(w.maya.query(api.bookings.form, {})).rejects.toThrow();
  });

  test("D102 one role per email: a client's email can't be a vendor, and a vendor's can't be invited as a client", async () => {
    const w = await world();
    await expect(w.heston.mutation(api.vendors.add, { ...jordan, email: "maya@harbor.example", invite: false })).rejects.toThrow(/belongs to a client.*not both/);
    const vendorId = await w.heston.mutation(api.vendors.add, { ...jordan, invite: false }) as Id<"vendors">;
    await expect(w.heston.mutation(api.vendors.update, { vendorId, ...jordan, email: "jo@harbor.example" })).rejects.toThrow(/belongs to a client/);
    await expect(w.heston.mutation(api.clients.invite, { email: "jordan@ellisfilms.com" })).rejects.toThrow(/one of your vendors.*not both/);
    await expect(w.heston.mutation(api.clients.addPerson, { clientId: w.harbor, email: "Jordan@EllisFilms.com", role: "contact" })).rejects.toThrow(/one of your vendors/);
    // Taken off the vendor list, the email is free to become a client's.
    await w.heston.mutation(api.vendors.archive, { vendorId, archived: true });
    await w.heston.mutation(api.clients.addPerson, { clientId: w.harbor, email: "jordan@ellisfilms.com", role: "contact" });
    // Their old vendor record can't come back now, and couldn't be booked if it were.
    await expect(w.heston.mutation(api.vendors.archive, { vendorId, archived: false })).rejects.toThrow(/belongs to a client/);
    await w.t.run(async (ctx) => { await ctx.db.patch(vendorId, { archivedAt: undefined }); });
    await expect(shoot(w, vendorId)).rejects.toThrow(/belongs to a client/);
  });
});
