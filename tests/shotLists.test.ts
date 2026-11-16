// Shot lists (Nov 16; D179–D182). Step 1: the data and who may change it.
//   T-SL.1 adding, pasting (numbers kept or the next free one), reordering
//   T-SL.2 one list per shoot day; linking later; moving a setup to another day's list
//   T-SL.3 ticks for everyone; Reset clears them
//   T-SL.4 a tick made offline lands once, and loses to a newer tick or a Reset (D182)
//   T-SL.5 the booked crew ticks from a call sheet sent to them; clients, other vendors, another business can't (D180)
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { world } from "./payHarness";
import { readerShots } from "../convex/shotLists";
import { buildProblems, emptyFields, newNodes, type BuildDoc } from "../convex/lib/wsBuilder";
import { todayCentral } from "../convex/lib/bookings";
import { bakeShots, blockList, initialsOf, nextCode, parsePaste, parsePasteRows, shotBlocks, tickLands } from "../convex/lib/shotList";

const api = anyApi;
beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_ONLY_TO = "";
});
afterEach(() => { vi.unstubAllGlobals(); });
const quiet = () => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "x" }), { status: 200 })));
const day = (n: number) => { const d = new Date(`${todayCentral()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
type W = Awaited<ReturnType<typeof world>>;

const schedule = (w: W, date: string, bookingIds: Id<"vendorBookings">[] = []) =>
  w.heston.mutation(api.shoots.schedule, { projectId: w.p, date, call: "07:30", wrap: "17:00", location: "DePaul → St. Mary's", parking: "", prepare: [], withOwner: true, bookingIds, calendar: false }).then((r: { shootId: Id<"shoots"> }) => r.shootId);

describe("shot list rules (lib/shotList.ts)", () => {
  test("T-SL.1 paste: a number at the start is kept if free; the others count on from the highest", () => {
    const r = parsePaste("1. Exterior from street level\n- Signage and entrance\n\n#45 Employee walking in at sunrise\n  12) Elevators\n12 - Duplicate twelve\n[ ] Hospital clock", [1, 2, 3]);
    expect(r).toEqual([
      { number: 46, text: "Exterior from street level" }, // #1 is taken: the next free after the highest (#45)
      { number: 47, text: "Signage and entrance" },
      { number: 45, text: "Employee walking in at sunrise" },
      { number: 12, text: "Elevators" },
      { number: 48, text: "Duplicate twelve" },
      { number: 49, text: "Hospital clock" },
    ]);
    expect(parsePaste("\n \n", [])).toEqual([]);
    expect(parsePaste("A\nB", [])).toEqual([{ number: 1, text: "A" }, { number: 2, text: "B" }]);
  });
  test("codes, initials, ticks landing, blocks on a page", () => {
    expect(nextCode([])).toBe("S-01");
    expect(nextCode(["M-01", "M-02"])).toBe("M-03");
    expect(nextCode(["H-09"])).toBe("H-10");
    expect(initialsOf("Heston Hill")).toBe("HH");
    expect(initialsOf("Jordan Q Ellis")).toBe("JE");
    expect(initialsOf("Cher")).toBe("CH");
    expect(tickLands(100, 200, undefined, undefined)).toEqual({ lands: true, at: 100 });
    expect(tickLands(100, 200, 150, undefined).lands).toBe(false);     // a newer tick already landed
    expect(tickLands(100, 200, undefined, 120).lands).toBe(false);     // Reset after it was made
    expect(tickLands(900, 200, undefined, undefined)).toEqual({ lands: true, at: 200 }); // a phone clock ahead counts as now
    expect(shotBlocks({ type: "doc", content: [{ type: "line" }, { type: "shotlist", attrs: { listId: null } }, { type: "section", content: [{ type: "shotlist", attrs: { listId: "abc", crewTick: false } }] }] }))
      .toEqual([{ listId: null, crewTick: true }, { listId: "abc", crewTick: false }]);
  });
});

describe("shot lists", () => {
  test("T-SL.1, T-SL.2 make a list in pre-pro, add setups and shots, link it to a shoot day, move a setup to Day 2", async () => {
    const w = await world();
    quiet();
    const listId = await w.heston.mutation(api.shotLists.create, { projectId: w.p }) as Id<"shotLists">;
    let l = await w.heston.query(api.shotLists.get, { listId });
    expect(l).toMatchObject({ shoot: null, total: 0, done: 0, setups: [], days: [] });

    const gap = await w.heston.mutation(api.shotLists.addSetup, { listId, gap: true, start: "06:30", end: "07:15", title: "Call at Aloft lobby, travel to DePaul" });
    const m1 = await w.heston.mutation(api.shotLists.addSetup, { listId, code: "M-01", start: "07:30", end: "08:30", title: "DePaul lobby: exteriors", note: "Crew only." }) as Id<"shotSetups">;
    const m2 = await w.heston.mutation(api.shotLists.addSetup, { listId, start: "08:30", end: "09:00", title: "1 West: nurse b-roll" }) as Id<"shotSetups">;
    await expect(w.heston.mutation(api.shotLists.addSetup, { listId, start: "09:00", end: "08:00", title: "Backwards" })).rejects.toThrow(/end is before/);
    await expect(w.heston.mutation(api.shotLists.addShots, { setupId: gap, text: "x" })).rejects.toThrow(/gap line/);

    expect(await w.heston.mutation(api.shotLists.addShots, { setupId: m1, text: "1 Exterior from street level\n2 Signage and entrance\n3 Automatic doors opening\n6 Elevators opening/closing\n45 Employee walking in at sunrise" }))
      .toEqual({ added: 5, numbers: [1, 2, 3, 6, 45] });
    expect((await w.heston.mutation(api.shotLists.addShots, { setupId: m2, text: "Nurses station from a distance\nNurse walking down hallway" })).numbers).toEqual([46, 47]);
    l = await w.heston.query(api.shotLists.get, { listId });
    expect(l.setups.map((x: { code: string | null; gap: boolean }) => [x.code, x.gap])).toEqual([[null, true], ["M-01", false], ["M-02", false]]); // M-02 follows M-01
    expect(l.total).toBe(7);

    // Numbers: typed over, never twice on one list.
    const s6 = l.setups[1].shots.find((s: { number: number }) => s.number === 6)._id;
    await expect(w.heston.mutation(api.shotLists.editShot, { shotId: s6, number: 45 })).rejects.toThrow(/#45 is already/);
    await w.heston.mutation(api.shotLists.editShot, { shotId: s6, number: 9, note: "Both banks" });
    // Reorder: #9 to the top of M-01, then into M-02.
    await w.heston.mutation(api.shotLists.moveShot, { shotId: s6, setupId: m1, index: 0 });
    l = await w.heston.query(api.shotLists.get, { listId });
    expect(l.setups[1].shots.map((s: { number: number }) => s.number)).toEqual([9, 1, 2, 3, 45]);
    await w.heston.mutation(api.shotLists.moveShot, { shotId: s6, setupId: m2, index: 1 });
    await w.heston.mutation(api.shotLists.moveSetup, { setupId: m2, index: 0 });
    l = await w.heston.query(api.shotLists.get, { listId });
    expect(l.setups.map((x: { title: string }) => x.title)).toEqual(["1 West: nurse b-roll", "Call at Aloft lobby, travel to DePaul", "DePaul lobby: exteriors"]);
    expect(l.setups[0].shots.map((s: { number: number; note: string | null }) => [s.number, s.note])).toEqual([[46, null], [9, "Both banks"], [47, null]]);

    // D179: one list per shoot day, linked once the day is scheduled.
    const d1 = await schedule(w, day(5));
    const d2 = await schedule(w, day(6));
    await w.heston.mutation(api.shotLists.update, { listId, shootId: d1 });
    const list2 = await w.heston.mutation(api.shotLists.create, { projectId: w.p, shootId: d2 }) as Id<"shotLists">;
    await expect(w.heston.mutation(api.shotLists.create, { projectId: w.p, shootId: d1 })).rejects.toThrow(/already has a shot list/);
    await expect(w.heston.mutation(api.shotLists.update, { listId: list2, shootId: d1 })).rejects.toThrow(/already has a shot list/);
    l = await w.heston.query(api.shotLists.get, { listId });
    expect(l.shoot).toMatchObject({ _id: d1, day: 1, date: day(5) });
    expect(l.days).toEqual([{ _id: d1, day: 1, date: day(5), taken: false }, { _id: d2, day: 2, date: day(6), taken: true }]);
    expect(l.others).toEqual([{ _id: list2, title: null, day: 2, date: day(6) }]);
    expect((await w.heston.query(api.shotLists.forShoot, { shootId: d1 }))._id).toBe(listId);

    // Move M-02 (#46, #9, #47) to Day 2, where #9 is taken: it gets the next free number there.
    const d2s = await w.heston.mutation(api.shotLists.addSetup, { listId: list2, title: "St. Mary's" }) as Id<"shotSetups">;
    await w.heston.mutation(api.shotLists.addShots, { setupId: d2s, text: "9 Already nine" });
    await w.heston.mutation(api.shotLists.moveSetup, { setupId: m2, index: 5, listId: list2 });
    const two = await w.heston.query(api.shotLists.get, { listId: list2 });
    expect(two.setups.map((x: { title: string; shots: Array<{ number: number }> }) => [x.title, x.shots.map((s) => s.number)])).toEqual([["St. Mary's", [9]], ["1 West: nurse b-roll", [46, 48, 47]]]);
    expect((await w.heston.query(api.shotLists.get, { listId })).total).toBe(4); // #1, #2, #3, #45 stay on Day 1

    // Another project's list can't take it; another business's owner sees and changes nothing.
    const other = await w.t.run((ctx) => ctx.db.insert("projects", { businessId: w.A, name: "Elsewhere", createdAt: 0 }));
    const far = await w.heston.mutation(api.shotLists.create, { projectId: other }) as Id<"shotLists">;
    await expect(w.heston.mutation(api.shotLists.moveSetup, { setupId: m1, index: 0, listId: far })).rejects.toThrow(/same project/);
    await expect(w.heston.mutation(api.shotLists.update, { listId: far, shootId: d1 })).rejects.toThrow(/this project's shoot days/);
    expect(await w.boss.query(api.shotLists.get, { listId })).toBeNull();
    await expect(w.boss.mutation(api.shotLists.addShots, { setupId: m1, text: "x" })).rejects.toThrow();
    expect((await w.boss.query(api.shotLists.all, {})).length).toBe(0);

    // Removing a list removes its setups and shots.
    await w.heston.mutation(api.shotLists.remove, { listId: list2 });
    expect(await w.t.run(async (ctx) => (await ctx.db.query("shots").collect()).filter((s) => s.listId === list2).length)).toBe(0);
  });

  test("T-SL.3, T-SL.4, T-SL.5 ticks: the owner, the booked crew from their call sheet, offline ticks, Reset", async () => {
    const w = await world();
    quiet();
    const JORDAN = "jordan@ellisfilms.com", SAMR = "sam@riverasound.example";
    const jordanV = await w.heston.mutation(api.vendors.add, { name: "Jordan Ellis", email: JORDAN, roles: ["Camera"], rates: [], invite: false }) as Id<"vendors">;
    const samV = await w.heston.mutation(api.vendors.add, { name: "Sam Rivera", email: SAMR, roles: ["Sound"], rates: [], invite: false }) as Id<"vendors">;
    const kJ = await w.heston.mutation(api.bookings.create, { vendorId: jordanV, projectId: w.p, role: "Camera", start: day(4), end: day(4), cents: 100_000, unit: "day" }) as Id<"vendorBookings">;
    const kS = await w.heston.mutation(api.bookings.create, { vendorId: samV, projectId: w.p, role: "Sound", start: day(9), end: day(9), cents: 90_000, unit: "day" }) as Id<"vendorBookings">;
    const subs = await w.t.run(async (ctx) => {
      const out: string[] = [];
      for (const [e, n] of [[JORDAN, "Jordan Ellis"], [SAMR, "Sam Rivera"]]) {
        const userId = await ctx.db.insert("users", { email: e, name: n, role: "vendor" });
        await ctx.db.insert("memberships", { businessId: w.A, email: e, userId, role: "vendor", createdAt: Date.now() });
        out.push(`${userId}|${await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 })}`);
      }
      return out;
    });
    const jordan = w.t.withIdentity({ subject: subs[0] }), samR = w.t.withIdentity({ subject: subs[1] });
    const shootId = await schedule(w, day(4), [kJ]);
    const listId = await w.heston.mutation(api.shotLists.create, { projectId: w.p, shootId }) as Id<"shotLists">;
    const m1 = await w.heston.mutation(api.shotLists.addSetup, { listId, title: "Lobby" }) as Id<"shotSetups">;
    await w.heston.mutation(api.shotLists.addShots, { setupId: m1, text: "One\nTwo\nThree" });
    const ids = (await w.heston.query(api.shotLists.forShoot, { shootId })).setups[0].shots.map((s: { _id: string }) => s._id) as Id<"shots">[];

    // A call sheet sent to Jordan (crew), Sam (crew, another day: never reaches him) and Maya (client), with the block.
    const page = (crewTick: boolean) => ({ type: "doc", content: [{ type: "shotlist", attrs: { listId: null, crewTick } }] });
    const csId = await w.t.run(async (ctx) => {
      const buildId = await ctx.db.insert("wsBuilds", { businessId: w.A, title: "CS", blocks: page(true), fields: {}, style: {}, signers: [], kind: "callsheet", createdAt: 0, updatedAt: 0 });
      return await ctx.db.insert("callSheets", { businessId: w.A, shootId, projectId: w.p, buildId, how: "blank", status: "sent", sentAt: 0, updates: 0,
        recipients: [{ id: `crew:${kJ}`, kind: "crew", name: "Jordan Ellis", email: JORDAN, vendorId: jordanV, bookingId: kJ, on: true, sentAt: 1, addedAt: 0 },
          { id: `crew:${kS}`, kind: "crew", name: "Sam Rivera", email: SAMR, vendorId: samV, bookingId: kS, on: true, sentAt: 1, addedAt: 0 },
          { id: "client:maya@harbor.example", kind: "client", name: "Maya", email: "maya@harbor.example", on: true, sentAt: 1, addedAt: 0 }],
        sent: { title: "CS", page: page(true), fields: emptyFields(), style: {}, at: 0, round: 0 }, history: [], createdAt: 0, updatedAt: 0 });
    });

    // The owner ticks; the crew ticks from the sheet: everyone sees both, with initials.
    const t0 = Date.now();
    expect(await w.heston.mutation(api.shotLists.tick, { shotId: ids[0], done: true, at: t0 })).toEqual({ landed: true });
    expect(await jordan.mutation(api.vendorPortal.tickShot, { callSheetId: csId, shotId: ids[1], done: true, at: t0 })).toEqual({ landed: true });
    let l = await w.heston.query(api.shotLists.forShoot, { shootId });
    expect(l.setups[0].shots.map((s: { done: { initials: string } | null }) => s.done?.initials ?? null)).toEqual([expect.any(String), "JE", null]);
    expect([l.done, l.total]).toEqual([2, 3]);

    // D180: not Sam (booked another day), not the client, not another business, not a guest-less nobody.
    await expect(samR.mutation(api.vendorPortal.tickShot, { callSheetId: csId, shotId: ids[2], done: true, at: t0 })).rejects.toThrow(/isn't here/);
    await expect(w.maya.mutation(api.vendorPortal.tickShot, { callSheetId: csId, shotId: ids[2], done: true, at: t0 })).rejects.toThrow();
    await expect(w.maya.mutation(api.shotLists.tick, { shotId: ids[2], done: true, at: t0 })).rejects.toThrow();
    await expect(w.boss.mutation(api.shotLists.tick, { shotId: ids[2], done: true, at: t0 })).rejects.toThrow();
    // A shot of another list (not on this sheet) is refused too.
    const otherList = await w.heston.mutation(api.shotLists.create, { projectId: w.p }) as Id<"shotLists">;
    const os = await w.heston.mutation(api.shotLists.addSetup, { listId: otherList, title: "Other" }) as Id<"shotSetups">;
    await w.heston.mutation(api.shotLists.addShots, { setupId: os, text: "Elsewhere" });
    const otherShot = (await w.heston.query(api.shotLists.get, { listId: otherList })).setups[0].shots[0]._id;
    await expect(jordan.mutation(api.vendorPortal.tickShot, { callSheetId: csId, shotId: otherShot, done: true, at: t0 })).rejects.toThrow(/isn't on your call sheet/);
    // The owner turned "Crew can tick on the sheet" off: the crew can't tick.
    await w.t.run(async (ctx) => { const cs = (await ctx.db.get(csId))!; await ctx.db.patch(csId, { sent: { ...cs.sent!, page: page(false) } }); });
    await expect(jordan.mutation(api.vendorPortal.tickShot, { callSheetId: csId, shotId: ids[2], done: true, at: t0 })).rejects.toThrow(/isn't on your call sheet/);
    await w.t.run(async (ctx) => { const cs = (await ctx.db.get(csId))!; await ctx.db.patch(csId, { sent: { ...cs.sent!, page: page(true) } }); });

    // D182: Jordan unticks #2 offline (made earlier than the owner's later tick of it): the newer one stays.
    await w.heston.mutation(api.shotLists.tick, { shotId: ids[1], done: true, at: t0 + 5 });
    expect(await jordan.mutation(api.vendorPortal.tickShot, { callSheetId: csId, shotId: ids[1], done: false, at: t0 + 2 })).toEqual({ landed: false });
    // The same tick sent twice (a retry after reconnecting) changes nothing the second time.
    await jordan.mutation(api.vendorPortal.tickShot, { callSheetId: csId, shotId: ids[2], done: true, at: t0 + 10 });
    await jordan.mutation(api.vendorPortal.tickShot, { callSheetId: csId, shotId: ids[2], done: true, at: t0 + 10 });
    l = await w.heston.query(api.shotLists.forShoot, { shootId });
    expect(l.done).toBe(3);

    // Reset: all back to not done; a tick made (offline) before the Reset doesn't come back.
    expect(await w.heston.mutation(api.shotLists.reset, { listId })).toEqual({ cleared: 3 });
    expect(await jordan.mutation(api.vendorPortal.tickShot, { callSheetId: csId, shotId: ids[0], done: true, at: t0 - 1000 })).toEqual({ landed: false });
    expect((await w.heston.query(api.shotLists.forShoot, { shootId })).done).toBe(0);
    await expect(jordan.mutation(api.shotLists.reset, { listId })).rejects.toThrow(); // Reset is the owner's
    expect(await jordan.mutation(api.vendorPortal.tickShot, { callSheetId: csId, shotId: ids[0], done: true, at: Date.now() + 1000 })).toEqual({ landed: true });
    // D181: the crew's sheet carries the list, live, with who ticked, and lets them tick; a client's view has no ticks.
    const mine = await jordan.query(api.vendorPortal.callSheet, { callSheetId: csId });
    expect(mine.shots).toMatchObject({ defaultId: listId, canTick: true });
    expect(mine.shots.lists[0].setups[0].shots.map((s: { done: { initials: string } | null }) => s.done?.initials ?? null)).toEqual(["JE", null, null]);
    const client = await w.t.run(async (ctx) => readerShots(ctx, page(true), w.p, shootId, false));
    expect(client!.canTick).toBe(false);
    expect(client!.lists[0].setups[0].shots.every((s) => s.done === null)).toBe(true);
    // A block naming another project's list shows nothing of it.
    const farList = await w.t.run(async (ctx) => {
      const other = await ctx.db.insert("projects", { businessId: w.A, name: "Elsewhere", createdAt: 0 });
      return await ctx.db.insert("shotLists", { businessId: w.A, projectId: other, createdAt: 0, updatedAt: 0 });
    });
    const far = await w.t.run(async (ctx) => readerShots(ctx, { type: "doc", content: [{ type: "shotlist", attrs: { listId: farList } }] }, w.p, shootId, true));
    expect(far!.lists).toEqual([]);
    expect(await w.t.run(async (ctx) => readerShots(ctx, { type: "doc", content: [] }, w.p, shootId, true))).toBeNull();
    // The builder's source for the sheet's block: the project's lists, this shoot day's first.
    const fb = await w.heston.query(api.shotLists.forBuild, { buildId: await w.t.run(async (ctx) => (await ctx.db.get(csId))!.buildId!) });
    expect(fb).toMatchObject({ defaultId: listId, callSheet: true });
    expect(fb.lists.map((l: { _id: string }) => l._id).sort()).toEqual([listId, otherList].sort());
  });
});

describe("shot list pages (step 2)", () => {
  const read = (f: string) => require("node:fs").readFileSync(f, "utf8") as string;
  test("Pre-pro › Shot lists sits after Call sheets with the designer's icon; the pages are routed", () => {
    const shell = read("src/shell/Shell.tsx");
    expect(shell).toMatch(/label: "Call sheets"[^\n]*\n\s*\{ group: "Pre-pro", to: "\/production\/shot-lists", label: "Shot lists"/);
    expect(shell).toContain(`"/production/shot-lists": "shot-list"`);
    expect(read("src/ui/Icon.tsx")).toContain(`"shot-list"`);
    const svg = read("src/assets/icons/shot-list.svg");
    expect(svg).toMatch(/width="24" height="24"/);
    expect(svg).toContain("currentColor");
    const app = read("src/App.tsx");
    expect(app).toMatch(/\\\/production\\\/shot-lists\\\/\?\$/);
    expect(app).toMatch(/<ShotListEditor key=\{id\} listId=\{id\} \/>/);
  });
  test("the Paste shots dialog's line follows the frame (1034-20542)", () => {
    const page = read("src/modules/production/ShotLists.tsx");
    expect(page).toContain("One shot per line. A number at the start of a line is kept.");
    // The frame's example: the list has #1–#11 and #45; "#12, #13 and #46 as typed; the other two get #47 and #48".
    const used = [...Array.from({ length: 11 }, (_, k) => k + 1), 45];
    expect(parsePasteRows("12 Med cart\n13 IV pump\nShift huddle\nWindow light\n46 Badge tap", used).map((r) => [r.number, r.typed]))
      .toEqual([[12, true], [13, true], [47, false], [48, false], [46, true]]);
  });
});

describe("ticks on the phone (step 3, D182)", () => {
  test("T-SL.4 a waiting tick shows at once, replaces an older one of the same shot, and the line says it's saved", async () => {
    const { queueTick, shownDone, waitingLine } = await import("../src/modules/production/tickQueue");
    let q = queueTick([], { shotId: "a", done: true, at: 1 });
    q = queueTick(q, { shotId: "b", done: true, at: 2 });
    q = queueTick(q, { shotId: "a", done: false, at: 3 });
    expect(q).toEqual([{ shotId: "b", done: true, at: 2 }, { shotId: "a", done: false, at: 3 }]);
    expect(shownDone(true, "a", q)).toBe(false); // the phone's untick, not the server's tick
    expect(shownDone(true, "c", q)).toBe(true);
    expect(waitingLine(1, false)).toBe("No signal · 1 tick saved on this phone · will sync");
    expect(waitingLine(2, true)).toBe("Syncing 2 ticks…");
    expect(waitingLine(0, false)).toBeNull();
  });
  test("the checklist page: Hide finished, Reset asks first with the frame's words, the header sticks", () => {
    const page = require("node:fs").readFileSync("src/modules/production/ShotChecklist.tsx", "utf8") as string;
    expect(page).toContain("Every shot goes back to not done, for everyone on the shoot.");
    expect(page).toMatch(/Clear all \{done\} \{done === 1 \? "tick" : "ticks"\}\?/);
    expect(page).toContain(`useTickQueue(\`wp.ticks.\${shootId}\``);
    const css = require("node:fs").readFileSync("src/portal.css", "utf8") as string;
    expect(css).toContain(".main:has(.sl-onset) { overflow: clip; }");
  });
});

describe("the Shot list block (step 4, D181)", () => {
  test("T-SL.6 a new block; never in a contract; a printed page keeps the list as it stood", () => {
    const nodes = newNodes("shotlist");
    expect(nodes[1]).toEqual({ type: "shotlist", attrs: { listId: null, crewTick: true, snap: null } });
    const doc = { title: "Agreement", page: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Terms" }] }, ...nodes] }, fields: emptyFields(), signers: [], style: {} } as unknown as BuildDoc;
    expect(buildProblems(doc)).toContain("A shot list can't go in a contract: remove it.");
    const lists = [{ _id: "L1", pick: "Day 1 · Tue 11/3 · H-01", setups: [{ gap: false, code: "H-01", start: "07:30", end: "09:00", title: "Counter", note: null, shots: [{ number: 1, text: "Hero pour", note: null }] }] }];
    expect(blockList(null, lists, "L1")?._id).toBe("L1");
    expect(blockList("nope", lists, "L1")).toBeNull();
    const baked = bakeShots({ type: "doc", content: [{ type: "shotlist", attrs: { listId: null, crewTick: true, snap: null } }] }, lists, "L1");
    expect((baked.content[0].attrs as { snap: { pick: string; setups: unknown[] } }).snap).toEqual({ pick: "Day 1 · Tue 11/3 · H-01", setups: lists[0].setups });
  });
  test("the builder offers the block on call sheets, briefings and proposals only (never a contract or a Help guide)", () => {
    const b = require("node:fs").readFileSync("src/modules/docs/builder/Builder.tsx", "utf8") as string;
    expect(b).toContain(`(x.kind !== "shotlist" || ((isCall || isBrief || isProp) && !isGuide && canShots))`);
    expect(b).toContain("bakeShots(baked.page, shots.lists, shots.defaultId)");
  });
});
