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
    await w.heston.mutation(api.users.setTools, { tools: { order: ["clients", "dashboard", "nope", "clients", "calendar", "messages"], hidden: ["dashboard", "clients"], widgets: [{ id: "activity", on: false }, { id: "x", on: true }] } });
    const t = (await w.heston.query(api.users.me, {})).tools;
    // Nov 16: the groups are fixed; the saved order counts inside each (Calendar before Messages in Every day).
    expect(t.order.slice(0, 4)).toEqual(["dashboard", "calendar", "messages", "work"]);
    expect([...t.order].sort()).toEqual([...TOOLS].sort());
    expect(t.hidden).toEqual(["clients"]); // Dashboard can't be hidden
    expect(t.widgets[0]).toEqual({ id: "activity", on: false });
    expect(t.widgets.map((x: { id: string }) => x.id).sort()).toEqual([...WIDGETS].sort());
    // Another owner's menu is their own.
    expect((await w.boss.query(api.users.me, {})).tools).toEqual(DEFAULT_TOOLS);
    await expect(w.maya.mutation(api.users.setTools, { tools: {} })).rejects.toThrow(/Not allowed/);
    expect((await w.maya.query(api.users.me, {})).tools).toBeUndefined();
  });
  test("menus saved before Nov 17 fold into the eight tools in three groups", () => {
    // People → Clients, Docs and Payments → Sales and money, Sent → Messages, Review → Post; older hiding is dropped.
    const old = toolsOf({ order: ["sent", "dashboard", "people", "messages", "production", "docs", "payments"], hidden: ["payments", "sent"] });
    expect(old.order).toEqual(["messages", "work", "calendar", "dashboard", "projects", "production", "clients", "money"]);
    // Nov 17: Creative planning and Post live inside Production; a menu that hid them (or listed them first) keeps Production.
    expect(toolsOf({ order: ["post", "creative", "dashboard"], hidden: ["post", "creative"] })).toMatchObject({ hidden: [] });
    expect(toolsOf({ order: ["dashboard", "creative", "projects"] }).order.slice(4, 6)).toEqual(["production", "projects"]);
    expect(toolsOf({ order: ["dashboard", "people", "messages", "production", "docs", "payments", "sent"] }).order).toEqual([...TOOLS]); // the old default is the new default
    expect(old.hidden).toEqual([]);
    expect(toolsOf({}).order).toEqual([...TOOLS]);
  });
});
