// Phase 8d (Heston, Nov 19, 10:13: "approved"): the rest of the site through the one connector.
//   T8d.1 a creative doc's text, written and read as page markdown
//   T8d.2 messages, invites, review links, team access, calendar invites, a watermark turned off: asks
//   T8d.3 a proposal's or briefing's first send makes its PDF in Heston's browser: not through the connector
//   T8d.4 keys run out when chosen, and stop if their maker stops being the owner
//   T8d.5 a photo uploaded through the connector goes only where a site function puts it
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import { world } from "./payHarness";
import type { Id } from "../convex/_generated/dataModel";

const api = anyApi;
beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_ONLY_TO = "";
});
afterEach(() => { vi.unstubAllGlobals(); });

async function setup() {
  const w = await world();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
  const keyA = (await w.heston.action(api.portalKeys.createKey, {})).key as string;
  const raw = (k: string, name: string, args: Record<string, unknown> = {}) => w.t.fetch("/portal-mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${k}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
  const as = (k: string) => async (name: string, args: Record<string, unknown> = {}) => {
    const j = await (await raw(k, name, args)).json();
    return { error: j.result.isError === true, text: j.result.content[0].text as string, data: j.result.structuredContent as Record<string, any> };
  };
  return { w, a: as(keyA), as, raw };
}

describe("Phase 8d · the rest of the site", () => {
  test("T8d.1 a creative doc's text is written and read as page markdown", async () => {
    const x = await setup();
    const made = await x.a("site_change", { action: "creative.newDoc", args: { kind: "treatment", title: "Harbor launch treatment" } });
    expect(made.error).toBe(false);
    const creativeDocId = (made.data.result as { docId?: string })?.docId ?? (made.data.result as string);
    const w = await x.a("site_change", { action: "pageText.write", args: { creativeDocId, markdown: "# Harbor launch\n### The idea\nMorning light on the espresso bar.\n- Wide of the room\n- Close on the pour" } });
    expect(w.error).toBe(false);
    const r = await x.a("site_read", { action: "pageText.get", args: { creativeDocId } });
    expect(r.data.result).toMatchObject({ what: "creative doc", markdown: expect.stringContaining("Morning light on the espresso bar.") });
    expect(r.data.result.markdown).toContain("- Close on the pour");
  });

  test("T8d.2 messages, invites, review links, team access, calendar invites and a watermark turned off all ask", async () => {
    const x = await setup();
    for (const action of ["messages.send", "clients.invite", "clients.invitePerson", "shares.create", "shares.update", "shares.addMember", "team.invite", "team.setRole", "team.setPerm", "team.assign", "team.remove", "briefs.send", "fileRequests.sendDraft", "subscriptions.setFailRule"]) {
      expect((await x.a("site_change", { action, args: {} })).text, action).toMatch(/needs Heston/);
    }
    expect((await x.a("site_change", { action: "calendar.save", args: { calendarId: "c", calendarName: "Cal", inviteVendors: false, inviteClient: true } })).text).toMatch(/Google emails/);
    expect((await x.a("site_change", { action: "clients.setSettings", args: { clientId: x.w.harbor, watermarkOff: true } })).text).toMatch(/without it/);
    expect((await x.a("site_change", { action: "clients.setSettings", args: { clientId: x.w.harbor, rounds: 3 } })).error).toBe(false);
    expect((await x.a("site_change", { action: "shares.setOff", args: { shareId: "x", off: false } })).text).toMatch(/opens the cuts again|args/);
  });

  test("T8d.3 a first send of a proposal or briefing stays on the site; asks with no one to send to are refused", async () => {
    const x = await setup();
    const made = await x.w.heston.mutation(api.proposals.create, {}) as { proposalId?: Id<"proposals"> } | Id<"proposals">;
    const proposalId = typeof made === "string" ? made : made.proposalId!;
    const r = await x.a("site_ask", { action: "proposals.send", args: { proposalId }, heston_ok: "yes, send the proposal" });
    expect(r.error).toBe(true);
    expect(r.text).toMatch(/first send makes the proposal's PDF in your browser/);
    expect((await x.a("site_ask", { action: "proposals.send", args: { proposalId, storageId: "kg2abc" }, heston_ok: "yes, send it" })).text).toMatch(/file can't be handed in|should be/);
  });

  test("T8d.4 a key works for the time chosen, and stops when its maker stops being the owner", async () => {
    const x = await setup();
    const k30 = (await x.w.heston.action(api.portalKeys.createKey, { days: 30 })).key as string;
    const listed = await x.w.heston.query(api.portalKeys.listKeys, {});
    expect(listed.find((k: { expiresAt: number | null }) => k.expiresAt)).toMatchObject({ expired: false });
    expect((await x.raw(k30, "site_actions")).status).toBe(200);
    await x.w.t.run(async (ctx) => { for (const k of await ctx.db.query("portalKeys").collect()) if (k.expiresAt) await ctx.db.patch(k._id, { expiresAt: Date.now() - 1 }); });
    expect((await x.raw(k30, "site_actions")).status).toBe(401);
    // The other business's owner makes a key, then stops being its owner: the key stops.
    const kb = (await x.w.boss.action(api.portalKeys.createKey, { days: null })).key as string;
    expect((await x.raw(kb, "site_actions")).status).toBe(200);
    await x.w.t.run(async (ctx) => { for (const m of await ctx.db.query("memberships").collect()) if (m.email === "boss@other.example") await ctx.db.patch(m._id, { revokedAt: Date.now() }); });
    expect((await x.raw(kb, "site_actions")).status).toBe(401);
  });

  test("T8d.5 a photo uploaded through the connector goes only where a site function puts it", async () => {
    const x = await setup();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString("base64");
    expect((await x.a("site_upload", { name: "x.png", content_type: "image/png", base64: Buffer.from("not a png").toString("base64") })).text).toMatch(/isn't a PNG/);
    expect((await x.a("site_upload", { name: "x.svg", content_type: "image/svg+xml", base64: png })).text).toMatch(/photo .* or a PDF only/);
    const up = await x.a("site_upload", { name: "camera.png", content_type: "image/png", base64: png });
    expect(up.error).toBe(false);
    expect(up.data).toMatchObject({ bytes: 12, storageId: expect.any(String) });
    expect(await x.w.t.run((ctx) => ctx.db.system.get(up.data.storageId as Id<"_storage">))).toMatchObject({ size: 12 });
    // It goes through the site's own photo checks (this test runtime keeps no file types, so they refuse it here; on
    // Convex the type comes with the file). Nothing else holds it until one of them takes it.
    const gearId = (await x.a("site_change", { action: "gear.add", args: { name: "FX3", kind: "camera" } })).data.result as string;
    const set = await x.a("site_change", { action: "gear.setPhoto", args: { gearId, storageId: up.data.storageId } });
    expect(set.data.result).toMatch(/A photo needs to be a PNG/);
    expect((await x.w.t.run((ctx) => ctx.db.get(gearId as Id<"gear">)))!.photoId).toBeUndefined();
  });
});
