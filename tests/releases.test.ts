// 5i (D193): a release signed in person on the owner's phone. The owner hands over: no link is emailed and no code is
// asked (the trail says so, with the device and the shoot's place); after that the signer goes through Sign's own steps,
// unchanged (consent, adopt, initial, Sign), and the finished copy goes to the email typed for them.
//   T-RL.1 hand over → sign → signed; the trail; no invite email
//   T-RL.2 refusals: not approved, twice, someone without Docs; a draft can be removed; shots must be on the day's list
//   T-RL.3 (541ac10 review): only the owner hands over; only a release's own document, with no owner signature, no
//          payment and the release's signer, goes the in-person way; the email isn't marked confirmed and the
//          certificate says who checked them in person
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { PERMS } from "../convex/lib/perms";
import { certificate } from "../convex/lib/wsFinal";

const modules = import.meta.glob("../convex/**/*.ts");
const OWNER = "owner@studio.example";
beforeAll(() => {
  process.env.ALLOWED_EMAILS = OWNER;
  process.env.RESEND_API_KEY = "re_test";
  process.env.SITE_URL = "https://app.wranglerportal.com";
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const SIGNER = "talent@signer.example";
type Mail = { to: string; subject: string };

async function pdf(): Promise<Uint8Array> {
  const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
  d.addPage([612, 792]).drawText("Talent release", { x: 72, y: 700, size: 12, font: f });
  return d.save();
}

async function setup() {
  const t = convexTest(schema, modules);
  const mails: Mail[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === "https://api.resend.com/emails") { const b = JSON.parse(String(init?.body)); mails.push({ to: b.to[0], subject: b.subject }); return new Response(JSON.stringify({ id: "em" }), { status: 200 }); }
    return new Response("{}", { status: 500 });
  });
  const ids = await t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", { email: OWNER, name: "Alex Owner", role: "owner" });
    const sub = `${owner}|${await ctx.db.insert("authSessions", { userId: owner, expirationTime: Date.now() + 3_600_000 })}`;
    const p = await ctx.db.insert("projects", { name: "Hospital stories", createdAt: 0 });
    const shootId = await ctx.db.insert("shoots", { projectId: p, date: "2030-11-16", call: "06:30", location: "Mercy Clinic, Springfield, MO", prepare: [], crew: [], status: "scheduled", history: [], createdAt: 0, updatedAt: 0 } as never);
    const listId = await ctx.db.insert("shotLists", { projectId: p, shootId, createdAt: 0, updatedAt: 0 } as never);
    const setupId = await ctx.db.insert("shotSetups", { listId, order: 1, title: "Lobby", createdAt: 0 } as never);
    const shot = await ctx.db.insert("shots", { listId, setupId, order: 1, number: 3, text: "Nurse at the whiteboard", releaseNeeded: true, createdAt: 0 } as never);
    const buildId = await ctx.db.insert("wsBuilds", { title: "Talent release: Riley Quinn", blocks: { type: "doc", content: [] }, fields: {}, signers: [], style: {}, createdAt: 0, updatedAt: 0 } as never);
    return { sub, shootId, shot, buildId, listId, p };
  });
  const me = t.withIdentity({ subject: ids.sub });
  const store = (b: Uint8Array, type: string) => t.run((ctx) => ctx.storage.store(new Blob([b], { type })));
  const { documentId } = await me.action(api.sign.create, { storageId: await store(await pdf(), "application/pdf"), fileName: "Talent release.pdf" });
  const versionId = (await me.query(api.sign.get, { documentId }))!.version._id;
  await me.mutation(api.sign.saveLayout, {
    versionId, title: "Talent release: Riley Quinn", signingOrder: "any", payment: null,
    signers: [{ key: "client", name: "Riley Quinn", email: SIGNER, order: 1 }],
    boxes: [{ id: "r-sign", signer: "client", kind: "sign", page: 0, x: 0.1, y: 0.7, w: 0.3, h: 0.05 }, { id: "r-date", signer: "client", kind: "date", page: 0, x: 0.5, y: 0.7, w: 0.2, h: 0.02 }],
  });
  const releaseId = await t.run((ctx) => ctx.db.insert("releases", { shootId: ids.shootId, projectId: ids.p, kind: "talent", name: "Riley Quinn", email: SIGNER, shotIds: [ids.shot], buildId: ids.buildId, createdAt: 0, updatedAt: 0 }));
  const call = async (op: string, body: Record<string, unknown>) => {
    const r = await t.fetch(`/ws/${op}`, { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.9", "user-agent": "iPhone", origin: "https://sign.wranglerportal.com" }, body: JSON.stringify(body) });
    return (await r.json()) as Record<string, any>;
  };
  const flush = async () => { vi.useFakeTimers(); await t.finishAllScheduledFunctions(vi.runAllTimers); vi.useRealTimers(); };
  return { t, me, mails, ids, documentId, versionId, releaseId, call, flush };
}

describe("releases on set", () => {
  test("T-RL.1 hand over, sign with Sign's own steps, signed; the trail says in person; no invite email", async () => {
    const x = await setup();
    // Not approved yet: nothing to hand over.
    await expect(x.me.mutation(api.releases.handOver, { releaseId: x.releaseId, device: "iPhone", checked: true })).rejects.toThrow(/isn't ready/);
    await x.t.run((ctx) => ctx.db.patch(x.releaseId, { documentId: x.documentId }));
    await x.me.mutation(api.sign.approve, { versionId: x.versionId });
    expect((await x.me.query(api.releases.get, { releaseId: x.releaseId }))!.state).toBe("ready");
    // Q2 (Nov 17): a hand-back PIN comes first.
    await expect(x.me.mutation(api.releases.handOver, { releaseId: x.releaseId, device: "iPhone", checked: true })).rejects.toThrow(/hand-back PIN/);
    await expect(x.me.mutation(api.handBack.setPin, { pin: "12a4" })).rejects.toThrow(/4 digits/);
    await x.me.mutation(api.handBack.setPin, { pin: "2580" });
    expect(await x.me.query(api.handBack.mine, {})).toEqual({ pin: true, passkeys: [] });
    const h = await x.me.mutation(api.releases.handOver, { releaseId: x.releaseId, device: "iPhone", checked: true });
    // Handed over: this sign-in answers nothing of the business (any page), only its release and the hand-back.
    expect(await x.me.query(api.users.me, {})).toMatchObject({ allowed: false, locked: { releaseId: x.releaseId, signer: "Riley Quinn" } });
    await expect(x.me.query(api.releases.forShoot, { shootId: x.ids.shootId })).rejects.toThrow(/Not allowed/);
    await expect(x.me.query(api.handBack.mine, {})).rejects.toThrow(/Not allowed/);
    await expect(x.me.mutation(api.releases.handOver, { releaseId: x.releaseId, device: "iPhone", checked: true })).rejects.toThrow(/Not allowed/);
    expect((await x.me.query(api.releases.get, { releaseId: x.releaseId }))!.state).toBe("signing");
    await x.flush();
    expect(x.mails.filter((m) => m.to === SIGNER)).toEqual([]); // no link was emailed
    // The signer's steps are Sign's own: the session the hand-over gave opens the document; Sign waits for consent.
    expect((await x.call("open", { token: h.token, session: h.session })).verified).toBe(true);
    expect((await x.call("sign", { token: h.token, session: h.session, agreed: true })).error).toMatch(/Agree to sign electronically/);
    expect(await x.call("consent", { token: h.token, session: h.session, agreed: true })).toMatchObject({ ok: true });
    expect(await x.call("adopt", { token: h.token, session: h.session, name: "Riley Quinn", method: "typed", signature: PNG_B64, initials: PNG_B64 })).toMatchObject({ ok: true });
    expect(await x.call("sign", { token: h.token, session: h.session, agreed: true })).toMatchObject({ ok: true, complete: true });
    expect((await x.me.query(api.releases.get, { releaseId: x.releaseId }))!.state).toBe("signed");
    // Hand back: a wrong PIN counts down; the right one unlocks; the business answers again.
    expect(await x.me.mutation(api.handBack.unlockWithPin, { pin: "1111" })).toEqual({ ok: false, left: 4 });
    expect(await x.me.mutation(api.handBack.unlockWithPin, { pin: "2580" })).toEqual({ ok: true });
    expect((await x.me.query(api.users.me, {}))!.locked).toBeNull();
    await expect(x.me.mutation(api.handBack.unlockWithPin, { pin: "2580" })).rejects.toThrow(/Not allowed/);
    const ev = (await x.me.query(api.sign.get, { documentId: x.documentId }))!.events;
    expect(ev.find((e) => e.kind === "in_person")?.detail).toMatch(/Signing in person on Alex's iPhone at Mercy Clinic, Springfield, MO \(the shoot's place\)/);
    expect(ev.find((e) => e.kind === "sent")?.detail).toMatch(/No link was emailed/);
    expect(ev.some((e) => e.kind === "code_sent")).toBe(false);
    // Review H2: no code, so the email isn't marked confirmed; the in-person check is kept apart.
    const sg = await x.t.run(async (ctx) => (await ctx.db.query("wsSignings").collect())[0]);
    expect(sg.verifiedAt ?? null).toBeNull();
    expect(sg.inPerson).toMatchObject({ by: "Alex Owner", device: "Alex's iPhone", place: "Mercy Clinic, Springfield, MO" });
    // The shot it covers no longer counts as missing.
    expect((await x.me.query(api.releases.forShoot, { shootId: x.ids.shootId }))!.missing).toEqual([]);
  });

  test("Q2 five wrong PINs sign the handed-over session out (only that one); a passkey can't be added while handed over", async () => {
    const x = await setup();
    await x.t.run((ctx) => ctx.db.patch(x.releaseId, { documentId: x.documentId }));
    await x.me.mutation(api.sign.approve, { versionId: x.versionId });
    await x.me.mutation(api.handBack.setPin, { pin: "2580" });
    const other = await x.t.run(async (ctx) => { const u = (await ctx.db.query("users").first())!._id; return ctx.db.insert("authSessions", { userId: u, expirationTime: Date.now() + 3_600_000 }); });
    await x.me.mutation(api.releases.handOver, { releaseId: x.releaseId, device: "iPhone", checked: true });
    await expect(x.me.action(api.passkeys.registerOptions, { origin: "https://app.wranglerportal.com" })).rejects.toThrow(/Not allowed/);
    await expect(x.me.action(api.passkeys.unlockOptions, { origin: "https://evil.example" })).rejects.toThrow(/portal's own address/);
    await expect(x.me.action(api.passkeys.unlockOptions, { origin: "https://app.wranglerportal.com" })).rejects.toThrow(/No passkey yet/);
    for (const left of [4, 3, 2, 1]) expect(await x.me.mutation(api.handBack.unlockWithPin, { pin: "0000" })).toEqual({ ok: false, left });
    expect(await x.me.mutation(api.handBack.unlockWithPin, { pin: "0000" })).toEqual({ ok: false, signedOut: true });
    const s = x.ids.sub.split("|")[1] as Id<"authSessions">;
    expect(await x.t.run((ctx) => ctx.db.get(s))).toBeNull();
    expect(await x.t.run((ctx) => ctx.db.get(other))).not.toBeNull(); // their other devices stay signed in
    // Review H1: the same sign-in (its token still valid) gets nothing back: not the business, not a new PIN, no unlock.
    expect(await x.me.query(api.users.me, {})).toMatchObject({ allowed: false, locked: { signedOut: true } });
    await expect(x.me.query(api.releases.forShoot, { shootId: x.ids.shootId })).rejects.toThrow(/Not allowed/);
    await expect(x.me.mutation(api.handBack.setPin, { pin: "1111" })).rejects.toThrow(/Not allowed/);
    await expect(x.me.mutation(api.handBack.unlockWithPin, { pin: "2580" })).rejects.toThrow(/Not allowed/);
    await expect(x.me.query(api.handBack.mine, {})).rejects.toThrow(/Not allowed/);
    // Their other sign-in still works as the owner.
    const elsewhere = x.t.withIdentity({ subject: `${x.ids.sub.split("|")[0]}|${other}` });
    expect(await elsewhere.query(api.handBack.mine, {})).toMatchObject({ pin: true });
    // The mark is cleared once the token can't be used any more (the 6-hourly sweep).
    expect(await x.t.run((ctx) => ctx.db.query("sessionLocks").collect())).toHaveLength(1);
    await x.t.run(async (ctx) => { for (const l of await ctx.db.query("sessionLocks").collect()) await ctx.db.patch(l._id, { at: Date.now() - 4 * 3_600_000 }); });
    expect(await x.t.mutation(internal.handBack.sweep, {})).toBe(1);
  });

  test("T-RL.2 a draft can be removed; shots must be on the day's list; someone without Docs is refused", async () => {
    const x = await setup();
    expect((await x.me.query(api.releases.forShoot, { shootId: x.ids.shootId }))!.missing.map((m) => m.number)).toEqual([3]);
    await x.me.mutation(api.releases.markShot, { shotId: x.ids.shot, needed: false });
    expect((await x.me.query(api.releases.forShoot, { shootId: x.ids.shootId }))!.missing).toEqual([]);
    const tpls = await x.me.mutation(api.releases.templates, {});
    expect(tpls.map((t) => t.kind).sort()).toEqual(["location", "minor", "talent"]);
    const minor = tpls.find((t) => t.kind === "minor")!;
    await expect(x.me.mutation(api.releases.create, { shootId: x.ids.shootId, templateId: minor._id as Id<"wsTemplates">, name: "Pat Quinn", email: "guardian@signer.example", shotIds: [] })).rejects.toThrow(/minor's name/);
    const other = await x.t.run(async (ctx) => {
      const list = await ctx.db.insert("shotLists", { title: "Other", createdAt: 0, updatedAt: 0 } as never);
      const st = await ctx.db.insert("shotSetups", { listId: list, order: 1, title: "X", createdAt: 0 } as never);
      return ctx.db.insert("shots", { listId: list, setupId: st, order: 1, number: 1, text: "Elsewhere", createdAt: 0 } as never);
    });
    await expect(x.me.mutation(api.releases.create, { shootId: x.ids.shootId, templateId: minor._id as Id<"wsTemplates">, name: "Pat Quinn", email: "guardian@signer.example", minorName: "Sam Quinn", shotIds: [other] })).rejects.toThrow(/isn't on this shoot's list/);
    const made = await x.me.mutation(api.releases.create, { shootId: x.ids.shootId, templateId: minor._id as Id<"wsTemplates">, name: "Pat Quinn", email: "guardian@signer.example", minorName: "Sam Quinn", shotIds: [x.ids.shot] });
    const b = await x.t.run(async (ctx) => (await ctx.db.get(made.buildId))!);
    expect(b.title).toBe("Minor release: Sam Quinn");
    expect(b.fields as unknown).toMatchObject({ client: { name: "Pat Quinn" } });
    expect((b.fields as { custom: Array<{ key: string; value: string }> }).custom).toEqual(expect.arrayContaining([{ key: "minor.name", label: "Minor's name", value: "Sam Quinn" }, { key: "location", label: "Location", value: "Mercy Clinic, Springfield, MO" }]));
    await x.me.mutation(api.releases.remove, { releaseId: made.releaseId });
    expect(await x.t.run((ctx) => ctx.db.get(made.buildId))).toBeNull();
    // A team member with Shoots but not Docs can't see or start releases.
    const sub = await x.t.run(async (ctx) => {
      const b2 = (await ctx.db.query("businesses").first())?._id;
      const u = await ctx.db.insert("users", { email: "crew@studio.example", name: "Pat", role: "team", emailVerificationTime: 0 });
      await ctx.db.insert("memberships", { ...(b2 ? { businessId: b2 } : {}), email: "crew@studio.example", userId: u, role: "team", teamRole: "producer", perms: Object.fromEntries(PERMS.map((p) => [p, p === "shoots" || p === "production"])), createdAt: 1 } as never);
      return `${u}|${await ctx.db.insert("authSessions", { userId: u, expirationTime: Date.now() + 3_600_000 })}`;
    });
    const pat = x.t.withIdentity({ subject: sub });
    await expect(pat.query(api.releases.forShoot, { shootId: x.ids.shootId })).rejects.toThrow();
    await expect(pat.mutation(api.releases.handOver, { releaseId: x.releaseId, device: "iPhone", checked: true })).rejects.toThrow();
  });

  test("T-RL.3 owner only; release documents only; the certificate's in-person line", async () => {
    const x = await setup();
    await x.t.run((ctx) => ctx.db.patch(x.releaseId, { documentId: x.documentId }));
    await x.me.mutation(api.sign.approve, { versionId: x.versionId });
    const producer = await x.t.run(async (ctx) => {
      const b2 = (await ctx.db.query("businesses").first())?._id;
      const u = await ctx.db.insert("users", { email: "producer@studio.example", name: "Jo", role: "team", emailVerificationTime: 0 });
      await ctx.db.insert("memberships", { ...(b2 ? { businessId: b2 } : {}), email: "producer@studio.example", userId: u, role: "team", teamRole: "producer", perms: Object.fromEntries(PERMS.map((p) => [p, p !== "settings" && p !== "payments" && p !== "value"])), createdAt: 1 } as never);
      return `${u}|${await ctx.db.insert("authSessions", { userId: u, expirationTime: Date.now() + 3_600_000 })}`;
    });
    const jo = x.t.withIdentity({ subject: producer });
    // A team member with Docs and Shoots can see and fill in releases, but not approve or hand them over.
    expect(await jo.query(api.releases.forShoot, { shootId: x.ids.shootId })).not.toBeNull();
    await expect(jo.mutation(api.releases.handOver, { releaseId: x.releaseId, device: "iPhone", checked: true })).rejects.toThrow(/Not allowed/);
    const sid = await x.t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array([37, 80, 68, 70])], { type: "application/pdf" })));
    await expect(jo.action(api.releases.prepare, { releaseId: x.releaseId, storageId: sid })).rejects.toThrow(/Not allowed/);
    // A signer who isn't the release's is refused.
    await x.t.run((ctx) => ctx.db.patch(x.releaseId, { email: "someone@else.example" }));
    await expect(x.me.mutation(api.releases.handOver, { releaseId: x.releaseId, device: "iPhone", checked: true })).rejects.toThrow(/isn't Riley Quinn/);
    await x.t.run((ctx) => ctx.db.patch(x.releaseId, { email: SIGNER }));
    // An owner signature or a payment is refused (they're sent from Contracts).
    const ver = await x.t.run(async (ctx) => (await ctx.db.get(x.versionId))!);
    await x.t.run((ctx) => ctx.db.patch(x.versionId, { signers: [...ver.signers, { key: "heston", name: "Alex Owner", email: OWNER, order: 0 }] } as never));
    await expect(x.me.mutation(api.releases.handOver, { releaseId: x.releaseId, device: "iPhone", checked: true })).rejects.toThrow(/no business signature/);
    await x.t.run((ctx) => ctx.db.patch(x.versionId, { signers: ver.signers, payment: { amountCents: 5000, description: "Deposit" } } as never));
    await expect(x.me.mutation(api.releases.handOver, { releaseId: x.releaseId, device: "iPhone", checked: true })).rejects.toThrow(/no payment/);
    await x.t.run((ctx) => ctx.db.patch(x.versionId, { payment: ver.payment } as never));
    // A document that isn't a release's can't be signed in person.
    await x.t.run((ctx) => ctx.db.patch(x.releaseId, { documentId: undefined }));
    const { sendInPersonCore } = await import("../convex/sign");
    await expect(x.t.run((ctx) => sendInPersonCore(ctx as never, x.versionId, { device: "iPhone", place: null, by: "Alex" }))).rejects.toThrow(/Only a release/);
    // The certificate: who checked them, and that the email wasn't confirmed.
    const s0 = { key: "client", name: "Riley Quinn", email: SIGNER, title: null, adoptedName: "Riley Quinn", adoptedTitle: null, method: "typed", signaturePng: new Uint8Array(), initialsPng: new Uint8Array(), signatureSha256: "a", initialsSha256: "b", signedAt: 2, signedDate: "2030-11-16", ip: null, userAgent: null, verifiedAt: null, consentAt: 1, consentVersion: "v1", adoptedAt: 1, initialed: [], viewedPages: [0], inPerson: { at: 1, by: "Alex Owner", device: "Alex's iPhone", place: "Mercy Clinic" } };
    const lines = certificate({ label: "WRNGLR-0001", title: "Talent release", company: "Studio", versionNumber: 1, fileName: "r.pdf", fileSha256: "x", lockHash: "y", pages: 1, sentAt: 1, completedAt: 2, signingOrder: "any", owner: null, signers: [s0], boxes: [], events: [], statement: "I agree", verifyUrl: "https://example.test" });
    const text = lines.join("\n");
    expect(text).toMatch(/Signed in person on Alex's iPhone at Mercy Clinic: Alex Owner confirmed in person who was signing/);
    expect(text).toMatch(/Email not confirmed with a code/);
    expect(text).not.toMatch(/one-time code sent/);
  });
});
