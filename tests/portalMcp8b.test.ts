// Phase 8b (Heston, Nov 18: "Approved"): the rest of the site through the one connector, run as the business owner.
//   T8b.1 every action named exists on the site, with arguments Claude can see; the tools are there
//   T8b.2 reads: the owner's own view, only the key's business
//   T8b.3 changes: direct, as the owner, in Activity as Claude's; never in another business
//   T8b.4 a change that would send something is undone, and Claude is told what it would have sent
//   T8b.5 asks: tried and undone, the Confirm page shows exactly who it reaches; nothing happens until Heston confirms;
//         if it would reach different people by then, Confirm refuses and nothing is done
//   T8b.6 deletes are always asks
//   T8b.7 what never comes through: moving a project to another client, W-9s and bank details, bad arguments
//   T8b.8 with its own key, every action runs as the owner: none is refused for want of access
//   T8b.9 the 8b review's fixes: every address counted, shared boards, reopened access and clients' tasks ask first,
//         the Confirm page says why and never gets the records themselves, releases stay out of Sign's draft tools
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { world } from "./payHarness";
import { ACTIONS, argsOf } from "../convex/lib/siteActions";
import { todayCentral } from "../convex/lib/bookings";
import { argsFor, setup as matrixSetup } from "./matrix";
import { peopleIn, scrub } from "../convex/lib/siteGuard";

const api = anyApi;
beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_ONLY_TO = "";
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

type W = Awaited<ReturnType<typeof world>>;
type Sent = { to: string; subject: string };
const day = (n: number) => { const d = new Date(`${todayCentral()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function confirmAs(w: W, id: string, who: "heston" | "boss" | "maya" = "heston") {
  const g = await w.heston.query(api.confirm.get, { id });
  return w[who].mutation(api.confirm.confirm, { id, hash: (g?.hash as string | null) ?? "none" });
}

async function setup() {
  const w = await world();
  const mails: Sent[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === "https://api.resend.com/emails") { const b = JSON.parse(String(init?.body)); mails.push({ to: b.to[0], subject: b.subject }); return new Response(JSON.stringify({ id: "em" }), { status: 200 }); }
    return new Response("{}", { status: 500 });
  }));
  // Maya can open the Launch project (an invited project share), so news about it reaches her.
  const shareId = await w.t.run(async (ctx) => {
    const s = await ctx.db.insert("shares", { businessId: w.A, token: "tok-proj-1", kind: "project", projectId: w.p, access: "comment", who: "invited", allVersions: true, downloads: false, emailNewVersions: true, createdAt: 0, createdBy: (await ctx.db.query("users").first())!._id });
    await ctx.db.insert("shareMembers", { businessId: w.A, shareId: s, email: "maya@harbor.example", addedAt: 0 });
    return s;
  });
  const keyA = (await w.heston.action(api.portalKeys.createKey, {})).key as string;
  const keyB = (await w.boss.action(api.portalKeys.createKey, {})).key as string;
  const call = (key: string) => async (name: string, args: Record<string, unknown> = {}) => {
    const r = await w.t.fetch("/portal-mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
    const j = await r.json();
    return { error: j.result.isError === true, text: j.result.content[0].text as string, data: j.result.structuredContent as Record<string, any> };
  };
  const settle = async () => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); await w.t.finishAllScheduledFunctions(vi.runAllTimers); vi.useRealTimers(); };
  return { w, shareId, a: call(keyA), b: call(keyB), mails, settle, keyA };
}

describe("Phase 8b · the site through the connector", () => {
  test("T8b.1 every action is a real site function with arguments Claude can read; the four tools are listed", async () => {
    for (const [name, e] of Object.entries(ACTIONS)) {
      expect(typeof e.fn?._handler, name).toBe("function");
      expect(argsOf(name).type, name).toBe("object");
      const want = e.mode === "read" ? "isQuery" : e.onPage ? "isAction" : "isMutation";
      expect(e.fn[want], `${name} is a ${e.mode}${e.onPage ? " run from the Confirm page" : ""} but the site function isn't the right kind`).toBe(true);
      if (e.onPage) expect(e.mode === "ask" && typeof e.shows === "function", `${name} runs on the page, so it's an ask that shows what it sends`).toBe(true);
    }
    const x = await setup();
    const list = await x.w.t.fetch("/portal-mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${x.keyA}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    const names = (await list.json()).result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(["site_actions", "site_read", "site_change", "site_ask"]));
    const all = await x.a("site_actions");
    expect(all.data.actions.length).toBe(Object.keys(ACTIONS).length);
    const prod = await x.a("site_actions", { area: "production" });
    const sl = prod.data.actions.find((r: { action: string }) => r.action === "shotLists.addShots");
    expect(sl).toMatchObject({ kind: "change", args: { type: "object", required: expect.arrayContaining(["setupId", "text"]) } });
    expect((await x.a("site_actions", { action: "shoots.schedule" })).data).toMatchObject({ kind: "ask", note: expect.stringMatching(/client's people/) });
  });

  test("T8b.2 reads are the owner's own view, of the key's business only", async () => {
    const x = await setup();
    const listId = await x.w.heston.mutation(api.shotLists.create, { projectId: x.w.p, title: "Day 1" }) as string;
    const mine = await x.a("site_read", { action: "shotLists.get", args: { listId } });
    expect(mine.error).toBe(false);
    expect(mine.data.result).toMatchObject({ total: 0 });
    expect((await x.a("site_read", { action: "shotLists.all" })).data.result).toEqual(await x.w.heston.query(api.shotLists.all, {}));
    // Another business's key: A's list isn't there for it.
    const theirs = await x.b("site_read", { action: "shotLists.get", args: { listId } });
    expect(theirs.error ? theirs.text : JSON.stringify(theirs.data.result)).toMatch(/isn't here|not found|null|doesn't exist|Not allowed/i);
    expect(JSON.stringify((await x.b("site_read", { action: "shotLists.all" })).data.result)).not.toContain(listId);
    // A read can't change anything.
    expect((await x.a("site_read", { action: "shotLists.create", args: { projectId: x.w.p } })).text).toMatch(/changes things/);
  });

  test("T8b.3 a change is made at once as the owner, shows in Activity as Claude's, and never reaches another business", async () => {
    const x = await setup();
    const made = await x.a("site_change", { action: "shotLists.create", args: { projectId: x.w.p, title: "Day 1" } });
    expect(made.error).toBe(false);
    const listId = made.data.result as string;
    const setupId = (await x.a("site_change", { action: "shotLists.addSetup", args: { listId, start: "07:30", end: "08:30", title: "Lobby" } })).data.result as string;
    expect((await x.a("site_change", { action: "shotLists.addShots", args: { setupId, text: "1 Exterior\n2 Signage" } })).data.result).toEqual({ added: 2, numbers: [1, 2] });
    const l = await x.w.heston.query(api.shotLists.get, { listId });
    expect(l.total).toBe(2);
    const rows = await x.w.t.run(async (ctx) => ({ list: await ctx.db.get(listId as Id<"shotLists">), log: await ctx.db.query("auditLog").collect() }));
    expect(rows.list!.businessId).toBe(x.w.A);
    expect(rows.log.filter((r) => r.who === "Claude").map((r) => r.text)).toEqual(expect.arrayContaining([expect.stringMatching(/changed on the site: Make a shot list/), expect.stringMatching(/Add shots/)]));
    // Another business's key can't touch A's list, and A's list is unchanged.
    const other = await x.b("site_change", { action: "shotLists.addShots", args: { setupId, text: "3 Sneaky" } });
    expect(other.error).toBe(true);
    expect((await x.w.heston.query(api.shotLists.get, { listId })).total).toBe(2);
    // B's own change lands in B.
    const theirs = (await x.b("site_change", { action: "shotLists.create", args: { title: "Their list" } })).data.result as string;
    expect((await x.w.t.run((ctx) => ctx.db.get(theirs as Id<"shotLists">)))!.businessId).not.toBe(x.w.A);
  });

  test("T8b.4 a change that would send something is undone, and Claude is told what it would have sent", async () => {
    const x = await setup();
    const r = await x.a("site_change", { action: "projects.setStage", args: { projectId: x.w.p, stage: "production", post: true, note: "Shooting next week" } });
    expect(r.error).toBe(true);
    expect(r.text).toMatch(/Nothing was changed: this would send Inbox post to .*maya@harbor\.example.*site_ask/);
    const after = await x.w.t.run(async (ctx) => ({ p: await ctx.db.get(x.w.p), inbox: await ctx.db.query("inboxItems").collect() }));
    expect(after.p!.stage).toBeUndefined();
    expect(after.inbox).toHaveLength(0);
    // Without posting it's a plain change.
    expect((await x.a("site_change", { action: "projects.setStage", args: { projectId: x.w.p, stage: "strategy", post: false } })).error).toBe(false);
    expect((await x.w.t.run((ctx) => ctx.db.get(x.w.p)))!.stage).toBe("strategy");
    // An ask or a delete is never a direct change.
    expect((await x.a("site_change", { action: "shoots.schedule", args: {} })).text).toMatch(/needs Heston/);
    expect((await x.a("site_change", { action: "shotLists.remove", args: { listId: "x" } })).text).toMatch(/needs Heston/);
    // A change whose arguments reach someone is an ask.
    expect((await x.a("site_change", { action: "work.create", args: { title: "Send logo files", audience: "client", home: { type: "project", id: x.w.p } } })).text).toMatch(/shows in their portal.*site_ask/);
  });

  test("T8b.5 an ask is tried and undone; Confirm shows who it reaches; it happens only on Heston's Confirm; a different reach is refused", async () => {
    const x = await setup();
    const args = { projectId: x.w.p, date: day(5), call: "07:00", wrap: "17:00", location: "Harbor Coffee, 412 Main St.", prepare: ["Lights on by 7"], withOwner: true, bookingIds: [], calendar: false };
    expect((await x.a("site_ask", { action: "shoots.schedule", args })).text).toMatch(/Ask Heston first/);
    const r = await x.a("site_ask", { action: "shoots.schedule", args, heston_ok: "yes, schedule the Harbor shoot" });
    expect(r.error).toBe(false);
    expect(r.data.what_goes_out).toEqual(expect.arrayContaining([
      { label: "Does", value: "Schedule a shoot" },
      expect.objectContaining({ label: "Sends", value: expect.stringMatching(/maya@harbor\.example/) }),
      expect.objectContaining({ label: "Details", value: expect.stringMatching(/projectId: Launch/) }),
    ]));
    await x.settle();
    // Nothing happened yet: no shoot, no email.
    expect(await x.w.t.run((ctx) => ctx.db.query("shoots").collect())).toHaveLength(0);
    expect(x.mails).toHaveLength(0);
    // Only the owner, signed in, can confirm it.
    await expect(confirmAs(x.w, r.data.request_id, "boss")).rejects.toThrow();
    await expect(confirmAs(x.w, r.data.request_id, "maya")).rejects.toThrow();
    await confirmAs(x.w, r.data.request_id);
    await x.settle();
    expect(await x.w.t.run((ctx) => ctx.db.query("shoots").collect())).toHaveLength(1);
    expect(x.mails.map((m) => m.to)).toContain("maya@harbor.example");
    expect((await x.a("request_status", { request_id: r.data.request_id })).data.status).toBe("done");

    // A second ask, then Jo is given the project too: it would now reach someone else, so Confirm refuses.
    const r2 = await x.a("site_ask", { action: "shoots.schedule", args: { ...args, date: day(6) }, heston_ok: "yes, day 2 too" });
    expect(r2.error).toBe(false);
    await x.w.t.run(async (ctx) => { await ctx.db.insert("shareMembers", { businessId: x.w.A, shareId: x.shareId, email: "jo@harbor.example", addedAt: 1 }); });
    await expect(confirmAs(x.w, r2.data.request_id)).rejects.toThrow(/different people/);
    expect(await x.w.t.run((ctx) => ctx.db.query("shoots").collect())).toHaveLength(1);
    // The site's own reason comes back when it can't be done at all.
    const bad = await x.a("site_ask", { action: "shoots.schedule", args: { ...args, location: "  " }, heston_ok: "yes" });
    expect(bad.error).toBe(true);
    expect(bad.text).toMatch(/where/i);
  });

  test("T8b.6 deletes are asks, and happen on Confirm", async () => {
    const x = await setup();
    const listId = await x.w.heston.mutation(api.shotLists.create, { projectId: x.w.p, title: "Old list" }) as string;
    const r = await x.a("site_ask", { action: "shotLists.remove", args: { listId }, heston_ok: "delete the old list" });
    expect(r.error).toBe(false);
    expect(r.data.what_goes_out).toEqual(expect.arrayContaining([{ label: "Deletes", value: "Old list" }, { label: "Sends", value: "No email or message" }]));
    expect(await x.w.t.run((ctx) => ctx.db.get(listId as Id<"shotLists">))).not.toBeNull();
    await confirmAs(x.w, r.data.request_id);
    expect(await x.w.t.run((ctx) => ctx.db.get(listId as Id<"shotLists">))).toBeNull();
    expect((await x.w.t.run((ctx) => ctx.db.query("auditLog").collect())).map((l) => l.text)).toEqual(expect.arrayContaining([expect.stringMatching(/confirmed Claude's request: Delete a shot list: Old list/)]));
    // A change that sends nothing isn't an ask.
    expect((await x.a("site_ask", { action: "shotLists.create", args: { projectId: x.w.p }, heston_ok: "okay do it" })).text).toMatch(/sends nothing.*site_change/);
  });

  test("T8b.7 never through it: a project moved to another client, W-9s and bank details, unknown actions and wrong arguments", async () => {
    const x = await setup();
    expect((await x.a("site_change", { action: "library.renameProject", args: { projectId: x.w.p, name: "Launch", client: "Someone Else" } })).text).toMatch(/done by Heston on the site/);
    expect((await x.w.t.run((ctx) => ctx.db.get(x.w.p)))!.clientId).toBe(x.w.harbor);
    // A vendor with a W-9 and a bank on file: Claude sees only that they're on file.
    const vendorId = await x.w.heston.mutation(api.vendors.add, { name: "Jordan Ellis", email: "jordan@ellisfilms.com", roles: ["Shooter"], rates: [], invite: false }) as Id<"vendors">;
    await x.w.t.run(async (ctx) => {
      const fileId = await ctx.storage.store(new Blob(["%PDF-1.4 w9"], { type: "application/pdf" }));
      await ctx.db.patch(vendorId, { w9: { fileId, name: "w9-jordan.pdf", uploadedAt: 1 } } as never);
    });
    const v = await x.a("site_read", { action: "vendors.get", args: { vendorId } });
    expect(v.error).toBe(false);
    const text = JSON.stringify(v.data);
    expect(text).not.toContain("w9-jordan.pdf");
    expect(text).toContain("Jordan Ellis");
    expect((await x.a("site_read", { action: "vendors.w9Link", args: {} })).text).toMatch(/no action called/);
    expect((await x.a("site_change", { action: "releases.handOver", args: {} })).text).toMatch(/no action called/);
    expect((await x.a("site_change", { action: "shotLists.addShots", args: { setupId: "nope", text: 3 } })).text).toMatch(/args\.(setupId|text) should be/);
    expect((await x.a("site_change", { action: "shotLists.create", args: { projectId: x.w.p, sneaky: true } })).text).toMatch(/sneaky isn't one of/);
    expect((await x.a("site_change", { action: "toString", args: {} })).text).toMatch(/no action called/);
  });

  test("T8b.8 with its own key every action runs as the owner (none is refused for want of access)", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 }));
    process.env.CONVEX_SITE_URL = "https://x.convex.site";
    const { t, ids } = await matrixSetup();
    const sub = await t.run(async (ctx) => { const u = (await ctx.db.query("users").withIndex("email", (q) => q.eq("email", "heston@wranglerproductions.com")).first())!; return `${u._id}|${await ctx.db.insert("authSessions", { userId: u._id, expirationTime: Date.now() + 3_600_000 })}`; });
    const key = (await t.withIdentity({ subject: sub }).action(api.portalKeys.createKey, {})).key as string;
    const table = argsFor(ids);
    let worked = 0;
    const refused: string[] = [];
    for (const [name, e] of Object.entries(ACTIONS)) {
      const tool = e.mode === "read" ? "site_read" : e.mode === "change" ? "site_change" : "site_ask";
      const r = await t.fetch("/portal-mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: { action: name, args: table[name] ?? {}, heston_ok: "yes, go ahead" } } }) });
      const j = await r.json();
      if (!j.result.isError) worked++;
      else if (/Not allowed|Sign in first|can't act as|hasn't signed in|should be|isn't one of|is needed/.test(j.result.content[0].text)) refused.push(`${name}: ${j.result.content[0].text.slice(0, 120)}`);
    }
    expect(refused).toEqual([]);
    expect(worked).toBeGreaterThan(Object.keys(ACTIONS).length * 0.75);
  });

  test("T8b.9 review fixes: every address is counted; what reopens or widens access asks; Confirm says why; releases stay out", async () => {
    // H1: any address field counts, whatever its shape; a long list says there are more.
    expect([...peopleIn({ recipients: [{ email: "x&y@evil.example", name: "X" }, { email: "talent@ok.example" }], to: "odd@host" })].sort())
      .toEqual(["X <x&y@evil.example>", "odd@host", "talent@ok.example"]);
    expect(peopleIn({ guests: Array.from({ length: 2100 }, (_, i) => `p${i}@x.example`) }).has("(and more)")).toBe(true);
    // L2: link tokens, how a vendor is paid and secrets stay out; hidden fields too.
    expect(scrub({ token: "abc", link: "https://app.wranglerportal.com/x", payMethod: { method: "Zelle" }, address: "1 Main", nested: { tokens: ["a"] } }, ["address"]))
      .toEqual({ token: "(on file)", link: "https://app.wranglerportal.com/x", payMethod: "(on file)", address: "(on file)", nested: { tokens: "(on file)" } });

    const x = await setup();
    // H2: adding a final file is an ask.
    expect((await x.a("site_change", { action: "projects.addDeliveryFile", args: { projectId: x.w.p, path: "/Other/payroll.pdf", name: "payroll.pdf" } })).text).toMatch(/needs Heston/);
    // H3: a board shared by its link: saving it is an ask, and the Confirm page says why.
    const canvasId = await x.w.heston.mutation(api.canvas.create, { name: "Moodboard", kind: "canvas" }) as string;
    await x.w.heston.mutation(api.canvas.setLink, { canvasId, on: true });
    const save = await x.a("site_change", { action: "canvas.save", args: { canvasId, items: [], rev: 0 } });
    expect(save.text).toMatch(/This board is shared.*site_ask/);
    // M6: a link turned on asks, and the page says why it asks.
    await x.w.heston.mutation(api.canvas.setLink, { canvasId, on: false });
    const on = await x.a("site_ask", { action: "canvas.setLink", args: { canvasId, on: true }, heston_ok: "turn the link on" });
    expect(on.error).toBe(false);
    expect(on.data.what_goes_out).toEqual(expect.arrayContaining([{ label: "Why it asks", value: expect.stringMatching(/anyone with it/) }, { label: "Details", value: expect.stringMatching(/canvasId: Moodboard/) }]));
    const page = await x.w.heston.query(api.confirm.get, { id: on.data.request_id });
    expect(page.preview.bind).toBeUndefined(); // L6: the records themselves never go to the page
    expect(page.preview.open).toBe(`/creative/canvas/${canvasId}`);
    // M1–M3: restoring a vendor, re-ticking someone, letting an outsider edit, reopening a delivered project: all asks.
    const vendorId = await x.w.heston.mutation(api.vendors.add, { name: "Jordan Ellis", email: "jordan@ellisfilms.com", roles: ["Shooter"], rates: [], invite: false }) as string;
    await x.w.heston.mutation(api.vendors.archive, { vendorId, archived: true });
    expect((await x.a("site_change", { action: "vendors.archive", args: { vendorId, archived: false } })).text).toMatch(/gives them their portal back/);
    const real = await x.w.t.run(async (ctx) => {
      const sh = await ctx.db.insert("shoots", { businessId: x.w.A, projectId: x.w.p, date: "2030-01-03", call: "08:00", location: "Here", prepare: [], crew: [], status: "scheduled", history: [], createdAt: 0, updatedAt: 0 } as never);
      const cs = await ctx.db.insert("callSheets", { businessId: x.w.A, shootId: sh, projectId: x.w.p, how: "blank", status: "draft", updates: 0, recipients: [], history: [], createdAt: 0, updatedAt: 0 } as never);
      const person = await ctx.db.insert("canvasPeople", { businessId: x.w.A, canvasId: canvasId as Id<"canvases">, email: "pal@x.example", role: "view", token: "pal-token-1234567890", createdAt: 0 });
      return { cs, person, sh };
    });
    expect((await x.a("site_change", { action: "callSheets.toggle", args: { callSheetId: real.cs, id: "crew:1", on: true } })).text).toMatch(/back on a call sheet/);
    expect((await x.a("site_change", { action: "canvas.setRole", args: { personId: real.person, role: "edit" } })).text).toMatch(/edit the board/);
    expect((await x.a("site_change", { action: "briefings.setLinkExpiry", args: { briefingId: "x", days: null } })).text).toMatch(/needs Heston/);
    expect((await x.a("site_change", { action: "places.useForShoot", args: { placeId: "x", shootId: real.sh, asPlace: true } })).text).toMatch(/moves the shoot/);
    await x.w.t.run(async (ctx) => { await ctx.db.patch(x.w.p, { stage: "delivery" }); });
    expect((await x.a("site_change", { action: "projects.setStage", args: { projectId: x.w.p, stage: "polish", post: false } })).text).toMatch(/opens it again/);
    // M4: a task the client sees: editing it asks.
    const taskId = await x.w.heston.mutation(api.work.create, { title: "Send logo files", audience: "client", home: { type: "project", id: x.w.p } }) as string;
    expect((await x.a("site_change", { action: "work.update", args: { taskId, title: "Pay at evil.example" } })).text).toMatch(/shows in the client's/);
    expect((await x.w.t.run((ctx) => ctx.db.get(taskId as Id<"tasks">)))!.title).toBe("Send logo files");
    // L1: built-in names are not fields.
    expect((await x.a("site_change", { action: "shotLists.create", args: { projectId: x.w.p, constructor: 1 } })).text).toMatch(/constructor isn't one of/);
    // L4: a release's page can't be read or changed through Sign's draft tools.
    const buildId = await x.w.heston.mutation(api.builder.createBuild, { blank: true }) as Id<"wsBuilds">;
    await x.w.t.run(async (ctx) => { await ctx.db.insert("releases", { businessId: x.w.A, kind: "talent", name: "Riley", email: "riley@x.example", shotIds: [], buildId, createdAt: 0, updatedAt: 0 } as never); });
    expect((await x.a("get_draft", { draft: buildId })).text).toMatch(/signed in person/);
    expect((await x.a("update_draft", { draft: buildId, title: "Changed" })).text).toMatch(/signed in person/);
  });

  test("T8b.10 re-review: a shared board's Confirm page lists what goes on it, docs by name; another business learns nothing from the checks", async () => {
    const x = await setup();
    const canvasId = await x.w.heston.mutation(api.canvas.create, { name: "Moodboard", kind: "canvas" }) as string;
    await x.w.heston.mutation(api.canvas.setLink, { canvasId, on: true });
    const { docId } = await x.w.heston.mutation(api.creative.newDoc, { kind: "treatment", title: "Other client's secret treatment" }) as { docId: string };
    const items = [{ id: "n1", type: "note", x: 0, y: 0, w: 100, h: 100, z: 1, text: "Call me" }, { id: "d1", type: "doc", docId, x: 200, y: 0, w: 560, h: 724, z: 2 }];
    const r = await x.a("site_ask", { action: "canvas.save", args: { canvasId, items, rev: 0 }, heston_ok: "save the board" });
    expect(r.error).toBe(false);
    const on = r.data.what_goes_out.find((l: { label: string }) => l.label === "On the board");
    expect(on.value).toMatch(/Adds note: “Call me”/);
    expect(on.value).toMatch(/Adds doc: the treatment doc “Other client's secret treatment”/);
    expect(r.data.what_goes_out).toEqual(expect.arrayContaining([{ label: "Why it asks", value: expect.stringMatching(/shared/) }]));
    // Another business's key: A's shared board answers as any board it can't see.
    const theirs = await x.b("site_change", { action: "canvas.save", args: { canvasId, items: [], rev: 0 } });
    expect(theirs.error).toBe(true);
    expect(theirs.text).not.toMatch(/shared/);
    const taskId = await x.w.heston.mutation(api.work.create, { title: "Client task", audience: "client", home: { type: "project", id: x.w.p } }) as string;
    expect((await x.b("site_change", { action: "work.done", args: { taskId, done: true } })).text).not.toMatch(/client's/);
  });
});
