// Nov 2 (Heston, replacing D102 "one role per email"): one login can be a client and a vendor. It's on one side at a
// time and switches; each side sees only what that side sees. Maya is Harbor Coffee's client of Wrangler; here she is
// also added and invited as a shooter, booked, and switches between the two sides.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { world } from "./payHarness";

const api = anyApi;
beforeAll(async () => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.CONVEX_SITE_URL = "https://x.convex.site";
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_ONLY_TO = "";
  const { generateKeyPairSync } = await import("node:crypto");
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.JWT_PRIVATE_KEY = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  process.env.JWKS = JSON.stringify({ keys: [{ use: "sig", alg: "RS256", ...pair.publicKey.export({ format: "jwk" }) }] });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
type W = Awaited<ReturnType<typeof world>>;
type Sent = { to: string; subject: string; text: string };
const stub = (mails: Sent[]) => vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url === "https://api.resend.com/emails") { const b = JSON.parse(String(init?.body)); mails.push({ to: b.to[0], subject: b.subject, text: b.text }); return new Response(JSON.stringify({ id: "em" }), { status: 200 }); }
  return new Response("{}", { status: 500 });
}));
const settle = async (w: W) => { vi.useFakeTimers(); await w.t.finishAllScheduledFunctions(vi.runAllTimers); vi.useRealTimers(); };
const MAYA = "maya@harbor.example";
const role = (w: W, email: string) => w.t.run(async (ctx) => (await ctx.db.query("users").withIndex("email", (q) => q.eq("email", email)).unique())?.role);

describe("one login, client and vendor", () => {
  test("a client is added, invited and booked as a vendor; she switches sides and each side sees only its own", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const vendorId = await w.heston.mutation(api.vendors.add, { name: "Maya Brooks", email: MAYA, roles: ["Shooter"], rates: [], invite: true }) as Id<"vendors">;
    await settle(w);
    // The invite tells her to sign in with the login she has, and lands on the vendor side.
    const invite = mails.find((m) => m.to === MAYA)!;
    expect(invite.text).toContain(`?invited=${MAYA}&side=vendor`);
    expect(invite.text).toContain("Sign in with your WranglerPortal account");
    // Her existing login got Wrangler on its vendor side straight away.
    expect(await w.maya.query(api.users.me, {})).toMatchObject({ role: "client", sides: ["client", "vendor"] });
    const bookingId = await w.heston.mutation(api.bookings.create, { vendorId, projectId: w.p, role: "Shooter", start: "2030-11-06", end: "2030-11-06", cents: 50_000, unit: "day" }) as Id<"vendorBookings">;

    // On the client side: her projects; the vendor side is refused.
    expect((await w.maya.query(api.projects.mine, {})) ?? []).toBeDefined();
    await expect(w.maya.query(api.vendorPortal.home, {})).rejects.toThrow(/Not allowed/);
    // Switch: the vendor side, with the booking; the client side is refused now.
    expect(await w.maya.mutation(api.users.switchSide, { side: "vendor" })).toBe("vendor");
    expect(await w.maya.query(api.users.me, {})).toMatchObject({ role: "vendor", sides: ["client", "vendor"] });
    const home = await w.maya.query(api.vendorPortal.home, {});
    expect(JSON.stringify(home)).toContain(bookingId);
    await w.maya.mutation(api.vendorPortal.accept, { bookingId });
    await expect(w.maya.query(api.projects.mine, {})).rejects.toThrow(/Not allowed/);
    await expect(w.maya.query(api.inbox.mine, {})).rejects.toThrow(/Not allowed/);
    // And back.
    await w.maya.mutation(api.users.switchSide, { side: "client" });
    expect(await role(w, MAYA)).toBe("client");
    await w.maya.query(api.inbox.mine, {});
    await expect(w.maya.query(api.vendorPortal.bookings, {})).rejects.toThrow(/Not allowed/);
  });

  test("only to a side she has; never for an owner; taken off the vendor list, the vendor side goes", async () => {
    const w = await world();
    stub([]);
    await expect(w.maya.mutation(api.users.switchSide, { side: "vendor" })).rejects.toThrow(/No business has you as a vendor/);
    await expect(w.heston.mutation(api.users.switchSide, { side: "client" })).rejects.toThrow(/Not allowed/);
    await expect(w.boss.mutation(api.users.switchSide, { side: "vendor" })).rejects.toThrow(/Not allowed/);
    const vendorId = await w.heston.mutation(api.vendors.add, { name: "Maya Brooks", email: MAYA, roles: ["Shooter"], rates: [], invite: true }) as Id<"vendors">;
    await w.maya.mutation(api.users.switchSide, { side: "vendor" });
    await w.heston.mutation(api.vendors.archive, { vendorId, archived: true });
    expect((await w.maya.query(api.users.me, {})).sides).toEqual(["client"]);
    await expect(w.maya.query(api.vendorPortal.home, {})).rejects.toThrow(/Not allowed/);
    await expect(w.maya.mutation(api.users.switchSide, { side: "vendor" })).rejects.toThrow(/No business has you as a vendor/);
    await w.maya.mutation(api.users.switchSide, { side: "client" });
    // Back on the list (invited before): the vendor side comes back.
    await w.heston.mutation(api.vendors.archive, { vendorId, archived: false });
    expect((await w.maya.query(api.users.me, {})).sides).toEqual(["client", "vendor"]);
  });

  test("a vendor invited as a client; a new account invited as both starts on the client side with both", async () => {
    const w = await world();
    stub([]);
    const signUp = (email: string) => w.t.action(api.auth.signIn, { provider: "password", params: { flow: "signUp", email, password: "longenoughpassword" } });
    // Both before she has an account.
    await w.heston.mutation(api.vendors.add, { name: "Riley Chen", email: "riley@chen.example", roles: ["Editor"], rates: [], invite: true });
    await w.heston.mutation(api.clients.invite, { email: "riley@chen.example" });
    await signUp("riley@chen.example");
    expect(await role(w, "riley@chen.example")).toBe("client");
    const ms = await w.t.run((ctx) => ctx.db.query("memberships").withIndex("by_email", (q) => q.eq("email", "riley@chen.example")).collect());
    expect(ms.map((m) => m.role).sort()).toEqual(["client", "vendor"]);
    // A client of another business can be a person on a client here too (no more "one role" refusals).
    await w.heston.mutation(api.clients.addPerson, { clientId: w.harbor, email: "riley@chen.example", role: "contact" });
  });
});
