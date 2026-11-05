// Phase 5d step 3 (T5d.5): gear. Add with only a name; the serial shows its last 4; maintenance and "due"; the insurer
// CSV (total, formula-safe, retired left out); gear on a shoot with a same-day clash that warns and never blocks; owner
// only (the access and isolation suites cover every caller; here the data itself is checked).
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import { setup } from "./matrix";

const api = anyApi;
beforeAll(() => { process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com"; });
afterEach(() => vi.useRealTimers());

async function owner() {
  const { t, ids } = await setup();
  return { t, ids, me: t.withIdentity({ subject: ids.ownerSub }) };
}

describe("gear", () => {
  test("Add needs only a name; the page shows the last 4 of the serial, never the whole one", async () => {
    const { me } = await owner();
    await expect(me.mutation(api.gear.add, { name: "  ", kind: "lens" })).rejects.toThrow(/name/);
    const id = await me.mutation(api.gear.add, { name: "Sigma 18-35", kind: "lens" });
    const bare = await me.query(api.gear.get, { gearId: id });
    expect(bare).toMatchObject({ name: "Sigma 18-35", status: "in_service", serialLast4: null, insuredCents: null });
    await me.mutation(api.gear.update, { gearId: id, name: "Sigma 18-35", kind: "lens", serial: "ABC-99887766", priceCents: 79900, insuredCents: 90000, boughtOn: "2029-05-01" });
    const full = await me.query(api.gear.get, { gearId: id });
    expect(full.serialLast4).toBe("7766");
    expect(JSON.stringify(full)).not.toContain("99887766");
    expect(JSON.stringify(await me.query(api.gear.list, {}))).not.toContain("99887766");
    // Saving again without a serial keeps the one on file.
    await me.mutation(api.gear.update, { gearId: id, name: "Sigma 18-35 Art", kind: "lens" });
    expect((await me.query(api.gear.get, { gearId: id })).serialLast4).toBe("7766");
  });

  test("Bad amounts and dates are refused", async () => {
    const { me } = await owner();
    await expect(me.mutation(api.gear.add, { name: "X", kind: "other", priceCents: -5 })).rejects.toThrow(/amount/);
    await expect(me.mutation(api.gear.add, { name: "X", kind: "other", priceCents: 1.5 })).rejects.toThrow(/amount/);
    await expect(me.mutation(api.gear.add, { name: "X", kind: "other", boughtOn: "soon" })).rejects.toThrow(/date/);
  });

  test("Tiles: items, insured value (retired left out), in repair, maintenance due; chips follow status", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2030-03-01T18:00:00Z"));
    const { me, ids } = await owner();
    const a = await me.mutation(api.gear.add, { name: "Aputure", kind: "lighting", insuredCents: 50000 });
    const b = await me.mutation(api.gear.add, { name: "Old rig", kind: "grip", insuredCents: 20000 });
    await me.mutation(api.gear.setStatus, { gearId: b, status: "retired" });
    await me.mutation(api.gear.setStatus, { gearId: ids.gearId, status: "in_repair" });
    await me.mutation(api.gear.logMaintenance, { gearId: a, date: "2030-02-01", what: "Fan replaced", costCents: 4500, nextDue: "2030-02-20" });
    const l = await me.query(api.gear.list, {});
    expect(l.tiles).toEqual({ items: 2, insuredCents: 150000, inRepair: 1, due: 1 }); // only the light; the camera's next date (2030-06-01) is later
  });

  test("Export for insurer: the whole serial, a total, retired left out, nothing a spreadsheet would run as a formula", async () => {
    const { me } = await owner();
    const x = await me.mutation(api.gear.add, { name: "=HYPERLINK(\"http://x\")", kind: "other", insuredCents: 12345, serial: "S,1" });
    const r = await me.mutation(api.gear.add, { name: "Retired thing", kind: "other", insuredCents: 99900 });
    await me.mutation(api.gear.setStatus, { gearId: r, status: "retired" });
    void x;
    const out = await me.query(api.gear.exportCsv, {});
    const lines = out.csv.trim().split("\n");
    expect(lines[0]).toBe("Name,Kind,Serial,Bought,Price,Insurance value");
    expect(out.csv).toContain("SN-1234567"); // the whole serial goes to the insurer
    expect(out.csv).toContain("\"'=HYPERLINK(");
    expect(out.csv).toContain('"S,1"');
    expect(out.csv).not.toContain("Retired thing");
    expect(lines.at(-1)).toBe("Total,,,,,1123.45");
    expect(out.totalCents).toBe(112345);
  });

  test("On a shoot: add and remove; a same-day clash is named, never blocks; retired gear can't be added", async () => {
    const { me, t, ids } = await owner();
    const other = await t.run(async (ctx) => ctx.db.insert("shoots", { projectId: ids.projectId, date: "2030-01-02", call: "09:00", location: "Y", prepare: [], crew: [], status: "scheduled", history: [], createdAt: 0, updatedAt: 0 }));
    const later = await t.run(async (ctx) => ctx.db.insert("shoots", { projectId: ids.projectId, date: "2030-01-09", call: "09:00", location: "Y", prepare: [], crew: [], status: "scheduled", history: [], createdAt: 0, updatedAt: 0 }));
    // The matrix camera is already on ids.shootId (2030-01-02). Booking it on the same-day shoot warns, and works.
    await me.mutation(api.gear.addToShoot, { shootId: other, gearId: ids.gearId });
    await me.mutation(api.gear.addToShoot, { shootId: other, gearId: ids.gearId }); // twice is once
    const a = await me.query(api.gear.forShoot, { shootId: other });
    expect(a.items).toHaveLength(1);
    expect(a.items[0].clash).toHaveLength(1);
    expect(a.items[0].clash[0]).toMatchObject({ shootId: ids.shootId, call: "07:00" });
    expect((await me.query(api.gear.forShoot, { shootId: ids.shootId })).items[0].clash).toHaveLength(1);
    // A different day: no clash.
    await me.mutation(api.gear.addToShoot, { shootId: later, gearId: ids.gearId });
    expect((await me.query(api.gear.forShoot, { shootId: later })).items[0].clash).toEqual([]);
    expect((await me.query(api.gear.get, { gearId: ids.gearId })).upcoming.length).toBe(3);
    // A cancelled shoot's gear stops clashing.
    await t.run(async (ctx) => ctx.db.patch(other, { status: "cancelled" }));
    expect((await me.query(api.gear.forShoot, { shootId: ids.shootId })).items[0].clash).toEqual([]);
    await me.mutation(api.gear.removeFromShoot, { shootId: later, gearId: ids.gearId });
    expect((await me.query(api.gear.forShoot, { shootId: later })).items).toEqual([]);
    const r = await me.mutation(api.gear.add, { name: "Gone", kind: "other" });
    await me.mutation(api.gear.setStatus, { gearId: r, status: "retired" });
    await expect(me.mutation(api.gear.addToShoot, { shootId: later, gearId: r })).rejects.toThrow(/retired/);
    expect((await me.query(api.gear.forShoot, { shootId: later })).available.map((x: any) => x.name)).not.toContain("Gone");
  });

  test("Nobody else reads or changes gear: a client and a stranger are refused", async () => {
    const { t, ids } = await owner();
    for (const sub of [ids.clientSub, ids.strangerSub]) {
      const as = t.withIdentity({ subject: sub });
      await expect(as.query(api.gear.list, {})).rejects.toThrow(/Not allowed|Sign in/);
      await expect(as.query(api.gear.exportCsv, {})).rejects.toThrow(/Not allowed|Sign in/);
      await expect(as.mutation(api.gear.setStatus, { gearId: ids.gearId, status: "retired" })).rejects.toThrow(/Not allowed|Sign in/);
    }
  });
});
