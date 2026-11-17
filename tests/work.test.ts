// 5m Work (Nov 17).
//   T-WK.1 tasks: made on a project or on their own; My tasks is the assignee's; statuses and Done; a repeat makes the
//          next one (every week from the due date; again after done from today); subtasks follow their task on a move;
//          drag on the calendar changes the due date; another business sees nothing
//   T-WK.2 the client and a vendor: only tasks marked for them, on a project the client can open, show in their portal;
//          they can only press Done; someone else's task is refused
//   T-WK.3 to-do lists (an item turns into a task and leaves the list) and templates (dates from the shoot or delivery
//          day, roles picked, vendor tasks left out with no vendor)
//   T-WK.4 a team member without Projects: My tasks only, and only their own task's status
import { describe, expect, test } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { world } from "./payHarness";
import { PERMS } from "../convex/lib/perms";
import { addDays } from "../convex/work";

const api = anyApi;
type W = Awaited<ReturnType<typeof world>>;
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

async function share(w: W) {
  await w.t.run(async (ctx) => {
    const owner = (await ctx.db.query("users").first())!._id;
    const s = await ctx.db.insert("shares", { businessId: w.A, token: "tok-proj-1", kind: "project", projectId: w.p, access: "comment", who: "invited", allVersions: true, downloads: false, emailNewVersions: true, createdAt: 0, createdBy: owner });
    await ctx.db.insert("shareMembers", { businessId: w.A, shareId: s, email: "maya@harbor.example", addedAt: 0 });
  });
}
async function teammate(w: W, perms: string[]) {
  const sub = await w.t.run(async (ctx) => {
    const u = await ctx.db.insert("users", { email: "pat@studio.example", name: "Pat", role: "team", emailVerificationTime: 0 });
    await ctx.db.insert("memberships", { businessId: w.A, email: "pat@studio.example", userId: u, role: "team", teamRole: "editor", perms: Object.fromEntries(PERMS.map((p) => [p, perms.includes(p)])), createdAt: 1 } as never);
    return `${u}|${await ctx.db.insert("authSessions", { userId: u, expirationTime: Date.now() + 3_600_000 })}`;
  });
  return w.t.withIdentity({ subject: sub });
}

describe("work", () => {
  test("T-WK.1 tasks, My tasks, repeats, subtasks, the calendar", async () => {
    const w = await world();
    const a = await w.heston.mutation(api.work.create, { title: "Book the drone pilot", home: { type: "project", id: w.p }, due: "2030-03-02", priority: "high" });
    await w.heston.mutation(api.work.create, { title: "Renew insurance", mine: true });
    const me = await w.heston.query(api.work.mine, {});
    expect(me.tasks.map((t: { title: string }) => t.title)).toEqual(["Renew insurance"]); // only what's given to me
    // Assign, then it's mine too.
    const people = await w.heston.query(api.work.people, { taskId: a });
    const self = people.team.find((p: { email: string }) => p.email !== "pat@studio.example")!;
    await w.heston.mutation(api.work.update, { taskId: a, assignee: { email: self.email, name: self.name }, repeat: { every: "week", after: false } });
    expect((await w.heston.query(api.work.mine, {})).tasks).toHaveLength(2);
    // Done: a weekly repeat makes the next one, a week after the due date.
    const r = await w.heston.mutation(api.work.done, { taskId: a, done: true });
    const next = await w.t.run((ctx) => ctx.db.get(r.next as Id<"tasks">));
    expect(next).toMatchObject({ title: "Book the drone pilot", status: "todo", due: "2030-03-09", priority: "high" });
    expect(addDays("2030-01-31", "month")).toBe("2030-02-28");
    // "Again after it's done" counts from today.
    const b = await w.heston.mutation(api.work.create, { title: "Back up the drives", home: { type: "project", id: w.p }, due: "2030-01-01" });
    await w.heston.mutation(api.work.update, { taskId: b, repeat: { every: "day", after: true } });
    const r2 = await w.heston.mutation(api.work.done, { taskId: b, done: true });
    expect((await w.t.run((ctx) => ctx.db.get(r2.next as Id<"tasks">)))!.due).toBe(addDays(today(), "day"));
    // Subtasks follow their task when it moves; a subtask can't move on its own.
    const sub = await w.heston.mutation(api.work.create, { title: "Call around", parentId: next!._id });
    await w.heston.mutation(api.homes.move, { kind: "task", id: next!._id, to: { type: "client", id: w.harbor } });
    expect(await w.t.run(async (ctx) => (await ctx.db.get(sub as Id<"tasks">))!.clientId)).toBe(w.harbor);
    await expect(w.heston.mutation(api.homes.move, { kind: "task", id: sub, to: null })).rejects.toThrow(/goes where its task goes/);
    // The calendar: drag to a day changes the due date; the board: drag changes the status.
    await w.heston.mutation(api.work.place, { taskId: next!._id, due: "2030-03-12" });
    await w.heston.mutation(api.work.place, { taskId: next!._id, status: "waiting" });
    expect(await w.t.run((ctx) => ctx.db.get(next!._id))).toMatchObject({ due: "2030-03-12", status: "waiting" });
    // The project's Tasks tab.
    expect((await w.heston.query(api.work.forProject, { projectId: w.p })).map((t: { title: string }) => t.title)).toContain("Back up the drives");
    // Another business sees and changes nothing.
    expect((await w.boss.query(api.work.all, {})).tasks).toEqual([]);
    expect(await w.boss.query(api.work.get, { taskId: a })).toBeNull();
    await expect(w.boss.mutation(api.work.done, { taskId: a, done: false })).rejects.toThrow();
  });

  test("T-WK.2 the client's and a vendor's tasks: only theirs, only Done", async () => {
    const w = await world();
    await share(w);
    const forClient = await w.heston.mutation(api.work.create, { title: "Send your logo", home: { type: "project", id: w.p }, audience: "client", due: "2030-11-20" });
    const teamOnly = await w.heston.mutation(api.work.create, { title: "Grade the edit", home: { type: "project", id: w.p } });
    // A task for the client needs a project or client.
    await expect(w.heston.mutation(api.work.create, { title: "Loose", audience: "client" })).rejects.toThrow(/Attach it/);
    const mine = await w.maya.query(api.work.forClient, {});
    expect(mine.map((t: { title: string }) => t.title)).toEqual(["Send your logo"]);
    expect(mine[0]).toMatchObject({ project: "26127 Launch", from: "Wrangler Productions" });
    // Someone who can't open the project sees none of it and can't finish it.
    expect(await w.sam.query(api.work.forClient, {})).toEqual([]);
    await expect(w.sam.mutation(api.work.clientDone, { taskId: forClient, done: true })).rejects.toThrow(/isn't one of yours/);
    await expect(w.maya.mutation(api.work.clientDone, { taskId: teamOnly, done: true })).rejects.toThrow(/isn't one of yours/);
    await w.maya.mutation(api.work.clientDone, { taskId: forClient, done: true });
    expect(await w.t.run((ctx) => ctx.db.get(forClient as Id<"tasks">))).toMatchObject({ status: "done", doneBy: "Maya Brooks" });
    // Clients can only press Done: nothing else of Work answers them.
    await expect(w.maya.query(api.work.all, {})).rejects.toThrow();
    await expect(w.maya.mutation(api.work.update, { taskId: forClient, title: "x" })).rejects.toThrow();
    // A vendor: only tasks given to them on purpose.
    const vendorId = await w.heston.mutation(api.vendors.add, { name: "Jordan Ellis", email: "jordan@crew.example", roles: ["Shooter"], rates: [], invite: true }) as Id<"vendors">;
    const jordan = await w.t.run(async (ctx) => {
      const u = await ctx.db.insert("users", { email: "jordan@crew.example", name: "Jordan Ellis", role: "vendor" });
      await ctx.db.insert("memberships", { businessId: w.A, email: "jordan@crew.example", userId: u, role: "vendor", createdAt: 1 });
      return `${u}|${await ctx.db.insert("authSessions", { userId: u, expirationTime: Date.now() + 3_600_000 })}`;
    });
    const j = w.t.withIdentity({ subject: jordan });
    await expect(w.heston.mutation(api.work.create, { title: "No vendor", home: { type: "project", id: w.p }, audience: "vendor" })).rejects.toThrow(/Pick the vendor/);
    const vt = await w.heston.mutation(api.work.create, { title: "Send the drone logs", home: { type: "project", id: w.p }, audience: "vendor", vendorId });
    expect((await j.query(api.work.forVendor, {})).map((t: { title: string }) => t.title)).toEqual(["Send the drone logs"]);
    await expect(j.mutation(api.work.vendorDone, { taskId: teamOnly, done: true })).rejects.toThrow(/isn't one of yours/);
    await j.mutation(api.work.vendorDone, { taskId: vt, done: true });
    expect(await w.t.run(async (ctx) => (await ctx.db.get(vt as Id<"tasks">))!.status)).toBe("done");
  });

  test("T-WK.3 to-do lists and templates", async () => {
    const w = await world();
    const list = await w.heston.mutation(api.work.createList, { name: "Shoot day packing", home: { type: "project", id: w.p } });
    await w.heston.mutation(api.work.saveList, { listId: list, items: [{ id: "a", text: "Tape", done: false }, { id: "b", text: "Call the venue about parking", done: false }] });
    const task = await w.heston.mutation(api.work.itemToTask, { listId: list, itemId: "b" });
    expect(await w.t.run((ctx) => ctx.db.get(task as Id<"tasks">))).toMatchObject({ title: "Call the venue about parking", projectId: w.p });
    expect((await w.heston.query(api.work.lists, {}))[0].items.map((i: { text: string }) => i.text)).toEqual(["Tape"]);
    const tpl = await w.heston.mutation(api.work.saveTemplate, { name: "Social package", items: [
      { id: "1", title: "Book crew", from: "shoot", days: -7, role: "Producer", audience: "team", priority: "high" },
      { id: "2", title: "Send your logo", from: "shoot", days: -10, role: "Client", audience: "client", priority: "normal" },
      { id: "3", title: "Send the footage", from: "shoot", days: 1, role: "Shooter", audience: "vendor", priority: "normal" },
      { id: "4", title: "Deliver the cuts", from: "delivery", days: 0, role: "Producer", audience: "team", priority: "normal" },
    ] });
    const r = await w.heston.mutation(api.work.useTemplate, { templateId: tpl, projectId: w.p, shootDay: "2030-06-10", deliveryDay: "2030-07-01", roles: [{ role: "Producer", email: "pat@studio.example", name: "Pat" }] });
    expect(r.added).toBe(3); // the vendor's task is left out: no vendor picked for Shooter
    const made = (await w.heston.query(api.work.forProject, { projectId: w.p })).filter((t: { title: string }) => ["Book crew", "Send your logo", "Deliver the cuts"].includes(t.title));
    expect(Object.fromEntries(made.map((t: { title: string; due: string }) => [t.title, t.due]))).toEqual({ "Book crew": "2030-06-03", "Send your logo": "2030-05-31", "Deliver the cuts": "2030-07-01" });
    expect(made.find((t: { title: string }) => t.title === "Book crew").assignee).toMatchObject({ email: "pat@studio.example" });
  });

  test("T-WK.4 a team member without Projects", async () => {
    const w = await world();
    const pat = await teammate(w, ["review"]);
    const given = await w.heston.mutation(api.work.create, { title: "Export the selects", home: { type: "project", id: w.p }, assignee: { email: "pat@studio.example", name: "Pat" } });
    const other = await w.heston.mutation(api.work.create, { title: "Pay the venue", home: { type: "project", id: w.p } });
    expect((await pat.query(api.work.mine, {})).tasks.map((t: { title: string }) => t.title)).toEqual(["Export the selects"]);
    await expect(pat.query(api.work.all, {})).rejects.toThrow();
    expect((await pat.query(api.work.get, { taskId: given }))!.title).toBe("Export the selects");
    await expect(pat.query(api.work.get, { taskId: other })).rejects.toThrow(/Not allowed/);
    await pat.mutation(api.work.update, { taskId: given, status: "doing" });
    await expect(pat.mutation(api.work.update, { taskId: given, title: "New name" })).rejects.toThrow(/Not allowed/);
    await expect(pat.mutation(api.work.done, { taskId: other, done: true })).rejects.toThrow(/Not allowed/);
    await pat.mutation(api.work.create, { title: "Clean the cards", mine: true });
    await expect(pat.mutation(api.work.create, { title: "Elsewhere", home: { type: "project", id: w.p } })).rejects.toThrow();
  });
});
