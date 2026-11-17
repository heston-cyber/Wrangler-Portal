// Second review (Nov 17), H1 follow-up: a session ended on the server (Sign out this device, a password change, five
// wrong hand-back PINs) answers nothing at once, even while its token is still valid: not the owner's side, not a
// client's billing; the browser is told to sign out (users.me ended).
import { describe, expect, test } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { world } from "./payHarness";

const api = anyApi;
const sessionOf = (sub: string) => sub.split("|")[1] as Id<"authSessions">;

describe("an ended session", () => {
  test("the owner's and a client's ended sessions get nothing; the browser is told to sign out", async () => {
    const w = await world();
    const inv = await w.t.run((ctx) => ctx.db.insert("invoices", {
      businessId: w.A, projectId: w.p, clientId: w.harbor, kind: "final", title: "Final invoice", billTo: { name: "Maya Brooks", email: "maya@harbor.example", company: "Harbor Coffee" },
      lines: [{ id: "a", description: "Final payment", qty: 1, unitCents: 1000 }], dueDate: "2030-01-01", status: "open", totalCents: 1000, amountPaidCents: 0, amountRemainingCents: 1000,
      payToken: "x".repeat(32), history: [], createdAt: 0, updatedAt: 0,
    } as never));
    void inv;
    expect(await w.maya.query(api.invoicePay.mine, {})).toHaveLength(1);
    expect(await w.heston.query(api.library.overview, {})).toBeTruthy();
    await w.t.run(async (ctx) => { await ctx.db.delete(sessionOf(w.mayaSub)); await ctx.db.delete(sessionOf(w.hestonSub)); });
    expect(await w.maya.query(api.invoicePay.mine, {})).toEqual([]);
    await expect(w.heston.query(api.library.overview, {})).rejects.toThrow(/Not allowed/);
    expect(await w.heston.query(api.users.me, {})).toMatchObject({ allowed: false, ended: true });
    expect(await w.maya.query(api.users.me, {})).toMatchObject({ allowed: false, ended: true });
    // Others are untouched.
    expect(await w.boss.query(api.users.me, {})).toMatchObject({ allowed: true, locked: null });
  });
});
