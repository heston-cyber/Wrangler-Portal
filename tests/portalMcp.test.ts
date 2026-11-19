// Phase 8a (Heston, Nov 18: "Approved"): the one Wrangler Portal connector (/portal-mcp, wp_ keys).
//   T8.1 Review's and Sign's tools all answer on it, unchanged; old keys don't open it and its key doesn't open them.
//   T8.2 a key sees and changes only its own business.
//   T8.3 a send is only a request: nothing goes until the owner, signed in, presses Confirm; another business's owner,
//        a client and the connector itself can't press it.
//   D207 only the business owner makes, sees and revokes keys.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { world } from "./payHarness";
import { TOOLS as REVIEW_TOOLS } from "../convex/mcp";
import { TOOLS as SIGN_TOOLS } from "../convex/wsMcp";

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

async function setup() {
  const w = await world();
  const mails: Sent[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === "https://api.resend.com/emails") { const b = JSON.parse(String(init?.body)); mails.push({ to: b.to[0], subject: b.subject }); return new Response(JSON.stringify({ id: "em" }), { status: 200 }); }
    return new Response("{}", { status: 500 });
  }));
  // Maya can see Harbor Coffee's portal (an accepted invite), so a note to Harbor reaches her.
  const B = await w.t.run(async (ctx) => {
    await ctx.db.insert("invites", { businessId: w.A, email: "maya@harbor.example", createdAt: 0, acceptedAt: 1 } as never);
    const pr = await ctx.db.insert("projects", { businessId: w.A, name: "Launch film", clientId: w.harbor, createdAt: 0 } as never);
    await ctx.db.insert("videos", { businessId: w.A, projectId: pr, title: "Harbor launch cut", createdAt: 0, updatedAt: 0 });
    return (await ctx.db.query("businesses").withIndex("by_slug", (q) => q.eq("slug", "other")).unique())!._id;
  });
  const keyA = (await w.heston.action(api.portalKeys.createKey, {})).key as string;
  const keyB = (await w.boss.action(api.portalKeys.createKey, {})).key as string;
  const rpc = async (body: unknown, auth: string | null, path = "/portal-mcp") => {
    const r = await w.t.fetch(path, { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body) });
    const txt = await r.text();
    return { status: r.status, j: txt ? JSON.parse(txt) : null };
  };
  const callAs = (key: string) => async (name: string, args: Record<string, unknown> = {}) => {
    const r = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, key);
    return { error: r.j.result.isError === true, text: r.j.result.content[0].text as string, data: r.j.result.structuredContent as Record<string, any> };
  };
  const settle = async () => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); await w.t.finishAllScheduledFunctions(vi.runAllTimers); vi.useRealTimers(); };
  return { w, B, keyA, keyB, rpc, a: callAs(keyA), b: callAs(keyB), mails, settle };
}

describe("Phase 8a · the one connector", () => {
  test("D207 only the business owner makes, sees and revokes keys; each key is its own business's", async () => {
    const x = await setup();
    const rows = await x.w.t.run((ctx) => ctx.db.query("portalKeys").collect());
    expect(rows.map((r) => r.businessId).sort()).toEqual([x.w.A, x.B].sort());
    expect(rows.every((r) => r.hash.length === 64 && !JSON.stringify(r).includes(x.keyA))).toBe(true); // only a hash is kept
    const mine = await x.w.heston.query(api.portalKeys.listKeys, {});
    expect(mine).toHaveLength(1);
    expect(await x.w.boss.query(api.portalKeys.listKeys, {})).toHaveLength(1); // B's own, not A's
    await expect(x.w.boss.mutation(api.portalKeys.revokeKey, { keyId: mine[0]._id })).rejects.toThrow(/isn't here/);
    for (const who of [x.w.maya, x.w.t]) {
      await expect(who.action(api.portalKeys.createKey, {})).rejects.toThrow();
      await expect(who.query(api.portalKeys.listKeys, {})).rejects.toThrow();
    }
    // Revoked: the connector stops answering to it at once.
    await x.w.heston.mutation(api.portalKeys.revokeKey, { keyId: mine[0]._id });
    expect((await x.rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, x.keyA)).status).toBe(401);
    expect((await x.w.t.run((ctx) => ctx.db.query("auditLog").collect())).map((r) => r.text)).toEqual(expect.arrayContaining([expect.stringMatching(/made a Claude connector key/), expect.stringMatching(/revoked a Claude connector key/)]));
  });

  test("T8.1 Review's and Sign's tools are all here; the old keys don't open it, and its key doesn't open the old two", async () => {
    const x = await setup();
    const list = await x.rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, x.keyA);
    const names: string[] = list.j.result.tools.map((t: { name: string }) => t.name);
    for (const t of [...REVIEW_TOOLS, ...SIGN_TOOLS]) expect(names).toContain(t.name);
    expect(names).toEqual(expect.arrayContaining(["guide", "send_client_note", "request_status"]));
    expect(names.filter((n) => /confirm/.test(n))).toEqual([]); // no tool can press Confirm
    const init = await x.rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } }, x.keyA);
    expect(init.j.result.serverInfo.name).toBe("wrangler-portal");
    expect(init.j.result.instructions).toMatch(/ask Heston in this chat first/);
    expect((await x.rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, null)).status).toBe(401);
    const wr = (await x.w.heston.action(api.connector.createKey, {})).key as string;
    expect((await x.rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, wr)).status).toBe(401); // a Review key
    expect((await x.rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, x.keyA, "/mcp")).status).toBe(401); // its key on Review's
    expect((await x.rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, x.keyA, "/ws-mcp")).status).toBe(401); // and on Sign's
    // The key on the end of the address works too (Heston's Claude has no Request headers).
    expect((await x.rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, null, `/portal-mcp/${x.keyA}`)).status).toBe(200);
    const g = await x.a("guide");
    expect(g.error).toBe(false);
    expect(g.data.never).toEqual(expect.arrayContaining([expect.stringMatching(/moving money/), expect.stringMatching(/signing for Heston/)]));
    const fv = await x.a("find_videos");
    expect(fv.error, fv.text).toBe(false);
    expect(fv.text).toContain("Harbor launch cut");
    expect((await x.a("list_documents")).error).toBe(false);
    // Sign's reminder emailed straight away on the old connector; here it's a request and needs Heston's words.
    const remind = list.j.result.tools.find((t: { name: string }) => t.name === "send_reminder");
    expect(remind.inputSchema.required).toContain("heston_ok");
    expect((await x.a("send_reminder", { document: "WS-00001", signer: "client" })).error).toBe(true);
    expect(await x.w.t.run((ctx) => ctx.db.query("pendingActions").collect())).toEqual([]);
  });

  test("T8.2 a key sees and changes only its own business", async () => {
    const x = await setup();
    const fv = await x.b("find_videos");
    expect(fv.text).not.toContain("Harbor launch cut");
    const inbox = await x.b("get_client_inbox", { client: "Harbor Coffee" });
    expect(inbox.error).toBe(true); // B has no such client
    const d = await x.b("draft_client_note", { client: "Harbor Coffee", title: "Hi", text: "x", said: "Heston: draft it" });
    expect(d.error).toBe(true);
    expect(await x.w.t.run((ctx) => ctx.db.query("inboxNotes").collect())).toEqual([]);
  });

  test("T8.3 a send is a request until the owner presses Confirm; nobody else (and no tool) can press it", async () => {
    const x = await setup();
    const d = await x.a("draft_client_note", { client: "Harbor Coffee", title: "Cut 2 is up", text: "Have a look when you can.", said: "Heston: tell Harbor cut 2 is up" });
    expect(d.error, d.text).toBe(false);
    const noteId = d.data.noteId as Id<"inboxNotes">;
    // Without Heston's words: refused, nothing made.
    expect((await x.a("send_client_note", { note_id: noteId })).error).toBe(true);
    expect(await x.w.t.run((ctx) => ctx.db.query("pendingActions").collect())).toEqual([]);
    // Another business's key can't even ask for A's note.
    expect((await x.b("send_client_note", { note_id: noteId, heston_ok: "send it" })).error).toBe(true);
    // A request: nothing is posted or emailed yet.
    const r = await x.a("send_client_note", { note_id: noteId, heston_ok: "yes, send it to Harbor" });
    expect(r.error, r.text).toBe(false);
    expect(r.data).toMatchObject({ summary: "Send the note “Cut 2 is up” to Harbor Coffee", status: "waiting for Heston", expires_in_hours: 24 });
    expect(r.data.confirm_at).toBe(`https://app.wranglerportal.com/confirm/${r.data.request_id}`);
    await x.settle();
    expect(x.mails).toEqual([]);
    expect(await x.w.t.run((ctx) => ctx.db.query("inboxItems").collect())).toEqual([]);
    expect((await x.a("request_status", { request_id: r.data.request_id })).data).toMatchObject({ status: "waiting" });
    // Review H1: the Confirm page shows exactly what goes out, read live: the whole text, who it reaches, the email.
    const page = await x.w.heston.query(api.confirm.get, { id: r.data.request_id });
    expect(page.changed).toBe(false);
    expect(page.said).toBe("yes, send it to Harbor");
    const line = (l: string) => page.preview.lines.find((y: { label: string }) => y.label === l)?.value;
    expect(line("Text")).toBe("Have a look when you can.");
    expect(line("Reaches")).toContain("maya@harbor.example");
    expect(line("Email")).toMatch(/email/);
    // The Dashboard shows it to the owner only.
    expect((await x.w.heston.query(api.confirm.waiting, {})).map((q: { summary: string }) => q.summary)).toEqual(["Send the note “Cut 2 is up” to Harbor Coffee"]);
    expect(await x.w.boss.query(api.confirm.waiting, {})).toEqual([]);
    expect(await x.w.maya.query(api.confirm.waiting, {})).toEqual([]);
    // Nobody but the owner presses Confirm: not B's owner, not the client, not someone signed out.
    expect(await x.w.boss.query(api.confirm.get, { id: r.data.request_id })).toBeNull();
    await expect(x.w.boss.mutation(api.confirm.confirm, { id: r.data.request_id })).rejects.toThrow(/isn't here/);
    await expect(x.w.maya.mutation(api.confirm.confirm, { id: r.data.request_id })).rejects.toThrow();
    await expect(x.w.t.mutation(api.confirm.confirm, { id: r.data.request_id })).rejects.toThrow();
    // Heston confirms: it goes exactly as the site's Send does.
    const sent = await x.w.heston.mutation(api.confirm.confirm, { id: r.data.request_id });
    expect(sent).toMatchObject({ ok: true });
    expect(sent.sent).toBeGreaterThan(0);
    await x.settle();
    expect(x.mails.map((m) => m.to)).toContain("maya@harbor.example");
    expect(await x.w.t.run((ctx) => ctx.db.query("inboxItems").collect())).toHaveLength(sent.sent);
    expect((await x.w.t.run((ctx) => ctx.db.get(noteId)))!.status).toBe("sent");
    expect((await x.a("request_status", { request_id: r.data.request_id })).data.status).toBe("done");
    await expect(x.w.heston.mutation(api.confirm.confirm, { id: r.data.request_id })).rejects.toThrow(/already done/);
    // Activity: Claude's change, and Heston's Confirm.
    const log = (await x.w.t.run((ctx) => ctx.db.query("auditLog").collect())).map((l) => `${l.kind}|${l.who}|${l.text}`);
    expect(log).toEqual(expect.arrayContaining([expect.stringMatching(/^claude\|Claude\|Draft a note/), expect.stringMatching(/^sent\|Heston\|confirmed Claude's request: Send the note/)]));
  });

  test("T8.3 a request runs out after 24 hours, can be cancelled, and the same ask twice is one request", async () => {
    const x = await setup();
    const d = await x.a("draft_client_note", { client: "Harbor Coffee", title: "Hello", text: "x", said: "Heston: draft" });
    const ask = () => x.a("send_client_note", { note_id: d.data.noteId, heston_ok: "send it" });
    const r1 = await ask(), r2 = await ask();
    expect(r2.data.request_id).toBe(r1.data.request_id);
    await x.w.t.run(async (ctx) => { for (const p of await ctx.db.query("pendingActions").collect()) await ctx.db.patch(p._id, { expiresAt: Date.now() - 1 }); });
    await expect(x.w.heston.mutation(api.confirm.confirm, { id: r1.data.request_id })).rejects.toThrow(/ran out/);
    expect((await x.a("request_status", { request_id: r1.data.request_id })).data.status).toBe("expired");
    const r3 = await ask(); // asked again after it ran out: a new request
    expect(r3.data.request_id).not.toBe(r1.data.request_id);
    await x.w.heston.mutation(api.confirm.cancel, { id: r3.data.request_id });
    await expect(x.w.heston.mutation(api.confirm.confirm, { id: r3.data.request_id })).rejects.toThrow(/cancelled/);
    expect((await x.w.t.run((ctx) => ctx.db.get(d.data.noteId as Id<"inboxNotes">)))!.status).toBe("draft");
  });

  test("review H1: a draft changed after Claude asked can't be confirmed as asked", async () => {
    const x = await setup();
    const d = await x.a("draft_client_note", { client: "Harbor Coffee", title: "Cut 2 is up", text: "Have a look.", said: "Heston: draft" });
    expect(d.data.next).toMatch(/send_client_note/); // review L6: this connector's way to send it
    const r = await x.a("send_client_note", { note_id: d.data.noteId, heston_ok: "send it" });
    // Someone (Claude, or a team member) changes the body and adds a link after the ask.
    await x.w.t.run((ctx) => ctx.db.patch(d.data.noteId as Id<"inboxNotes">, { text: "Our bank details changed, pay here", link: "https://evil.example/pay" }));
    const page = await x.w.heston.query(api.confirm.get, { id: r.data.request_id });
    expect(page.changed).toBe(true);
    expect(page.preview.lines.find((l: { label: string }) => l.label === "Link").value).toBe("https://evil.example/pay");
    await expect(x.w.heston.mutation(api.confirm.confirm, { id: r.data.request_id })).rejects.toThrow(/changed since Claude asked/);
    expect((await x.w.t.run((ctx) => ctx.db.get(d.data.noteId as Id<"inboxNotes">)))!.status).toBe("draft");
    await x.settle();
    expect(x.mails).toEqual([]);
  });

  test("review M3, H2, M2: a version's description waits for Confirm; no project moves to a client; no PDF fetched from a link", async () => {
    const x = await setup();
    // M3: the description is a request; it changes only on Confirm.
    expect((await x.a("set_version_description", { video: "Harbor launch cut", description: "Tightened the open" })).error).toBe(true); // no heston_ok
    const ver = await x.w.t.run(async (ctx) => {
      const vid = (await ctx.db.query("videos").collect())[0];
      return ctx.db.insert("versions", { businessId: x.w.A, videoId: vid._id, number: 1, status: "ready", bunnyGuid: "g", fileName: "a.mp4", startTimecode: "01:00:00:00", createdAt: 0 } as never);
    });
    const r = await x.a("set_version_description", { video: "Harbor launch cut", description: "Tightened the open", heston_ok: "yes, add that" });
    expect(r.error, r.text).toBe(false);
    expect((await x.w.t.run((ctx) => ctx.db.get(ver)))!.description).toBeUndefined();
    await x.w.heston.mutation(api.confirm.confirm, { id: r.data.request_id });
    expect((await x.w.t.run((ctx) => ctx.db.get(ver)))!.description).toBe("Tightened the open");
    // H2: registering under a client never moves an existing project; a new project can still be made under one.
    const before = await x.w.t.run(async (ctx) => (await ctx.db.query("projects").collect()).map((p) => [p.name, p.clientId ?? null]));
    const moved = await x.a("register_video", { title: "Teaser", project: "Launch film", client: "Northline" });
    expect(moved.error).toBe(true);
    expect(moved.text).toMatch(/moves it; Heston does that on the site/);
    const older = await x.a("add_to_register", { video: "Harbor launch cut", short_title: "HarborLaunch", client: "Northline" } as Record<string, unknown>);
    expect(older.error, older.text).toBe(false); // numbered; the client argument is ignored here
    expect(await x.w.t.run(async (ctx) => (await ctx.db.query("projects").collect()).map((p) => [p.name, p.clientId ?? null]))).toEqual(before);
    expect((await x.a("register_video", { title: "Promo", project: "Brand new show", client: "Northline" })).error).toBe(false);
    // M2: the server never fetches a link Claude names.
    const f = await x.a("create_document", { title: "X", file_name: "x.pdf", pdf_url: "https://evil.example/collect?d=secret" });
    expect(f.error).toBe(true);
    expect(x.w.t).toBeTruthy();
  });
});
