// Nov 21 (Heston, approved 00:03): "Create without emailing". An invoice finalized in Stripe with its number and pay
// link, but nothing goes to anyone: no email, no Inbox item, not on the client's portal (D-g), no reminders until
// it's emailed (D-h). Email it sends it later, once. Stripe is the stand-in from payHarness (test mode).
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { REMINDER_DEFAULTS } from "../convex/invoiceReminders";
import { SUGGESTED } from "../convex/lib/perms";
import { due, fakeStripe, refreshNow, world } from "./payHarness";

const api = anyApi;
const internal = anyApi;
const DAY = 86_400_000;

beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.STRIPE_PLATFORM_KEY = "sk_test_platform";
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_ONLY_TO = "";
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

type W = Awaited<ReturnType<typeof world>>;
const draft = (w: W) => w.heston.mutation(api.invoices.saveDraft, {
  clientId: w.harbor, projectId: w.p, kind: "final", title: "Final invoice", billTo: { name: "Maya Brooks", email: "maya@harbor.example", company: "Harbor Coffee" },
  lines: [{ id: "a", description: "Final payment", qty: 1, unitCents: 450000 }], dueDate: due,
}) as Promise<Id<"invoices">>;
const mailsTo = (calls: { path: string }[]) => calls.filter((c) => c.path.startsWith("https://api.resend.com")).length;
const settle = (w: W) => w.t.finishAllScheduledFunctions(vi.runAllTimers);
const inbox = (w: W) => w.t.run(async (ctx) => await ctx.db.query("inboxItems").collect());
const emailKeys = (w: W) => w.t.run(async (ctx) => (await ctx.db.query("emailLog").collect()).map((r) => r.key));

describe("Create without emailing", () => {
  test("T1: finalized in Stripe with its number and pay link; no email, no Inbox item, not on the client's portal", async () => {
    vi.useFakeTimers();
    const w = await world();
    const calls = fakeStripe();
    const id = await draft(w);
    const r = await w.heston.action(api.invoices.create, { invoiceId: id });
    expect(r).toEqual({ number: "WRNGLR-0001", link: expect.stringMatching(/^https:\/\/app\.wranglerportal\.com\/i\/[\w-]+$/) });
    expect(calls.some((c) => c.path === "invoices/in_1/finalize")).toBe(true);
    expect(calls.some((c) => /\/send$/.test(c.path))).toBe(false); // Stripe's own email stays off too
    expect(calls.find((c) => c.path === "invoices/in_1/finalize")!.form).toMatchObject({ auto_advance: "false" }); // and Stripe doesn't chase it
    expect(calls.find((c) => c.path === "invoices" && c.method === "POST")!.form).toMatchObject({ collection_method: "send_invoice", auto_advance: "false" });
    await settle(w);
    expect(mailsTo(calls)).toBe(0);
    expect(await inbox(w)).toEqual([]);
    expect(await emailKeys(w)).toEqual([]);
    // The owner sees it as due and not emailed; the client's portal doesn't list it (D-g).
    const inv = await w.heston.query(api.invoices.get, { invoiceId: id });
    expect(inv).toMatchObject({ status: "due", number: "WRNGLR-0001", notEmailed: true, sentAt: null, issuedAt: expect.any(Number) });
    expect(inv.history.map((h: { kind: string }) => h.kind)).toEqual(["created", "created"]);
    expect(await w.maya.query(api.invoicePay.mine, {})).toEqual([]);
    expect(await w.jo.query(api.invoicePay.mine, {})).toEqual([]);
    // The copied link opens the payable page, signed in or not.
    const token = r.link.split("/i/")[1];
    expect(await w.t.query(api.invoicePay.page, { token })).toMatchObject({ number: "WRNGLR-0001", status: "due" });
    // It can't be made twice.
    await expect(w.heston.action(api.invoices.create, { invoiceId: id })).rejects.toThrow(/already made/);
    await expect(w.heston.action(api.invoices.send, { invoiceId: id })).rejects.toThrow(/already/);
  });

  test("T2: no reminders, automatic or by hand, until it's emailed (D-h); an emailed twin is reminded", async () => {
    vi.useFakeTimers();
    const w = await world();
    fakeStripe();
    const id = await draft(w);
    await w.heston.action(api.invoices.create, { invoiceId: id });
    await w.heston.mutation(api.invoiceReminders.setReminders, { ...REMINDER_DEFAULTS, on: true });
    // Due in two days and made a week ago: an emailed invoice would get its "3 days before" reminder now.
    const soon = new Date(Date.now() + 2 * DAY).toISOString().slice(0, 10);
    await w.t.run(async (ctx) => { await ctx.db.patch(id, { dueDate: soon, createdAt: Date.now() - 7 * DAY }); });
    expect(await w.t.mutation(internal.invoiceReminders.runDue, {})).toEqual({ sent: 0 });
    expect((await w.heston.query(api.invoices.get, { invoiceId: id })).reminders).toMatchObject({ next: null, canSend: false });
    await expect(w.heston.mutation(api.invoiceReminders.sendReminder, { invoiceId: id })).rejects.toThrow(/hasn't been emailed yet/);
    // Control: the same invoice, emailed a week ago, is reminded now.
    await w.t.run(async (ctx) => { await ctx.db.patch(id, { quiet: undefined, sentAt: Date.now() - 7 * DAY }); });
    expect(await w.t.mutation(internal.invoiceReminders.runDue, {})).toEqual({ sent: 1 });
    // Once emailed (fresh), the "before" reminder waits a day after it went.
    const id2 = await draft(w);
    fakeStripe(); // a fresh stand-in for the second invoice (it keeps one running total)
    await w.heston.action(api.invoices.create, { invoiceId: id2 });
    await w.t.run(async (ctx) => { await ctx.db.patch(id2, { dueDate: soon }); });
    await w.heston.mutation(api.invoices.emailIt, { invoiceId: id2 });
    const next = (await w.heston.query(api.invoices.get, { invoiceId: id2 })).reminders.next;
    expect(next).toBeGreaterThanOrEqual(Date.now() + DAY - 60_000);
  });

  // Review M1: made now, emailed after its due date: the client gets the invoice, but no overdue reminder straight after.
  test("T2b: emailed after its due date: no overdue reminder for at least a day", async () => {
    vi.useFakeTimers();
    const w = await world();
    fakeStripe();
    const id = await draft(w);
    await w.heston.action(api.invoices.create, { invoiceId: id });
    await w.heston.mutation(api.invoiceReminders.setReminders, { ...REMINDER_DEFAULTS, on: true });
    await w.t.run(async (ctx) => { await ctx.db.patch(id, { dueDate: new Date(Date.now() - 6 * DAY).toISOString().slice(0, 10) }); });
    expect((await w.heston.query(api.invoices.get, { invoiceId: id })).status).toBe("overdue");
    await w.heston.mutation(api.invoices.emailIt, { invoiceId: id });
    expect(await w.t.mutation(internal.invoiceReminders.runDue, {})).toEqual({ sent: 0 });
    expect((await w.heston.query(api.invoices.get, { invoiceId: id })).reminders.next).toBeGreaterThanOrEqual(Date.now() + DAY - 60_000);
  });

  test("T2c: Email it refuses while a bank payment is clearing, or with Stripe disconnected", async () => {
    vi.useFakeTimers();
    const w = await world();
    fakeStripe();
    const id = await draft(w);
    await w.heston.action(api.invoices.create, { invoiceId: id });
    await w.t.run(async (ctx) => { await ctx.db.patch(id, { processing: true }); });
    await expect(w.heston.mutation(api.invoices.emailIt, { invoiceId: id })).rejects.toThrow(/bank payment is on its way/);
    await w.t.run(async (ctx) => { await ctx.db.patch(id, { processing: undefined }); await ctx.db.patch(w.A, { stripe: { ...(await ctx.db.get(w.A))!.stripe!, status: "disconnected" } }); });
    await expect(w.heston.mutation(api.invoices.emailIt, { invoiceId: id })).rejects.toThrow(/Stripe isn't connected/);
    expect((await w.t.run((ctx) => ctx.db.get(id)))!.quiet).toBe(true);
  });

  test("T3: Email it sends the normal invoice email and Inbox item once; the client's portal lists it from then", async () => {
    vi.useFakeTimers();
    const w = await world();
    const calls = fakeStripe();
    const id = await draft(w);
    const { link } = await w.heston.action(api.invoices.create, { invoiceId: id });
    await settle(w);
    expect(await w.heston.mutation(api.invoices.emailIt, { invoiceId: id })).toEqual({ to: "maya@harbor.example" });
    await expect(w.heston.mutation(api.invoices.emailIt, { invoiceId: id })).rejects.toThrow(/already emailed/);
    await settle(w);
    expect(mailsTo(calls)).toBe(1);
    expect(await emailKeys(w)).toEqual([`invoice-sent:${id}`]);
    const items = await inbox(w);
    expect(items).toEqual([expect.objectContaining({ kind: "invoice", email: "maya@harbor.example", link: `/i/${link.split("/i/")[1]}` })]); // the same link
    const inv = await w.heston.query(api.invoices.get, { invoiceId: id });
    expect(inv).toMatchObject({ notEmailed: false, sentAt: expect.any(Number) });
    expect(inv.history.map((h: { kind: string }) => h.kind)).toEqual(["created", "created", "sent", "emailed"]);
    expect(await w.maya.query(api.invoicePay.mine, {})).toEqual([expect.objectContaining({ number: "WRNGLR-0001" })]);
    // Email it is only for one made without emailing.
    const sentOne = await draft(w);
    fakeStripe();
    await w.heston.action(api.invoices.send, { invoiceId: sentOne });
    await expect(w.heston.mutation(api.invoices.emailIt, { invoiceId: sentOne })).rejects.toThrow(/already emailed/);
    const still = await draft(w);
    await expect(w.heston.mutation(api.invoices.emailIt, { invoiceId: still })).rejects.toThrow(/Send the invoice first/);
  });

  test("T4: paid from the copied link: marked paid, the receipt goes to the bill-to address, nothing in their Inbox, and on their portal only as a paid receipt; Email it is refused", async () => {
    vi.useFakeTimers();
    const w = await world();
    fakeStripe();
    const id = await draft(w);
    const { link } = await w.heston.action(api.invoices.create, { invoiceId: id });
    const token = link.split("/i/")[1];
    const paid = { status: "paid", amount_paid: 450000, status_transitions: { paid_at: Math.floor(Date.now() / 1000) }, payment: { type: "payment_intent", payment_intent: { id: "pi_1", status: "succeeded", amount: 450000, payment_method: { type: "card", card: { brand: "visa", last4: "4242" } } } } };
    fakeStripe({ payments: [paid], invoiceStatus: "paid" });
    await refreshNow(w, token);
    await settle(w);
    expect(await w.heston.query(api.invoices.get, { invoiceId: id })).toMatchObject({ status: "paid", notEmailed: true });
    const keys = await emailKeys(w);
    expect(keys).toContain(`receipt:${id}:pi_1`); // the receipt (to the bill-to address, as the Create dialog says)
    expect(keys.filter((k) => !k.startsWith("receipt:") && !k.startsWith("owner-paid:"))).toEqual([]); // and Heston's "paid": nothing else
    expect(await inbox(w)).toEqual([]);
    // Decision 2 (Nov 21): paid, it's on their portal as their receipt.
    expect(await w.maya.query(api.invoicePay.mine, {})).toEqual([expect.objectContaining({ number: "WRNGLR-0001", status: "paid" })]);
    expect(await w.jo.query(api.invoicePay.mine, {})).toHaveLength(1); // Jo is Harbor's other contact
    expect(await w.boss.query(api.invoicePay.mine, {})).toEqual([]);
    await expect(w.heston.mutation(api.invoices.emailIt, { invoiceId: id })).rejects.toThrow(/already paid/);
    // Review M3: Reports count it as invoiced in the month it was made, not never.
    const month = new Date().toISOString().slice(0, 7);
    const r = await w.heston.query(api.reports.page, { from: `${month}-01`, to: new Date().toISOString().slice(0, 10), tz: "UTC" });
    expect(r.months.find((m: { month: string }) => m.month === month)).toMatchObject({ invoicedCents: 450000, paidCents: 450000 });
  });

  test("T5: only the business's own side: another business's owner (with Stripe connected) or team, a client and nobody get none of it", async () => {
    vi.useFakeTimers();
    const w = await world();
    const calls = fakeStripe();
    const id = await draft(w);
    // Review M4: B has Stripe connected and a team member, so only the business scoping can refuse them.
    await w.t.run(async (ctx) => {
      const b = (await ctx.db.query("businesses").collect()).find((x) => x.slug === "other")!;
      await ctx.db.patch(b._id, { stripe: { accountId: "acct_B", status: "connected", chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, livemode: false, startedAt: 0, checkedAt: 0 } });
      const kim = await ctx.db.insert("users", { email: "kim@other.example", name: "Kim", role: "team", emailVerificationTime: 0 });
      await ctx.db.insert("memberships", { businessId: b._id, email: "kim@other.example", userId: kim, role: "team", teamRole: "bookkeeper", perms: { ...SUGGESTED.bookkeeper }, createdAt: 1 });
    });
    const kimSub = await w.t.run(async (ctx) => { const u = (await ctx.db.query("users").collect()).find((x) => x.email === "kim@other.example")!; return `${u._id}|${await ctx.db.insert("authSessions", { userId: u._id, expirationTime: Date.now() + 3_600_000 })}`; });
    const kim = w.t.withIdentity({ subject: kimSub });
    const counter = () => w.t.run(async (ctx) => JSON.stringify(await ctx.db.query("businesses").collect()));
    const before = await counter();
    await expect(w.boss.action(api.invoices.create, { invoiceId: id })).rejects.toThrow(/isn't here/);
    await expect(kim.action(api.invoices.create, { invoiceId: id })).rejects.toThrow(/isn't here|Not allowed/);
    await expect(w.maya.action(api.invoices.create, { invoiceId: id })).rejects.toThrow(/Not allowed/);
    await expect(w.t.action(api.invoices.create, { invoiceId: id })).rejects.toThrow();
    expect(calls).toHaveLength(0); // nothing reached Stripe
    expect(await counter()).toBe(before); // no number taken
    expect((await w.t.run((ctx) => ctx.db.get(id)))!.status).toBe("draft");
    await w.heston.action(api.invoices.create, { invoiceId: id });
    await expect(w.boss.mutation(api.invoices.emailIt, { invoiceId: id })).rejects.toThrow(/isn't here/);
    await expect(kim.mutation(api.invoices.emailIt, { invoiceId: id })).rejects.toThrow(/isn't here|Not allowed/);
    await expect(w.maya.mutation(api.invoices.emailIt, { invoiceId: id })).rejects.toThrow(/Not allowed/);
    await expect(w.t.mutation(api.invoices.emailIt, { invoiceId: id })).rejects.toThrow();
    expect((await w.t.run((ctx) => ctx.db.get(id)))!.quiet).toBe(true);
    await settle(w);
    expect(await inbox(w)).toEqual([]);
  });
});
