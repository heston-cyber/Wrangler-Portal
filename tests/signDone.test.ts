// Wrangler Sign Phase S3 (Oct 27): after everyone signs.
//   T-S3.1 the signed PDF: every mark stamped, the certificate appended, its hash in the trail, the emails and the
//          verify check; one changed byte doesn't verify.
//   T-S3.2 the copies: every signer and Heston get the PDF, byte for byte.
//   T-S3.3 the archive: waits until Dropbox is connected, then the PDF and the audit record land in <year>/, read back
//          and checked; the audit record alone re-proves the trail.
//   T-S3.4 Stripe: one draft per document for the exact amount, none without an amount, still one after running
//          twice, and no code anywhere that could finalize, send or pay an invoice.
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import { PDFDocument, PDFName, PDFDict, StandardFonts } from "@cantoo/pdf-lib";
import { certificate, finalStamps, type FinalSigner } from "../convex/lib/wsFinal";
import { eventHash, GENESIS } from "../convex/lib/wsAudit";

const modules = import.meta.glob("../convex/**/*.ts");
const sources = import.meta.glob("../convex/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.RESEND_API_KEY = "re_test";
  process.env.SITE_URL = "https://review.wranglerportal.com";
  process.env.STRIPE_SIGN_KEY = "rk_test_x";
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); delete process.env.WS_DROPBOX_APP_KEY; delete process.env.WS_DROPBOX_APP_SECRET; });

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PNG = Uint8Array.from(atob(PNG_B64), (c) => c.charCodeAt(0));
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) Safari/605.1";
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function sha(b: Uint8Array) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(b)))].map((x) => x.toString(16).padStart(2, "0")).join(""); }

type Mail = { to: string; subject: string; text: string; attachments?: Array<{ filename: string; content: string }> };
type World = {
  mails: Mail[];
  stripe: { calls: Array<{ method: string; path: string; idem?: string; form?: Record<string, string> }>; invoices: Map<string, any>; customers: Array<{ id: string; email: string }> };
  dropbox: { files: Map<string, Uint8Array>; corrupt: boolean };
};

function stub(w: World) {
  const idemSeen = new Map<string, unknown>();
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const hdr = (k: string) => new Headers(init?.headers).get(k) ?? undefined;
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (url === "https://api.resend.com/emails") { const b = JSON.parse(String(init?.body)); w.mails.push({ to: b.to[0], subject: b.subject, text: b.text, attachments: b.attachments }); return ok({ id: "em" }); }
    if (url.startsWith("https://api.stripe.com/v1/")) {
      const path = url.slice("https://api.stripe.com/v1/".length);
      const method = init?.method ?? "GET";
      const form = init?.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : undefined;
      const idem = hdr("Idempotency-Key");
      w.stripe.calls.push({ method, path, idem, form });
      if (idem && idemSeen.has(idem)) return ok(idemSeen.get(idem));
      let out: any;
      if (method === "GET" && path.startsWith("customers/search?")) out = { data: [...w.stripe.customers].filter((c) => new URLSearchParams(path.split("?")[1]).get("query")!.toLowerCase().includes(c.email.toLowerCase())) };
      else if (method === "GET" && path.startsWith("invoices/search?")) { const q = new URLSearchParams(path.split("?")[1]).get("query")!; out = { data: [...w.stripe.invoices.values()].filter((i) => q.includes(`"${i.form["metadata[ws_document_id]"]}"`) && q.includes(`"${i.form["metadata[ws_version]"]}"`)) }; }
      else if (method === "POST" && path === "customers") out = { id: "cus_1" };
      else if (method === "POST" && path === "invoices") { const id = `in_${w.stripe.invoices.size + 1}`; out = { id, status: "draft" }; w.stripe.invoices.set(id, { id, status: "draft", total: 0, livemode: false, form }); }
      else if (method === "POST" && path === "invoiceitems") { const inv = w.stripe.invoices.get(form!.invoice); inv.total += Number(form!.amount); out = { id: "ii_1" }; }
      else if (method === "GET" && path.startsWith("invoices/")) out = w.stripe.invoices.get(path.slice(9));
      else return new Response(JSON.stringify({ error: { message: "unexpected" } }), { status: 400 });
      if (idem) idemSeen.set(idem, out);
      return ok(out);
    }
    if (url === "https://content.dropboxapi.com/2/files/upload") {
      const arg = JSON.parse(hdr("Dropbox-API-Arg")!);
      w.dropbox.files.set(arg.path, new Uint8Array(await new Response(init!.body as BodyInit).arrayBuffer()));
      return ok({ path_display: arg.path });
    }
    if (url === "https://content.dropboxapi.com/2/files/download") {
      const arg = JSON.parse(hdr("Dropbox-API-Arg")!);
      const b = w.dropbox.files.get(arg.path)!;
      return new Response(w.dropbox.corrupt ? new Uint8Array([...b, 0]) : b, { status: 200 });
    }
    return new Response("{}", { status: 500 });
  });
}

async function pdf(): Promise<Uint8Array> {
  const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
  d.addPage([612, 792]).drawText("Agreement", { x: 72, y: 700, size: 12, font: f });
  d.addPage([612, 792]).drawText("Signatures", { x: 72, y: 700, size: 12, font: f });
  return d.save();
}

async function signedDocument(opts: { payment?: boolean } = {}) {
  const t = convexTest(schema, modules);
  const w: World = { mails: [], stripe: { calls: [], invoices: new Map(), customers: [] }, dropbox: { files: new Map(), corrupt: false } };
  stub(w);
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
    versionId, title: "Service Agreement", signingOrder: "any", payment: opts.payment === false ? null : { amountCents: 120000, description: "Deposit (25%)" },
    signers: [{ key: "heston", name: "", email: "", order: 1 }, { key: "client", name: "Jordan Sample", email: "jordan@example.com", order: 1 }],
    boxes: [
      { id: "j-ini", signer: "client", kind: "initials", page: 0, x: 0.1, y: 0.2, w: 0.1, h: 0.03 },
      { id: "j-sign", signer: "client", kind: "sign", page: 1, x: 0.1, y: 0.7, w: 0.3, h: 0.05, cover: { page: 1, x: 0.1, y: 0.72, w: 0.2, h: 0.02 } },
      { id: "j-name", signer: "client", kind: "name", page: 1, x: 0.5, y: 0.7, w: 0.3, h: 0.02 },
      { id: "j-date", signer: "client", kind: "date", page: 1, x: 0.5, y: 0.75, w: 0.2, h: 0.02 },
      { id: "h-sign", signer: "heston", kind: "sign", page: 1, x: 0.5, y: 0.9, w: 0.3, h: 0.05 },
      { id: "h-date", signer: "heston", kind: "date", page: 1, x: 0.1, y: 0.9, w: 0.2, h: 0.02 },
    ],
  });
  await me.mutation(api.sign.approve, { versionId });
  const flush = async () => { vi.useFakeTimers(); await t.finishAllScheduledFunctions(vi.runAllTimers); vi.useRealTimers(); };
  const call = async (op: string, body: Record<string, unknown>) => {
    const r = await t.fetch(`/ws/${op}`, { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7", "user-agent": UA, origin: "https://sign.wranglerportal.com" }, body: JSON.stringify(body) });
    return (await r.json()) as Record<string, any>;
  };
  await me.mutation(api.sign.send, { versionId });
  await flush();
  const token = (await t.run((ctx) => ctx.db.query("wsSignings").first()))!.token;
  await call("code", { token });
  const code = [...w.mails].reverse().find((m) => /code/.test(m.subject))!.subject.slice(0, 6);
  const { session } = await call("verify", { token, code });
  await call("consent", { token, session, agreed: true });
  await call("viewed", { token, session, page: 0 });
  await call("viewed", { token, session, page: 1 });
  await call("adopt", { token, session, name: "Jordan A. Sample", method: "typed", signature: PNG_B64, initials: PNG_B64 });
  await call("initial", { token, session, boxId: "j-ini" });
  expect(await call("sign", { token, session, agreed: true })).toMatchObject({ ok: true, complete: true });
  await flush();
  const get = async () => (await me.query(api.sign.get, { documentId }))!;
  const verify = async (h: string) => (await (await t.fetch("/ws-verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sha256: h }) })).json()) as Record<string, any>;
  return { t, w, me, documentId, flush, get, verify };
}

describe("T-S3.1 the signed PDF", () => {
  test("stamped, certified, hashed into the trail, and checkable; one changed byte isn't", async () => {
    const x = await signedDocument();
    const d = await x.get();
    expect(d.doc.status).toBe("completed");
    const f = d.doc.final!;
    expect(f.fileName).toBe("WS-00001 Service Agreement (signed).pdf");
    const bytes = new Uint8Array(await x.t.run(async (ctx) => (await ctx.storage.get(f.fileId))!.arrayBuffer()));
    expect(await sha(bytes)).toBe(f.sha256);
    // The trail names the hash; so does every email.
    expect(d.events.find((e) => e.kind === "signed_copy_made")!.detail).toContain(f.sha256);
    expect(d.chain).toMatchObject({ ok: true });
    for (const m of x.w.mails.filter((m) => m.subject.startsWith("Signed:"))) expect(m.text).toContain(f.sha256);
    // The original two pages plus the certificate; images (two signatures, one set of initials) are on the pages.
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBeGreaterThanOrEqual(3);
    const xobjects = (i: number) => { const r = out.getPage(i).node.Resources()!; const xo = r.lookup(PDFName.of("XObject")); return xo instanceof PDFDict ? xo.keys().length : 0; };
    expect(xobjects(0)).toBe(1); // Jordan's initials
    expect(xobjects(1)).toBe(2); // Jordan's and Heston's signatures (same PNG bytes are embedded once each)
    // Verify: the right hash matches, one flipped byte doesn't.
    expect(await x.verify(f.sha256)).toMatchObject({ match: true, label: "WS-00001", title: "Service Agreement", signers: ["Jordan A. Sample", "Heston Hill (Wrangler Productions)"] });
    const flipped = new Uint8Array(bytes); flipped[flipped.length - 10] ^= 1;
    expect(await x.verify(await sha(flipped))).toEqual({ match: false });
    expect((await x.t.fetch("/ws-verify", { method: "POST", body: "{\"sha256\":\"nope\"}" })).status).toBe(400);
  });

  test("the certificate names every signer, how they proved who they are, their IP and the event log", async () => {
    const x = await signedDocument();
    const d = await x.get();
    const s = await x.t.run((ctx) => ctx.db.query("wsSignings").first());
    // Rebuild the same lines the PDF got, from the stored record (certificate() is what stamp() prints).
    const signer: FinalSigner = { key: "client", name: s!.name, email: s!.email, title: null, adoptedName: s!.adopted!.name, adoptedTitle: null, method: "typed", signaturePng: PNG, initialsPng: PNG, signatureSha256: s!.adopted!.signatureSha256, initialsSha256: s!.adopted!.initialsSha256, signedAt: s!.signedAt!, signedDate: s!.signedDate!, ip: s!.signIp!, userAgent: s!.signUserAgent!, verifiedAt: s!.verifiedAt!, consentAt: s!.consentAt!, consentVersion: s!.consentVersion!, adoptedAt: s!.adopted!.at, initialed: s!.initialed!, viewedPages: s!.viewedPages! };
    const lines = certificate({ label: "WS-00001", title: "Service Agreement", company: "Wrangler Productions, a DBA of Hill Creative LLC", versionNumber: 1, fileName: "Agreement.pdf", fileSha256: d.version.fileSha256, lockHash: d.version.lockHash!, pages: 2, sentAt: d.doc.sentAt!, completedAt: d.doc.completedAt!, signingOrder: "any", owner: null, signers: [signer], boxes: [], events: [], statement: "S", verifyUrl: "https://sign.wranglerportal.com/verify" }).join("\n");
    expect(lines).toContain("Certificate of completion");
    expect(lines).toContain("one-time code sent to jordan@example.com");
    expect(lines).toContain("203.0.113.7 (Safari on iPhone)");
    expect(lines).toContain("ws-consent-2026-10-27");
    expect(lines).toContain(d.version.fileSha256);
    expect(lines).toContain("Pages viewed: 1, 2 of 2");
    // A box whose initials weren't given can't be stamped.
    expect(() => finalStamps([{ id: "q", signer: "client", kind: "initials", page: 0, x: 0, y: 0, w: 0.1, h: 0.1 }], null, [{ ...signer, initialed: [] }])).toThrow(/didn't initial/);
  });
});

describe("T-S3.2 copies", () => {
  test("every signer and Heston get the signed PDF, byte for byte; Heston's has the invoice link", async () => {
    const x = await signedDocument();
    const d = await x.get();
    const copies = x.w.mails.filter((m) => m.subject === "Signed: Service Agreement (WS-00001)");
    expect(copies.map((m) => m.to).sort()).toEqual(["heston@wranglerproductions.com", "jordan@example.com"]);
    const bytes = new Uint8Array(await x.t.run(async (ctx) => (await ctx.storage.get(d.doc.final!.fileId))!.arrayBuffer()));
    for (const m of copies) {
      expect(m.attachments![0].filename).toBe("WS-00001 Service Agreement (signed).pdf");
      expect(await sha(unb64(m.attachments![0].content))).toBe(await sha(bytes));
    }
    expect(copies.find((m) => m.to === "heston@wranglerproductions.com")!.text).toContain("https://dashboard.stripe.com/test/invoices/in_1");
    expect(d.doc.copies).toMatchObject({ status: "sent", sent: ["jordan@example.com", "heston@wranglerproductions.com"] });
    expect(d.events.filter((e) => e.kind === "copy_emailed").map((e) => e.email).sort()).toEqual(["heston@wranglerproductions.com", "jordan@example.com"]);
    // Retrying doesn't email anyone twice.
    await x.me.mutation(api.signDone.retry, { documentId: x.documentId, step: "copies" });
    await x.flush();
    expect(x.w.mails.filter((m) => m.subject.startsWith("Signed:")).length).toBe(2);
  });
});

describe("T-S3.3 archive", () => {
  test("waits for Dropbox, then files the PDF and the audit record, read back and checked; the record re-proves the trail", async () => {
    const x = await signedDocument();
    expect((await x.get()).doc.archive).toMatchObject({ status: "waiting" });
    expect(x.w.dropbox.files.size).toBe(0);
    // Connect (the app's keys in Convex, and a stored Dropbox token), then archive whatever is waiting.
    process.env.WS_DROPBOX_APP_KEY = "k"; process.env.WS_DROPBOX_APP_SECRET = "s";
    await x.t.run((ctx) => ctx.db.insert("wsDropbox", { accountId: "dbid:1", refreshToken: "r", accessToken: "a", accessExpiresAt: Date.now() + 3_600_000, connectedAt: Date.now() }));
    expect(await x.t.action(internal.wsArchive.archivePending, {})).toEqual({ tried: 1 });
    const d = await x.get();
    const year = new Date().getFullYear();
    expect(d.doc.archive).toMatchObject({ status: "archived", verified: true, pdfPath: `/${year}/WS-00001 Service Agreement (signed).pdf`, auditPath: `/${year}/WS-00001 Service Agreement (audit).json` });
    expect(await sha(x.w.dropbox.files.get(d.doc.archive!.pdfPath!)!)).toBe(d.doc.final!.sha256);
    // The audit record on its own: the signed file's hash, and a trail whose hashes all recompute.
    const rec = JSON.parse(new TextDecoder().decode(x.w.dropbox.files.get(d.doc.archive!.auditPath!)!));
    expect(rec.format).toBe("wrangler-sign-audit/1");
    expect(rec.signed.sha256).toBe(d.doc.final!.sha256);
    expect(rec.signers[0]).toMatchObject({ email: "jordan@example.com", ip: "203.0.113.7" });
    let prev = GENESIS;
    for (const e of rec.events) { const { prevHash, hash, ...rest } = e; expect(prevHash).toBe(prev); expect(await eventHash(prev, rest)).toBe(hash); prev = hash; }
    expect(d.events.some((e) => e.kind === "archived")).toBe(true);
  });

  test("a copy that doesn't read back the same is a failure, not 'archived'", async () => {
    const x = await signedDocument();
    process.env.WS_DROPBOX_APP_KEY = "k"; process.env.WS_DROPBOX_APP_SECRET = "s";
    await x.t.run((ctx) => ctx.db.insert("wsDropbox", { accountId: "dbid:1", refreshToken: "r", accessToken: "a", accessExpiresAt: Date.now() + 3_600_000, connectedAt: Date.now() }));
    x.w.dropbox.corrupt = true;
    await x.me.mutation(api.signDone.retry, { documentId: x.documentId, step: "archive" });
    await x.flush();
    const d = await x.get();
    expect(d.doc.archive).toMatchObject({ status: "failed" });
    expect(d.doc.archive!.error).toMatch(/doesn't match/);
  });
});

describe("T-S3.4 Stripe", () => {
  test("one draft for the exact amount, never sent; running completion again still leaves one", async () => {
    const x = await signedDocument();
    expect(x.w.stripe.invoices.size).toBe(1);
    const inv = x.w.stripe.invoices.get("in_1");
    expect(inv).toMatchObject({ status: "draft", total: 120000 });
    expect(inv.form).toMatchObject({ auto_advance: "false", collection_method: "send_invoice", "metadata[ws_doc]": "WS-00001" });
    expect((await x.get()).doc.invoice).toMatchObject({ status: "created", id: "in_1", amountCents: 120000, livemode: false });
    // Again, twice: the document says it's done, and Stripe's idempotency keys would also stop a second draft.
    await x.t.action(internal.signDone.finish, { documentId: x.documentId });
    await x.t.action(internal.signDone.finish, { documentId: x.documentId, steps: ["invoice"] });
    expect(x.w.stripe.invoices.size).toBe(1);
    expect(x.w.stripe.calls.every((c) => !/finalize|\/send|\/pay/.test(c.path))).toBe(true);
    expect(x.w.stripe.calls.filter((c) => c.method === "POST").every((c) => !!c.idem)).toBe(true);
  });

  test("no amount on the document: no Stripe call at all", async () => {
    const x = await signedDocument({ payment: false });
    expect(x.w.stripe.calls).toEqual([]);
    expect((await x.get()).doc.invoice).toMatchObject({ status: "none" });
  });

  test("no code can finalize, send, pay or void a Stripe invoice", () => {
    const stripeFiles = Object.entries(sources).filter(([, src]) => src.includes("api.stripe.com"));
    expect(stripeFiles.length).toBeGreaterThan(0);
    for (const [file, src] of stripeFiles) {
      const calls = src.match(/["'`][^"'`]*(invoices\/[^"'`]*\/(finalize|send|pay|void)|\/finalize_invoice)[^"'`]*["'`]/g);
      expect(calls, file).toBeNull();
    }
  });
});
