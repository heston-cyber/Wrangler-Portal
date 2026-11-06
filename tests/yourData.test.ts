// Phase 5e step 6 (Nov 6): Settings › Your data. D1 what the export holds (and never holds), D2 who can download it
// and for how long, D3 scheduling and cancelling a deletion (emails 49 and its reminder), D4 the day-60 run, D5 who can
// use any of it, and Wrangler can't be deleted.
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import { unzipSync, strFromU8 } from "fflate";
import type { Id } from "../convex/_generated/dataModel";
import { world } from "./payHarness";
import { SECRET_FIELDS } from "../convex/yourData";

const api = anyApi;
const internal = anyApi;
beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.RESEND_API_KEY = "re_test";
});
beforeEach(() => { vi.useFakeTimers(); }); // scheduled jobs (day 53, day 60) run on the fake clock
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
type W = Awaited<ReturnType<typeof world>>;
const mails: Array<{ to: string; subject: string }> = [];
const stub = () => {
  mails.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { body?: string }) => {
    if (String(url).includes("resend")) { const b = JSON.parse(init?.body ?? "{}"); mails.push({ to: [b.to].flat()[0], subject: b.subject }); }
    return new Response(JSON.stringify({ id: "em" }), { status: 200 });
  }));
};
const settle = (w: W) => w.t.finishAllScheduledFunctions(vi.runAllTimers, 2000); // the day-60 run is a chain of short steps
const B = (w: W) => w.t.run(async (ctx) => (await ctx.db.query("businesses").collect()).find((b) => b.slug === "other")!._id);

async function seedInvoice(w: W, biz: Id<"businesses">, clientId: Id<"clients">, title: string, payToken: string) {
  return w.t.run(async (ctx) => ctx.db.insert("invoices", {
    businessId: biz, clientId, kind: "other", title, lines: [{ id: "l1", description: title, qty: 1, unitCents: 1000 }], dueDate: "2026-12-01", status: "open",
    billTo: { name: "X", email: "x@x.example" }, totalCents: 1000, amountPaidCents: 0, amountRemainingCents: 1000, payToken, history: [], createdAt: 0, updatedAt: 0,
  } as never));
}
async function readZip(w: W, fileId: Id<"_storage">) {
  return w.t.run(async (ctx): Promise<Record<string, string>> => {
    const files = unzipSync(new Uint8Array(await (await ctx.storage.get(fileId))!.arrayBuffer()));
    return Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strFromU8(v)]));
  });
}
function keysIn(x: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(x)) x.forEach((y) => keysIn(y, out));
  else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { out.add(k); keysIn(v, out); }
  return out;
}

describe("Phase 5e · Your data", () => {
  test("D1 the export: this business's records and file links, nothing of another business's, no secrets", async () => {
    const w = await world();
    stub();
    const b = await B(w);
    const w9 = await w.t.run((ctx) => ctx.storage.store(new Blob(["%PDF w9"], { type: "application/pdf" })));
    await w.t.run(async (ctx) => {
      await ctx.db.insert("vendors", { businessId: w.A, name: "Jordan Ellis", email: "jordan@x.example", roles: ["Shooter"], rates: [], w9: { fileId: w9, name: "w9.pdf", uploadedAt: 0 }, createdAt: 0, updatedAt: 0 } as never);
      await ctx.db.insert("clients", { businessId: b, name: "Someone Else's Client", createdAt: 0 });
    });
    const otherClient = await w.t.run(async (ctx) => (await ctx.db.query("clients").collect()).find((c) => c.businessId === b)!._id);
    const ours = await seedInvoice(w, w.A, w.harbor, "Ours", "SECRETPAYTOKENAAAA");
    // Review fix: tokens also travel inside other fields (an Inbox item's link, Stripe's own pay page).
    await w.t.run(async (ctx) => {
      await ctx.db.patch(ours, { stripe: { accountId: "acct_1Pq9WranglerAcct", invoiceId: "in_1", customerId: "cus_1", hostedUrl: "https://invoice.stripe.com/i/acct_1Pq9WranglerAcct/live_STRIPEHOSTEDSECRET99", pdfUrl: "https://pay.stripe.com/invoice/acct_1/STRIPEPDFSECRET77/pdf", livemode: false } } as never);
      await ctx.db.insert("inboxItems", { businessId: w.A, email: "maya@harbor.example", kind: "invoice", title: "Invoice", text: "Pay it", link: "/i/SECRETPAYTOKENAAAA", source: { module: "payments", id: ours }, key: "inv:1", createdAt: 0 });
      await ctx.db.insert("emailPrefs", { businessId: w.A, email: "maya@harbor.example", key: "UNSUBSCRIBEKEYSECRET42", updatedAt: 0 });
      // A file id of another business, pasted into this business's text: never treated as this business's file.
      const theirFile = await ctx.storage.store(new Blob(["theirs"]));
      const kitFile = await ctx.storage.store(new Blob(["kit"]));
      await ctx.db.patch(w.harbor, { brandKit: { colors: [], fonts: {}, files: [{ fileId: kitFile, name: "guide.pdf", size: 3, type: "application/pdf", addedAt: 0 }] } } as never);
      await ctx.db.insert("vendors", { businessId: w.A, name: "Pasted", email: "p@x.example", roles: [], rates: [], portfolio: String(theirFile), createdAt: 0, updatedAt: 0 } as never);
    });
    await seedInvoice(w, b, otherClient, "Theirs", "SECRETPAYTOKENBBBB");
    const exportId = await w.heston.mutation(api.yourData.requestExport, {});
    await expect(w.heston.mutation(api.yourData.requestExport, {})).rejects.toThrow(/already being made/);
    expect((await w.heston.query(api.yourData.state, {})).latest).toMatchObject({ status: "making" });
    await settle(w);
    const e = await w.t.run(async (ctx) => ctx.db.get(exportId as Id<"dataExports">));
    expect(e).toMatchObject({ status: "ready" });
    const files = await readZip(w, e!.fileId!);
    expect(Object.keys(files)).toEqual(expect.arrayContaining(["README.txt", "files.csv", "clients.csv", "projects.csv", "invoices.csv", "vendors.csv", "records/clients.json", "records/invoices.json", "records/vendors.json", "records/projects.json"]));
    const everything = Object.values(files).join("\n");
    expect(everything).toContain("Harbor Coffee");
    expect(everything).not.toContain("Someone Else's Client");
    expect(everything).not.toContain("Theirs");
    expect(everything).not.toContain("SECRETPAYTOKEN");
    expect(everything).not.toMatch(/STRIPEHOSTEDSECRET|STRIPEPDFSECRET|UNSUBSCRIBEKEYSECRET/);
    expect(files["records/inboxItems.json"]).toContain("/i/[removed]");
    expect(files["records/invoices.json"]).toContain("acct_1Pq9WranglerAcct"); // Stripe's own ids aren't secrets
    expect(files["files.csv"].trim().split("\r\n").filter((l) => l.startsWith("vendors,"))).toHaveLength(1); // the W-9, not the pasted id
    expect(files["files.csv"]).toMatch(/clients,[a-z0-9]+,brandKit\.files\[0\]\.fileId,http/); // a file in a brand kit
    expect(files["records/connectorKeys.json"]).toBeUndefined();
    for (const [name, text] of Object.entries(files)) if (name.endsWith(".json")) for (const k of keysIn(JSON.parse(text))) expect(SECRET_FIELDS.has(k), `${name}: ${k}`).toBe(false);
    expect(files["files.csv"]).toMatch(/vendors,[a-z0-9]+,w9\.fileId,http/);
    expect(files["vendors.csv"]).toContain("Jordan Ellis,jordan@x.example,Shooter,Yes");
    expect(mails.filter((m) => m.to === "heston@wranglerproductions.com").map((m) => m.subject)).toEqual(["Your Wrangler Productions export is ready"]);
    const rows = await w.t.run(async (ctx) => (await ctx.db.query("auditLog").collect()).map((r) => r.text));
    expect(rows).toContain("asked for an export of everything");
  });

  test("D2 the download is the signed-in owner's, for 7 days; then its file goes", async () => {
    const w = await world();
    stub();
    const exportId = await w.heston.mutation(api.yourData.requestExport, {});
    await settle(w);
    expect(await w.heston.mutation(api.yourData.exportLink, { exportId })).toMatch(/^http/);
    await expect(w.maya.mutation(api.yourData.exportLink, { exportId })).rejects.toThrow();
    await expect(w.boss.mutation(api.yourData.exportLink, { exportId })).rejects.toThrow();
    await expect(w.t.mutation(api.yourData.exportLink, { exportId })).rejects.toThrow();
    const fileId = (await w.t.run(async (ctx) => ctx.db.get(exportId as Id<"dataExports">)))!.fileId!;
    await w.t.run(async (ctx) => { await ctx.db.patch(exportId as Id<"dataExports">, { expiresAt: Date.now() - 1 }); });
    expect((await w.heston.query(api.yourData.state, {})).latest).toMatchObject({ status: "expired" });
    await expect(w.heston.mutation(api.yourData.exportLink, { exportId })).rejects.toThrow(/expired/);
    expect(await w.t.mutation(internal.yourData.purge, {})).toBe(1);
    expect(await w.t.run(async (ctx) => ctx.storage.get(fileId))).toBeNull();
    // Cancelled while being made: the file it made is thrown away.
    const second = await w.heston.mutation(api.yourData.requestExport, {});
    await w.heston.mutation(api.yourData.cancelExport, { exportId: second });
    await settle(w);
    expect(await w.t.run(async (ctx) => (await ctx.db.get(second as Id<"dataExports">))!.status)).toBe("cancelled");
  });

  test("D3 schedule a deletion (typed name, email 49), cancel it, and nothing happens on day 60", async () => {
    const w = await world();
    stub();
    const b = await B(w);
    await expect(w.boss.mutation(api.yourData.scheduleDeletion, { typedName: "other films" })).rejects.toThrow(/exactly/);
    const { deleteAt } = await w.boss.mutation(api.yourData.scheduleDeletion, { typedName: "Other Films" });
    expect(Math.round((deleteAt - Date.now()) / 86_400_000)).toBe(60);
    await expect(w.boss.mutation(api.yourData.scheduleDeletion, { typedName: "Other Films" })).rejects.toThrow(/already scheduled/);
    expect((await w.boss.query(api.yourData.state, {})).deletion).toMatchObject({ deleteAt });
    await settle(w); // email 49 now; the reminder and the run are weeks away and do nothing yet
    expect(mails.map((m) => [m.to, m.subject])).toEqual([["boss@other.example", "Other Films is scheduled for deletion"]]);
    const deletionId = await w.t.run(async (ctx) => (await ctx.db.query("businessDeletions").collect())[0]._id);
    expect(await w.t.run(async (ctx) => (await ctx.db.get(deletionId))!.status)).toBe("scheduled");
    await w.boss.mutation(api.yourData.cancelDeletion, {});
    expect((await w.boss.query(api.yourData.state, {})).deletion).toBeNull();
    // Day 53 and day 60 come round: no reminder, nothing deleted.
    vi.setSystemTime(deleteAt - 7 * 86_400_000);
    await w.t.action(internal.yourData.sendDeletionMail, { deletionId, reminder: true, asBusiness: b });
    vi.setSystemTime(deleteAt + 1000);
    await w.t.action(internal.yourData.runDeletion, { deletionId, asBusiness: b });
    await settle(w);
    expect(await w.t.run(async (ctx) => ctx.db.get(b))).not.toBeNull();
    expect(await w.t.run(async (ctx) => (await ctx.db.get(deletionId))!.status)).toBe("cancelled");
    expect(mails).toHaveLength(1);
  });

  test("D4 day 60: a safety-net export, everyone signed out, only that business's records go, the admins see the export", async () => {
    const w = await world();
    stub();
    const b = await B(w);
    const seeded = await w.t.run(async (ctx) => {
      const client = await ctx.db.insert("clients", { businessId: b, name: "Their Client", createdAt: 0 });
      await ctx.db.insert("projects", { businessId: b, name: "Their Project", clientId: client, createdAt: 0 });
      const logo = await ctx.storage.store(new Blob(["png"], { type: "image/png" }));
      await ctx.db.insert("vendors", { businessId: b, name: "Their Vendor", email: "v@x.example", roles: [], rates: [], w9: { fileId: logo, name: "w9.pdf", uploadedAt: 0 }, createdAt: 0, updatedAt: 0 } as never);
      // someone only in this business, and Maya, who is also Wrangler's client
      const only = await ctx.db.insert("users", { email: "only@other.example", name: "Only", role: "client" });
      await ctx.db.insert("memberships", { businessId: b, email: "only@other.example", userId: only, role: "client", createdAt: 0 });
      await ctx.db.insert("authSessions", { userId: only, expirationTime: Date.now() + 3_600_000 });
      const maya = (await ctx.db.query("users").withIndex("email", (q) => q.eq("email", "maya@harbor.example")).first())!._id;
      await ctx.db.insert("memberships", { businessId: b, email: "maya@harbor.example", userId: maya, role: "client", createdAt: 0 });
      await ctx.db.insert("authSessions", { userId: maya, expirationTime: Date.now() + 3_600_000 }); // signed in at Wrangler
      // Review fix: Wrangler's file id pasted into this business's text is not this business's file.
      const ours = await ctx.storage.store(new Blob(["wrangler's"]));
      await ctx.db.insert("vendors", { businessId: b, name: "Paster", email: "p@x.example", roles: [], rates: [], portfolio: String(ours), createdAt: 0, updatedAt: 0 } as never);
      return { client, logo, only, maya, ours };
    });
    await seedInvoice(w, b, seeded.client, "Theirs", "SECRETPAYTOKENCCCC");
    const before = await w.t.run(async (ctx) => ({ projects: (await ctx.db.query("projects").collect()).filter((p) => p.businessId === w.A).length, clients: (await ctx.db.query("clients").collect()).filter((p) => p.businessId === w.A).length }));
    const mayaSessions = await w.t.run(async (ctx) => (await ctx.db.query("authSessions").collect()).filter((s) => s.userId === seeded.maya).length);
    const { deleteAt } = await w.boss.mutation(api.yourData.scheduleDeletion, { typedName: "Other Films" });
    await settle(w);
    const deletionId = await w.t.run(async (ctx) => (await ctx.db.query("businessDeletions").collect())[0]._id);
    vi.setSystemTime(deleteAt - 7 * 86_400_000); // the reminder, a week before
    await w.t.action(internal.yourData.sendDeletionMail, { deletionId, reminder: true, asBusiness: b });
    vi.setSystemTime(deleteAt + 1000); // day 60
    await w.t.action(internal.yourData.runDeletion, { deletionId, asBusiness: b });
    await settle(w);
    const d = (await w.t.run(async (ctx) => ctx.db.get(deletionId)))!;
    expect(d).toMatchObject({ status: "done", step: "done", deleted: expect.objectContaining({ clients: 1, projects: 1, invoices: 1, vendors: 2 }) });
    expect(mails.map((m) => m.subject)).toEqual(["Other Films is scheduled for deletion", `Other Films will be deleted on ${new Date(deleteAt).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric" })}`]);
    const after = await w.t.run(async (ctx) => ({
      business: await ctx.db.get(b),
      theirRows: (await ctx.db.query("clients").collect()).filter((c) => c.businessId === b).length + (await ctx.db.query("invoices").collect()).filter((c) => c.businessId === b).length,
      file: !!(await ctx.storage.get(seeded.logo)), oursFile: !!(await ctx.storage.get(seeded.ours)),
      mayaSessions: (await ctx.db.query("authSessions").collect()).filter((s) => s.userId === seeded.maya).length,
      only: await ctx.db.get(seeded.only), onlySessions: (await ctx.db.query("authSessions").collect()).filter((s) => s.userId === seeded.only).length,
      maya: await ctx.db.get(seeded.maya), mayaMembers: (await ctx.db.query("memberships").collect()).filter((m) => m.userId === seeded.maya).map((m) => m.businessId),
      boss: (await ctx.db.query("users").withIndex("email", (q) => q.eq("email", "boss@other.example")).first()),
      ours: { projects: (await ctx.db.query("projects").collect()).filter((p) => p.businessId === w.A).length, clients: (await ctx.db.query("clients").collect()).filter((p) => p.businessId === w.A).length },
    }));
    expect(after.business).toBeNull();
    expect(after.theirRows).toBe(0);
    expect(after.file).toBe(true); // option B: kept 30 days with the safety-net export
    expect(after.oursFile).toBe(true);
    expect(after.mayaSessions).toBe(mayaSessions); // still Wrangler's client, so still signed in there
    expect(after.only).toBeNull();
    expect(after.onlySessions).toBe(0);
    expect(after.maya).not.toBeNull();
    expect(after.mayaMembers).toEqual([w.A]);
    expect(after.boss).toBeNull();
    expect(after.ours).toEqual(before);
    // The safety net: kept 30 days, for the portal's admins only.
    const files = await readZip(w, d.finalExportId!);
    expect(files["records/clients.json"]).toContain("Their Client");
    expect(Object.values(files).join("\n")).not.toContain("Harbor Coffee");
    const st = await w.heston.query(api.yourData.state, {});
    expect(st.safety).toEqual([expect.objectContaining({ name: "Other Films" })]);
    expect(await w.heston.mutation(api.yourData.finalExportLink, { deletionId: d._id })).toMatch(/^http/);
    expect(files["files.csv"]).toMatch(/vendors,[a-z0-9]+,w9\.fileId,http/);
    // Day 30 after: the export and the files kept with it go; Wrangler's file stays.
    vi.setSystemTime(deleteAt + 31 * 86_400_000);
    await w.t.mutation(internal.yourData.purge, {});
    const later = await w.t.run(async (ctx) => ({ file: !!(await ctx.storage.get(seeded.logo)), zip: !!(await ctx.storage.get(d.finalExportId!)), ours: !!(await ctx.storage.get(seeded.ours)), kept: (await ctx.db.query("deletionFiles").collect()).length }));
    expect(later).toEqual({ file: false, zip: false, ours: true, kept: 0 });
    expect((await w.heston.query(api.yourData.state, {})).safety).toEqual([]);
  });

  test("D6 a run that stops part way starts again where it stopped; a started run can't be cancelled", async () => {
    const w = await world();
    stub();
    const b = await B(w);
    await w.t.run(async (ctx) => { for (let i = 0; i < 250; i++) await ctx.db.insert("clients", { businessId: b, name: `C${i}`, createdAt: 0 }); });
    const { deleteAt } = await w.boss.mutation(api.yourData.scheduleDeletion, { typedName: "Other Films" });
    await settle(w);
    const deletionId = await w.t.run(async (ctx) => (await ctx.db.query("businessDeletions").collect())[0]._id);
    vi.setSystemTime(deleteAt + 1000);
    // The export and the first steps happen, then the run stops (as if a step had failed).
    await w.t.mutation(internal.yourData.startDeletion, { deletionId, asBusiness: b });
    await expect(w.boss.mutation(api.yourData.cancelDeletion, {})).rejects.toThrow(/already started/);
    const zip = await w.t.run((ctx) => ctx.storage.store(new Blob(["zip"])));
    await w.t.mutation(internal.yourData.keepFinal, { deletionId, fileId: zip, bytes: 3, asBusiness: b });
    for (let i = 0; i < 6; i++) await w.t.mutation(internal.yourData.deleteStep, { deletionId, asBusiness: b });
    await w.t.run(async (ctx) => { for (const j of await ctx.db.system.query("_scheduled_functions").collect()) if (j.state.kind === "pending") await ctx.scheduler.cancel(j._id); });
    const mid = (await w.t.run(async (ctx) => ctx.db.get(deletionId)))!;
    expect(mid.status).toBe("running");
    expect(await w.t.run(async (ctx) => ctx.db.get(b))).not.toBeNull();
    // Half an hour without a step: the daily purge starts it again from its saved step; nothing is made twice.
    vi.setSystemTime(Date.now() + 31 * 60_000);
    await w.t.mutation(internal.yourData.purge, {});
    await settle(w);
    const d = (await w.t.run(async (ctx) => ctx.db.get(deletionId)))!;
    expect(d).toMatchObject({ status: "done", finalExportId: zip, attempts: 2 });
    expect(d.deleted?.clients).toBe(250);
    expect(await w.t.run(async (ctx) => ctx.db.get(b))).toBeNull();
  });

  test("D5 Wrangler can't be deleted; only the owner can use Your data", async () => {
    const w = await world();
    await expect(w.heston.mutation(api.yourData.scheduleDeletion, { typedName: "Wrangler Productions" })).rejects.toThrow(/can't be deleted/);
    expect((await w.heston.query(api.yourData.state, {})).business).toEqual({ name: "Wrangler Productions", isDefault: true });
    for (const who of [w.maya, w.t]) {
      await expect(who.query(api.yourData.state, {})).rejects.toThrow();
      await expect(who.mutation(api.yourData.requestExport, {})).rejects.toThrow();
      await expect(who.mutation(api.yourData.scheduleDeletion, { typedName: "Wrangler Productions" })).rejects.toThrow();
    }
    expect((await w.boss.query(api.yourData.state, {})).safety).toEqual([]); // not an admin
  });
});
