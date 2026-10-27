// Wrangler Sign Phase S2 (Oct 27): sending and signing, through the same HTTP requests the signing page makes.
//   T-S2.1 the gate: wrong / expired / used-up codes, the lock, expired, voided and superseded links.
//   T-S2.2 no skipping: Sign is refused until consent, adoption and every initial are done.
//   T-S2.3 the trail: every step logged in order with the signer's email, IP and browser; the chain verifies.
//   T-S2.4 several signers, any order and one after another.
//   T-S2.5 isolation: one signer's link, code or session gets nothing of another's.
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
      { id: "j-ini2", signer: "client", kind: "initials", page: 1, x: 0.1, y: 0.2, w: 0.1, h: 0.03 },
      { id: "j-sign", signer: "client", kind: "sign", page: 1, x: 0.1, y: 0.7, w: 0.3, h: 0.05 },
      { id: "j-date", signer: "client", kind: "date", page: 1, x: 0.5, y: 0.7, w: 0.2, h: 0.02 },
      { id: "c-sign", signer: "client2", kind: "sign", page: 1, x: 0.1, y: 0.8, w: 0.3, h: 0.05 },
      { id: "h-sign", signer: "heston", kind: "sign", page: 1, x: 0.5, y: 0.9, w: 0.3, h: 0.05 },
    ],
  });
  await me.mutation(api.sign.approve, { versionId });
  const flush = async () => { vi.useFakeTimers(); await t.finishAllScheduledFunctions(vi.runAllTimers); vi.useRealTimers(); };
  const call = async (op: string, body: Record<string, unknown>, ip = "198.51.100.1") => {
    const r = await t.fetch(`/ws/${op}`, { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip, "user-agent": UA, origin: "https://sign.wranglerportal.com" }, body: JSON.stringify(body) });
    return { status: r.status, cors: r.headers.get("access-control-allow-origin"), body: (await r.json()) as Record<string, any> };
  };
  const tokens = async () => Object.fromEntries((await t.run((ctx) => ctx.db.query("wsSignings").collect())).map((s) => [s.signerKey, s.token]));
  const codeFor = (email: string) => { const m = [...mails].reverse().find((x) => x.to === email && /code/.test(x.subject)); return m?.subject.match(/^(\d{6})/)?.[1] ?? ""; };
  const verified = async (token: string, email: string, ip?: string) => {
    expect((await call("code", { token }, ip)).body).toMatchObject({ sent: true });
    const r = await call("verify", { token, code: codeFor(email) }, ip);
    expect(r.body.session).toBeTruthy();
    return r.body.session as string;
  };
  const adopt = (token: string, session: string, name: string, ip?: string) => call("adopt", { token, session, name, method: "typed", signature: PNG_B64, initials: PNG_B64 }, ip);
  const events = async () => (await me.query(api.sign.get, { documentId }))!.events;
  // Send and let the invite emails go out (scheduled functions left running in the background race the test).
  const send = async (days?: number) => { const r = await me.mutation(api.sign.send, { versionId, ...(days ? { expiresInDays: days } : {}) }); await flush(); return r; };
  return { t, me, mails, documentId, versionId, flush, call, tokens, codeFor, verified, adopt, events, send };
}

describe("sending", () => {
  test("send puts Heston's signature on, emails every client a link from contracts@, and the document is out", async () => {
    const x = await setup();
    const r = await x.send(14);
    expect(r.sent).toBe(2);
    const invites = x.mails.filter((m) => m.subject.startsWith("Please sign"));
    expect(invites.map((m) => m.to).sort()).toEqual(["casey@example.com", "jordan@example.com"]);
    expect(invites[0].from).toBe("Wrangler Productions <contracts@wranglerportal.com>");
    const tk = await x.tokens();
    expect(invites.find((m) => m.to === "jordan@example.com")!.text).toContain(`https://sign.wranglerportal.com/${tk.client}`);
    const d = (await x.me.query(api.sign.get, { documentId: x.documentId }))!;
    expect(d.doc.status).toBe("sent");
    expect(d.version.ownerSignedAt).toBeTruthy();
    expect(d.signings.map((s) => [s.key, s.status])).toEqual([["client", "sent"], ["client2", "sent"]]);
    expect(d.events.map((e) => e.kind)).toEqual(expect.arrayContaining(["owner_signed", "sent", "send_settings", "email_delivered_to_resend"]));
    // Can't send twice, edit, or delete while it's out.
    await expect(x.me.mutation(api.sign.send, { versionId: x.versionId })).rejects.toThrow(/approved version/);
    await expect(x.me.mutation(api.sign.revise, { documentId: x.documentId })).rejects.toThrow(/Cancel \(void\) it first/);
    await expect(x.me.mutation(api.sign.remove, { documentId: x.documentId })).rejects.toThrow(/kept for the record/);
  });

  test("only the current approved version can be sent", async () => {
    const x = await setup();
    await x.me.mutation(api.sign.revise, { documentId: x.documentId });
    await expect(x.me.mutation(api.sign.send, { versionId: x.versionId })).rejects.toThrow(/current, approved/);
  });
});

describe("T-S2.1 the gate", () => {
  test("no session, no document; wrong codes count down, then the code is used up; then a lock", async () => {
    const x = await setup();
    await x.send();
    const { client } = await x.tokens();
    const open = await x.call("open", { token: client });
    expect(open.body).toMatchObject({ state: "ready", verified: false, title: "Service Agreement", label: "WS-00001", email: "j…n@example.com" });
    expect(open.cors).toBe("https://sign.wranglerportal.com");
    expect((await x.call("doc", { token: client, session: "made-up" })).body.code).toBe("session");
    expect((await x.call("verify", { token: client, code: "123456" })).body.code).toBe("nocode");
    await x.call("code", { token: client });
    expect((await x.call("code", { token: client })).status).toBe(429); // a second code right away
    const good = x.codeFor("jordan@example.com");
    const bad = good === "000000" ? "111111" : "000000";
    for (let i = 0; i < 4; i++) expect((await x.call("verify", { token: client, code: bad })).body.code).toBe("wrong");
    expect((await x.call("verify", { token: client, code: bad })).body.error).toMatch(/used up/);
    expect((await x.call("verify", { token: client, code: good })).body.code).toBe("nocode"); // the right one no longer works
    // Ten wrong codes in an hour lock the link.
    await x.t.run(async (ctx) => { const s = (await ctx.db.query("wsSignings").collect()).find((y) => y.signerKey === "client")!; await ctx.db.patch(s._id, { codeSends: [], failures: Array(9).fill(Date.now()), codeHash: undefined }); });
    await x.call("code", { token: client });
    expect((await x.call("verify", { token: client, code: bad })).body.code).toBe("locked");
    expect((await x.call("code", { token: client })).body.code).toBe("locked");
  });

  test("an expired code, an expired link, a voided document and a replaced version are all refused", async () => {
    const x = await setup();
    await x.send();
    const { client, client2 } = await x.tokens();
    await x.call("code", { token: client });
    await x.t.run(async (ctx) => { const s = (await ctx.db.query("wsSignings").collect()).find((y) => y.signerKey === "client")!; await ctx.db.patch(s._id, { codeExpiresAt: Date.now() - 1 }); });
    expect((await x.call("verify", { token: client, code: x.codeFor("jordan@example.com") })).body.code).toBe("expired_code");
    const session = await x.verified(client2, "casey@example.com");
    await x.t.run((ctx) => ctx.db.patch(x.documentId, { expiresAt: Date.now() - 1 }));
    expect((await x.call("open", { token: client })).body.state).toBe("expired");
    expect((await x.call("doc", { token: client2, session })).body.code).toBe("expired");
    await x.me.mutation(api.sign.extendExpiry, { documentId: x.documentId, days: 7 });
    expect((await x.call("doc", { token: client2, session })).body.title).toBe("Service Agreement");
    await x.me.mutation(api.sign.voidDocument, { documentId: x.documentId, reason: "Scope changed" });
    await x.flush();
    expect((await x.call("open", { token: client })).body.state).toBe("voided");
    expect((await x.call("doc", { token: client2, session })).body.code).toBe("session"); // sessions cleared too
    expect(x.mails.filter((m) => m.subject.startsWith("Cancelled")).map((m) => m.to).sort()).toEqual(["casey@example.com", "jordan@example.com"]);
    // A new version after voiding: the old links stay dead.
    await x.me.mutation(api.sign.revise, { documentId: x.documentId });
    expect((await x.call("open", { token: client })).body.state).toMatch(/voided|superseded/);
    expect((await x.call("open", { token: "nope" })).body.state).toBe("missing");
  });
});

describe("T-S2.2 no skipping", () => {
  test("adopting needs consent; Sign needs consent, adoption, every initial and the statement", async () => {
    const x = await setup();
    await x.send();
    const { client } = await x.tokens();
    const s = await x.verified(client, "jordan@example.com");
    expect((await x.call("sign", { token: client, session: s, agreed: true })).body.error).toMatch(/sign electronically/);
    expect((await x.adopt(client, s, "Jordan Sample")).body.error).toMatch(/sign electronically/);
    expect((await x.call("consent", { token: client, session: s, agreed: false })).body.error).toBeTruthy();
    expect((await x.call("consent", { token: client, session: s, agreed: true })).body.ok).toBe(true);
    expect((await x.call("sign", { token: client, session: s, agreed: true })).body.error).toMatch(/Adopt/);
    expect((await x.call("initial", { token: client, session: s, boxId: "j-ini" })).body.error).toMatch(/Adopt/);
    expect((await x.adopt(client, s, "Jordan Sample")).body.ok).toBe(true);
    expect((await x.call("adopt", { token: client, session: s, name: "J", method: "typed", signature: "bm90IGEgcG5n", initials: PNG_B64 })).status).toBe(400);
    expect((await x.call("initial", { token: client, session: s, boxId: "c-sign" })).body.error).toMatch(/isn't one of your/);
    expect((await x.call("initial", { token: client, session: s, boxId: "j-ini" })).body.ok).toBe(true);
    expect((await x.call("sign", { token: client, session: s, agreed: true })).body.error).toMatch(/1 initial box is still empty/);
    expect((await x.call("initial", { token: client, session: s, boxId: "j-ini2" })).body.ok).toBe(true);
    expect((await x.call("sign", { token: client, session: s, agreed: false })).body.error).toMatch(/statement/);
    expect((await x.call("sign", { token: client, session: s, agreed: true })).body).toMatchObject({ ok: true, complete: false });
    // Signed: the link says so, the session is gone, nothing more can be done.
    expect((await x.call("open", { token: client })).body.state).toBe("signed");
    expect((await x.call("initial", { token: client, session: s, boxId: "j-ini", on: false })).body.code).toBe("session");
  });
});

describe("T-S2.3 the trail", () => {
  test("every step, in order, with email, IP and browser; the chain verifies; Heston is told", async () => {
    const x = await setup();
    await x.send();
    const { client, client2 } = await x.tokens();
    await x.call("open", { token: client }, IP.jordan);
    const s = await x.verified(client, "jordan@example.com", IP.jordan);
    await x.call("consent", { token: client, session: s, agreed: true }, IP.jordan);
    await x.call("viewed", { token: client, session: s, page: 0 }, IP.jordan);
    await x.call("viewed", { token: client, session: s, page: 0 }, IP.jordan); // once per page
    await x.call("viewed", { token: client, session: s, page: 1 }, IP.jordan);
    await x.adopt(client, s, "Jordan A. Sample", IP.jordan);
    await x.call("initial", { token: client, session: s, boxId: "j-ini" }, IP.jordan);
    await x.call("initial", { token: client, session: s, boxId: "j-ini2" }, IP.jordan);
    await x.call("sign", { token: client, session: s, agreed: true }, IP.jordan);
    const s2 = await x.verified(client2, "casey@example.com", IP.casey);
    await x.call("consent", { token: client2, session: s2, agreed: true }, IP.casey);
    await x.adopt(client2, s2, "Casey Lee", IP.casey);
    expect((await x.call("sign", { token: client2, session: s2, agreed: true }, IP.casey)).body).toMatchObject({ ok: true, complete: true });
    await x.flush();

    const d = (await x.me.query(api.sign.get, { documentId: x.documentId }))!;
    expect(d.doc.status).toBe("completed");
    expect(d.chain).toMatchObject({ ok: true });
    const jordan = d.events.filter((e) => e.email === "jordan@example.com" && e.ip === IP.jordan).map((e) => e.kind);
    expect(jordan).toEqual(["opened", "code_sent", "email_verified", "consent_given", "page_viewed", "page_viewed", "signature_adopted", "initialed", "initialed", "signed"]);
    const signed = d.events.find((e) => e.kind === "signed" && e.email === "jordan@example.com")!;
    expect(signed.detail).toMatch(/Jordan A\. Sample/);
    expect(signed.detail).toContain(d.version.lockHash!);
    expect(signed.detail).toContain(d.version.fileSha256);
    const all = await x.t.run((ctx) => ctx.db.query("wsEvents").collect());
    expect(all.filter((e) => e.actor === "signer:client").every((e) => e.userAgent === UA)).toBe(true);
    expect(d.events.some((e) => e.kind === "all_signed")).toBe(true);
    expect(x.mails.filter((m) => m.to === "heston@wranglerproductions.com").map((m) => m.subject)).toEqual(expect.arrayContaining(["Jordan Sample signed WS-00001", "Casey Lee signed WS-00001", "Signed by everyone: Service Agreement (WS-00001)"]));
  });
});

describe("T-S2.4 several signers", () => {
  test("one after another: the second gets a link only when the first has signed", async () => {
    const x = await setup("sequence");
    await x.send();
    expect(x.mails.filter((m) => m.subject.startsWith("Please sign")).map((m) => m.to)).toEqual(["jordan@example.com"]);
    const { client, client2 } = await x.tokens();
    expect((await x.call("open", { token: client2 })).body).toMatchObject({ state: "waiting", before: ["Jordan Sample"] });
    expect((await x.call("code", { token: client2 })).body.code).toBe("waiting");
    const s = await x.verified(client, "jordan@example.com");
    await x.call("consent", { token: client, session: s, agreed: true });
    await x.adopt(client, s, "Jordan Sample");
    for (const b of ["j-ini", "j-ini2"]) await x.call("initial", { token: client, session: s, boxId: b });
    await x.call("sign", { token: client, session: s, agreed: true });
    await x.flush();
    expect(x.mails.filter((m) => m.subject.startsWith("Please sign")).map((m) => m.to)).toEqual(["jordan@example.com", "casey@example.com"]);
    expect((await x.call("open", { token: client2 })).body.state).toBe("ready");
    expect((await x.me.query(api.sign.get, { documentId: x.documentId }))!.doc.status).toBe("sent");
  });

  test("reminders go only to someone whose turn it is and who hasn't signed", async () => {
    const x = await setup("sequence");
    await x.send();
    await expect(x.me.mutation(api.sign.resend, { documentId: x.documentId, signerKey: "client2" })).rejects.toThrow(/turn/);
    await x.t.run(async (ctx) => { for (const s of await ctx.db.query("wsSignings").collect()) await ctx.db.patch(s._id, { lastEmailAt: 0 }); });
    await x.me.mutation(api.sign.resend, { documentId: x.documentId, signerKey: "client" });
    await x.flush();
    expect(x.mails.filter((m) => m.subject.startsWith("Reminder: Please sign")).map((m) => m.to)).toEqual(["jordan@example.com"]);
  });
});

describe("T-S2.5 isolation", () => {
  test("a session, code or box from one signer does nothing on another's link or another document", async () => {
    const x = await setup();
    await x.send();
    const { client, client2 } = await x.tokens();
    const sj = await x.verified(client, "jordan@example.com");
    expect((await x.call("doc", { token: client2, session: sj })).body.code).toBe("session");
    await x.call("code", { token: client2 });
    expect((await x.call("verify", { token: client, code: x.codeFor("casey@example.com") })).body.code).toMatch(/nocode|wrong/);
    await x.call("consent", { token: client, session: sj, agreed: true });
    await x.adopt(client, sj, "Jordan Sample");
    expect((await x.call("initial", { token: client, session: sj, boxId: "c-sign" })).body.error).toMatch(/isn't one of your/);
    // What Jordan's page is given: his own boxes marked "me", Casey's only as "another signer", nothing of Casey's.
    const doc = (await x.call("doc", { token: client, session: sj })).body;
    expect(doc.boxes.filter((b: any) => b.who === "me").map((b: any) => b.id).sort()).toEqual(["j-date", "j-ini", "j-ini2", "j-sign"]);
    expect(doc.boxes.find((b: any) => b.id === "c-sign")).toMatchObject({ who: "other", otherName: "Casey Lee", otherSigned: false });
    expect(JSON.stringify(doc)).not.toContain("casey@example.com");
    expect(JSON.stringify(doc)).not.toContain(client2);
    expect(doc.heston).toMatchObject({ name: "Heston Hill", title: "Founder" });
    expect(doc.consent.id).toMatch(/^ws-consent-/);
  });

  test("an unknown origin gets no CORS permission; owner functions stay owner-only", async () => {
    const x = await setup();
    await x.send();
    const r = await x.t.fetch("/ws/open", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: JSON.stringify({ token: "x" }) });
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
    await expect(x.t.mutation(api.sign.voidDocument, { documentId: x.documentId })).rejects.toThrow(/Sign in/);
    await expect(x.t.mutation(api.sign.send, { versionId: x.versionId })).rejects.toThrow(/Sign in/);
  });
});
