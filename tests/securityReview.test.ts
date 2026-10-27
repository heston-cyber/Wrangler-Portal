// Security review (Oct 27): each finding the independent review proved, now refused. The setup is the signing
// tests' (the same HTTP requests the signing page makes).
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";

const modules = import.meta.glob("../convex/**/*.ts");
beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.RESEND_API_KEY = "re_test";
  process.env.SITE_URL = "https://review.wranglerportal.com";
  process.env.WS_DEBUG = "1";
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PNG = Uint8Array.from(atob(PNG_B64), (c) => c.charCodeAt(0));
type Mail = { to: string; subject: string; text: string; from: string };

function stubMail(mails: Mail[]) {
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("https://api.stripe.com/") || url.includes("dropboxapi.com")) return new Response("{}", { status: 500 });
    if (url === "https://api.resend.com/emails") { const b = JSON.parse(String(init?.body)); mails.push({ to: b.to[0], subject: b.subject, text: b.text, from: b.from }); return new Response(JSON.stringify({ id: "em" }), { status: 200 }); }
    return new Response("{}", { status: 500 });
  });
}

async function pdf(): Promise<Uint8Array> {
  const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
  d.addPage([612, 792]).drawText("Agreement", { x: 72, y: 700, size: 12, font: f });
  d.addPage([612, 792]).drawText("Signatures", { x: 72, y: 700, size: 12, font: f });
  return d.save();
}

const IP = { jordan: "203.0.113.7", casey: "2001:db8::42" };
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) Safari/605.1";

async function setup(order: "any" | "sequence" = "any") {
  const t = convexTest(schema, modules);
  const mails: Mail[] = [];
  stubMail(mails);
  const sub = await t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston", role: "owner" });
    return `${owner}|${await ctx.db.insert("authSessions", { userId: owner, expirationTime: Date.now() + 3_600_000 })}`;
  });
  const me = t.withIdentity({ subject: sub });
  const store = (b: Uint8Array, type: string) => t.run((ctx) => ctx.storage.store(new Blob([b], { type })));
  await me.action(api.sign.adoptSignature, { name: "Heston Hill", title: "Founder", method: "typed", signatureStorageId: await store(PNG, "image/png"), initialsStorageId: await store(PNG, "image/png") });
  const { documentId } = await me.action(api.sign.create, { storageId: await store(await pdf(), "application/pdf"), fileName: "Agreement.pdf" });
  const versionId = (await me.query(api.sign.get, { documentId }))!.version._id;
  await me.mutation(api.sign.saveLayout, {
    versionId, title: "Service Agreement", signingOrder: order, payment: null,
    signers: [{ key: "heston", name: "", email: "", order: 1 }, { key: "client", name: "Jordan Sample", email: "jordan@example.com", order: 1 }, { key: "client2", name: "Casey Lee", email: "casey@example.com", order: 2 }],
    boxes: [
      { id: "j-ini", signer: "client", kind: "initials", page: 0, x: 0.1, y: 0.2, w: 0.1, h: 0.03 },
      { id: "j-sign", signer: "client", kind: "sign", page: 1, x: 0.1, y: 0.7, w: 0.3, h: 0.05 },
      { id: "j-name", signer: "client", kind: "name", page: 1, x: 0.5, y: 0.6, w: 0.3, h: 0.02 },
      { id: "c-sign", signer: "client2", kind: "sign", page: 1, x: 0.1, y: 0.8, w: 0.3, h: 0.05 },
      { id: "h-sign", signer: "heston", kind: "sign", page: 1, x: 0.5, y: 0.9, w: 0.3, h: 0.05 },
    ],
  });
  await me.mutation(api.sign.approve, { versionId });
  const flush = async () => { vi.useFakeTimers(); await t.finishAllScheduledFunctions(vi.runAllTimers); vi.useRealTimers(); };
  const call = async (op: string, body: Record<string, unknown>, ua = UA) => {
    const r = await t.fetch(`/ws/${op}`, { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.1", "user-agent": ua, origin: "https://sign.wranglerportal.com" }, body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as Record<string, any> };
  };
  const tokens = async () => Object.fromEntries((await t.run((ctx) => ctx.db.query("wsSignings").collect())).map((s) => [s.signerKey, s.token]));
  const codeFor = (email: string) => { const m = [...mails].reverse().find((x) => x.to === email && /code/.test(x.subject)); return m?.subject.match(/^(\d{6})/)?.[1] ?? ""; };
  const verified = async (token: string, email: string, ua = UA) => {
    await call("code", { token }, ua);
    const r = await call("verify", { token, code: codeFor(email) }, ua);
    return r.body.session as string;
  };
  const send = async () => { const r = await me.mutation(api.sign.send, { versionId }); await flush(); return r; };
  return { t, me, mails, documentId, versionId, flush, call, tokens, codeFor, verified, send, store };
}

async function signFully(x: Awaited<ReturnType<typeof setup>>, token: string, email: string, name: string, ua = UA) {
  const s = await x.verified(token, email, ua);
  await x.call("consent", { token, session: s, agreed: true }, ua);
  await x.call("adopt", { token, session: s, name, method: "typed", signature: PNG_B64, initials: PNG_B64 }, ua);
  await x.call("initial", { token, session: s, boxId: "j-ini" }, ua);
  return x.call("sign", { token, session: s, agreed: true }, ua);
}

import { readFileSync } from "node:fs";
import { pngProblem } from "../convex/lib/pngCheck";
import { cleanLine, hasLink, FAILS_LIFETIME } from "../convex/lib/wsSigning";
import { htmlFromText } from "../convex/lib/email";
import { publicHttps } from "../convex/wsMcp";

const CANVAS_B64 = readFileSync(new URL("./fixtures/sig-canvas.b64", import.meta.url), "utf8").trim();

describe("T-SR security review fixes", () => {
  test("F6: a junk 'PNG' is refused at adopt; a real canvas PNG is accepted", async () => {
    const x = await setup();
    await x.send();
    const tk = await x.tokens();
    const junk = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8, 9));
    const s = await x.verified(tk.client, "jordan@example.com");
    await x.call("consent", { token: tk.client, session: s, agreed: true });
    expect((await x.call("adopt", { token: tk.client, session: s, name: "J", method: "typed", signature: junk, initials: junk })).status).toBe(400);
    expect((await x.call("adopt", { token: tk.client, session: s, name: "Jordan Sample", method: "drawn", signature: CANVAS_B64, initials: PNG_B64 })).body.ok).toBe(true);
    expect(pngProblem(Uint8Array.from(atob(CANVAS_B64), (c) => c.charCodeAt(0)))).toBeNull();
  });

  test("F2: a document that was ever sent can't be deleted, even after cancel → new version", async () => {
    const x = await setup();
    await x.send();
    const tk = await x.tokens();
    expect((await signFully(x, tk.client, "jordan@example.com", "Jordan Sample")).body.ok).toBe(true);
    await x.me.mutation(api.sign.voidDocument, { documentId: x.documentId });
    await x.flush();
    await x.me.mutation(api.sign.revise, { documentId: x.documentId });
    await expect(x.me.mutation(api.sign.remove, { documentId: x.documentId })).rejects.toThrow(/kept for the record/);
    const left = await x.t.run(async (ctx) => ({ doc: await ctx.db.get(x.documentId), events: (await ctx.db.query("wsEvents").collect()).length }));
    expect(left.doc).not.toBeNull();
    expect(left.events).toBeGreaterThan(10);
  });

  test("F3: rebuilding the new draft keeps the earlier version's file", async () => {
    const x = await setup();
    await x.send();
    await x.me.mutation(api.sign.voidDocument, { documentId: x.documentId });
    await x.flush();
    const v1 = (await x.me.query(api.sign.get, { documentId: x.documentId }))!.version;
    await x.me.mutation(api.sign.revise, { documentId: x.documentId });
    const newPdf = await x.store(await pdf(), "application/pdf");
    await x.t.mutation(internal.sign.replaceDraftFile, { documentId: x.documentId, storageId: newPdf, fileName: "x.pdf", sha: "x", bytes: 1, pages: v1.pages, title: "t" });
    expect(await x.t.run(async (ctx) => !!(await ctx.storage.get(v1.fileId)))).toBe(true);
  });

  test("F7: a signer's changes are limited per hour", async () => {
    const x = await setup();
    await x.send();
    const tk = await x.tokens();
    const s = await x.verified(tk.client, "jordan@example.com");
    await x.call("consent", { token: tk.client, session: s, agreed: true });
    await x.call("adopt", { token: tk.client, session: s, name: "J", method: "typed", signature: PNG_B64, initials: PNG_B64 });
    let refused = 0;
    for (let i = 0; i < 320; i++) { const r = await x.call("initial", { token: tk.client, session: s, boxId: "j-ini", on: i % 2 === 0 }); if (r.body.error) refused++; }
    expect(refused).toBeGreaterThan(0);
    const toggles = (await x.t.run((ctx) => ctx.db.query("wsEvents").collect())).filter((e) => e.kind === "initialed" || e.kind === "initials_removed").length;
    expect(toggles).toBeLessThanOrEqual(300);
  });

  test("F5: a name with line breaks or a link is refused or flattened; nothing breaks out of the email's HTML", async () => {
    const x = await setup();
    await x.send();
    const tk = await x.tokens();
    const s = await x.verified(tk.client, "jordan@example.com");
    await x.call("consent", { token: tk.client, session: s, agreed: true });
    const evil = 'Jordan\n\nURGENT: pay the deposit at https://evil.example/pay"style="x';
    const r = await x.call("adopt", { token: tk.client, session: s, name: evil, method: "typed", signature: PNG_B64, initials: PNG_B64 });
    expect(r.status).toBe(400);
    expect((await x.call("adopt", { token: tk.client, session: s, name: "Jordan pay at evil.example", method: "typed", signature: PNG_B64, initials: PNG_B64 })).status).toBe(400);
    expect(cleanLine("## Jordan\n\nSmith\u202e")).toBe("Jordan Smith");
    expect(hasLink("John Smith Jr.", true)).toBe(false);
    expect(hasLink("J.R. Smith", true)).toBe(false);
    expect(htmlFromText('see https://evil.example/pay"style="x')).not.toMatch(/href="[^"]*"style/);
  });

  test("F9: wrong codes add up over the link's life; at the cap it locks for good and Heston is told", async () => {
    const x = await setup();
    await x.send();
    const tk = await x.tokens();
    await x.t.run(async (ctx) => { const s = (await ctx.db.query("wsSignings").collect()).find((y) => y.signerKey === "client")!; await ctx.db.patch(s._id, { failTotal: FAILS_LIFETIME - 1 }); });
    await x.call("code", { token: tk.client });
    const r = await x.call("verify", { token: tk.client, code: "000000" });
    expect(r.body.error).toMatch(/locked/);
    const good = await x.call("verify", { token: tk.client, code: x.codeFor("jordan@example.com") });
    expect(good.body.session).toBeUndefined();
    expect((await x.call("code", { token: tk.client })).body.error).toMatch(/locked/);
    await x.flush();
    expect(x.mails.some((m) => m.to === "heston@wranglerproductions.com" && /locked/.test(m.subject))).toBe(true);
  });

  test("F8: a review guest can't delete or attach a stored file that isn't their recording", async () => {
    const x = await setup();
    const v1 = (await x.me.query(api.sign.get, { documentId: x.documentId }))!.version;
    await x.me.mutation(api.notes.discardVoice, { storageId: v1.fileId });
    expect(await x.t.run(async (ctx) => !!(await ctx.storage.get(v1.fileId)))).toBe(true);
  });

  test("F12: pdf_url must be a public https address on every hop", () => {
    for (const bad of ["http://x.com/a.pdf", "https://localhost/a.pdf", "https://127.0.0.1/a.pdf", "https://10.0.0.5/a.pdf", "https://169.254.169.254/latest", "https://[::1]/a", "https://192.168.1.2/a", "https://intranet/a"]) expect(() => publicHttps(bad), bad).toThrow();
    expect(publicHttps("https://example.com/a.pdf").hostname).toBe("example.com");
  });
});
