// Phase 5 · raw footage storage. T5.1: the offer shows the right keep date; Keep it drafts one invoice; paid, it's kept a
// year; no thanks (or no answer) reminds the owner once on the keep day, and nothing is ever deleted. T5.3: next year's
// invoice is drafted once, 30 days before the paid year ends (D140). T5.4: the emails follow their switches. D98: the
// owner can record a copy to the client's drive, which stops the reminder. D142: no offer for earlier deliveries.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { world } from "./payHarness";
import { todayCentral } from "../convex/lib/bookings";
import { addDays, addYear, storagePaid } from "../convex/footage";

const api = anyApi;
const internal = anyApi;
beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_ONLY_TO = "";
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

type W = Awaited<ReturnType<typeof world>>;
type Sent = { to: string; subject: string; text: string };
/** Records emails and every other URL anything tries to reach (nothing may delete a file). */
const stub = (mails: Sent[], urls: string[] = []) => vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url === "https://api.resend.com/emails") { const b = JSON.parse(String(init?.body)); mails.push({ to: b.to[0], subject: b.subject, text: b.text }); return new Response(JSON.stringify({ id: "em" }), { status: 200 }); }
  urls.push(url);
  return new Response("{}", { status: 500 });
}));
const settle = async (w: W) => { vi.useFakeTimers(); await w.t.finishAllScheduledFunctions(vi.runAllTimers); vi.useRealTimers(); };
/** The hourly job, at 1 PM Central today (it waits until 9 AM). */
const runDue = async (w: W) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${todayCentral()}T19:00:00Z`));
  const r = await w.t.action(internal.footage.runDue, {});
  vi.useRealTimers();
  await settle(w);
  return r as { ended: number; renewed: number; unpaid: number };
};

/** Maya and Jo can open the project (an invited project share); it has one final file. */
async function setup(w: W) {
  await w.t.run(async (ctx) => {
    const s = await ctx.db.insert("shares", { businessId: w.A, token: "tok-proj-1", kind: "project", projectId: w.p, access: "comment", who: "invited", allVersions: true, downloads: false, emailNewVersions: true, createdAt: 0, createdBy: (await ctx.db.query("users").first())!._id });
    await ctx.db.insert("shareMembers", { businessId: w.A, shareId: s, email: "maya@harbor.example", addedAt: 0 });
    await ctx.db.insert("deliveryFiles", { businessId: w.A, projectId: w.p, name: "Launch_FINAL.mov", kind: "dropbox", dropboxPath: "/launch_final.mov", createdAt: 0 });
  });
}
const markSent = (w: W, id: Id<"invoices">, sid: string) => w.t.run(async (ctx) => { await ctx.db.patch(id, { status: "open", stripe: { accountId: "acct_A", invoiceId: sid, customerId: "cus_1", livemode: false } }); });
const webhook = (w: W, sid: string, status: string) => w.t.mutation(internal.invoices.applyStripeInvoice, { accountId: "acct_A", invoice: { id: sid, status, total: 10000, amount_paid: status === "paid" ? 10000 : 0, amount_remaining: status === "paid" ? 0 : 10000 }, eventType: `invoice.${status}` });
const row = (w: W) => w.t.run(async (ctx) => (await ctx.db.query("footageStorage").collect()));
const invoices = (w: W) => w.t.run(async (ctx) => (await ctx.db.query("invoices").collect()));

describe("raw footage storage", () => {
  test("T5.1 the offer at delivery: keep date, Inbox, email 34 (D98: 30 days, $100/year)", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    await setup(w);
    await w.heston.mutation(api.projects.setDelivery, { projectId: w.p, unlocked: true });
    await settle(w);
    const [r] = await row(w);
    expect(r).toMatchObject({ status: "offered", priceCents: 10_000, keepUntil: addDays(todayCentral(), 30), businessId: w.A });
    const inbox = await w.maya.query(api.inbox.mine, {});
    const items = (inbox.items ?? inbox) as Array<{ title: string; link: string }>;
    expect(items.find((i) => i.title === "Keep your raw footage?")).toMatchObject({ link: `/projects/${w.p}` });
    const m34 = mails.find((m) => m.subject === "Keep your raw footage? 26127 Launch")!;
    expect(m34.to).toBe("maya@harbor.example");
    expect(m34.text).toContain("Hi Maya,");
    expect(m34.text).toContain("$100 / year");
    expect(mails.some((m) => m.to === "jo@harbor.example")).toBe(false); // Jo can't open the project
    // The client's card, and the owner's.
    expect(await w.maya.query(api.footage.forClientProject, { projectId: w.p })).toMatchObject({ status: "offered", keepUntil: r.keepUntil, priceCents: 10_000 });
    expect(await w.jo.query(api.footage.forClientProject, { projectId: w.p })).toBeNull();
    expect((await w.heston.query(api.footage.forProject, { projectId: w.p })).storage).toMatchObject({ status: "offered", keepUntil: r.keepUntil });
    // Settings: other keep days apply to the next offer only.
    await w.heston.mutation(api.footage.saveSettings, { on: true, priceCents: 12_500, keepDays: 14 });
    expect(await w.heston.query(api.footage.settings, {})).toMatchObject({ on: true, priceCents: 12_500, keepDays: 14 });
    await expect(w.heston.mutation(api.footage.saveSettings, { on: true, priceCents: 12_500, keepDays: 13 })).rejects.toThrow(/how long/);
  });

  test("D142: one offer per project, and none when the files were open before; off in Settings means no offer", async () => {
    const w = await world();
    stub([]);
    await setup(w);
    await w.heston.mutation(api.projects.setDelivery, { projectId: w.p, unlocked: true });
    await w.heston.mutation(api.projects.setDelivery, { projectId: w.p, unlocked: false });
    await w.heston.mutation(api.projects.setDelivery, { projectId: w.p, unlocked: true });
    expect(await row(w)).toHaveLength(1);
    // A project delivered before Phase 5 (its links already ran out): Unlock again offers nothing.
    const p2 = await w.t.run(async (ctx) => {
      const id = await ctx.db.insert("projects", { businessId: w.A, name: "Old", clientId: w.harbor, createdAt: 0, deliveryUnlockedAt: 1 });
      await ctx.db.insert("deliveryFiles", { businessId: w.A, projectId: id, name: "Old.mov", kind: "dropbox", dropboxPath: "/old.mov", createdAt: 0 });
      return id;
    });
    await w.heston.mutation(api.projects.setDelivery, { projectId: p2, unlocked: true });
    expect(await row(w)).toHaveLength(1);
    expect((await w.heston.query(api.footage.forProject, { projectId: p2 })).storage).toBeNull();
    // Turned off: no offer.
    await w.heston.mutation(api.footage.saveSettings, { on: false, priceCents: 10_000, keepDays: 30 });
    const p3 = await w.t.run(async (ctx) => {
      const id = await ctx.db.insert("projects", { businessId: w.A, name: "New", clientId: w.harbor, createdAt: 0 });
      await ctx.db.insert("deliveryFiles", { businessId: w.A, projectId: id, name: "New.mov", kind: "dropbox", dropboxPath: "/new.mov", createdAt: 0 });
      return id;
    });
    await w.heston.mutation(api.projects.setDelivery, { projectId: p3, unlocked: true });
    expect(await row(w)).toHaveLength(1);
  });

  test("T5.1 Keep it drafts exactly one invoice (nothing charged); paid, it's kept a year from the keep day", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    await setup(w);
    await w.heston.mutation(api.projects.setDelivery, { projectId: w.p, unlocked: true });
    await settle(w);
    await expect(w.jo.mutation(api.footage.keep, { projectId: w.p })).rejects.toThrow(/isn't here/); // Jo can't open the project
    expect(await w.maya.mutation(api.footage.keep, { projectId: w.p })).toEqual({ already: false });
    expect(await w.maya.mutation(api.footage.keep, { projectId: w.p })).toEqual({ already: true });
    const inv = await invoices(w);
    expect(inv).toHaveLength(1);
    const [r] = await row(w);
    expect(inv[0]).toMatchObject({ status: "draft", kind: "other", projectId: w.p, clientId: w.harbor, storageId: r._id, totalCents: 10_000, billTo: { name: "Maya Brooks", email: "maya@harbor.example", company: "Harbor Coffee" } });
    expect(inv[0].stripe).toBeUndefined(); // only a draft: the owner checks and sends it
    expect(r).toMatchObject({ status: "kept", invoiceId: inv[0]._id, answeredBy: { email: "maya@harbor.example", name: "Maya Brooks" } });
    await settle(w);
    const owner = mails.find((m) => m.subject === "Maya Brooks is keeping their raw footage: 26127 Launch")!;
    expect(owner.to).toBe("heston@wranglerproductions.com");
    expect(owner.text).toContain("invoice draft is in Payments");
    expect(await w.maya.query(api.footage.forClientProject, { projectId: w.p })).toMatchObject({ status: "kept", keptUntil: null, invoiceSent: false, by: "Maya Brooks" });
    // The Dashboard asks the owner to send it.
    expect((await w.heston.query(api.home.needs, {})).filter((n: { kind: string }) => n.kind === "footage")).toEqual([expect.objectContaining({ what: "kept", projectId: w.p })]);
    // Paid (the webhook's path): kept a year from the day it is paid (that date is the renewal date).
    await w.t.run(async (ctx) => { const i = (await ctx.db.get(inv[0]._id))!; await ctx.db.patch(i._id, { status: "paid" }); await storagePaid(ctx as never, i); });
    expect((await row(w))[0]).toMatchObject({ status: "paid", paidUntil: addYear(todayCentral()) });
    expect(await w.maya.query(api.footage.forClientProject, { projectId: w.p })).toMatchObject({ status: "paid", paidUntil: addYear(todayCentral()) });
  });

  test("storage turned off in Settings: no renewal is drafted for that client, the paid year still runs", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    await setup(w);
    await w.heston.mutation(api.projects.setDelivery, { projectId: w.p, unlocked: true });
    await w.maya.mutation(api.footage.keep, { projectId: w.p });
    const first = (await invoices(w))[0];
    await w.t.run(async (ctx) => { const i = (await ctx.db.get(first._id))!; await ctx.db.patch(i._id, { status: "paid" }); await storagePaid(ctx as never, i); });
    await w.t.run(async (ctx) => { const [r] = await ctx.db.query("footageStorage").collect(); await ctx.db.patch(r._id, { paidUntil: addDays(todayCentral(), 30) }); });
    await w.heston.mutation(api.footage.saveSettings, { on: false, priceCents: 10_000, keepDays: 30 });
    expect(await runDue(w)).toMatchObject({ renewed: 0 });
    expect((await invoices(w))).toHaveLength(1); // only the first year's invoice
    expect((await row(w))[0].status).toBe("paid");
    expect((await row(w))[0].renewalFor).toBeUndefined();
    // Turned back on inside the window: the renewal is drafted.
    await w.heston.mutation(api.footage.saveSettings, { on: true, priceCents: 10_000, keepDays: 30 });
    expect(await runDue(w)).toMatchObject({ renewed: 1 });
    expect((await invoices(w))).toHaveLength(2);
  });

  test("a storage draft deleted goes back to an open offer (nobody named), and Keep it works again before the keep day", async () => {
    const w = await world();
    stub([]);
    await setup(w);
    await w.heston.mutation(api.projects.setDelivery, { projectId: w.p, unlocked: true });
    await w.maya.mutation(api.footage.keep, { projectId: w.p });
    const [i] = await invoices(w);
    await w.heston.mutation(api.invoices.deleteDraft, { invoiceId: i._id });
    expect((await row(w))[0]).toMatchObject({ status: "offered" });
    expect((await row(w))[0].invoiceId).toBeUndefined();
    expect((await row(w))[0].answeredBy).toBeUndefined();
    await expect(w.heston.mutation(api.footage.stop, { projectId: w.p })).rejects.toThrow(/nothing to stop/); // review L8
    expect(await w.maya.mutation(api.footage.keep, { projectId: w.p })).toEqual({ already: false });
  });

  test("T5.1 no thanks: one reminder to the owner on the keep day (email 36, Dashboard), and nothing is deleted", async () => {
    const w = await world();
    const mails: Sent[] = [], urls: string[] = [];
    stub(mails, urls);
    await setup(w);
    await w.heston.mutation(api.projects.setDelivery, { projectId: w.p, unlocked: true });
    await w.maya.mutation(api.footage.decline, { projectId: w.p });
    expect((await row(w))[0]).toMatchObject({ status: "declined" });
    expect(await w.maya.query(api.footage.forClientProject, { projectId: w.p })).toMatchObject({ status: "declined" });
    // Not yet: nothing happens before the keep day.
    expect(await runDue(w)).toMatchObject({ ended: 0, renewed: 0 });
    // The keep day.
    await w.t.run(async (ctx) => { const [r] = await ctx.db.query("footageStorage").collect(); await ctx.db.patch(r._id, { keepUntil: todayCentral() }); });
    mails.length = 0;
    expect(await runDue(w)).toMatchObject({ ended: 1, renewed: 0 });
    expect(await runDue(w)).toMatchObject({ ended: 0, renewed: 0 }); // once
    const m36 = mails.filter((m) => m.subject === "Raw footage not kept: 26127 Launch");
    expect(m36).toHaveLength(1);
    expect(m36[0].to).toBe("heston@wranglerproductions.com");
    expect(m36[0].text).toContain("Harbor Coffee didn't keep their raw footage.");
    expect(m36[0].text).toContain("The portal never deletes files itself.");
    expect((await row(w))[0]).toMatchObject({ status: "ended" });
    expect(await w.maya.query(api.footage.forClientProject, { projectId: w.p })).toBeNull(); // the offer is gone for the client
    await expect(w.maya.mutation(api.footage.keep, { projectId: w.p })).rejects.toThrow();
    // Nothing reached Dropbox or Bunny: the portal deleted nothing.
    expect(urls.filter((u) => /dropbox|bunny|b-cdn/i.test(u))).toEqual([]);
    // The Dashboard keeps it until the owner marks it deleted or moved.
    expect((await w.heston.query(api.home.needs, {})).filter((n: { kind: string }) => n.kind === "footage")).toEqual([expect.objectContaining({ what: "ended" })]);
    await w.heston.mutation(api.footage.markDone, { projectId: w.p });
    expect((await w.heston.query(api.home.needs, {})).filter((n: { kind: string }) => n.kind === "footage")).toEqual([]);
  });

  test("D98: copied to their drive stops the keep-day reminder", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    await setup(w);
    await w.heston.mutation(api.projects.setDelivery, { projectId: w.p, unlocked: true });
    await w.heston.mutation(api.footage.recordDrive, { projectId: w.p });
    await w.t.run(async (ctx) => { const [r] = await ctx.db.query("footageStorage").collect(); await ctx.db.patch(r._id, { keepUntil: todayCentral() }); });
    mails.length = 0;
    expect(await runDue(w)).toMatchObject({ ended: 0, renewed: 0 });
    expect(mails.some((m) => /Raw footage not kept/.test(m.subject))).toBe(false);
    expect((await row(w))[0]).toMatchObject({ status: "drive" });
    // Recording a drive copy isn't allowed while they're paying for it.
    await w.t.run(async (ctx) => { const [r] = await ctx.db.query("footageStorage").collect(); await ctx.db.patch(r._id, { status: "paid", paidUntil: addDays(todayCentral(), 200) }); });
    await expect(w.heston.mutation(api.footage.recordDrive, { projectId: w.p })).rejects.toThrow(/Stop storing first/);
  });

  test("T5.3 the renewal is drafted once, 30 days before the paid year ends; unpaid at the end, the owner is reminded", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    await setup(w);
    await w.heston.mutation(api.projects.setDelivery, { projectId: w.p, unlocked: true });
    await w.maya.mutation(api.footage.keep, { projectId: w.p });
    const first = (await invoices(w))[0];
    await w.t.run(async (ctx) => {
      const i = (await ctx.db.get(first._id))!; await ctx.db.patch(i._id, { status: "paid" }); await storagePaid(ctx as never, i);
      const [r] = await ctx.db.query("footageStorage").collect(); await ctx.db.patch(r._id, { paidUntil: addDays(todayCentral(), 31) });
    });
    expect(await runDue(w)).toMatchObject({ ended: 0, renewed: 0 }); // 31 days out: not yet
    await w.t.run(async (ctx) => { const [r] = await ctx.db.query("footageStorage").collect(); await ctx.db.patch(r._id, { paidUntil: addDays(todayCentral(), 30) }); });
    mails.length = 0;
    expect(await runDue(w)).toMatchObject({ ended: 0, renewed: 1 });
    expect(await runDue(w)).toMatchObject({ ended: 0, renewed: 0 }); // once per year
    const inv = await invoices(w);
    expect(inv).toHaveLength(2);
    const renewal = inv.find((i) => i._id !== first._id)!;
    const paidUntil = addDays(todayCentral(), 30);
    expect(renewal).toMatchObject({ status: "draft", totalCents: 10_000, dueDate: paidUntil, billTo: { email: "maya@harbor.example" } });
    expect((await row(w))[0]).toMatchObject({ status: "paid", renewalFor: paidUntil, invoiceId: renewal._id });
    expect(mails.filter((m) => m.subject === "Next year's storage invoice is ready: 26127 Launch")).toHaveLength(1);
    expect((await w.heston.query(api.home.needs, {})).filter((n: { kind: string }) => n.kind === "footage")).toEqual([expect.objectContaining({ what: "renewal" })]);
    // Paid: another year on from the end of the last one.
    await w.t.run(async (ctx) => { const i = (await ctx.db.get(renewal._id))!; await ctx.db.patch(i._id, { status: "paid" }); await storagePaid(ctx as never, i); });
    expect((await row(w))[0]).toMatchObject({ status: "paid", paidUntil: addYear(paidUntil) });
    // A year that ends unpaid: ended, and the owner hears (lapsed).
    await w.t.run(async (ctx) => { const [r] = await ctx.db.query("footageStorage").collect(); await ctx.db.patch(r._id, { paidUntil: todayCentral(), renewalFor: todayCentral() }); });
    mails.length = 0;
    expect(await runDue(w)).toMatchObject({ ended: 1, renewed: 0 });
    expect(mails.find((m) => m.subject === "Raw footage not kept: 26127 Launch")?.text).toContain("storage year ended without renewal");
  });

  test("T5.4 the owner's switch: no Keep it email when it's off (the keep-day email can't be switched off)", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    await setup(w);
    await w.heston.mutation(api.notifications.setOwner, { key: "footage", on: false });
    await expect(w.heston.mutation(api.notifications.setOwner, { key: "footage_ended", on: false })).rejects.toThrow();
    await w.heston.mutation(api.projects.setDelivery, { projectId: w.p, unlocked: true });
    await settle(w); // email 34 goes out while it's still an open offer
    await w.maya.mutation(api.footage.keep, { projectId: w.p });
    await settle(w);
    expect(mails.some((m) => /is keeping their raw footage/.test(m.subject))).toBe(false);
    expect(mails.some((m) => /^Keep your raw footage\?/.test(m.subject))).toBe(true);
  });

  test("T5.5 another business's owner sees and changes none of it", async () => {
    const w = await world();
    stub([]);
    await setup(w);
    await w.heston.mutation(api.projects.setDelivery, { projectId: w.p, unlocked: true });
    expect(await w.boss.query(api.footage.forProject, { projectId: w.p })).toBeNull();
    await expect(w.boss.mutation(api.footage.recordDrive, { projectId: w.p })).rejects.toThrow();
    await expect(w.boss.mutation(api.footage.markDone, { projectId: w.p })).rejects.toThrow();
    expect(await w.boss.query(api.footage.settings, {})).toMatchObject({ on: false }); // its own settings: off until it sets them
    expect((await row(w))[0]).toMatchObject({ status: "offered" });
    expect(await w.sam.query(api.footage.forClientProject, { projectId: w.p })).toBeNull();
  });

  test("D142 (review M1): a project opened before, locked again then unlocked, gets no offer", async () => {
    const w = await world();
    stub([]);
    await setup(w);
    // Opened before Phase 5 (links still live), with no Inbox trace: Lock again keeps the fact it was opened.
    const old = await w.t.run(async (ctx) => {
      const id = await ctx.db.insert("projects", { businessId: w.A, name: "Old", clientId: w.harbor, createdAt: 0, deliveryUnlockedAt: Date.now() - 86_400_000 });
      await ctx.db.insert("deliveryFiles", { businessId: w.A, projectId: id, name: "Old.mov", kind: "dropbox", dropboxPath: "/old.mov", createdAt: 0 });
      return id;
    });
    await w.heston.mutation(api.projects.setDelivery, { projectId: old, unlocked: false });
    await w.heston.mutation(api.projects.setDelivery, { projectId: old, unlocked: true });
    // Locked long ago, but its "Final files ready" Inbox items show it was delivered.
    const older = await w.t.run(async (ctx) => {
      const id = await ctx.db.insert("projects", { businessId: w.A, name: "Older", clientId: w.harbor, createdAt: 0 });
      await ctx.db.insert("deliveryFiles", { businessId: w.A, projectId: id, name: "Older.mov", kind: "dropbox", dropboxPath: "/older.mov", createdAt: 0 });
      await ctx.db.insert("inboxItems", { businessId: w.A, email: "maya@harbor.example", kind: "final_files", title: "Final files ready", text: "Older", source: { module: "projects", id }, key: `final:${id}:1:maya@harbor.example`, createdAt: 1 });
      return id;
    });
    await w.heston.mutation(api.projects.setDelivery, { projectId: older, unlocked: true });
    expect(await row(w)).toHaveLength(0);
    // A new project still gets one, once, however often it's locked and unlocked.
    await w.heston.mutation(api.projects.setDelivery, { projectId: w.p, unlocked: true });
    await w.heston.mutation(api.projects.setDelivery, { projectId: w.p, unlocked: false });
    await w.heston.mutation(api.projects.setDelivery, { projectId: w.p, unlocked: true });
    expect(await row(w)).toHaveLength(1);
  });

  test("the Stripe webhook: paid keeps a year; voided goes back to an open offer", async () => {
    const w = await world();
    stub([]);
    await setup(w);
    await w.heston.mutation(api.projects.setDelivery, { projectId: w.p, unlocked: true });
    await w.maya.mutation(api.footage.keep, { projectId: w.p });
    const [i] = await invoices(w);
    await markSent(w, i._id, "in_1");
    await webhook(w, "in_1", "void");
    expect((await row(w))[0]).toMatchObject({ status: "offered" });
    await w.maya.mutation(api.footage.keep, { projectId: w.p });
    const j = (await invoices(w)).find((x) => x._id !== i._id)!;
    await markSent(w, j._id, "in_2");
    await webhook(w, "in_2", "paid");
    const r = (await row(w))[0];
    expect(r).toMatchObject({ status: "paid", paidUntil: addYear(todayCentral()) });
    await webhook(w, "in_2", "paid"); // a repeat changes nothing
    expect((await row(w))[0].paidUntil).toBe(addYear(todayCentral()));
  });

  test("review H1: paid after it ended or was stopped changes nothing by itself; the owner is told and decides", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    await setup(w);
    await w.heston.mutation(api.projects.setDelivery, { projectId: w.p, unlocked: true });
    await w.maya.mutation(api.footage.keep, { projectId: w.p });
    const [first] = await invoices(w);
    await markSent(w, first._id, "in_1");
    await webhook(w, "in_1", "paid");
    // The renewal goes out, the year ends unpaid, the owner deletes the footage...
    await w.t.run(async (ctx) => { const [r] = await ctx.db.query("footageStorage").collect(); await ctx.db.patch(r._id, { paidUntil: addDays(todayCentral(), 30) }); });
    await runDue(w);
    const renewal = (await invoices(w)).find((x) => x._id !== first._id)!;
    await markSent(w, renewal._id, "in_r");
    await w.t.run(async (ctx) => { const [r] = await ctx.db.query("footageStorage").collect(); await ctx.db.patch(r._id, { paidUntil: todayCentral(), renewalFor: todayCentral() }); });
    await runDue(w);
    await w.heston.mutation(api.footage.markDone, { projectId: w.p });
    // ...then the client pays the old renewal.
    mails.length = 0;
    await webhook(w, "in_r", "paid");
    await settle(w);
    const r = (await row(w))[0];
    expect(r).toMatchObject({ status: "ended", latePaid: { invoiceId: renewal._id, was: "deleted" } });
    expect(r.doneAt).toBeGreaterThan(0);
    expect(await w.maya.query(api.footage.forClientProject, { projectId: w.p })).toBeNull(); // not told it's kept
    expect(mails.find((m) => m.subject === "A storage invoice was paid late: 26127 Launch")?.to).toBe("heston@wranglerproductions.com");
    expect((await w.heston.query(api.home.needs, {})).filter((n: { kind: string }) => n.kind === "footage")).toEqual([expect.objectContaining({ what: "paidLate" })]);
    await expect(w.heston.mutation(api.footage.reinstate, { projectId: w.p })).rejects.toThrow(/Refund/); // deleted: can't keep it
    await w.heston.mutation(api.footage.dismissLatePaid, { projectId: w.p });
    expect((await w.heston.query(api.home.needs, {})).filter((n: { kind: string }) => n.kind === "footage")).toEqual([]);
  });

  test("review H1: paid after Stop storing: the owner can keep it a year from today", async () => {
    const w = await world();
    stub([]);
    await setup(w);
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
    expect((await row(w))[0]).toMatchObject({ status: "stopped", latePaid: { was: "stopped" } });
    await w.heston.mutation(api.footage.reinstate, { projectId: w.p });
    const r = (await row(w))[0];
    expect(r).toMatchObject({ status: "paid", paidUntil: addYear(todayCentral()) });
    expect(r.latePaid).toBeUndefined();
  });

  test("review M3: Keep it pressed but never paid: the owner is told once, after the keep day and the due date", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    await setup(w);
    await w.heston.mutation(api.projects.setDelivery, { projectId: w.p, unlocked: true });
    await w.maya.mutation(api.footage.keep, { projectId: w.p });
    const [i] = await invoices(w);
    await markSent(w, i._id, "in_1");
    expect(await runDue(w)).toMatchObject({ unpaid: 0 }); // not yet
    await w.t.run(async (ctx) => {
      const [r] = await ctx.db.query("footageStorage").collect(); await ctx.db.patch(r._id, { keepUntil: addDays(todayCentral(), -3) });
      await ctx.db.patch(i._id, { dueDate: addDays(todayCentral(), -1) });
    });
    mails.length = 0;
    expect(await runDue(w)).toMatchObject({ unpaid: 1 });
    expect(await runDue(w)).toMatchObject({ unpaid: 0 });
    expect(mails.filter((m) => m.subject === "Raw footage storage not paid: 26127 Launch")).toHaveLength(1);
    expect((await row(w))[0]).toMatchObject({ status: "kept" });
    expect((await w.heston.query(api.home.needs, {})).filter((n: { kind: string }) => n.kind === "footage")).toEqual([expect.objectContaining({ what: "unpaid" })]);
  });

  test("dates: a year on (Feb 29 → Feb 28), and days on", () => {
    expect(addYear("2028-02-29")).toBe("2029-02-28");
    expect(addYear("2026-11-19")).toBe("2027-11-19");
    expect(addDays("2026-12-20", 30)).toBe("2027-01-19");
    expect(addDays("2026-12-20", -30)).toBe("2026-11-20");
  });
});

void (null as unknown as Id<"projects">);
