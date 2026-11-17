// 5j packing lists and 5k locations (Nov 17).
//   T-PK.1 a saved list → a shoot's copy (the saved list stays); load-in and wrap ticks; an older offline tick loses;
//          Mark as lost updates the Gear item; one list per shoot
//   T-PL.1 a place: made, linked to a shoot, made the shoot's place; sun times from its point
import { describe, expect, test } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { world } from "./payHarness";
import { sunTimes, sunClock } from "../src/lib/sun";

const api = anyApi;

describe("packing lists", () => {
  test("T-PK.1 saved list, a shoot's copy, ticks, lost gear", async () => {
    const w = await world();
    const gearId = await w.t.run((ctx) => ctx.db.insert("gear", { name: "FX6", kind: "camera", serial: "SN123456", status: "in_service", createdAt: 0, updatedAt: 0 }));
    const listId = await w.heston.mutation(api.packing.create, { name: "Interview kit" }) as Id<"packLists">;
    expect(await w.heston.mutation(api.packing.addGear, { listId, gearIds: [gearId, gearId] })).toBe(1);
    await w.heston.mutation(api.packing.addLine, { listId, text: "Gaffer tape", qty: 2 });
    const saved = await w.heston.query(api.packing.get, { listId });
    expect(saved.lines.map((x: { text: string; serial4: string | null }) => [x.text, x.serial4])).toEqual([["FX6", "3456"], ["Gaffer tape", null]]);
    const { shootId } = await w.heston.mutation(api.shoots.schedule, { projectId: w.p, date: "2030-02-02", call: "07:00", location: "Studio", parking: "", prepare: [], withOwner: true, bookingIds: [], calendar: false });
    const copy = await w.heston.mutation(api.packing.useOnShoot, { shootId, listId }) as Id<"packLists">;
    await expect(w.heston.mutation(api.packing.useOnShoot, { shootId })).rejects.toThrow(/packing list already/);
    const on = await w.heston.query(api.packing.forShoot, { shootId });
    expect(on.list._id).toBe(copy);
    const line = on.list.lines[0]._id;
    // A tick made at 10:00 (sent late) lands; one made earlier but sent after it loses.
    await w.heston.mutation(api.packing.tick, { lineId: line, pass: "loaded", done: true, at: 2000, sent: 2000 });
    expect((await w.heston.mutation(api.packing.tick, { lineId: line, pass: "loaded", done: false, at: 1000, sent: 60000 })).landed).toBe(false); // made a minute before it was sent
    expect((await w.heston.query(api.packing.forShoot, { shootId })).list.lines[0].loaded).toMatchObject({ name: "Heston" });
    // Ticks are only for a shoot's copy; the saved list is untouched.
    await expect(w.heston.mutation(api.packing.tick, { lineId: saved.lines[0]._id, pass: "loaded", done: true, at: 1 })).rejects.toThrow(/shoot's list/);
    expect((await w.heston.query(api.packing.get, { listId })).lines[0].loaded).toBeNull();
    // At wrap: lost.
    await w.heston.mutation(api.packing.flag, { lineId: line, flag: "lost" });
    expect(await w.t.run(async (ctx) => (await ctx.db.get(gearId))!.status)).toBe("retired");
    // Review L8: clearing the flag puts the item back as it was; a second tap adds nothing.
    await w.heston.mutation(api.packing.flag, { lineId: line, flag: null });
    expect(await w.t.run(async (ctx) => (await ctx.db.get(gearId))!.status)).toBe("in_service");
    await w.heston.mutation(api.packing.flag, { lineId: line, flag: "lost" });
    await w.heston.mutation(api.packing.flag, { lineId: line, flag: "lost" });
    expect((await w.t.run(async (ctx) => (await ctx.db.get(gearId))!.notes ?? "")).match(/Marked lost/g)).toHaveLength(2);
    // The Shoot page counts it.
    expect((await w.heston.query(api.shootPage.get, { shootId })).gear).toMatchObject({ total: 3, loaded: 1, back: 0 });
    // A client can't see any of it.
    await expect(w.maya.query(api.packing.lists, {})).rejects.toThrow();
  });
});

describe("locations", () => {
  test("T-PL.1 a place used for a shoot; sun times", async () => {
    const w = await world();
    const placeId = await w.heston.mutation(api.places.create, { name: "DePaul east lobby", address: "12303 DePaul Dr, Bridgeton, MO", lat: 38.7581, lng: -90.4307, tags: ["Interior", "hospital", "interior"] }) as Id<"places">;
    const p = await w.heston.query(api.places.get, { placeId });
    expect(p).toMatchObject({ name: "DePaul east lobby", tags: ["interior", "hospital"], lat: 38.7581 });
    const { shootId } = await w.heston.mutation(api.shoots.schedule, { projectId: w.p, date: "2030-02-02", call: "07:00", location: "Studio", parking: "", prepare: [], withOwner: true, bookingIds: [], calendar: false });
    await w.heston.mutation(api.places.useForShoot, { placeId, shootId, asPlace: true });
    expect(await w.t.run(async (ctx) => (await ctx.db.get(shootId))!.location)).toBe("12303 DePaul Dr, Bridgeton, MO");
    expect((await w.heston.query(api.places.forShoot, { shootId })).places[0]).toMatchObject({ name: "DePaul east lobby", main: true });
    expect((await w.heston.query(api.places.list, {}))[0].shoots).toHaveLength(1);
    await w.heston.mutation(api.places.unlink, { placeId, shootId });
    expect((await w.heston.query(api.places.forShoot, { shootId })).places).toEqual([]);
    await expect(w.maya.query(api.places.list, {})).rejects.toThrow();
    // Sun times (Bridgeton, MO, Nov 16): as the design's sample.
    const s = sunTimes(38.7581, -90.4307, "2026-11-16");
    expect([sunClock(s.sunrise), sunClock(s.morningGolden![1]), sunClock(s.eveningGolden![0]), sunClock(s.sunset)]).toEqual(["6:45 AM", "7:24 AM", "4:08 PM", "4:48 PM"]);
  });
});
