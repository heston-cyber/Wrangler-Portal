// Phase 5b step 2 (Nov 3): the tool overviews and the Dashboard. The numbers match the seeded records, and another
// business's owner sees none of them.
import { convexTest } from "convex-test";
import { beforeAll, expect, test } from "vitest";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";
import { todayCentral } from "../convex/lib/bookings";
import { addDays } from "../convex/footage";

const modules = import.meta.glob("../convex/**/*.ts");
const api = anyApi;

beforeAll(() => { process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com"; });

async function setup() {
  const t = convexTest(schema, modules);
  const today = todayCentral();
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    const a = await ctx.db.insert("businesses", { slug: "wrangler", name: "Wrangler Productions", createdAt: 0 });
    const owner = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston", role: "owner" });
    await ctx.db.insert("memberships", { businessId: a, email: "heston@wranglerproductions.com", userId: owner, role: "owner", createdAt: 0 });
    const b = await ctx.db.insert("businesses", { slug: "other", name: "Other Films", createdAt: 1 });
    const boss = await ctx.db.insert("users", { email: "boss@otherfilms.example", name: "Boss", role: "owner" });
    await ctx.db.insert("memberships", { businessId: b, email: "boss@otherfilms.example", userId: boss, role: "owner", createdAt: 1 });
    const sess = async (userId: Id<"users">) => `${userId}|${await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 })}`;

    // Clients: one client with a live project, two leads, a follow-up due today and one later, one unread testimonial.
    const harbor = await ctx.db.insert("clients", { businessId: a, name: "Harbor Coffee", createdAt: 0 } as never);
    const proj = await ctx.db.insert("projects", { businessId: a, name: "Launch", jobNumber: "26127", clientId: harbor, stage: "production", createdAt: 0 });
    const delivered = await ctx.db.insert("projects", { businessId: a, name: "Done", stage: "delivery", deliveryUnlockedAt: now, createdAt: 0 });
    const deal = (title: string, stage: "lead" | "quoted") => ctx.db.insert("deals", { businessId: a, title, stage, source: "hand", history: [], createdAt: now, updatedAt: now });
    await deal("Lead one", "lead"); await deal("Lead two", "lead"); await deal("Quoted one", "quoted");
    const fu = (due: string) => ctx.db.insert("followUps", { businessId: a, who: "Pat", about: "Proposal", due, clientId: harbor, createdAt: now });
    await fu(today); await fu(addDays(today, 20));
    const inbox = await ctx.db.insert("inboxNotes", { businessId: a, clientId: harbor, title: "t", text: "t", status: "sent", draftedBy: "owner", createdAt: now, updatedAt: now });
    await ctx.db.insert("testimonials", { businessId: a, noteId: inbox, projectId: proj, email: "p@h.co", name: "Pat", working: "great", film: "great", permission: true, createdAt: now, updatedAt: now });

    // Review: a video with a ready version, shared by a link nobody has opened; one open client note.
    const vid = await ctx.db.insert("videos", { businessId: a, projectId: proj, title: "Launch Film", createdAt: 0, updatedAt: 0 });
    const ver = await ctx.db.insert("versions", { businessId: a, videoId: vid, number: 2, status: "ready", bunnyGuid: "g", fileName: "f.mp4", startTimecode: "01:00:00:00", createdAt: now });
    await ctx.db.insert("shares", { businessId: a, token: "tok", kind: "video", videoId: vid, access: "comment", who: "link", allVersions: true, downloads: false, emailNewVersions: false, createdAt: now, createdBy: owner });
    for (let i = 0; i < 2; i++) await ctx.db.insert("notes", { businessId: a, versionId: ver, videoId: vid, kind: "general", text: "n", status: "open", authorName: "Maya", createdAt: now + i, updatedAt: now, authorKind: "client" });

    // Docs: one sent document nobody has opened, one completed this month, one draft, one contract template.
    const doc = (number: number, status: "sent" | "completed" | "draft") => ctx.db.insert("wsDocuments", { businessId: a, number, title: `Doc ${number}`, status, currentVersion: 1, createdAt: now, updatedAt: now, ...(status === "sent" ? { sentAt: now, sentVersion: 1 } : {}), ...(status === "completed" ? { completedAt: now } : {}) });
    const sent = await doc(1, "sent"); await doc(2, "completed"); await doc(3, "draft");
    await ctx.db.insert("wsSignings", { businessId: a, documentId: sent, versionNumber: 1, signerKey: "client", name: "Maya Brooks", email: "maya@h.co", order: 1, token: "t1", status: "sent", sentAt: now } as never);
    await ctx.db.insert("wsTemplates", { businessId: a, name: "Service agreement", blocks: [], fields: [], style: {}, createdAt: now, updatedAt: now });

    // Proposals: one sent, one accepted (no contract yet), one draft.
    const prop = async (n: number, status: "sent" | "accepted" | "draft") => {
      const build = await ctx.db.insert("wsBuilds", { businessId: a, title: `Pitch ${n}`, blocks: [], fields: [], style: {}, signers: [], kind: "proposal", createdAt: now, updatedAt: now });
      return ctx.db.insert("proposals", { businessId: a, buildId: build, number: `WRNGLR-P-000${n}`, seq: n, status, history: [], createdAt: now, updatedAt: now, ...(status !== "draft" ? { sentAt: now } : {}),
        ...(status === "accepted" ? { response: { kind: "accepted" as const, name: "Pat", at: now } } : {}) });
    };
    await prop(1, "sent"); await prop(2, "accepted"); await prop(3, "draft");

    // Vendors: Jordan (booked this week, offered, W-9 on file isn't set) with a sent invoice.
    const vendor = await ctx.db.insert("vendors", { businessId: a, name: "Jordan Ellis", email: "j@v.co", roles: ["Camera"], rates: [], createdAt: now, updatedAt: now });
    const booking = await ctx.db.insert("vendorBookings", { businessId: a, vendorId: vendor, projectId: proj, role: "Camera", start: addDays(today, 1), end: addDays(today, 1), rate: { cents: 100000, unit: "day" }, status: "offered", offeredAt: now, createdAt: now, updatedAt: now });
    await ctx.db.insert("vendorInvoices", { businessId: a, vendorId: vendor, bookingId: booking, projectId: proj, number: "INV-1", mode: "lines", hours: [], lines: [{ description: "Day", cents: 100000 }], rate: { cents: 100000, unit: "day" }, totalCents: 100000, status: "sent", sentAt: now, createdAt: now, updatedAt: now });

    // A shoot today and one next week.
    const shoot = (date: string) => ctx.db.insert("shoots", { businessId: a, projectId: proj, date, call: "07:30", location: "Studio B", prepare: [], crew: [], status: "scheduled", history: [], createdAt: 0, updatedAt: 0 });
    await shoot(today); await shoot(addDays(today, 3));

    // The other business has records of every kind too: none of them may show.
    const oc = await ctx.db.insert("clients", { businessId: b, name: "Theirs", createdAt: 0 } as never);
    const op = await ctx.db.insert("projects", { businessId: b, name: "Theirs", clientId: oc, stage: "production", createdAt: 0 });
    await ctx.db.insert("deals", { businessId: b, title: "Their lead", stage: "lead", source: "hand", history: [], createdAt: now, updatedAt: now });
    await ctx.db.insert("followUps", { businessId: b, who: "Z", about: "x", due: today, createdAt: now });
    await ctx.db.insert("wsDocuments", { businessId: b, number: 9, title: "Theirs", status: "sent", currentVersion: 1, createdAt: now, updatedAt: now, sentAt: now, sentVersion: 1 });
    await ctx.db.insert("vendors", { businessId: b, name: "Their vendor", email: "x@v.co", roles: [], rates: [], createdAt: now, updatedAt: now });
    await ctx.db.insert("shoots", { businessId: b, projectId: op, date: today, call: "07:30", location: "x", prepare: [], crew: [], status: "scheduled", history: [], createdAt: 0, updatedAt: 0 });
    void delivered;
    return { heston: await sess(owner), boss: await sess(boss) };
  });
  return { t, today, heston: t.withIdentity({ subject: ids.heston }), boss: t.withIdentity({ subject: ids.boss }) };
}

test("T5b.2 Clients overview: tiles, needs, pipeline and follow-up counts match the records", async () => {
  const w = await setup();
  const o = await w.heston.query(api.overviews.clients, {});
  expect(o.tiles).toEqual({ active: 1, leads: 2, followUps: 1, testimonials: 1 });
  expect(o.needsTotal).toBe(4); // one follow-up due, two leads, one testimonial
  expect(o.needs.map((n: { kind: string }) => n.kind)).toEqual(["followup", "lead", "lead", "testimonial"]);
  expect(o.pipeline.find((s: { key: string }) => s.key === "lead").n).toBe(2);
  expect(o.followUps).toEqual({ today: 1, week: 0, later: 1 });
});

test("T5b.2 Review overview: waiting on clients, new notes, in progress, delivered this month", async () => {
  const w = await setup();
  const o = await w.heston.query(api.overviews.review, {});
  expect(o.tiles).toEqual({ waiting: 1, notes: 2, inProgress: 1, delivered: 1 });
  expect(o.waiting[0]).toMatchObject({ video: "26127 Launch Film", version: 2, opens: 0 });
  expect(o.notes[0]).toMatchObject({ who: "Maya", count: 2, version: 2 });
});

test("T5b.2 Docs overview: to sign, signed this month, drafts, templates", async () => {
  const w = await setup();
  const o = await w.heston.query(api.overviews.docs, {});
  expect(o.tiles).toEqual({ toSign: 1, signed: 1, drafts: 1, templates: 1 });
  expect(o.waiting[0]).toMatchObject({ title: "Doc 1", opened: false, remind: { signerKey: "client", name: "Maya Brooks" } });
  expect(o.signature.adopted).toBe(false);
});

test("T5b.2 Proposals overview: out for review, accepted without a contract, drafts, declined", async () => {
  const w = await setup();
  const o = await w.heston.query(api.overviews.proposals, {});
  expect(o.tiles).toEqual({ out: 1, accepted: 1, drafts: 1, declined: 0 });
  expect(o.needs[0]).toMatchObject({ kind: "accepted" });
  expect(o.steps).toBeGreaterThan(0);
});

test("T5b.2 Vendors overview: booked this week, waiting to accept, invoices, missing W-9", async () => {
  const w = await setup();
  const o = await w.heston.query(api.overviews.vendors, {});
  expect(o.tiles).toEqual({ booked: 1, shoots: 1, waiting: 1, invoices: 1, w9: 1 });
  expect(o.needs.map((n: { kind: string }) => n.kind).sort()).toEqual(["invoice", "w9", "waiting"]);
  expect(o.week).toHaveLength(1);
});

test("T5b.2 Dashboard: today, coming up, live edits; money from the Payments numbers", async () => {
  const w = await setup();
  const d = await w.heston.query(api.home.dashboard, { tzOffsetMin: 300 });
  expect(d.tiles).toMatchObject({ today: 1, edits: 1 });
  expect(d.coming).toHaveLength(2);
  expect(d.comingTotal).toBe(2);
  expect(d.money).toEqual({ stripe: null, paid: 0, due: 0, overdue: 0 });
});

test("T5b.2 another business's owner sees none of it", async () => {
  const w = await setup();
  const c = await w.boss.query(api.overviews.clients, {});
  expect(c.tiles).toEqual({ active: 1, leads: 1, followUps: 1, testimonials: 0 }); // only their own
  expect(c.needs.map((n: { title: string }) => n.title).join(" ")).not.toMatch(/Lead one|Harbor/);
  const r = await w.boss.query(api.overviews.review, {});
  expect(r.tiles).toEqual({ waiting: 0, notes: 0, inProgress: 1, delivered: 0 });
  expect((await w.boss.query(api.overviews.docs, {})).tiles).toMatchObject({ toSign: 1, signed: 0, drafts: 0, templates: 0 });
  expect((await w.boss.query(api.overviews.proposals, {})).empty).toBe(true);
  const v = await w.boss.query(api.overviews.vendors, {});
  expect(v.tiles).toEqual({ booked: 0, shoots: 0, waiting: 0, invoices: 0, w9: 0 });
  const d = await w.boss.query(api.home.dashboard, { tzOffsetMin: 0 });
  expect(d.coming).toHaveLength(1);
  expect(d.coming[0].project).toBe("Theirs");
});
