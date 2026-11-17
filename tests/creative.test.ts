// 5l Creative planning (Nov 17).
//   T-CR.1 creative docs: made on their own or attached; the view-only link shows only while on; never signed; Start a
//          briefing from this copies the doc (team notes left out) onto the same project; another business sees nothing
//   T-CR.2 brand kits as creative work: a copy of a company's kit (colours, not files), edited with the kit editor by
//          its id, shared by link, moved with Attach/Move
//   T-CR.3 canvas: a mood board starts with its frames; saves carry their revision (an older one is refused); a save
//          can't point at another board's files; uploads refuse programs and big files; sharing per person (Can view
//          can't save, Can edit can) and by a view-only link; Stop sharing ends every link
import { describe, expect, test } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { world } from "./payHarness";
import { cleanItems, refusedFile } from "../convex/lib/canvas";
import { dropNotes } from "../convex/lib/creativeTemplates";

const api = anyApi;

describe("creative planning", () => {
  test("T-CR.1 creative docs: link, never signed, briefing from it", async () => {
    const w = await world();
    const loose = await w.heston.mutation(api.creative.newDoc, { kind: "script" });
    const made = await w.heston.mutation(api.creative.newDoc, { kind: "treatment", title: "Launch film", home: { type: "project", id: w.p } });
    const docs = await w.heston.query(api.creative.docs, {});
    expect(docs.map((d: { title: string; home: { name: string } | null }) => [d.title, d.home?.name ?? null]).sort()).toEqual([["Launch film", "26127 Launch"], ["Two-column script", null]].sort());
    // It's a builder page of kind "creative": out of Contracts, never signed.
    const b = await w.t.run(async (ctx) => (await ctx.db.get(made.buildId as Id<"wsBuilds">))!);
    expect(b.kind).toBe("creative");
    expect((await w.heston.query(api.builder.listBuilds, {})).some((x: { _id: string }) => x._id === made.buildId)).toBe(false);
    // Not attached shows in Projects › Not attached.
    expect((await w.heston.query(api.homes.loose, {})).some((x: { kind: string; id: string; name: string }) => x.kind === "creativeDoc" && x.id === loose.docId && x.name === "Two-column script")).toBe(true);
    // Share link: the PDF made now; the link answers only while on.
    const sid = await w.t.run((ctx) => ctx.storage.store(new Blob(["%PDF-1.4"], { type: "application/pdf" })));
    const { token } = await w.heston.mutation(api.creative.share, { docId: made.docId, storageId: sid });
    expect(await w.t.query(api.creative.sharedDoc, { token })).toMatchObject({ title: "Launch film", kind: "Treatment", from: "Wrangler Productions" });
    await w.heston.mutation(api.creative.shareOn, { docId: made.docId, on: false });
    expect(await w.t.query(api.creative.sharedDoc, { token })).toBeNull();
    expect(await w.t.query(api.creative.sharedDoc, { token: "x".repeat(24) })).toBeNull();
    // Another business's owner sees and changes nothing.
    expect(await w.boss.query(api.creative.docs, {})).toEqual([]);
    expect(await w.boss.query(api.creative.doc, { docId: made.docId })).toBeNull();
    await expect(w.boss.mutation(api.creative.shareOn, { docId: made.docId, on: true })).rejects.toThrow();
    // A client can't reach any of it.
    await expect(w.maya.query(api.creative.docs, {})).rejects.toThrow();
    // Start a briefing from this: the doc under a Shoot brief, on the same project, team notes left out.
    await w.t.run((ctx) => ctx.db.patch(made.buildId as Id<"wsBuilds">, { blocks: { type: "doc", content: [
      { type: "paragraph", attrs: { size: "title" }, content: [{ type: "text", text: "Launch film" }] },
      { type: "paragraph", attrs: { size: "body" }, content: [{ type: "text", text: "Open on the roaster at dawn." }] },
      { type: "section", attrs: { look: "note" }, content: [{ type: "paragraph", content: [{ type: "text", text: "Budget is tight" }] }] },
    ] } }));
    const briefingId = await w.heston.mutation(api.creative.startBriefing, { docId: made.docId, starter: "shoot" });
    const br = await w.t.run(async (ctx) => { const x = (await ctx.db.get(briefingId as Id<"briefings">))!; return { x, b: (await ctx.db.get(x.buildId))! }; });
    expect(br.x.projectId).toBe(w.p);
    expect(br.b.kind).toBe("briefing");
    const text = JSON.stringify(br.b.blocks);
    expect(text).toMatch(/Open on the roaster at dawn/);
    expect(text).not.toMatch(/Budget is tight/);
    // The doc itself didn't change.
    expect(JSON.stringify((await w.t.run((ctx) => ctx.db.get(made.buildId as Id<"wsBuilds">)))!.blocks)).toMatch(/Budget is tight/);
    // Removing it removes its page too.
    await w.heston.mutation(api.creative.removeDoc, { docId: loose.docId });
    expect(await w.t.run((ctx) => ctx.db.get(loose.buildId as Id<"wsBuilds">))).toBeNull();
    // dropNotes leaves everything else.
    expect(dropNotes({ type: "doc", content: [{ type: "section", attrs: { look: "card" }, content: [] }, { type: "section", attrs: { look: "note" }, content: [] }] }).content).toHaveLength(1);
  });

  test("T-CR.2 brand kits: a copy, edited by id, shared, moved", async () => {
    const w = await world();
    await w.t.run((ctx) => ctx.db.patch(w.harbor, { brandKit: { colors: [{ hex: "#3B2A20" }, { hex: "#F2E8DC" }], fonts: { heading: "Fraunces" }, files: [], links: [], tone: ["Warm"] } }));
    const listed = await w.heston.query(api.creative.kits, {});
    expect(listed.companies.map((c: { name: string }) => c.name)).toEqual(["Harbor Coffee brand"]);
    const kitId = await w.heston.mutation(api.creative.newKit, { name: "Holiday launch", fromClientId: w.harbor, home: { type: "project", id: w.p } });
    const k = await w.heston.query(api.creative.kit, { kitId });
    expect(k.copiedFrom.name).toBe("Harbor Coffee brand");
    // The kit editor works on it by its id; the company's kit doesn't change.
    const got = await w.heston.query(api.brandKit.get, { kitId });
    expect(got).toMatchObject({ kind: "kit", name: "Holiday launch", fonts: { heading: "Fraunces" } });
    await w.heston.mutation(api.brandKit.save, { kitId, colors: [...got.colors, { hex: "#C8102E" }], fonts: got.fonts, links: [], tone: got.tone });
    expect((await w.heston.query(api.brandKit.get, { kitId })).colors).toHaveLength(3);
    expect((await w.heston.query(api.brandKit.get, { clientId: w.harbor })).colors).toHaveLength(2);
    // Shared by link: the kit as it is now; off means nothing.
    await w.heston.mutation(api.creative.shareKit, { kitId, on: true });
    const token = (await w.heston.query(api.creative.kit, { kitId })).share.token;
    expect((await w.t.query(api.creative.sharedKit, { token })).colors).toHaveLength(3);
    await w.heston.mutation(api.creative.shareKit, { kitId, on: false });
    expect(await w.t.query(api.creative.sharedKit, { token })).toBeNull();
    // Move to the client, then on its own.
    await w.heston.mutation(api.homes.move, { kind: "kit", id: kitId, to: { type: "client", id: w.harbor } });
    expect((await w.heston.query(api.creative.kit, { kitId })).home).toMatchObject({ type: "client", name: "Harbor Coffee" });
    await expect(w.heston.mutation(api.homes.move, { kind: "kit", id: kitId, to: { type: "shoot", id: w.p } })).rejects.toThrow();
    await w.heston.mutation(api.homes.move, { kind: "kit", id: kitId, to: null });
    expect((await w.heston.query(api.creative.kit, { kitId })).home).toBeNull();
    // Another business's owner can't open or edit it through the kit editor.
    await expect(w.boss.query(api.brandKit.get, { kitId })).rejects.toThrow();
    await expect(w.boss.mutation(api.brandKit.save, { kitId, colors: [], fonts: {}, links: [], tone: [] })).rejects.toThrow();
  });

  test("T-CR.3 canvas: revisions, files, sharing", async () => {
    const w = await world();
    const mood = await w.heston.mutation(api.canvas.create, { name: "Holiday mood", kind: "mood", home: { type: "project", id: w.p } });
    const m = await w.heston.query(api.canvas.get, { canvasId: mood });
    expect(m.items.filter((i: { type: string }) => i.type === "frame").map((i: { text: string }) => i.text)).toEqual(["Look", "Colour", "Type", "Words", "References"]);
    const id = await w.heston.mutation(api.canvas.create, { name: "Ideas", kind: "canvas" });
    const note = { id: "n1", type: "note", x: 10, y: 10, w: 200, h: 120, z: 1, text: "Open on the roaster", color: "#FFF4B8" };
    expect(await w.heston.mutation(api.canvas.save, { canvasId: id, items: [note], rev: 0 })).toEqual({ ok: true, rev: 1 });
    // An older save is refused and gets the newer board back.
    const stale = await w.heston.mutation(api.canvas.save, { canvasId: id, items: [], rev: 0 });
    expect(stale).toMatchObject({ ok: false, rev: 1, items: [{ id: "n1" }] });
    // A photo that isn't this board's own is dropped.
    const other = await w.t.run((ctx) => ctx.storage.store(new Blob(["x"], { type: "image/png" })));
    await w.heston.mutation(api.canvas.save, { canvasId: id, items: [note, { id: "p1", type: "image", x: 0, y: 0, w: 10, h: 10, z: 2, fileId: other }], rev: 1 });
    expect((await w.heston.query(api.canvas.get, { canvasId: id })).items.map((i: { id: string }) => i.id)).toEqual(["n1"]);
    // Uploads: a program is refused and deleted; a photo is the board's.
    const exe = await w.t.run((ctx) => ctx.storage.store(new Blob(["MZ"], { type: "application/x-msdownload" })));
    expect((await w.heston.mutation(api.canvas.addFile, { canvasId: id, storageId: exe, name: "setup.exe" })).error).toMatch(/isn't allowed/);
    const png = await w.t.run((ctx) => ctx.storage.store(new Blob(["png"], { type: "image/png" })));
    expect((await w.heston.mutation(api.canvas.addFile, { canvasId: id, storageId: png, name: "frame.png" })).error).toBeNull();
    expect(refusedFile("big.mov", "video/quicktime", 26 * 1024 * 1024)).toMatch(/up to 25 MB/);
    expect(refusedFile("page.html", "text/html", 10)).toMatch(/isn't allowed/);
    expect(refusedFile("deck.pdf", "application/pdf", 10)).toBeNull();
    expect(() => cleanItems([{ id: "a", type: "link", url: "javascript:alert(1)", x: 0, y: 0, w: 1, h: 1, z: 0 }], new Set())).not.toThrow();
    expect(cleanItems([{ id: "a", type: "link", url: "javascript:alert(1)", x: 0, y: 0, w: 1, h: 1, z: 0 }], new Set())).toEqual([]);
    // Nov 17 shapes: circles, arrows and lines keep their style; an arrow without ends, a bad style or a diamond is dropped or ignored.
    const shapes = cleanItems([
      { id: "c", type: "ellipse", x: 0, y: 0, w: 100, h: 80, z: 1, color: "#FF8383", fill: "#154163", stroke: 4, dash: "dashed", rough: 2, opacity: 60, seed: 42 },
      { id: "a", type: "arrow", x: 0, y: 0, w: 200, h: 10, z: 2, points: [0, 0, 200, 10], stroke: 2, dash: "dotted", rough: 0 },
      { id: "l", type: "line", x: 0, y: 0, w: 50, h: 50, z: 3, points: [0, 50, 50, 0], dash: "wavy", rough: 7, opacity: 400, round: "yes" },
      { id: "r", type: "box", x: 0, y: 0, w: 50, h: 50, z: 4, round: false, fill: null },
      { id: "x", type: "arrow", x: 0, y: 0, w: 20, h: 20, z: 5 },
      { id: "d", type: "diamond", x: 0, y: 0, w: 20, h: 20, z: 6 },
    ], new Set());
    expect(shapes.map((i) => i.id)).toEqual(["c", "a", "l", "r"]);
    expect(shapes[0]).toMatchObject({ type: "ellipse", fill: "#154163", stroke: 4, dash: "dashed", rough: 2, opacity: 60, seed: 42 });
    expect(shapes[1]).toMatchObject({ points: [0, 0, 200, 10], dash: "dotted", rough: 0 });
    expect(shapes[2]).toMatchObject({ opacity: 100 });
    expect(shapes[2].dash).toBeUndefined(); expect(shapes[2].rough).toBeUndefined(); expect(shapes[2].round).toBeUndefined();
    expect(shapes[3]).toMatchObject({ round: false, fill: null });
    // Shared with two people: Can view reads, Can edit saves; neither can upload.
    const viewer = await w.heston.mutation(api.canvas.addPerson, { canvasId: id, email: "maya@harbor.example", role: "view" });
    const editor = await w.heston.mutation(api.canvas.addPerson, { canvasId: id, email: "crew@crew.example", name: "Ana (crew)", role: "edit" });
    const seen = await w.t.query(api.canvas.shared, { token: viewer.token });
    expect(seen).toMatchObject({ name: "Ideas", role: "view", from: "Wrangler Productions" });
    await expect(w.t.mutation(api.canvas.sharedSave, { token: viewer.token, items: [], rev: seen.rev })).rejects.toThrow(/can't change/);
    expect(await w.t.mutation(api.canvas.sharedSave, { token: editor.token, items: [{ ...note, text: "Open on the roaster at dawn" }], rev: seen.rev })).toMatchObject({ ok: true });
    expect((await w.heston.query(api.canvas.get, { canvasId: id })).editedBy).toBe("Ana (crew)");
    // The view-only link answers only while on.
    const link = await w.heston.mutation(api.canvas.setLink, { canvasId: id, on: true });
    expect((await w.t.query(api.canvas.shared, { token: link.token })).role).toBe("view");
    await w.heston.mutation(api.canvas.setLink, { canvasId: id, on: false });
    expect(await w.t.query(api.canvas.shared, { token: link.token })).toBeNull();
    // Stop sharing: every person's link stops.
    await w.heston.mutation(api.canvas.stopSharing, { canvasId: id });
    expect(await w.t.query(api.canvas.shared, { token: editor.token })).toBeNull();
    // Review M2: a board, doc and kit on a project that moves to another client stop being shared.
    const onProject = await w.heston.mutation(api.canvas.create, { name: "Launch board", kind: "canvas", home: { type: "project", id: w.p } });
    const maya = await w.heston.mutation(api.canvas.addPerson, { canvasId: onProject, email: "maya@harbor.example", role: "edit" });
    const lk = await w.heston.mutation(api.canvas.setLink, { canvasId: onProject, on: true });
    // Heston (Nov 17, Q5): crew keep their board links; anyone else (and a vendor who is also the old client's) loses it.
    await w.t.run((ctx) => ctx.db.insert("vendors", { businessId: w.A, name: "Ana Cruz", email: "Ana@Crew.example", roles: ["Shooter"], rates: [], createdAt: 0, updatedAt: 0 } as never));
    await w.t.run((ctx) => ctx.db.insert("vendors", { businessId: w.A, name: "Maya (also crew)", email: "maya@harbor.example", roles: [], rates: [], createdAt: 0, updatedAt: 0 } as never));
    const ana = await w.heston.mutation(api.canvas.addPerson, { canvasId: onProject, email: "ana@crew.example", role: "edit" });
    const stranger = await w.heston.mutation(api.canvas.addPerson, { canvasId: onProject, email: "someone@else.example", role: "view" });
    const northline = await w.t.run((ctx) => ctx.db.insert("clients", { businessId: w.A, name: "Northline", createdAt: 0 }));
    await w.heston.mutation(api.homes.moveProject, { projectId: w.p, clientId: northline });
    expect(await w.t.query(api.canvas.shared, { token: maya.token })).toBeNull();
    expect(await w.t.query(api.canvas.shared, { token: lk.token })).toBeNull();
    expect(await w.t.query(api.canvas.shared, { token: stranger.token })).toBeNull();
    expect(await w.t.query(api.canvas.shared, { token: ana.token })).toMatchObject({ name: "Launch board", role: "edit" });
    // Another business's owner sees and changes nothing.
    expect(await w.boss.query(api.canvas.list, {})).toEqual([]);
    expect(await w.boss.query(api.canvas.get, { canvasId: id })).toBeNull();
    await expect(w.boss.mutation(api.canvas.save, { canvasId: id, items: [], rev: 99 })).rejects.toThrow();
  });
});
