// Nov 25 (Heston, approved): after the connector asks Heston to confirm something on the site, Claude keeps watching so
// it notices his Confirm without him saying so in chat.
//   C1 request_status with wait answers within moments of Heston's Confirm (and get_document with wait, for a contract)
//   C2 with nothing happening, one watch ends after 50 seconds still waiting, and says to keep watching
//   C3 only this business's own requests: another business's key gets nothing, at once
//   C4 every ask tells Claude to watch, and the connector's rules say so
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import schema from "../convex/schema";
import { world } from "./payHarness";
import { portalKeyFor } from "./portalKeyHelper";
import { POLL_MS, WATCH_MS, keepWatching, watchUntil } from "../convex/lib/watch";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";

const api = anyApi;
beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_ONLY_TO = "";
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fakeFetch = () => vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  return url === "https://api.resend.com/emails" ? new Response(JSON.stringify({ id: "em" }), { status: 200 }) : new Response("{}", { status: 500 });
}));

describe("watching one request", () => {
  test("C2 a watch ends after 50 seconds still busy; it stops the moment the request moves on", async () => {
    let t = 0; const sleeps: number[] = [];
    const clock = { now: () => t, sleep: async (ms: number) => { sleeps.push(ms); t += ms; } };
    const still = await watchUntil(async () => "waiting", (s) => s === "waiting", clock);
    expect(still).toEqual({ last: "waiting", still: true });
    expect(t).toBe(WATCH_MS);
    expect(sleeps.every((ms) => ms <= POLL_MS)).toBe(true);
    t = 0; let reads = 0;
    const moved = await watchUntil(async () => (++reads >= 4 ? "done" : "waiting"), (s) => s === "waiting", clock);
    expect(moved).toEqual({ last: "done", still: false });
    expect(t).toBe(3 * POLL_MS); // answered on the first read after it changed
    expect(keepWatching("waiting for Heston")).toMatch(/^Still waiting for Heston\. Call this again with wait: true .* up to 10 minutes/);
  });
});

describe("the connector watches for Heston's Confirm", () => {
  async function portal() {
    const w = await world();
    fakeFetch();
    await w.t.run(async (ctx) => { await ctx.db.insert("invites", { businessId: w.A, email: "maya@harbor.example", createdAt: 0, acceptedAt: 1 } as never); });
    const keyA = (await w.heston.action(api.portalKeys.createKey, {})).key as string;
    const keyB = (await w.boss.action(api.portalKeys.createKey, {})).key as string;
    const callAs = (key: string) => async (name: string, args: Record<string, unknown> = {}) => {
      const r = await w.t.fetch("/portal-mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
      const j = await r.json();
      return { error: j.result.isError === true, text: j.result.content[0].text as string, data: j.result.structuredContent as Record<string, any> };
    };
    return { w, a: callAs(keyA), b: callAs(keyB), rpc: async (body: unknown) => (await (await w.t.fetch("/portal-mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${keyA}` }, body: JSON.stringify(body) })).json()) };
  }

  test("C1 C3 C4 request_status with wait sees the Confirm within moments; another business can't watch it", async () => {
    const x = await portal();
    const d = await x.a("draft_client_note", { client: "Harbor Coffee", title: "Cut 2 is up", text: "Have a look.", said: "Heston: tell Harbor" });
    const r = await x.a("send_client_note", { note_id: d.data.noteId, heston_ok: "yes, send it" });
    expect(r.error, r.text).toBe(false);
    expect(r.data.next).toContain("request_status with this request_id and wait: true"); // C4
    // C3: another business's key gets nothing, without waiting.
    const started = Date.now();
    const other = await x.b("request_status", { request_id: r.data.request_id, wait: true });
    expect(other.error).toBe(true);
    expect(other.text).toMatch(/isn't here/);
    expect(Date.now() - started).toBeLessThan(POLL_MS);
    // C1: Claude watches; Heston confirms on the site a moment later; the watch answers right after.
    const watching = x.a("request_status", { request_id: r.data.request_id, wait: true });
    await pause(600);
    const g = await x.w.heston.query(api.confirm.get, { id: r.data.request_id });
    const t0 = Date.now();
    await x.w.heston.mutation(api.confirm.confirm, { id: r.data.request_id, hash: g.hash });
    const seen = await watching;
    expect(Date.now() - t0).toBeLessThan(POLL_MS + 1500);
    expect(seen.data).toMatchObject({ status: "done", next: "Tell Heston how it went." });
    // Without wait, it still answers at once.
    expect((await x.a("request_status", { request_id: r.data.request_id })).data.status).toBe("done");
  }, 20_000);

  test("C4 the rules and the guide tell Claude to watch after every ask", async () => {
    const x = await portal();
    const init = await x.rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    expect(init.result.instructions).toContain("Then keep watching without waiting for him to tell you: call request_status with wait: true (for a contract's approve, send or cancel, get_document with wait: true), again each time it comes back still waiting, for up to 10 minutes");
    expect(init.result.instructions).toContain("then call get_document with wait: true, again while its newest request is still pending, for up to 10 minutes");
    expect((await x.a("guide")).data.how_confirm_works).toContain("Then watch: request_status with wait: true");
    const tools = (await x.rpc({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })).result.tools as Array<{ name: string; inputSchema: { properties: Record<string, unknown> } }>;
    for (const n of ["request_status", "get_document"]) expect(tools.find((t) => t.name === n)!.inputSchema.properties.wait).toMatchObject({ type: "boolean" });
  });
});

describe("watching a contract request", () => {
  async function contractPdf() {
    const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
    const p = d.addPage([612, 792]);
    p.drawText("CLIENT: {{sign:client}}   Date: {{date:client}}", { x: 72, y: 300, size: 11, font: f });
    p.drawText("WRANGLER: {{sign:heston}}   Date: {{date:heston}}", { x: 72, y: 240, size: 11, font: f });
    const bytes = await d.save(); let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s);
  }
  test("C1 get_document with wait sees the approve Confirm within moments", async () => {
    const t = convexTest(schema, import.meta.glob("../convex/**/*.ts"));
    fakeFetch();
    const sub = await t.run(async (ctx) => {
      const owner = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston", role: "owner" });
      return `${owner}|${await ctx.db.insert("authSessions", { userId: owner, expirationTime: Date.now() + 3_600_000 })}`;
    });
    const me = t.withIdentity({ subject: sub });
    const key = await portalKeyFor(t, me);
    const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (ch) => ch.charCodeAt(0));
    const store = () => t.run((ctx) => ctx.storage.store(new Blob([PNG], { type: "image/png" })));
    await me.action(api.sign.adoptSignature, { name: "Heston Hill", title: "Founder", method: "typed", signatureStorageId: await store(), initialsStorageId: await store() });
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const j = await (await t.fetch("/portal-mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json();
      return { error: j.result.isError === true, text: j.result.content[0].text as string, data: j.result.structuredContent as Record<string, any> };
    };
    const c = await call("create_document", { title: "CO", pdf_base64: await contractPdf(), signers: [{ name: "Dillon Ripley", email: "dillon@example.com" }] });
    expect(c.error, c.text).toBe(false);
    const docId = (await t.run((ctx) => ctx.db.query("wsDocuments").first()))!._id;
    const a = await call("approve_document", { document: "WS-00001", heston_ok: "Looks good, approve it" });
    expect(a.error, a.text).toBe(false);
    expect(a.data.next).toContain("get_document for this document with wait: true");
    const watching = call("get_document", { document: "WS-00001", wait: true });
    await pause(600);
    const [req] = await me.query(api.sign.requestsFor, { documentId: docId });
    const t0 = Date.now();
    await me.mutation(api.sign.decideRequest, { requestId: req._id, confirm: true });
    const seen = await watching;
    expect(Date.now() - t0).toBeLessThan(POLL_MS + 1500);
    expect(seen.data.requests[0]).toMatchObject({ what: "approve", status: "done" });
    expect(seen.data.status).toBe("approved"); // the document read again after the Confirm
    expect(seen.data.next).toBe("Tell Heston how it went.");
  }, 30_000);
});
