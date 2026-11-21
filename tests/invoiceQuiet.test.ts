// Nov 21 (Heston, approved 00:03): "Create without emailing". An invoice finalized in Stripe with its number and pay
// link, but nothing goes to anyone: no email, no Inbox item, not on the client's portal (D-g), no reminders until
// it's emailed (D-h). Email it sends it later, once. Stripe is the stand-in from payHarness (test mode).
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { REMINDER_DEFAULTS } from "../convex/invoiceReminders";
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
    await settle(w);
    expect(mailsTo(calls)).toBe(0);
    expect(await inbox(w)).toEqual([]);
    expect(await emailKeys(w)).toEqual([]);
    // The owner sees it as due and not emailed; the client's portal doesn't list it (D-g).
    const inv = await w.heston.query(api.invoices.get, { invoiceId: id });
    expect(inv).toMatchObject({ status: "due", number: "WRNGLR-0001", notEmailed: true, sentAt: null });
    expect(inv.history.map((h: { kind: string }) => h.kind)).toEqual(["created", "created"]);
    expect(await w.maya.query(api.invoicePay.mine, {})).toEqual([]);
    expect(await w.jo.query(api.invoicePay.mine, {})).toEqual([]);
    // The copied link opens the payable page, signed in or not.
    const token = r.link.split("/i/")[1];
    expect(await w.t.query(api.invoicePay.page, { token })).toMatchObject({ number: "WRNGLR-0001", status: "due" });
    // It can't be made twice.
    await expect(w.heston.action(api.invoices.create, { invoiceId: id })).rejects.toThrow(/already/);
    await expect(w.heston.action(api.invoices.send, { invoiceId: id })).rejects.toThrow(/already/);
  });

  test("T2: no reminders, automatic or by hand, until it's emailed (D-h)", async () => {
    vi.useFakeTimers();
    const w = await world();
    fakeStripe();
    const id = await draft(w);
    await w.heston.action(api.invoices.create, { invoiceId: id });
    await w.heston.mutation(api.invoiceReminders.setReminders, { ...REMINDER_DEFAULTS, on: true });
    // Due in two days and made a week ago: an emailed invoice would get its "3 days before" reminder now.
    await w.t.run(async (ctx) => { await ctx.db.patch(id, { dueDate: new Date(Date.now() + 2 * DAY).toISOString().slice(0, 10), createdAt: Date.now() - 7 * DAY }); });
    expect(await w.t.mutation(internal.invoiceReminders.runDue, {})).toEqual({ sent: 0 });
    expect((await w.heston.query(api.invoices.get, { invoiceId: id })).reminders.next).toBeNull();
    await expect(w.heston.mutation(api.invoiceReminders.sendReminder, { invoiceId: id })).rejects.toThrow(/hasn't been emailed yet/);
    // Once emailed, they start (a day after it went, so not straight away).
    await w.heston.mutation(api.invoices.emailIt, { invoiceId: id });
    expect((await w.heston.query(api.invoices.get, { invoiceId: id })).reminders.next).toEqual(expect.any(Number));
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

  test("T4: paid from the copied link: marked paid, a receipt goes to the payer, still nothing on their portal or Inbox; Email it is refused", async () => {
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
    expect(keys).toContain(`receipt:${id}:pi_1`); // the payer's receipt
    expect(keys.filter((k) => !k.startsWith("receipt:") && !k.startsWith("owner-paid:"))).toEqual([]); // and Heston's "paid": nothing else
    expect(await inbox(w)).toEqual([]);
    expect(await w.maya.query(api.invoicePay.mine, {})).toEqual([]);
    await expect(w.heston.mutation(api.invoices.emailIt, { invoiceId: id })).rejects.toThrow(/already paid/);
  });

  test("T5: only the business's owner side: another business's owner, a client and nobody get none of it", async () => {
    vi.useFakeTimers();
    const w = await world();
    fakeStripe();
    const id = await draft(w);
    await expect(w.boss.action(api.invoices.create, { invoiceId: id })).rejects.toThrow();
    await expect(w.maya.action(api.invoices.create, { invoiceId: id })).rejects.toThrow(/Not allowed/);
    await expect(w.t.action(api.invoices.create, { invoiceId: id })).rejects.toThrow();
    expect((await w.t.run((ctx) => ctx.db.get(id)))!.status).toBe("draft"); // nothing happened
    await w.heston.action(api.invoices.create, { invoiceId: id });
    await expect(w.boss.mutation(api.invoices.emailIt, { invoiceId: id })).rejects.toThrow();
    await expect(w.maya.mutation(api.invoices.emailIt, { invoiceId: id })).rejects.toThrow(/Not allowed/);
    await expect(w.t.mutation(api.invoices.emailIt, { invoiceId: id })).rejects.toThrow();
    expect((await w.t.run((ctx) => ctx.db.get(id)))!.quiet).toBe(true);
  });
});
