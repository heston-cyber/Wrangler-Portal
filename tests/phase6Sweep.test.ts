// Phase 6 security sweep (Nov 17): the fixes, each with the case the review described.
//   S6.1 (M2) "Their Inbox": a team member without Payments sees that a money item went out, not its amount or pay
//        link; nobody on the owner's side gets a signer's own signing link
//   S6.2 (M3) a vendor's new email drops their Stripe payout recipient; Pay checks the bank against the one last seen
//   S6.3 (L2) a Stripe event from the other mode is acknowledged and ignored
//   S6.4 (L6) a message can't carry a web page, script or SVG
//   S6.5 (L7, L8, L3) a team member opening a client's page isn't "viewed"; the S0 diagnostic route is gone; the app
//        tells other sites only its origin
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { rolePerms } from "../convex/lib/perms";
import { signForTest } from "../convex/lib/stripeApi";
import { fakeStripe, sent, world } from "./payHarness";

const api = anyApi;
type W = Awaited<ReturnType<typeof world>>;

/** A Producer on the business's team (Clients on, Payments off), signed in. */
async function producer(w: W) {
  const sub = await w.t.run(async (ctx) => {
    const u = await ctx.db.insert("users", { email: "riley@chen.example", name: "Riley Chen", role: "team" });
    await ctx.db.insert("memberships", { businessId: w.A, email: "riley@chen.example", role: "team", teamRole: "producer", perms: rolePerms(null, "producer"), userId: u, createdAt: 0 });
    return `${u}|${await ctx.db.insert("authSessions", { userId: u, expirationTime: Date.now() + 3_600_000 })}`;
  });
  return w.t.withIdentity({ subject: sub });
}

describe("Phase 6 sweep fixes", () => {
  test("S6.1 Their Inbox hides money details from a team member without Payments, and signing links from everyone", async () => {
    const w = await world();
    await w.t.run(async (ctx) => {
      const base = { businessId: w.A, clientId: w.harbor, email: "maya@harbor.example", createdAt: 1 };
      await ctx.db.insert("inboxItems", { ...base, kind: "invoice", title: "Invoice WRNGLR-0007 · $4,200.00", text: "Due Dec 1 · $4,200.00", link: "/i/paytoken123", linkLabel: "Pay", source: { module: "payments", id: "x1" }, key: "inv:1:maya@harbor.example" });
      await ctx.db.insert("inboxItems", { ...base, kind: "to_sign", title: "Sign: Service agreement", text: "Ready to sign", link: "https://sign.wranglerportal.com/s/signertoken", source: { module: "sign", id: "d1" }, key: "sign:1:maya@harbor.example", createdAt: 2 });
      await ctx.db.insert("inboxItems", { ...base, kind: "cut_ready", title: "Launch 30s v2 is ready", text: "Have a look", link: "/v/abc", source: { module: "review", id: "v1" }, key: "cut:1:maya@harbor.example", createdAt: 3 });
    });
    const riley = await producer(w);
    const theirs = await riley.query(api.inbox.forClient, { clientId: w.harbor });
    const by = (k: string) => theirs.find((e: { kind: string }) => e.kind === k);
    expect(by("invoice")).toMatchObject({ title: "Invoice", text: "Details need the Payments switch.", link: null });
    expect(JSON.stringify(theirs)).not.toMatch(/paytoken123|4,200|signertoken/);
    expect(by("cut_ready")).toMatchObject({ title: "Launch 30s v2 is ready", link: "/v/abc" }); // other items as they are
    // Phase 6 review: the Sent list too, and an amount inside any other item (the raw-footage offer)
    await w.t.run(async (ctx) => { await ctx.db.insert("inboxItems", { businessId: w.A, clientId: w.harbor, email: "maya@harbor.example", kind: "final_files", title: "Keep your raw footage?", text: "Kept until Dec 1. Keep it for $100/year?", link: "/projects/x", source: { module: "projects", id: "p1" }, key: "footage:1:maya@harbor.example", createdAt: 4 }); });
    const sentRows = await riley.query(api.inbox.sent, {});
    expect(JSON.stringify(sentRows)).not.toMatch(/4,200|\$100/);
    expect(sentRows.find((r: { kind: string }) => r.kind === "invoice")).toMatchObject({ title: "Invoice" });
    expect(JSON.stringify(await riley.query(api.inbox.forClient, { clientId: w.harbor }))).not.toMatch(/\$100/);
    expect(JSON.stringify(await w.heston.query(api.inbox.sent, {}))).toMatch(/4,200/); // the owner sees it all
    const mine = await w.heston.query(api.inbox.forClient, { clientId: w.harbor });
    expect(mine.find((e: { kind: string }) => e.kind === "invoice")).toMatchObject({ title: "Invoice WRNGLR-0007 · $4,200.00", link: "/i/paytoken123" });
    expect(mine.find((e: { kind: string }) => e.kind === "to_sign")).toMatchObject({ title: "Sign: Service agreement", link: null });
  });

  test("S6.2 a vendor's new email drops the payout recipient (the new address sets up direct deposit afresh)", async () => {
    const w = await world();
    const v = await w.t.run(async (ctx) => ctx.db.insert("vendors", {
      businessId: w.A, name: "Jordan Ellis", email: "jordan@ellis.example", roles: ["Shooter"], rates: [], createdAt: 0, updatedAt: 0,
      payout: { recipientId: "acct_jordan", mode: "test", ready: true, payoutMethodId: "pm_x", last4: "6789", bankName: "Bank", checkedAt: 0 },
    } as never) as Promise<Id<"vendors">>);
    const x = await w.t.run(async (ctx) => ctx.db.get(v));
    const { _id, _creationTime, businessId, createdAt, updatedAt, payout, invitedAt, joinedAt, ...details } = x as Record<string, unknown>;
    void _id; void _creationTime; void businessId; void createdAt; void updatedAt; void payout; void invitedAt; void joinedAt;
    await w.heston.mutation(api.vendors.update, { vendorId: v, ...details, email: "someone@new.example" });
    expect((await w.t.run(async (ctx) => ctx.db.get(v)))!.payout).toBeUndefined();
    const src = readFileSync("convex/vendorPayouts.ts", "utf8");
    expect(src).toContain("const method = payoutMethodId ?? c.savedMethod;"); // the bank check itself: vendorPayouts.test.ts
    expect(src).toContain("idem: `wp-vendor-${v0.vendorId}-${v0.email}-${payoutsMode()}`");
  });

  test("S6.3 a Stripe event from the other mode is acknowledged and changes nothing", async () => {
    const w = await world();
    process.env.STRIPE_PLATFORM_KEY = "sk_test_platform";
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = "whsec_sweep";
    const body = JSON.stringify({ id: "evt_live_1", type: "account.application.deauthorized", account: "acct_A", livemode: true, data: { object: {} } });
    const r = await w.t.fetch("/stripe/connect", { method: "POST", body, headers: { "stripe-signature": await signForTest(body, "whsec_sweep") } });
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("other mode");
    expect((await w.t.run(async (ctx) => ctx.db.get(w.A)))!.stripe!.status).toBe("connected");
    expect(await w.t.run(async (ctx) => ctx.db.query("stripeEvents").collect())).toHaveLength(0);
  });

  test("S6.4 a message can't carry a web page, script or SVG", async () => {
    const w = await world();
    await w.t.run(async (ctx) => { // Maya can open the Launch project
      const owner = (await ctx.db.query("users").first())!._id;
      const s = await ctx.db.insert("shares", { businessId: w.A, token: "tok-proj-1", kind: "project", projectId: w.p, access: "comment", who: "invited", allVersions: true, downloads: false, emailNewVersions: true, createdAt: 0, createdBy: owner });
      await ctx.db.insert("shareMembers", { businessId: w.A, shareId: s, email: "maya@harbor.example", addedAt: 0 });
    });
    const { threadId: tid } = await w.maya.mutation(api.messages.clientSend, { projectId: w.p, text: "Hello" });
    const up = (body: string, type: string) => w.t.run(async (ctx) => ctx.storage.store(new Blob([body], { type })));
    for (const [type, name] of [["text/html", "invoice.html"], ["image/svg+xml", "logo.svg"], ["application/octet-stream", "page.HTM"]]) { // (the test storage keeps no content type, so the type check is read from the code below)
      const id = await up("<script>alert(1)</script>", type);
      expect((await w.maya.mutation(api.messages.clientSend, { threadId: tid, text: "see this", files: [{ storageId: id, name }] })).error, name).toMatch(/web pages, scripts and SVG files aren't allowed/);
    }
    expect(readFileSync("convex/messages.ts", "utf8")).toMatch(/ACTIVE_TYPE\.test\(meta\.contentType \?\? ""\)/);
    const ok = await up("PK", "application/zip");
    expect(await w.maya.mutation(api.messages.clientSend, { threadId: tid, text: "logos", files: [{ storageId: ok, name: "logos.zip" }] })).toMatchObject({ error: null });
  });

  test("S6.5 a team member opening a client page isn't the client viewing it; the S0 route is gone; referrer policy", async () => {
    const w = await world();
    fakeStripe();
    const { id, token } = await sent(w);
    const riley = await producer(w);
    await riley.mutation(api.invoicePay.markViewed, { token });
    expect((await w.t.run((ctx) => ctx.db.get(id)))!.viewedAt).toBeUndefined();
    await w.maya.mutation(api.invoicePay.markViewed, { token });
    expect((await w.t.run((ctx) => ctx.db.get(id)))!.viewedAt).toEqual(expect.any(Number));
    for (const f of ["convex/invoicePay.ts", "convex/lib/offers.ts", "convex/briefings.ts", "convex/signCopies.ts"]) expect(readFileSync(f, "utf8"), f).toMatch(/ownerSideLooking\(ctx/);
    expect(readFileSync("convex/http.ts", "utf8")).not.toContain("/ws-s0/ip");
    expect(readFileSync("index.html", "utf8")).toContain('<meta name="referrer" content="strict-origin" />');
  });
});
