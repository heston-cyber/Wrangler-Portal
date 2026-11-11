// Phase 5e step 3 (Nov 5): Settings › Activity. The owner's log of who changed what, kept a year, owner only.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { world } from "./payHarness";

const api = anyApi;
beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.RESEND_API_KEY = "re_test";
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const stub = () => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "em" }), { status: 200 })));

describe("Phase 5e · Activity", () => {
  test("A1 team changes, deletions and settings are logged with who did them; filters; owner only; another business sees none", async () => {
    const w = await world();
    stub();
    await w.heston.mutation(api.team.invite, { email: "riley@chen.example", role: "producer" });
    await w.heston.mutation(api.team.setRolePerm, { role: "producer", perm: "settings", on: true });
    const pid = await w.t.run(async (ctx) => ctx.db.insert("projects", { businessId: w.A, name: "Old job", createdAt: 0 }));
    await w.heston.mutation(api.library.deleteProject, { projectId: pid });
    await w.heston.mutation(api.business.updateSettings, { address: "1 Main St" });
    const log = await w.heston.query(api.auditLog.list, {});
    expect(log.rows.map((r: { text: string }) => r.text)).toEqual([
      "changed the business settings (address)", "deleted the project Old job", "turned Settings on for every Producer", "invited riley@chen.example as Producer",
    ]);
    expect(log.rows[0]).toMatchObject({ who: "Heston", role: "Owner", kind: "settings" });
    expect(log.counts).toMatchObject({ all: 4, team: 2, deleted: 1, settings: 1 });
    expect((await w.heston.query(api.auditLog.list, { kind: "team" })).rows).toHaveLength(2);
    expect((await w.heston.query(api.auditLog.list, { who: "Nobody" })).rows).toHaveLength(0);
    // A failed change leaves no line (it's in the same transaction).
    await expect(w.heston.mutation(api.library.deleteProject, { projectId: pid })).rejects.toThrow();
    expect((await w.heston.query(api.auditLog.list, {})).rows).toHaveLength(4);
    // Owner only; Other Films sees an empty log of its own.
    await expect(w.maya.query(api.auditLog.list, {})).rejects.toThrow(/Not allowed/);
    expect((await w.boss.query(api.auditLog.list, {})).rows).toEqual([]);
  });

  test("A2 a line older than a year is purged; newer ones stay", async () => {
    const w = await world();
    await w.t.run(async (ctx) => {
      await ctx.db.insert("auditLog", { businessId: w.A, at: Date.now() - 366 * 86_400_000, kind: "sent", who: "Heston", role: "Owner", text: "sent something long ago" });
      await ctx.db.insert("auditLog", { businessId: w.A, at: Date.now() - 300 * 86_400_000, kind: "sent", who: "Heston", role: "Owner", text: "sent something this year" });
    });
    expect(await w.t.mutation(anyApi.auditLog.purge, {})).toBe(1);
    expect((await w.heston.query(api.auditLog.list, {})).rows.map((r: { text: string }) => r.text)).toEqual(["sent something this year"]);
  });

  test("A3 a team member's change names them and their role", async () => {
    const w = await world();
    stub();
    const sub = await w.t.run(async (ctx) => {
      const u = await ctx.db.insert("users", { email: "pat@x.example", name: "Pat Producer", role: "team", emailVerificationTime: 0 });
      const { SUGGESTED } = await import("../convex/lib/perms");
      await ctx.db.insert("memberships", { businessId: w.A, email: "pat@x.example", userId: u, role: "team", teamRole: "producer", perms: { ...SUGGESTED.producer }, createdAt: 0 });
      return `${u}|${await ctx.db.insert("authSessions", { userId: u, expirationTime: Date.now() + 3_600_000 })}`;
    });
    const pat = w.t.withIdentity({ subject: sub });
    await pat.mutation(api.clients.invite, { email: "newclient@example.com" });
    const row = (await w.heston.query(api.auditLog.list, {})).rows[0];
    expect(row).toMatchObject({ who: "Pat Producer", role: "Producer", kind: "sent", text: "invited newclient@example.com to the portal" });
    await expect(pat.query(api.auditLog.list, {})).rejects.toThrow(/Not allowed/);
    void (null as unknown as Id<"users">);
  });
});
