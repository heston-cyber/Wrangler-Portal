// Nov 2 · Settings › Tools: the owner's own menu (order, tools off it) and the Dashboard's widgets, kept per login;
// whatever is saved comes back whole (new tools and widgets join at their default place); only owners save one.
import { describe, expect, test } from "vitest";
import { anyApi } from "convex/server";
import { world } from "./payHarness";
import { DEFAULT_TOOLS, TOOLS, WIDGETS, toolsOf } from "../convex/lib/tools";

const api = anyApi;
describe("tools", () => {
  test("saved per owner, made whole, Dashboard always on; clients can't", async () => {
    process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
    const w = await world();
    expect((await w.heston.query(api.users.me, {})).tools).toEqual(DEFAULT_TOOLS);
    await w.heston.mutation(api.users.setTools, { tools: { order: ["vendors", "dashboard", "nope", "vendors"], hidden: ["dashboard", "sent"], widgets: [{ id: "activity", on: false }, { id: "x", on: true }] } });
    const t = (await w.heston.query(api.users.me, {})).tools;
    expect(t.order[0]).toBe("vendors");
    expect(t.order.indexOf("dashboard")).toBeLessThan(t.order.indexOf("clients")); // missing ones join after their default neighbour
    expect([...t.order].sort()).toEqual([...TOOLS].sort());
    expect(t.hidden).toEqual(["sent"]);
    expect(t.widgets[0]).toEqual({ id: "activity", on: false });
    expect(t.widgets.map((x: { id: string }) => x.id).sort()).toEqual([...WIDGETS].sort());
    // Another owner's menu is their own.
    expect((await w.boss.query(api.users.me, {})).tools).toEqual(DEFAULT_TOOLS);
    await expect(w.maya.mutation(api.users.setTools, { tools: {} })).rejects.toThrow(/Not allowed/);
    expect((await w.maya.query(api.users.me, {})).tools).toBeUndefined();
  });
  test("a new tool joins at its default place", () => {
    const old = toolsOf({ order: ["sent", "dashboard", "clients", "review", "docs", "payments", "vendors"] }); // saved before Proposals existed
    expect(old.order).toEqual(["sent", "dashboard", "clients", "messages", "production", "docs", "proposals", "payments", "vendors"]);
    // D150: a menu saved with Review puts Production where Review was (and only once).
    expect(toolsOf({ order: ["dashboard", "review", "clients", "docs", "proposals", "payments", "vendors", "production", "sent"], hidden: ["review"] }))
      .toMatchObject({ order: ["dashboard", "production", "clients", "messages", "docs", "proposals", "payments", "vendors", "sent"], hidden: [] });
    // A menu saved without Production gets it right after Clients, its default place.
    expect(toolsOf({ order: ["dashboard", "vendors", "clients", "sent"] }).order.slice(0, 5)).toEqual(["dashboard", "vendors", "clients", "messages", "production"]);
  });
});
