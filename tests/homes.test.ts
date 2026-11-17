// How everything connects (Nov 16; D204–D206). The data layer: things made on their own, Attach and Move, a project's
// move carrying everything, sent things staying with their client, and nothing crossing businesses.
//   T-H.1 made on its own · T-H.2 Attach and Move per kind · T-H.3 a project moves with everything; the old client loses
//   it · T-H.4 sent stays with its client · T-H.5 nothing crosses businesses
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { world } from "./payHarness";
import { homeOf } from "../convex/homes";
import { coveredProjects } from "../convex/lib/shareAccess";
import { PERMS, type Perm } from "../convex/lib/perms";

type W = Awaited<ReturnType<typeof world>>;
const member = async (w: W, email: string, role: "producer" | "editor" | "bookkeeper", on: Perm[]) => {
  const sub = await w.t.run(async (ctx) => {
    const u = await ctx.db.insert("users", { email, name: email.split("@")[0], role: "team", emailVerificationTime: 0 });
    await ctx.db.insert("memberships", { businessId: w.A, email, userId: u, role: "team", teamRole: role, perms: Object.fromEntries(PERMS.map((p) => [p, on.includes(p)])), createdAt: 1 });
    return `${u}|${await ctx.db.insert("authSessions", { userId: u, expirationTime: Date.now() + 3_600_000 })}`;
  });
  return w.t.withIdentity({ subject: sub });
};

const api = anyApi;
beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.RESEND_API_KEY = "re_test";
});
afterEach(() => vi.unstubAllGlobals());

const quote = (businessId: Id<"businesses">, extra: Record<string, unknown>) => ({
  businessId, number: "Q-0001", seq: 1, status: "draft" as const, title: "Launch quote", lines: [], deposit: { kind: "percent" as const, value: 25 },
  validUntil: "2030-01-01", totalCents: 100_00, history: [], createdAt: 0, updatedAt: 0, ...extra,
});

describe("how everything connects", () => {
  test("T-H.1, T-H.2 a shot list made on its own, attached to a project, then a shoot day, then let go", async () => {
    const w = await world();
    await expect(w.heston.mutation(api.shotLists.create, {})).rejects.toThrow(/name/);
    const listId = await w.heston.mutation(api.shotLists.create, { title: "Spec spot ideas" }) as Id<"shotLists">;
    let l = await w.heston.query(api.shotLists.get, { listId });
    expect(l).toMatchObject({ title: "Spec spot ideas", project: null, shoot: null, days: [] });
    expect((await w.heston.query(api.homes.loose, {})).some((x: { id: string }) => x.id === listId)).toBe(true);
    expect((await w.heston.query(api.shotLists.all, {}))[0]).toMatchObject({ _id: listId, project: null });

    await w.heston.mutation(api.homes.move, { kind: "shotList", id: listId, to: { type: "project", id: w.p } });
    expect((await w.heston.query(api.shotLists.get, { listId })).project._id).toBe(w.p);
    const { shootId } = await w.heston.mutation(api.shoots.schedule, { projectId: w.p, date: "2030-02-02", call: "07:00", location: "Studio", parking: "", prepare: [], withOwner: true, bookingIds: [], calendar: false });
    await w.heston.mutation(api.homes.move, { kind: "shotList", id: listId, to: { type: "shoot", id: shootId } });
    l = await w.heston.query(api.shotLists.get, { listId });
    expect(l.shoot._id).toBe(shootId);
    // One list per shoot day: a second can't take it; the picker marks it taken.
    const second = await w.heston.mutation(api.shotLists.create, { title: "B-roll" }) as Id<"shotLists">;
    await expect(w.heston.mutation(api.homes.move, { kind: "shotList", id: second, to: { type: "shoot", id: shootId } })).rejects.toThrow(/already has a shot list/);
    expect((await w.heston.query(api.homes.places, { kind: "shotList" })).find((x: { id: string }) => x.id === shootId)).toMatchObject({ type: "shoot", taken: true });
    // A shot list can't go on a client or a lead.
    await expect(w.heston.mutation(api.homes.move, { kind: "shotList", id: listId, to: { type: "client", id: w.harbor } })).rejects.toThrow(/can't go on a client/);
    // Let go: on its own again, keeping its name.
    await w.heston.mutation(api.homes.move, { kind: "shotList", id: listId, to: null });
    expect(await w.heston.query(api.shotLists.get, { listId })).toMatchObject({ project: null, shoot: null, title: "Spec spot ideas" });
    // Two lists on their own can trade setups (the same "no project").
    const x = await w.heston.mutation(api.shotLists.addSetup, { listId, title: "Hero" }) as Id<"shotSetups">;
    await w.heston.mutation(api.shotLists.moveSetup, { setupId: x, index: 0, listId: second });
    expect((await w.heston.query(api.shotLists.get, { listId: second })).setups.map((s: { title: string }) => s.title)).toEqual(["Hero"]);
    // Moves are logged in Settings › Activity.
    expect(await w.t.run(async (ctx) => (await ctx.db.query("auditLog").collect()).filter((e) => e.kind === "moved").length)).toBeGreaterThanOrEqual(3);
  });

  test("T-H.2, T-H.4 a quote: lead → project (its client follows) → none; once sent it stays with its client", async () => {
    const w = await world();
    const { other, dealId, otherClient } = await w.t.run(async (ctx) => {
      const otherClient = await ctx.db.insert("clients", { businessId: w.A, name: "Northline Outfitters", createdAt: 0 });
      const other = await ctx.db.insert("projects", { businessId: w.A, name: "Brand film", client: "Northline Outfitters", clientId: otherClient, createdAt: 0 });
      const dealId = await ctx.db.insert("deals", { businessId: w.A, title: "Harbor summer", stage: "lead", source: "hand", clientId: w.harbor, history: [], createdAt: 0, updatedAt: 0 });
      return { other, dealId, otherClient };
    });
    const q = await w.t.run((ctx) => ctx.db.insert("quotes", quote(w.A, {})));
    expect(homeOf("quote", { _id: q })).toBeNull();
    await w.heston.mutation(api.homes.move, { kind: "quote", id: q, to: { type: "lead", id: dealId } });
    expect(await w.t.run(async (ctx) => (await ctx.db.get(q))!)).toMatchObject({ dealId, clientId: w.harbor });
    await w.heston.mutation(api.homes.move, { kind: "quote", id: q, to: { type: "project", id: other } });
    let row = await w.t.run(async (ctx) => (await ctx.db.get(q))!);
    expect(row).toMatchObject({ projectId: other, clientId: otherClient });
    expect(row.dealId).toBeUndefined();
    // Sent: it may file under the same client, never leave it.
    await w.t.run((ctx) => ctx.db.patch(q, { status: "sent", sentAt: 1 }));
    await expect(w.heston.mutation(api.homes.move, { kind: "quote", id: q, to: { type: "project", id: w.p } })).rejects.toThrow(/already sent/);
    await expect(w.heston.mutation(api.homes.move, { kind: "quote", id: q, to: null })).rejects.toThrow(/already sent/);
    await w.heston.mutation(api.homes.move, { kind: "quote", id: q, to: { type: "client", id: otherClient } });
    row = await w.t.run(async (ctx) => (await ctx.db.get(q))!);
    expect(row).toMatchObject({ clientId: otherClient });
    expect(row.projectId).toBeUndefined();
    // A team member without Payments can't move it (a Producer has no Payments switch by default).
  });

  test("T-H.3, T-H.4 a project moves to another client with everything; sent money stays; the old client's share goes off", async () => {
    const w = await world();
    const ids = await w.t.run(async (ctx) => {
      const me = (await ctx.db.query("users").first())!._id;
      const northline = await ctx.db.insert("clients", { businessId: w.A, name: "Northline Outfitters", createdAt: 0 });
      const draft = await ctx.db.insert("quotes", quote(w.A, { projectId: w.p, clientId: w.harbor, title: "Extra day" }));
      const sent = await ctx.db.insert("quotes", quote(w.A, { projectId: w.p, clientId: w.harbor, title: "Main quote", status: "sent", sentAt: 1, number: "Q-0002", seq: 2 }));
      const share = await ctx.db.insert("shares", { businessId: w.A, token: "tok-move-1", kind: "project", projectId: w.p, access: "comment", who: "invited", allVersions: true, downloads: false, emailNewVersions: true, createdAt: 0, createdBy: me } as never);
      const cshare = await ctx.db.insert("shares", { businessId: w.A, token: "tok-move-2", kind: "client", clientId: w.harbor, client: "Harbor Coffee", access: "comment", who: "invited", allVersions: true, downloads: false, emailNewVersions: true, createdAt: 0, createdBy: me } as never);
      const vid = await ctx.db.insert("videos", { businessId: w.A, projectId: w.p, title: "Launch spot", createdAt: 0, updatedAt: 0 } as never);
      const vshare = await ctx.db.insert("shares", { businessId: w.A, token: "tok-move-3", kind: "video", videoId: vid, access: "comment", who: "link", allVersions: false, downloads: false, emailNewVersions: false, createdAt: 0, createdBy: me } as never);
      return { northline, draft, sent, share, cshare, vshare };
    });
    const listId = await w.heston.mutation(api.shotLists.create, { projectId: w.p, title: "Day 1" }) as Id<"shotLists">;
    const before = await w.heston.query(api.homes.projectMove, { projectId: w.p });
    expect(before.staying.map((s: { name: string }) => s.name)).toEqual(["Main quote"]);
    expect(before.things).toBeGreaterThanOrEqual(2); // the draft quote and the shot list, at least

    expect(await w.heston.mutation(api.homes.moveProject, { projectId: w.p, clientId: ids.northline })).toMatchObject({ moved: 1, stayed: 1, sharesOff: 2 });
    const r = await w.t.run(async (ctx) => ({ p: (await ctx.db.get(w.p))!, draft: (await ctx.db.get(ids.draft))!, sent: (await ctx.db.get(ids.sent))!, share: (await ctx.db.get(ids.share))!, cshare: (await ctx.db.get(ids.cshare))!, vshare: (await ctx.db.get(ids.vshare))!, list: (await ctx.db.get(listId))! }));
    expect(r.p).toMatchObject({ clientId: ids.northline, client: "Northline Outfitters" });
    expect(r.list.projectId).toBe(w.p);                                        // nothing relinked
    expect(r.draft).toMatchObject({ projectId: w.p, clientId: ids.northline });  // follows the project
    expect(r.sent).toMatchObject({ clientId: w.harbor });                       // stays with Harbor…
    expect(r.sent.projectId).toBeUndefined();                                   // …and leaves the project
    expect(r.share.offAt).toBeGreaterThan(0);                                   // Harbor's project share is off
    expect(r.vshare.offAt).toBeGreaterThan(0);                                  // and the link shared for one cut
    // Harbor's client share no longer covers the project.
    expect((await w.t.run(async (ctx) => coveredProjects(ctx, r.cshare))).map((p) => p._id)).not.toContain(w.p);
    // Out of a client: on its own.
    await w.heston.mutation(api.homes.moveProject, { projectId: w.p, clientId: null });
    const p2 = await w.t.run(async (ctx) => (await ctx.db.get(w.p))!);
    expect(p2.clientId).toBeUndefined();
    expect(p2.client).toBeUndefined();
  });

  test("T-H.5 another business's owner can't move, attach to, or see this business's things", async () => {
    const w = await world();
    const listId = await w.heston.mutation(api.shotLists.create, { title: "Ours" }) as Id<"shotLists">;
    await expect(w.boss.mutation(api.homes.move, { kind: "shotList", id: listId, to: null })).rejects.toThrow(/isn't here/);
    await expect(w.boss.mutation(api.homes.moveProject, { projectId: w.p, clientId: null })).rejects.toThrow(/doesn't exist/);
    const theirs = await w.boss.mutation(api.shotLists.create, { title: "Theirs" }) as Id<"shotLists">;
    await expect(w.boss.mutation(api.homes.move, { kind: "shotList", id: theirs, to: { type: "project", id: w.p } })).rejects.toThrow(/isn't here any more/);
    expect((await w.boss.query(api.homes.loose, {})).map((x: { id: string }) => x.id)).toEqual([theirs]);
    expect((await w.boss.query(api.homes.places, { kind: "shotList" })).some((x: { id: string }) => x.id === w.p)).toBe(false);
    expect(await w.boss.query(api.homes.projectMove, { projectId: w.p })).toBeNull();
  });

  test("T-H.1, T-H.2 (D205) a shoot day on its own: scheduled, listed, its shot list goes with it into a project", async () => {
    const w = await world();
    const { shootId } = await w.heston.mutation(api.shoots.schedule, { date: "2030-03-03", call: "08:00", location: "Riverfront", parking: "", prepare: [], withOwner: true, bookingIds: [], calendar: false });
    const row = (await w.heston.query(api.production.shoots, {})).upcoming.find((x: { _id: string }) => x._id === shootId);
    expect(row).toMatchObject({ projectId: null, label: "Shoot on its own", client: null });
    expect((await w.heston.query(api.homes.loose, {})).some((x: { id: string }) => x.id === shootId)).toBe(true);
    await expect(w.heston.mutation(api.shoots.schedule, { date: "2030-03-04", call: "08:00", location: "X", parking: "", prepare: [], withOwner: false, bookingIds: ["nope" as never], calendar: false })).rejects.toThrow();
    // A call sheet waits until it's on a project (it goes to the project's crew and client).
    await expect(w.heston.mutation(api.callSheets.create, { shootId, how: "blank" })).rejects.toThrow(/Attach this shoot to a project first/);
    // Its shot list lives with it; the client can't see or confirm a shoot that's on its own.
    const listId = await w.heston.mutation(api.shotLists.create, { shootId, title: "B-roll" }) as Id<"shotLists">;
    expect((await w.heston.query(api.shotLists.forShoot, { shootId }))._id).toBe(listId);
    expect(await w.maya.query(api.shoots.page, { shootId })).toBeNull();
    // Attach it to a project: the shot list follows; then the call sheet can be made.
    await w.heston.mutation(api.homes.move, { kind: "shoot", id: shootId, to: { type: "project", id: w.p } });
    expect(await w.t.run(async (ctx) => (await ctx.db.get(listId))!.projectId)).toBe(w.p);
    expect(await w.heston.mutation(api.callSheets.create, { shootId, how: "blank" })).toBeTruthy();
    // Edit and cancel work on a shoot on its own too.
    const two = (await w.heston.mutation(api.shoots.schedule, { date: "2030-03-05", call: "08:00", location: "Lot", parking: "", prepare: [], withOwner: true, bookingIds: [], calendar: false })).shootId;
    await w.heston.mutation(api.shoots.update, { shootId: two, date: "2030-03-06", call: "09:00", location: "Lot B", parking: "", prepare: [], withOwner: true, bookingIds: [], calendar: false });
    await w.heston.mutation(api.shoots.cancel, { shootId: two });
    await expect(w.heston.mutation(api.homes.move, { kind: "shoot", id: two, to: { type: "project", id: w.p } })).rejects.toThrow(/cancelled/);
  });

  test("review fixes: same-name clients, addressed drafts, sent with no client, footage kept, name dialog (H1–H3, M3, M5)", async () => {
    const w = await world();
    const ids = await w.t.run(async (ctx) => {
      // Two clients called "Northline": the move goes to the one picked, not the oldest by name (H2).
      const old = await ctx.db.insert("clients", { businessId: w.A, name: "Northline", createdAt: 0 });
      const picked = await ctx.db.insert("clients", { businessId: w.A, name: "Northline", createdAt: 5 });
      // A draft invoice billed to Harbor (H1), a draft quote addressed to Maya (H1), and a sent quote with no clientId (H3).
      const addressed = await ctx.db.insert("quotes", quote(w.A, { projectId: w.p, clientId: w.harbor, title: "Addressed", contact: { name: "Maya Brooks", email: "maya@harbor.example" } }));
      const bare = await ctx.db.insert("quotes", quote(w.A, { projectId: w.p, title: "Sent, no client", status: "sent", sentAt: 1, number: "Q-0003", seq: 3 }));
      const plain = await ctx.db.insert("quotes", quote(w.A, { projectId: w.p, title: "Plain draft", number: "Q-0004", seq: 4 }));
      return { old, picked, addressed, bare, plain };
    });
    const inv = await w.heston.mutation(api.invoices.saveDraft, {
      clientId: w.harbor, projectId: w.p, kind: "final", title: "Final invoice", billTo: { name: "Maya Brooks", email: "maya@harbor.example", company: "Harbor Coffee" },
      lines: [{ id: "a", description: "Final payment", qty: 1, unitCents: 450000 }], dueDate: "2030-01-01", memo: "",
    }) as Id<"invoices">;
    await w.heston.mutation(api.homes.moveProject, { projectId: w.p, clientId: ids.picked });
    const r = await w.t.run(async (ctx) => ({ p: (await ctx.db.get(w.p))!, inv: (await ctx.db.get(inv))!, addressed: (await ctx.db.get(ids.addressed))!, bare: (await ctx.db.get(ids.bare))!, plain: (await ctx.db.get(ids.plain))! }));
    expect(r.p.clientId).toBe(ids.picked);
    expect(r.inv).toMatchObject({ clientId: w.harbor }); expect(r.inv.projectId).toBeUndefined();
    expect(r.addressed).toMatchObject({ clientId: w.harbor }); expect(r.addressed.projectId).toBeUndefined();
    expect(r.bare).toMatchObject({ clientId: w.harbor }); expect(r.bare.projectId).toBeUndefined();
    expect(r.plain).toMatchObject({ projectId: w.p, clientId: ids.picked });
    // The name dialog moves it by the same rules (M3): a new name makes that client and carries the plain draft.
    await w.heston.mutation(api.library.renameProject, { projectId: w.p, name: "Launch", client: "Riverbend" });
    const p3 = await w.t.run(async (ctx) => (await ctx.db.get(w.p))!);
    const river = await w.t.run(async (ctx) => (await ctx.db.query("clients").collect()).find((c) => c.name === "Riverbend")!);
    expect(p3).toMatchObject({ client: "Riverbend", clientId: river._id });
    expect(await w.t.run(async (ctx) => (await ctx.db.get(ids.plain))!.clientId)).toBe(river._id);
    // Footage the client is keeping holds the project with them (M5).
    await w.t.run((ctx) => ctx.db.insert("footageStorage", { businessId: w.A, projectId: w.p, clientId: river._id, priceCents: 1, offeredAt: 0, keepUntil: "2030-01-01", status: "kept", history: [], createdAt: 0, updatedAt: 0 } as never));
    await expect(w.heston.mutation(api.homes.moveProject, { projectId: w.p, clientId: null })).rejects.toThrow(/keeping this project's footage/);
    await expect(w.heston.mutation(api.library.renameProject, { projectId: w.p, name: "Launch", client: "" })).rejects.toThrow(/keeping this project's footage/);
  });

  test("review fixes: switches for places and project moves, leads, sent call sheets, confirmations (M1, M2, M4, M7, L1, L3)", async () => {
    const w = await world();
    const north = await w.t.run((ctx) => ctx.db.insert("clients", { businessId: w.A, name: "Northline", createdAt: 0 }));
    // M1: a bookkeeper (Payments, no Clients or Projects) is offered no clients, leads or projects, and can't use them.
    const keeper = await member(w, "kim@x.example", "bookkeeper", ["payments"]);
    expect(await keeper.query(api.homes.places, { kind: "quote" })).toEqual([]);
    const q = await w.t.run((ctx) => ctx.db.insert("quotes", quote(w.A, {})));
    await expect(keeper.mutation(api.homes.move, { kind: "quote", id: q, to: { type: "project", id: w.p } })).rejects.toThrow(/Not allowed/);
    // M2: a producer (Projects, no Payments) can't move a project carrying money documents, and isn't told what they are.
    const producer = await member(w, "pat@x.example", "producer", ["projects", "shoots", "clients"]);
    await w.t.run((ctx) => ctx.db.patch(q, { projectId: w.p, clientId: w.harbor, status: "sent", sentAt: 1 }));
    expect(await producer.query(api.homes.projectMove, { projectId: w.p })).toMatchObject({ staying: [], needsPayments: true });
    await expect(producer.mutation(api.homes.moveProject, { projectId: w.p, clientId: north })).rejects.toThrow();
    await w.t.run((ctx) => ctx.db.delete(q));
    // M4: moving the project drops Harbor's confirmation on its shoot day.
    const { shootId } = await w.heston.mutation(api.shoots.schedule, { projectId: w.p, date: "2030-02-02", call: "07:00", location: "Studio", parking: "", prepare: [], withOwner: true, bookingIds: [], calendar: false });
    await w.t.run((ctx) => ctx.db.patch(shootId, { confirmed: { name: "Maya Brooks", email: "maya@harbor.example", at: 1 } }));
    await producer.mutation(api.homes.moveProject, { projectId: w.p, clientId: north });
    expect(await w.t.run(async (ctx) => (await ctx.db.get(shootId))!.confirmed ?? null)).toBeNull();
    // L1: a shot list goes onto a shoot that's on its own (no project) without a validator error.
    const loose = (await w.heston.mutation(api.shoots.schedule, { date: "2030-03-03", call: "08:00", location: "Lot", parking: "", prepare: [], withOwner: true, bookingIds: [], calendar: false })).shootId;
    const list = await w.heston.mutation(api.shotLists.create, { title: "Loose" }) as Id<"shotLists">;
    await w.heston.mutation(api.homes.move, { kind: "shotList", id: list, to: { type: "shoot", id: loose } });
    expect(await w.t.run(async (ctx) => (await ctx.db.get(list))!)).toMatchObject({ shootId: loose });
    // L3: once its call sheet is sent, the shoot stays on its project.
    const csId = await w.heston.mutation(api.callSheets.create, { shootId, how: "blank" });
    await w.t.run((ctx) => ctx.db.patch(csId as Id<"callSheets">, { status: "sent" } as never));
    // Heston (Nov 16): it moves without problems; the sheet goes with it.
    await w.heston.mutation(api.homes.move, { kind: "shoot", id: shootId, to: null });
    expect(await w.t.run(async (ctx) => (await ctx.db.get(csId as Id<"callSheets">))!.projectId ?? null)).toBeNull();
    // M7: a lead moved to another client takes its plain quote; an addressed one stays with Harbor and leaves the lead.
    const dealId = await w.t.run((ctx) => ctx.db.insert("deals", { businessId: w.A, title: "Harbor summer", stage: "lead", source: "hand", clientId: w.harbor, history: [], createdAt: 0, updatedAt: 0 }));
    const plain = await w.t.run((ctx) => ctx.db.insert("quotes", quote(w.A, { dealId, clientId: w.harbor, title: "Plain" })));
    const sent = await w.t.run((ctx) => ctx.db.insert("quotes", quote(w.A, { dealId, clientId: w.harbor, title: "Sent", status: "sent", sentAt: 1, number: "Q-0009", seq: 9 })));
    await w.heston.mutation(api.homes.move, { kind: "lead", id: dealId, to: { type: "client", id: north } });
    const r = await w.t.run(async (ctx) => ({ plain: (await ctx.db.get(plain))!, sent: (await ctx.db.get(sent))! }));
    expect(r.plain).toMatchObject({ dealId, clientId: north });
    expect(r.sent).toMatchObject({ clientId: w.harbor }); expect(r.sent.dealId).toBeUndefined();
  });

  test("second review: calendar quietly, sent with no client, leads with no client, lead switches, footage answer (H, M-d, M-e, L-b, L-c, L-f)", async () => {
    const w = await world();
    const north = await w.t.run((ctx) => ctx.db.insert("clients", { businessId: w.A, name: "Northline", createdAt: 0 }));
    // H: a shoot on the calendar whose project changes client is re-synced with "none" (Google emails nobody).
    const { shootId } = await w.heston.mutation(api.shoots.schedule, { projectId: w.p, date: "2030-02-02", call: "07:00", location: "Studio", parking: "", prepare: [], withOwner: true, bookingIds: [], calendar: true });
    const syncs = () => w.t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).filter((f) => f.name.includes("syncShoot")).map((f) => (f.args[0] as { sendUpdates?: string }).sendUpdates));
    const before = (await syncs()).length;
    // L-c: an offer Harbor declined becomes a fresh offer for Northline.
    const fsId = await w.t.run((ctx) => ctx.db.insert("footageStorage", { businessId: w.A, projectId: w.p, clientId: w.harbor, priceCents: 1, offeredAt: 0, keepUntil: "2030-01-01", status: "declined", answeredBy: { email: "maya@harbor.example", name: "Maya Brooks", at: 1 }, history: [], createdAt: 0, updatedAt: 0 } as never));
    await w.heston.mutation(api.homes.moveProject, { projectId: w.p, clientId: north });
    expect((await syncs()).slice(before)).toEqual(["none"]);
    // Northline's people stay off the event and untold until Ask to confirm.
    expect(await w.t.run(async (ctx) => (await ctx.db.get(shootId))!.clientHold)).toMatchObject({ from: "Harbor Coffee" });
    const ask = await w.heston.mutation(api.shoots.askClientConfirm, { shootId });
    expect(ask.told).toBe(0); // Northline has no portal people in the test world
    expect(await w.t.run(async (ctx) => (await ctx.db.get(shootId))!.clientHold ?? null)).toBeNull();
    expect((await syncs()).slice(before)).toEqual(["none", "all"]);
    const f = await w.t.run(async (ctx) => (await ctx.db.get(fsId))!);
    expect(f).toMatchObject({ clientId: north, status: "offered" }); expect(f.answeredBy ?? null).toBeNull();
    // L-f: moved to another project of the same client: the event is still brought up to date, quietly.
    const other = await w.t.run((ctx) => ctx.db.insert("projects", { businessId: w.A, name: "Second", client: "Northline", clientId: north, createdAt: 0 }));
    await w.heston.mutation(api.homes.move, { kind: "shoot", id: shootId, to: { type: "project", id: other } });
    expect((await syncs()).slice(before)).toEqual(["none", "all", "none"]);

    // M-d: a sent invoice with no client on a project with no client leaves the project and stays unattached.
    const lone = await w.t.run((ctx) => ctx.db.insert("projects", { businessId: w.A, name: "Lone", createdAt: 0 }));
    const q = await w.t.run((ctx) => ctx.db.insert("quotes", quote(w.A, { projectId: lone, title: "Sent to Jane", status: "sent", sentAt: 1 })));
    await w.heston.mutation(api.homes.moveProject, { projectId: lone, clientId: north });
    const qr = await w.t.run(async (ctx) => (await ctx.db.get(q))!);
    expect(qr.projectId).toBeUndefined(); expect(qr.clientId).toBeUndefined();

    // M-e: a lead with no client takes its addressed, clientless quote along when it's filed under a client.
    const dealId = await w.t.run((ctx) => ctx.db.insert("deals", { businessId: w.A, title: "Website lead", stage: "lead", source: "hand", history: [], createdAt: 0, updatedAt: 0 }));
    const lq = await w.t.run((ctx) => ctx.db.insert("quotes", quote(w.A, { dealId, title: "For Jane", contact: { name: "Jane", email: "jane@x.example" }, number: "Q-0005", seq: 5 })));
    // L-b: someone with Clients but not Payments can't move a lead that carries a quote.
    const producer = await member(w, "pat@x.example", "producer", ["projects", "clients"]);
    await expect(producer.mutation(api.homes.move, { kind: "lead", id: dealId, to: { type: "client", id: north } })).rejects.toThrow(/Not allowed/);
    await w.heston.mutation(api.homes.move, { kind: "lead", id: dealId, to: { type: "client", id: north } });
    expect(await w.t.run(async (ctx) => (await ctx.db.get(lq))!)).toMatchObject({ dealId, clientId: north });
  });

  test("T-H.6 (3c) a kickoff brief and a file request made on their own; sent once attached; a booking for a shoot day", async () => {
    const w = await world();
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 }));
    // Harbor's client share: Maya is on it (client-level things go to her); Sam isn't.
    await w.t.run(async (ctx) => {
      const owner = (await ctx.db.query("users").first())!._id;
      const s = await ctx.db.insert("shares", { businessId: w.A, token: "tok-client-3c", kind: "client", clientId: w.harbor, client: "Harbor Coffee", access: "comment", who: "invited", allVersions: true, downloads: false, emailNewVersions: true, createdAt: 0, createdBy: owner } as never);
      await ctx.db.insert("shareMembers", { businessId: w.A, shareId: s, email: "maya@harbor.example", addedAt: 0 });
    });
    // A brief on its own: a draft, in Not attached, nobody told; Send waits for a home.
    const briefId = await w.heston.mutation(api.briefs.create, {}) as Id<"briefs">;
    expect((await w.heston.query(api.homes.loose, {})).some((x: { id: string }) => x.id === briefId)).toBe(true);
    await expect(w.heston.mutation(api.briefs.sendDraft, { briefId })).rejects.toThrow(/Attach this to a project or client first/);
    expect(await w.maya.query(api.briefs.page, { briefId })).toBeNull();
    // On Harbor (no project): Send goes to Harbor's people; Maya opens it, Sam can't.
    await w.heston.mutation(api.homes.move, { kind: "brief", id: briefId, to: { type: "client", id: w.harbor } });
    expect(await w.maya.query(api.briefs.page, { briefId })).toBeNull(); // still a draft
    expect((await w.heston.mutation(api.briefs.sendDraft, { briefId })).told).toBe(1);
    expect(await w.maya.query(api.briefs.page, { briefId })).toMatchObject({ project: null, place: "Harbor Coffee" });
    expect(await w.sam.query(api.briefs.page, { briefId })).toBeNull();
    await expect(w.heston.mutation(api.briefs.sendDraft, { briefId })).rejects.toThrow(/already been sent/);
    // Sent: it stays with Harbor; it can file under Harbor's project.
    const north = await w.t.run(async (ctx) => {
      const c = await ctx.db.insert("clients", { businessId: w.A, name: "Northline", createdAt: 0 });
      return { c, p: await ctx.db.insert("projects", { businessId: w.A, name: "Other", client: "Northline", clientId: c, createdAt: 0 }) };
    });
    await expect(w.heston.mutation(api.homes.move, { kind: "brief", id: briefId, to: { type: "project", id: north.p } })).rejects.toThrow(/stays with the client/);
    await w.heston.mutation(api.homes.move, { kind: "brief", id: briefId, to: { type: "project", id: w.p } });
    expect((await w.maya.query(api.briefs.page, { briefId }))?.project?._id).toBe(w.p); // Harbor's share covers its projects
    expect((await w.heston.query(api.briefs.forProject, { projectId: w.p })).brief._id).toBe(briefId);
    // A second sent brief can't join the project.
    const two = await w.heston.mutation(api.briefs.create, {}) as Id<"briefs">;
    await w.heston.mutation(api.homes.move, { kind: "brief", id: two, to: { type: "client", id: w.harbor } });
    await w.heston.mutation(api.briefs.sendDraft, { briefId: two });
    await expect(w.heston.mutation(api.homes.move, { kind: "brief", id: two, to: { type: "project", id: w.p } })).rejects.toThrow(/already has its kickoff brief/);

    // A file request on its own: a draft, no folder, nothing sent; attached to the project, Send asks (Dropbox first).
    const { requestId } = await w.heston.mutation(api.fileRequests.create, { title: "Logo files", due: "2030-01-02", remind: false });
    expect(await w.t.run(async (ctx) => (await ctx.db.get(requestId as Id<"fileRequests">))!)).toMatchObject({ status: "draft", folder: "" });
    await expect(w.heston.mutation(api.fileRequests.sendDraft, { requestId })).rejects.toThrow(/Attach this/);
    await w.heston.mutation(api.homes.move, { kind: "fileRequest", id: requestId, to: { type: "project", id: w.p } });
    await expect(w.heston.mutation(api.fileRequests.sendDraft, { requestId })).rejects.toThrow(/Connect Dropbox first/);
    await w.t.run((ctx) => ctx.db.insert("dropbox", { businessId: w.A, accountId: "acct-a", refreshToken: "ra", connectedAt: 0 } as never));
    const sent = await w.heston.mutation(api.fileRequests.sendDraft, { requestId });
    expect(sent.folder).toMatch(/^\/File requests\/Harbor Coffee\/26127 Launch\/Logo files/);
    expect(await w.t.run(async (ctx) => (await ctx.db.get(requestId as Id<"fileRequests">))!.status)).toBe("open");

    // A booking for a shoot day joins its crew; cancelling takes it off. A shoot on its own can't book.
    const vendorId = await w.t.run((ctx) => ctx.db.insert("vendors", { businessId: w.A, name: "Jordan Ellis", email: "jordan@x.example", roles: ["Shooter"], rates: [], createdAt: 0, updatedAt: 0 } as never));
    const { shootId } = await w.heston.mutation(api.shoots.schedule, { projectId: w.p, date: "2030-02-02", call: "07:00", location: "Studio", parking: "", prepare: [], withOwner: true, bookingIds: [], calendar: false });
    const base = { vendorId, projectId: w.p, role: "Shooter", start: "2030-02-02", end: "2030-02-02", cents: 80000, unit: "day" as const };
    await expect(w.heston.mutation(api.bookings.create, { ...base, start: "2030-02-03", end: "2030-02-03", shootId })).rejects.toThrow(/don't include the shoot day/);
    const bookingId = await w.heston.mutation(api.bookings.create, { ...base, shootId });
    expect((await w.t.run(async (ctx) => (await ctx.db.get(shootId))!.crew)).map((c) => c.bookingId ?? null)).toContain(bookingId);
    await expect(w.heston.mutation(api.homes.move, { kind: "shoot", id: shootId, to: null })).rejects.toThrow(/Crew booked/);
    await w.heston.mutation(api.bookings.cancel, { bookingId });
    expect((await w.t.run(async (ctx) => (await ctx.db.get(shootId))!.crew)).some((c) => c.bookingId === bookingId)).toBe(false);
    const loose = (await w.heston.mutation(api.shoots.schedule, { date: "2030-03-03", call: "08:00", location: "Lot", parking: "", prepare: [], withOwner: true, bookingIds: [], calendar: false })).shootId;
    await expect(w.heston.mutation(api.bookings.create, { ...base, start: "2030-03-03", end: "2030-03-03", shootId: loose })).rejects.toThrow(/Attach this shoot to a project first/);
  });
});
