// Phase 5d step 2 (T5d.4): Messages. One thread per project between the business and the client's people who can open
// it; a client who can't open the project (or a client of another business, or a vendor) gets nothing; read receipts
// and unread counts; files (25 MB, 10 a message); Show earlier messages; email 44 + an Inbox row to the client's
// people and email 45 to the owner, a couple of minutes later, once per unread stretch and only if still unread, behind
// their switches; a lead's thread by private link (no login) with email 44 carrying the link; a booked call is a line
// in the lead's thread.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { world } from "./payHarness";

const api = anyApi;
beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_ONLY_TO = "";
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

type Sent = { to: string; subject: string; text: string };
async function setup() {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(Date.parse("2030-01-07T15:00:00Z"));
  const w = await world();
  const mails: Sent[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === "https://api.resend.com/emails") { const b = JSON.parse(String(init?.body)); mails.push({ to: b.to[0], subject: b.subject, text: b.text }); return new Response(JSON.stringify({ id: "re_1" }), { status: 200 }); }
    return new Response("{}", { status: 500 });
  }));
  // Maya and Jo can open the Launch project; Sam is a client of the business but not on it.
  await w.t.run(async (ctx) => {
    const owner = (await ctx.db.query("users").first())!._id;
    const s = await ctx.db.insert("shares", { businessId: w.A, token: "tok-proj-1", kind: "project", projectId: w.p, access: "comment", who: "invited", allVersions: true, downloads: false, emailNewVersions: true, createdAt: 0, createdBy: owner });
    for (const email of ["maya@harbor.example", "jo@harbor.example"]) await ctx.db.insert("shareMembers", { businessId: w.A, shareId: s, email, addedAt: 0 });
  });
  const settle = () => w.t.finishAllScheduledFunctions(vi.runAllTimers);
  const later = (ms: number) => vi.setSystemTime(Date.now() + ms);
  return { ...w, mails, settle, later };
}
type W = Awaited<ReturnType<typeof setup>>;
const upload = (w: W, size: number, type = "application/zip") => w.t.run(async (ctx) => ctx.storage.store(new Blob([new Uint8Array(size)], { type })));

describe("messages", () => {
  test("A project thread: the owner starts it; its people read and reply; others get nothing", async () => {
    const w = await setup();
    const opts = await w.heston.query(api.messages.startOptions, {});
    expect(opts.projects.map((p: { _id: string }) => p._id)).toContain(w.p);
    const tid = await w.heston.mutation(api.messages.start, { projectId: w.p }) as Id<"msgThreads">;
    expect(await w.heston.mutation(api.messages.start, { projectId: w.p })).toBe(tid); // one thread per project
    await w.heston.mutation(api.messages.send, { threadId: tid, text: "Can we move Thursday's start to 10?" });
    const page = await w.maya.query(api.messages.clientThreadPage, { threadId: tid });
    expect(page).toMatchObject({ title: "Launch", sub: "With Wrangler Productions" });
    expect(page.messages.map((m: { text: string; mine: boolean }) => [m.text, m.mine])).toEqual([["Can we move Thursday's start to 10?", false]]);
    expect((await w.maya.query(api.messages.mine, {})).threads[0]).toMatchObject({ _id: tid, unread: true });
    expect(await w.maya.query(api.messages.unread, {})).toBe(1);
    // Sam (a client, not on the project), the other business's owner and a stranger link get nothing.
    expect(await w.sam.query(api.messages.clientThreadPage, { threadId: tid })).toBeNull();
    expect((await w.sam.query(api.messages.mine, {})).threads).toEqual([]);
    await expect(w.sam.mutation(api.messages.clientSend, { threadId: tid, text: "hi" })).rejects.toThrow(/isn't here/);
    expect(await w.boss.query(api.messages.thread, { threadId: tid })).toBeNull();
    await expect(w.boss.mutation(api.messages.send, { threadId: tid, text: "hi" })).rejects.toThrow(/isn't here/);
    await expect(w.maya.query(api.messages.thread, { threadId: tid })).rejects.toThrow(/Not allowed/);
    // Maya reads and replies; the owner sees "Read by Maya" under their message, then her reply, unread.
    w.later(60_000);
    await w.maya.mutation(api.messages.read, { threadId: tid });
    expect(await w.maya.query(api.messages.unread, {})).toBe(0);
    const own = await w.heston.query(api.messages.thread, { threadId: tid });
    expect(own.readBy.names.map((n: { name: string }) => n.name)).toEqual(["Maya"]);
    w.later(60_000);
    await w.maya.mutation(api.messages.clientSend, { threadId: tid, text: "Yes, 10 works." });
    expect(await w.heston.query(api.messages.unread, {})).toBe(1);
    expect((await w.heston.query(api.messages.threads, {}))[0]).toMatchObject({ _id: tid, unread: true, title: "Maya Brooks", sub: "Harbor Coffee · Launch" });
    expect((await w.maya.query(api.messages.clientThreadPage, { threadId: tid })).readBy).toMatchObject({ names: [] });
    await w.heston.mutation(api.messages.read, { threadId: tid });
    expect((await w.maya.query(api.messages.clientThreadPage, { threadId: tid })).readBy.names.map((n: { name: string }) => n.name)).toEqual(["Heston"]);
    // Search finds it by a word in a message.
    expect((await w.heston.query(api.messages.threads, { q: "thursday" })).map((t: { _id: string }) => t._id)).toEqual([tid]);
    expect(await w.heston.query(api.messages.threads, { q: "zebra" })).toEqual([]);
  });

  test("A client can start their project's thread; Show earlier messages pages back", async () => {
    const w = await setup();
    expect((await w.maya.query(api.messages.mine, {})).projects.map((p: { _id: string }) => p._id)).toEqual([w.p]);
    const r = await w.maya.mutation(api.messages.clientSend, { projectId: w.p, text: "Hello!" });
    await expect(w.sam.mutation(api.messages.clientSend, { projectId: w.p, text: "Hello!" })).rejects.toThrow(/isn't here/);
    for (let i = 0; i < 45; i++) { w.later(1000); await w.heston.mutation(api.messages.send, { threadId: r.threadId, text: `Line ${i}` }); }
    const first = await w.maya.query(api.messages.clientThreadPage, { threadId: r.threadId });
    expect(first.messages).toHaveLength(40);
    expect(first.more).toBe(true);
    expect(first.messages.at(-1).text).toBe("Line 44");
    const older = await w.maya.query(api.messages.clientThreadPage, { threadId: r.threadId, before: first.messages[0].createdAt });
    expect(older.messages.map((m: { text: string }) => m.text)).toEqual(["Hello!", "Line 0", "Line 1", "Line 2", "Line 3", "Line 4"]);
    expect(older.more).toBe(false);
  });

  test("Files: up to 10 a message, 25 MB each; a refused file is deleted; readers get a link", async () => {
    const w = await setup();
    const tid = await w.heston.mutation(api.messages.start, { projectId: w.p }) as Id<"msgThreads">;
    const ok = await upload(w, 1000);
    expect(await w.maya.mutation(api.messages.clientSend, { threadId: tid, text: "Here are the logo files.", files: [{ storageId: ok, name: "Logo-files.zip" }] })).toMatchObject({ error: null });
    const m = (await w.heston.query(api.messages.thread, { threadId: tid })).messages[0];
    expect(m.files[0]).toMatchObject({ name: "Logo-files.zip", size: 1000 });
    expect(m.files[0].url).toBeTruthy();
    const big = await upload(w, 25 * 1024 * 1024 + 1);
    expect((await w.maya.mutation(api.messages.clientSend, { threadId: tid, text: "", files: [{ storageId: big, name: "huge.mov" }] })).error).toMatch(/over 25 MB/);
    expect(await w.t.run(async (ctx) => ctx.db.system.get(big))).toBeNull();
    const many = await Promise.all(Array.from({ length: 11 }, () => upload(w, 10)));
    expect((await w.heston.mutation(api.messages.send, { threadId: tid, text: "x", files: many.map((s) => ({ storageId: s, name: "f" })) })).error).toMatch(/Up to 10/);
    await expect(w.heston.mutation(api.messages.send, { threadId: tid, text: "   " })).rejects.toThrow(/Write a message/);
  });

  test("Emails: 44 and an Inbox row to the client's people, 45 to the owner; once per unread stretch, only if still unread; switches", async () => {
    const w = await setup();
    const tid = await w.heston.mutation(api.messages.start, { projectId: w.p }) as Id<"msgThreads">;
    await w.heston.mutation(api.messages.send, { threadId: tid, text: "First." });
    w.later(10_000);
    await w.heston.mutation(api.messages.send, { threadId: tid, text: "Second." });
    await w.jo.mutation(api.messages.read, { threadId: tid }); // Jo read both before the email went
    await w.settle();
    const to44 = w.mails.filter((m) => /sent you a message about Launch/.test(m.subject));
    expect(to44.map((m) => m.to)).toEqual(["maya@harbor.example"]); // one email, to Maya only
    expect(to44[0].text).toContain("First.");
    expect(to44[0].text).toContain("And 1 more message.");
    expect(to44[0].text).toContain(`/messages?thread=${tid}`);
    const inbox = await w.maya.query(api.inbox.mine, {});
    expect(JSON.stringify(inbox)).toContain("sent you a message about Launch");
    // Maya replies twice: the owner gets one email 45.
    w.mails.length = 0;
    await w.maya.mutation(api.messages.clientSend, { threadId: tid, text: "Got it." });
    await w.maya.mutation(api.messages.clientSend, { threadId: tid, text: "And thanks." });
    await w.settle();
    expect(w.mails.map((m) => [m.to, m.subject])).toEqual([["heston@wranglerproductions.com", "Maya Brooks sent a message about Launch"]]);
    // Switches: the owner's off → no 45; Maya's off → no 44 (Jo still gets hers).
    w.mails.length = 0;
    await w.heston.mutation(api.notifications.setOwner, { key: "messages_owner", on: false });
    await w.maya.mutation(api.notifications.setClient, { key: "client_messages", on: false });
    await w.heston.mutation(api.messages.read, { threadId: tid });
    await w.jo.mutation(api.messages.clientSend, { threadId: tid, text: "Me too." });
    w.later(1000);
    await w.heston.mutation(api.messages.send, { threadId: tid, text: "Great." });
    await w.settle();
    expect(w.mails.map((m) => m.to)).toEqual(["jo@harbor.example"]); // Maya switched hers off; the owner switched 45 off
  });

  test("A lead: a thread by private link, no login; email 44 carries the link", async () => {
    const w = await setup();
    const dealId = await w.t.run(async (ctx) => ctx.db.insert("deals", { businessId: w.A, title: "Brand film", stage: "lead", source: "call", contactEmail: "priya@lead.example", lead: { name: "Priya Nair", email: "priya@lead.example", fields: [], at: 0 }, history: [], createdAt: 0, updatedAt: 0 }));
    const tid = await w.heston.mutation(api.messages.start, { dealId }) as Id<"msgThreads">;
    const page0 = await w.heston.query(api.messages.thread, { threadId: tid });
    expect(page0).toMatchObject({ kind: "lead", title: "Priya Nair", sub: "Lead · Brand film" });
    await w.heston.mutation(api.messages.send, { threadId: tid, text: "Looking forward to Thursday." });
    await w.settle();
    const mail = w.mails.find((m) => m.to === "priya@lead.example")!;
    const token = mail.text.match(/\/m\/([\w-]+)/)![1];
    expect(mail.text).toContain("No login needed");
    const lp = await w.t.query(api.messages.leadPage, { token });
    expect(lp).toMatchObject({ name: "Priya Nair", about: "Brand film", business: { name: "Wrangler Productions" } });
    expect(lp.messages.at(-1)).toMatchObject({ text: "Looking forward to Thursday.", mine: false });
    w.later(60_000);
    await w.t.mutation(api.messages.leadRead, { token });
    await w.t.mutation(api.messages.leadSend, { token, text: "Should I send the brief ahead?" });
    expect((await w.heston.query(api.messages.thread, { threadId: tid })).messages.at(-1)).toMatchObject({ side: "lead", name: "Priya Nair", text: "Should I send the brief ahead?" });
    expect((await w.heston.query(api.messages.thread, { threadId: tid })).readBy.names.map((n: { name: string }) => n.name)).toEqual(["Priya"]);
    // Her link opens only her thread; a made-up one opens nothing; clients never see lead threads.
    expect(await w.t.query(api.messages.leadPage, { token: "z".repeat(24) })).toBeNull();
    await expect(w.t.mutation(api.messages.leadSend, { token: "z".repeat(24), text: "x" })).rejects.toThrow(/doesn't work/);
    expect(await w.maya.query(api.messages.clientThreadPage, { threadId: tid })).toBeNull();
    expect(await w.boss.query(api.messages.thread, { threadId: tid })).toBeNull();
  });

  test("A booked call adds a line to the lead's thread", async () => {
    const w = await setup();
    const dealId = await w.t.run(async (ctx) => ctx.db.insert("deals", { businessId: w.A, title: "Event recap", stage: "lead", source: "call", contactEmail: "jl@lead.example", lead: { name: "Jordan Lee", email: "jl@lead.example", fields: [], at: 0 }, history: [], createdAt: 0, updatedAt: 0 }));
    const token = "jordancalltoken0123456789";
    await w.t.run(async (ctx) => { await ctx.db.insert("calls", { businessId: w.A, dealId, name: "Jordan Lee", email: "jl@lead.example", start: Date.parse("2030-01-09T17:00:00Z"), end: Date.parse("2030-01-09T17:30:00Z"), tz: "America/Chicago", status: "booked", token, history: [], createdAt: 0, updatedAt: 0 }); });
    await w.t.mutation(api.calls.cancel, { token });
    const t = await w.t.run(async (ctx) => (await ctx.db.query("msgThreads").collect()).find((x) => x.dealId === dealId)!);
    const page = await w.heston.query(api.messages.thread, { threadId: t._id });
    expect(page.messages).toHaveLength(1);
    expect(page.messages[0]).toMatchObject({ side: "system", call: { what: "cancelled", start: Date.parse("2030-01-09T17:00:00Z") } });
    expect((await w.heston.query(api.messages.threads, {}))[0]).toMatchObject({ kind: "lead", lastText: expect.stringMatching(/^Call cancelled: Wed, Jan 9, 11:00 AM/), unread: false });
  });
});
