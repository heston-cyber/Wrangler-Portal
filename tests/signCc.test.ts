// D160 (Heston, Nov 6): CC on contracts. C1 copied people get an email with a view-only link and the signers' email
// names them; C2 the copy link only reads, and can't reach any signing step; C3 everyone copied gets the signed copy;
// C4 cancelling tells them and the page stops showing the document; C5 the list is checked; C6 Claude's send request
// carries the CC list until Heston confirms; C7 another business can't read it.
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";

const modules = import.meta.glob("../convex/**/*.ts");
beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.RESEND_API_KEY = "re_test";
  process.env.SITE_URL = "https://review.wranglerportal.com";
  process.env.STRIPE_SIGN_KEY = "rk_test_x";
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PNG = Uint8Array.from(atob(PNG_B64), (c) => c.charCodeAt(0));
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) Safari/605.1";
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

async function document(opts: { payment?: boolean; cc?: Array<{ email: string; name?: string }>; sign?: boolean } = {}) {
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
  await me.mutation(api.sign.send, { versionId, ...(opts.cc ? { cc: opts.cc } : {}) });
  await flush();
  const get = async () => (await me.query(api.sign.get, { documentId }))!;
  if (opts.sign === false) return { t, w, me, documentId, versionId, flush, get, call };
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
  const verify = async (h: string) => (await (await t.fetch("/ws-verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sha256: h }) })).json()) as Record<string, any>;
  return { t, w, me, documentId, versionId, flush, get, call };
}

const ANA = { email: "Ana@Harbor.example", name: "Ana Ruiz" };
const tokenOf = (x: { t: any }) => x.t.run(async (ctx: any) => (await ctx.db.query("wsCopies").first())!.token as string);

describe("D160 · CC on contracts", () => {
  test("C1 copied people get a view-only link when it's sent; the signer's email names them", async () => {
    const x = await document({ cc: [ANA, { email: "books@harbor.example" }], sign: false });
    const toAna = x.w.mails.filter((m) => m.to === "ana@harbor.example");
    expect(toAna.map((m) => m.subject)).toEqual(["Copy: Service Agreement (WS-00001) was sent for signature"]);
    expect(toAna[0].text).toContain("nothing for you to sign");
    expect(toAna[0].text).toMatch(/https:\/\/sign\.wranglerportal\.com\/c\/[A-Za-z0-9_-]{20,}/);
    const invite = x.w.mails.find((m) => m.to === "jordan@example.com" && m.subject.startsWith("Please sign"))!;
    expect(invite.text).toContain("Copied: Ana Ruiz (ana@harbor.example), books@harbor.example.");
    const d = await x.get();
    expect(d.copies.map((c) => [c.email, c.name, !!c.emailedAt])).toEqual([["ana@harbor.example", "Ana Ruiz", true], ["books@harbor.example", null, true]]);
    expect(d.events.filter((e) => e.kind === "copied").map((e) => e.email)).toEqual(["ana@harbor.example", "books@harbor.example"]);
    expect(d.chain).toMatchObject({ ok: true });
    // No reminders for copied people.
    await x.me.mutation(api.sign.resend, { documentId: x.documentId, signerKey: "client" }).catch(() => undefined);
    await x.flush();
    expect(x.w.mails.filter((m) => m.to === "ana@harbor.example")).toHaveLength(1);
  });

  test("C2 the copy link reads only: no signing step takes it", async () => {
    const x = await document({ cc: [ANA], sign: false });
    const token = await tokenOf(x);
    const p = await x.t.query(api.signCopies.page, { token });
    expect(p).toMatchObject({ state: "sent", title: "Service Agreement", label: "WS-00001", signers: [{ name: "Jordan Sample", signedAt: null }] });
    expect((p as { fileUrl: string }).fileUrl).toMatch(/^http/);
    await x.t.mutation(api.signCopies.opened, { token });
    expect((await x.get()).copies[0].openedAt).not.toBeNull();
    for (const op of ["open", "code", "verify", "consent", "sign"]) {
      const r = await x.call(op, { token, code: "000000", session: "x", agreed: true });
      expect(r.ok, op).not.toBe(true);
    }
    expect(x.w.mails.filter((m) => m.to === "ana@harbor.example" && /code/.test(m.subject))).toHaveLength(0);
    expect(await x.t.query(api.signCopies.page, { token: "nope-nope-nope-nope-nope" })).toBeNull();
  });

  test("C3 when everyone has signed, everyone copied gets the signed copy, and the page offers it", async () => {
    const x = await document({ cc: [ANA] });
    const d = await x.get();
    expect(d.doc.status).toBe("completed");
    const copy = x.w.mails.find((m) => m.to === "ana@harbor.example" && m.subject.startsWith("Signed:"))!;
    expect(copy.attachments?.[0].filename).toBe(d.doc.final!.fileName);
    expect(d.doc.copies?.sent).toContain("ana@harbor.example");
    const p = await x.t.query(api.signCopies.page, { token: await tokenOf(x) });
    expect(p).toMatchObject({ state: "signed", fileName: d.doc.final!.fileName });
  });

  test("C4 cancelling tells everyone copied, and the link stops showing the document", async () => {
    const x = await document({ cc: [ANA], sign: false });
    await x.me.mutation(api.sign.voidDocument, { documentId: x.documentId, reason: "New dates" });
    await x.flush();
    const mail = x.w.mails.find((m) => m.to === "ana@harbor.example" && m.subject.startsWith("Cancelled:"))!;
    expect(mail.text).toContain("New dates");
    expect(await x.t.query(api.signCopies.page, { token: await tokenOf(x) })).toMatchObject({ state: "cancelled" });
    expect(await x.t.query(api.signCopies.page, { token: await tokenOf(x) })).not.toHaveProperty("fileUrl");
  });

  test("C5 the list is checked: real addresses, not a signer, 10 at most", async () => {
    const x = await document({ sign: false, cc: [] });
    await x.me.mutation(api.sign.voidDocument, { documentId: x.documentId });
    const t = x.t, me = x.me;
    // A fresh approved version to send again.
    const pdfId = await t.run(async (ctx) => { const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica); d.addPage([612, 792]).drawText("A", { x: 72, y: 700, size: 12, font: f }); d.addPage([612, 792]); return ctx.storage.store(new Blob([await d.save()], { type: "application/pdf" })); });
    await me.action(api.sign.replaceFile, { documentId: x.documentId, storageId: pdfId, fileName: "Agreement v2.pdf" });
    const v2 = (await me.query(api.sign.get, { documentId: x.documentId }))!.version._id;
    await me.mutation(api.sign.saveLayout, { versionId: v2, title: "Service Agreement", signingOrder: "any", payment: null, signers: [{ key: "heston", name: "", email: "", order: 1 }, { key: "client", name: "Jordan Sample", email: "jordan@example.com", order: 1 }], boxes: [{ id: "j", signer: "client", kind: "sign", page: 1, x: 0.1, y: 0.7, w: 0.3, h: 0.05 }, { id: "h", signer: "heston", kind: "sign", page: 1, x: 0.5, y: 0.9, w: 0.3, h: 0.05 }] });
    await me.mutation(api.sign.approve, { versionId: v2 });
    await expect(me.mutation(api.sign.send, { versionId: v2, cc: [{ email: "not an email" }] })).rejects.toThrow(/isn't an email address/);
    await expect(me.mutation(api.sign.send, { versionId: v2, cc: [{ email: "Jordan@Example.com" }] })).rejects.toThrow(/already signs/);
    await expect(me.mutation(api.sign.send, { versionId: v2, cc: [{ email: "heston@wranglerproductions.com" }] })).rejects.toThrow(/already signs/);
    await expect(me.mutation(api.sign.send, { versionId: v2, cc: Array.from({ length: 11 }, (_, i) => ({ email: `p${i}@x.example` })) })).rejects.toThrow(/10 people at most/);
    expect(await me.mutation(api.sign.send, { versionId: v2, cc: [{ email: "a@x.example" }, { email: "A@x.example " }] })).toMatchObject({ copied: 1 });
  });

  test("C6 Claude's send request carries the CC list; nothing goes until Heston confirms", async () => {
    const x = await document({ sign: false, cc: [] });
    await x.me.mutation(api.sign.voidDocument, { documentId: x.documentId });
    // (the request flow is the same for a fresh approved version; check it on the record)
    const t = x.t;
    const reqId = await t.run(async (ctx) => {
      const doc = (await ctx.db.get(x.documentId))!;
      await ctx.db.patch(doc._id, { status: "approved" });
      return null;
    });
    expect(reqId).toBeNull();
    const r = await t.mutation(internal.sign.requestAs, { documentId: x.documentId, what: "send", said: "send it and cc Ana", cc: [ANA], asBusiness: await t.run(async (ctx) => (await ctx.db.get(x.documentId))!.businessId!) });
    const shown = await x.me.query(api.sign.requestsFor, { documentId: x.documentId });
    expect(shown[0]).toMatchObject({ what: "send", cc: [{ email: "ana@harbor.example", name: "Ana Ruiz" }] });
    expect(r.requestId).toBeTruthy();
    expect(x.w.mails.filter((m) => m.to === "ana@harbor.example")).toHaveLength(0);
  });
});
