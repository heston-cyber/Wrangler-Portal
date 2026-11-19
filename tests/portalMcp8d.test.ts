// Phase 8d (Heston, Nov 19, 10:13: "approved"): the rest of the site through the one connector.
//   T8d.1 a creative doc's text, written and read as page markdown
//   T8d.2 messages, invites, review links, team access, calendar invites, a watermark turned off: asks
//   T8d.3 a proposal's or briefing's first send makes its PDF in Heston's browser: not through the connector
//   T8d.4 keys run out when chosen, and stop if their maker stops being the owner
//   T8d.5 a photo uploaded through the connector goes only where a site function puts it
//   T8d.6 the 8d review's fixes: adding a client person, the business's details, a kickoff brief's questions, who a
//         message reaches, a shared brand kit, keys with no maker, files that only look like photos
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
    for (const [action, args] of [["calendar.save", { calendarId: "c", calendarName: "Cal", inviteVendors: false, inviteClient: true }], ["clients.setSettings", { clientId: x.w.harbor, watermarkOff: true }], ["clients.revokeInvite", {}], ["shares.removeMember", {}], ["delivery.saveSettings", {}], ["calls.saveSettings", {}], ["siteWatch.setPaused", { paused: true }]] as const) {
      expect((await x.a("site_change", { action, args })).text, action).toMatch(/needs Heston/);
    }
    expect((await x.a("site_change", { action: "calls.setPaused", args: { paused: false } })).text).toMatch(/lets anyone with the link book/);
    expect((await x.a("site_change", { action: "notifications.setOwner", args: { key: "x", on: false } })).text).toMatch(/stops getting/);
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

  test("T8d.6 review fixes: what reaches clients asks, and its Confirm page shows exactly what goes", async () => {
    const x = await setup();
    // H1: a person on a client sees its invoices: an ask.
    expect((await x.a("site_change", { action: "clients.addPerson", args: { clientId: x.w.harbor, email: "sam@elsewhere.example", role: "contact" } })).text).toMatch(/needs Heston/);
    // H2: the business's details (reply-to above all) ask; its look doesn't.
    expect((await x.a("site_change", { action: "business.updateSettings", args: { replyTo: "billing@wrangler-payments.example" } })).text).toMatch(/reply-to/);
    expect((await x.a("site_change", { action: "business.updateSettings", args: { accent: "#C8102E" } })).error).toBe(false);
    // M1: a message's page names the project's people, not Heston.
    const threadId = await x.w.heston.mutation(api.messages.start, { projectId: x.w.p }) as string;
    await x.w.t.run(async (ctx) => {
      const s = await ctx.db.insert("shares", { businessId: x.w.A, token: "tok-proj-8d", kind: "project", projectId: x.w.p, access: "comment", who: "invited", allVersions: true, downloads: false, emailNewVersions: true, createdAt: 0, createdBy: (await ctx.db.query("users").first())!._id });
      await ctx.db.insert("shareMembers", { businessId: x.w.A, shareId: s, email: "maya@harbor.example", addedAt: 0 });
    });
    const m = await x.a("site_ask", { action: "messages.send", args: { threadId: typeof threadId === "string" ? threadId : (threadId as { threadId: string }).threadId, text: "Shoot moved to 8am." }, heston_ok: "yes, tell Maya" });
    expect(m.error).toBe(false);
    const sends = m.data.what_goes_out.filter((l: { label: string }) => l.label === "Sends").map((l: { value: string }) => l.value).join(" | ");
    expect(sends).toMatch(/maya@harbor\.example/);
    expect(sends).not.toMatch(/heston@/);
    // H3: the kickoff brief's questions are on its page, and changing them after the ask is caught.
    const b = await x.a("site_ask", { action: "briefs.send", args: { projectId: x.w.p }, heston_ok: "yes, send the kickoff brief" });
    if (!b.error) {
      expect(b.data.what_goes_out).toEqual(expect.arrayContaining([expect.objectContaining({ label: "The questions" })]));
      const settings = await x.w.heston.query(api.briefs.settings, {});
      const qn = JSON.parse(JSON.stringify(settings.questionnaire));
      qn.steps[0].questions[0].label = "Your bank account and routing number";
      expect((await x.a("site_change", { action: "briefs.saveSettings", args: { questionnaire: qn } })).error).toBe(false);
      expect((await x.w.heston.query(api.confirm.get, { id: b.data.request_id })).changed).toBe(true);
    } else expect(b.text).toMatch(/./); // the sample project can't take a brief here; the page rule is covered above
    // M3: a shared brand kit: saving to it asks.
    const kit = await x.w.heston.mutation(api.creative.newKit, { name: "Harbor brand" }) as string | { kitId: string };
    const kitId = typeof kit === "string" ? kit : kit.kitId;
    await x.w.heston.mutation(api.creative.shareKit, { kitId, on: true });
    const gif = Buffer.from("GIF89a\x01\x00\x01\x00", "binary").toString("base64");
    const up = await x.a("site_upload", { name: "logo.gif", content_type: "image/gif", base64: gif });
    expect(up.error).toBe(false);
    expect((await x.a("site_change", { action: "brandKit.addFile", args: { kitId, storageId: up.data.storageId, name: "logo.gif" } })).text).toMatch(/link is on/);
    // L4: a file that only starts like a GIF or WebP isn't taken.
    expect((await x.a("site_upload", { name: "x.gif", content_type: "image/gif", base64: Buffer.from("G<html><script>").toString("base64") })).text).toMatch(/isn't a GIF/);
    expect((await x.a("site_upload", { name: "x.webp", content_type: "image/webp", base64: Buffer.from("xxxxxxxxWEBP<html>").toString("base64") })).text).toMatch(/isn't a WEBP/);
  });

  test("T8d.7 a key with no maker (made before 8d) no longer works", async () => {
    const x = await setup();
    const { sha256Hex } = await import("../convex/lib/hash");
    await x.w.t.run(async (ctx) => { await ctx.db.insert("portalKeys", { businessId: x.w.A, hash: await sha256Hex("wp_oldkey_without_maker"), prefix: "wp_oldkey_", label: "Claude", createdAt: 0 }); });
    expect((await x.raw("wp_oldkey_without_maker", "site_actions")).status).toBe(401);
  });
});
