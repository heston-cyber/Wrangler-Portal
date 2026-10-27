// Wrangler Sign Phase S1 (Oct 27): documents, versions, approval, Heston's signature, the audit trail.
//   T-S1.2 versions: an approved version is locked; a change makes a new version; earlier ones stay exactly as they were.
//   T-S1.3 Heston's signature: adopted once, applied only to the current approved, unchanged version, and logged.
//   T-S1.4 access: everything here is owner-only (also covered by the access matrix in access.test.ts).
//   Plus: uploads are checked (PDF, not encrypted), the lock hash, the hash-chained trail, delete rules.
import { convexTest } from "convex-test";
import { beforeAll, describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { verifyChain } from "../convex/lib/wsAudit";

const modules = import.meta.glob("../convex/**/*.ts");
beforeAll(() => { process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com"; });

const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

async function samplePdf(pages = 2, text = "Sample agreement", objectStreams = true): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) d.addPage([612, 792]).drawText(`${text} page ${i + 1} {{sign:client}}`, { x: 72, y: 700, size: 12, font: f });
  return d.save({ useObjectStreams: objectStreams });
}

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston", role: "owner" });
    const client = await ctx.db.insert("users", { email: "client@example.com", name: "Client", role: "client" });
    const sess = async (userId: Id<"users">) => `${userId}|${await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 })}`;
    return { ownerSub: await sess(owner), clientSub: await sess(client) };
  });
  const me = t.withIdentity({ subject: ids.ownerSub });
  const client = t.withIdentity({ subject: ids.clientSub });
  const store = (bytes: Uint8Array, type = "application/pdf") => t.run((ctx) => ctx.storage.store(new Blob([bytes], { type })));
  return { t, me, client, store };
}

type Me = Awaited<ReturnType<typeof setup>>["me"];
const goodSigners = [{ key: "client", name: "Jordan Sample", email: "Jordan@Example.com", order: 1 }, { key: "heston", name: "ignored", email: "ignored@x.com", order: 1 }];
const goodBoxes = [
  { id: "a", signer: "client", kind: "sign" as const, page: 0, x: 0.1, y: 0.8, w: 0.3, h: 0.05, cover: { page: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.02 }, fromMarker: true },
  { id: "b", signer: "client", kind: "initials" as const, page: 1, x: 0.1, y: 0.5, w: 0.1, h: 0.04 },
  { id: "c", signer: "heston", kind: "sign" as const, page: 1, x: 0.5, y: 0.8, w: 0.3, h: 0.05 },
  { id: "d", signer: "heston", kind: "date" as const, page: 1, x: 0.5, y: 0.86, w: 0.2, h: 0.02 },
];

async function adopt(me: Me, store: (b: Uint8Array, t?: string) => Promise<Id<"_storage">>) {
  await me.action(api.sign.adoptSignature, { name: "Heston Hill", title: "Founder", method: "typed", signatureStorageId: await store(PNG, "image/png"), initialsStorageId: await store(PNG, "image/png") });
}

async function newDoc(me: Me, store: (b: Uint8Array, t?: string) => Promise<Id<"_storage">>) {
  const { documentId, label } = await me.action(api.sign.create, { storageId: await store(await samplePdf()), fileName: "Sample_Agreement.pdf" });
  const d = (await me.query(api.sign.get, { documentId }))!;
  return { documentId, label, versionId: d.version._id };
}

describe("uploading", () => {
  test("a PDF becomes WS-00001 v1 as a draft; numbers count up and are never reused", async () => {
    const { me, store } = await setup();
    const a = await newDoc(me, store);
    expect(a.label).toBe("WS-00001");
    const d = (await me.query(api.sign.get, { documentId: a.documentId }))!;
    expect(d.doc.status).toBe("draft");
    expect(d.doc.title).toBe("Sample Agreement");
    expect(d.version).toMatchObject({ number: 1, fileName: "Sample_Agreement.pdf", editable: true });
    expect(d.version.pages).toEqual([{ width: 612, height: 792, rotate: 0 }, { width: 612, height: 792, rotate: 0 }]);
    expect(d.version.fileSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(d.events.map((e) => e.kind)).toEqual(["created"]);
    await me.mutation(api.sign.remove, { documentId: a.documentId });
    expect((await newDoc(me, store)).label).toBe("WS-00002");
  });

  test("not a PDF, or a password-protected PDF, is refused and the upload removed", async () => {
    const { me, store, t } = await setup();
    const txt = await store(new TextEncoder().encode("hello"), "text/plain");
    await expect(me.action(api.sign.create, { storageId: txt, fileName: "x.pdf" })).rejects.toThrow(/isn't a PDF/);
    expect(await t.run(async (ctx) => (await ctx.storage.get(txt)) !== null)).toBe(false);
    // A PDF with an /Encrypt entry in its trailer (what any password or permissions lock adds).
    const raw = new TextDecoder("latin1").decode(await samplePdf(1, "Locked", false));
    const enc = raw.replace(/trailer\s*<</, "trailer\n<<\n/Encrypt << /Filter /Standard /V 4 /R 4 /O <00> /U <00> /P -4 >>");
    const id = await store(new Uint8Array([...enc].map((c) => c.charCodeAt(0))));
    await expect(me.action(api.sign.create, { storageId: id, fileName: "locked.pdf" })).rejects.toThrow(/password|can't be read/);
    expect(await me.query(api.sign.list, {})).toHaveLength(0);
  });
});

describe("T-S1.2 versions", () => {
  test("approve locks; editing is refused; a new version copies it; the approved one is untouched", async () => {
    const { me, store, t } = await setup();
    await adopt(me, store);
    const { documentId, versionId } = await newDoc(me, store);
    await me.mutation(api.sign.saveLayout, { versionId, title: "Service Agreement", signers: goodSigners, boxes: goodBoxes, signingOrder: "any", payment: { amountCents: 120000, description: "Deposit" } });
    let d = (await me.query(api.sign.get, { documentId }))!;
    // Heston's row is always his own name, title and email, whatever was sent; client emails are lower-cased.
    expect(d.version.signers.find((s) => s.key === "heston")).toMatchObject({ name: "Heston Hill", title: "Founder", email: "heston@wranglerproductions.com" });
    expect(d.version.signers.find((s) => s.key === "client")?.email).toBe("jordan@example.com");
    expect(d.problems).toEqual([]);

    const { lockHash } = await me.mutation(api.sign.approve, { versionId });
    expect(lockHash).toMatch(/^[0-9a-f]{64}$/);
    d = (await me.query(api.sign.get, { documentId }))!;
    expect(d.doc.status).toBe("approved");
    expect(d.version.editable).toBe(false);
    await expect(me.mutation(api.sign.saveLayout, { versionId, title: "Changed", signers: goodSigners, boxes: [], signingOrder: "any", payment: null })).rejects.toThrow(/locked/);
    await expect(me.mutation(api.sign.approve, { versionId })).rejects.toThrow(/locked/);

    const v1Before = await t.run((ctx) => ctx.db.get(versionId));
    await me.mutation(api.sign.revise, { documentId });
    d = (await me.query(api.sign.get, { documentId }))!;
    expect(d.doc).toMatchObject({ status: "draft", currentVersion: 2 });
    expect(d.version).toMatchObject({ number: 2, editable: true, boxes: v1Before!.boxes, fileSha256: v1Before!.fileSha256 });
    expect(d.version.approvedAt).toBeUndefined();
    // Change v2; v1 is exactly as it was approved.
    await me.mutation(api.sign.saveLayout, { versionId: d.version._id, title: "Service Agreement", signers: goodSigners, boxes: goodBoxes.slice(0, 1).concat(goodBoxes.slice(2)), signingOrder: "sequence", payment: null });
    expect(await t.run((ctx) => ctx.db.get(versionId))).toEqual(v1Before);
    const old = (await me.query(api.sign.get, { documentId, versionNumber: 1 }))!;
    expect(old.version).toMatchObject({ number: 1, isCurrent: false, editable: false, lockHash });
    // An older version can't be edited even though the document is a draft again.
    await expect(me.mutation(api.sign.saveLayout, { versionId, title: "x", signers: goodSigners, boxes: goodBoxes, signingOrder: "any", payment: null })).rejects.toThrow(/older version|locked/);
    expect(d.versions.map((x) => x.number)).toEqual([2, 1]);
  });

  test("a new PDF is a new version: signers carry over, boxes start empty, the old file stays", async () => {
    const { me, store, t } = await setup();
    const { documentId, versionId } = await newDoc(me, store);
    await me.mutation(api.sign.saveLayout, { versionId, title: "T", signers: goodSigners.slice(0, 1), boxes: goodBoxes.slice(0, 2), signingOrder: "any", payment: null });
    const v1 = (await t.run((ctx) => ctx.db.get(versionId)))!;
    const { versionNumber } = await me.action(api.sign.replaceFile, { documentId, storageId: await store(await samplePdf(3, "Revised")), fileName: "Revised.pdf" });
    expect(versionNumber).toBe(2);
    const d = (await me.query(api.sign.get, { documentId }))!;
    expect(d.version).toMatchObject({ number: 2, fileName: "Revised.pdf", boxes: [], signers: v1.signers });
    expect(d.version.pages).toHaveLength(3);
    expect(d.version.fileSha256).not.toBe(v1.fileSha256);
    expect(await t.run(async (ctx) => (await ctx.storage.get(v1.fileId)) !== null)).toBe(true);
    expect(d.events.map((e) => e.kind)).toEqual(["created", "new_version"]);
  });

  test("approval needs a client with a name, email and signature box, and Heston's adopted signature if he signs", async () => {
    const { me, store } = await setup();
    const { documentId, versionId } = await newDoc(me, store);
    let d = (await me.query(api.sign.get, { documentId }))!;
    expect(d.problems.join(" ")).toMatch(/needs a name/);
    await me.mutation(api.sign.saveLayout, { versionId, title: "T", signers: goodSigners, boxes: goodBoxes, signingOrder: "any", payment: { amountCents: 0, description: "" } });
    d = (await me.query(api.sign.get, { documentId }))!;
    expect(d.problems.join(" ")).toMatch(/Adopt your signature/);
    expect(d.problems.join(" ")).toMatch(/invoice amount/);
    await expect(me.mutation(api.sign.approve, { versionId })).rejects.toThrow(/Adopt your signature/);
    await adopt(me, store);
    await me.mutation(api.sign.saveLayout, { versionId, title: "T", signers: goodSigners, boxes: goodBoxes.filter((b) => b.signer !== "client" || b.kind !== "sign"), signingOrder: "any", payment: null });
    await expect(me.mutation(api.sign.approve, { versionId })).rejects.toThrow(/Jordan Sample needs a signature box/);
  });

  test("bad layouts are refused when saving", async () => {
    const { me, store } = await setup();
    const { versionId } = await newDoc(me, store);
    const save = (boxes: unknown[], signers: unknown[] = goodSigners) => me.mutation(api.sign.saveLayout, { versionId, title: "T", signers: signers as never, boxes: boxes as never, signingOrder: "any", payment: null });
    await expect(save([{ ...goodBoxes[0], page: 5 }])).rejects.toThrow(/page that doesn't exist/);
    await expect(save([{ ...goodBoxes[0], x: 0.9 }])).rejects.toThrow(/runs off the page/);
    await expect(save([{ ...goodBoxes[0], signer: "nobody" }])).rejects.toThrow(/isn't a signer/);
    await expect(save([goodBoxes[0], goodBoxes[0]])).rejects.toThrow(/repeated id/);
    await expect(save([], [{ key: "Bad Key", name: "", email: "", order: 1 }])).rejects.toThrow(/can only use/);
    await save(goodBoxes);
  });
});

describe("T-S1.3 Heston's signature", () => {
  test("applied only to the current, approved, unchanged version; logged once with the signature used", async () => {
    const { me, store, t } = await setup();
    await adopt(me, store);
    const { documentId, versionId } = await newDoc(me, store);
    await me.mutation(api.sign.saveLayout, { versionId, title: "T", signers: goodSigners, boxes: goodBoxes, signingOrder: "any", payment: null });
    await expect(t.mutation(internal.sign.applyOwnerSignature, { versionId })).rejects.toThrow(/approved version/);
    await me.mutation(api.sign.approve, { versionId });

    // Changed behind approval's back (as if the database were edited): refused.
    const real = (await t.run((ctx) => ctx.db.get(versionId)))!;
    await t.run((ctx) => ctx.db.patch(versionId, { boxes: real.boxes.map((b) => (b.id === "a" ? { ...b, x: 0.2 } : b)) }));
    await expect(t.mutation(internal.sign.applyOwnerSignature, { versionId })).rejects.toThrow(/changed after it was approved/);
    await t.run((ctx) => ctx.db.patch(versionId, { boxes: real.boxes }));

    expect(await t.mutation(internal.sign.applyOwnerSignature, { versionId })).toEqual({ applied: true });
    expect(await t.mutation(internal.sign.applyOwnerSignature, { versionId })).toEqual({ applied: true, already: true });
    const d = (await me.query(api.sign.get, { documentId }))!;
    const ev = d.events.filter((e) => e.kind === "owner_signed");
    expect(ev).toHaveLength(1);
    expect(ev[0].detail).toMatch(/Heston Hill, Founder/);
    expect(ev[0].email).toBe("heston@wranglerproductions.com");
    const sig = (await me.query(api.sign.ownerSignature, {}));
    expect(sig.adopted && ev[0].detail?.includes(sig.signatureSha256)).toBe(true);

    // A newer version means the old one can't be signed any more.
    await me.mutation(api.sign.revise, { documentId });
    await expect(t.mutation(internal.sign.applyOwnerSignature, { versionId })).rejects.toThrow(/current, approved/);
  });

  test("adopting again replaces it; the old one is kept; drafts pick up the new name", async () => {
    const { me, store, t } = await setup();
    await adopt(me, store);
    const { versionId } = await newDoc(me, store);
    await me.mutation(api.sign.saveLayout, { versionId, title: "T", signers: goodSigners, boxes: goodBoxes, signingOrder: "any", payment: null });
    await me.action(api.sign.adoptSignature, { name: "Heston R. Hill", title: "Owner", method: "drawn", signatureStorageId: await store(PNG, "image/png"), initialsStorageId: await store(PNG, "image/png") });
    expect(await me.query(api.sign.ownerSignature, {})).toMatchObject({ adopted: true, name: "Heston R. Hill", title: "Owner", method: "drawn" });
    expect(await t.run((ctx) => ctx.db.query("wsOwnerSignatures").collect())).toHaveLength(2);
    const v = (await t.run((ctx) => ctx.db.get(versionId)))!;
    expect(v.signers.find((s) => s.key === "heston")).toMatchObject({ name: "Heston R. Hill", title: "Owner" });
  });

  test("only PNGs are adopted", async () => {
    const { me, store } = await setup();
    await expect(me.action(api.sign.adoptSignature, { name: "H", title: "F", method: "typed", signatureStorageId: await store(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), "image/png"), initialsStorageId: await store(PNG, "image/png") })).rejects.toThrow(/PNG/);
  });
});

describe("audit trail", () => {
  test("every event chains to the one before; editing or deleting one is caught", async () => {
    const { me, store, t } = await setup();
    await adopt(me, store);
    const { documentId, versionId } = await newDoc(me, store);
    await me.mutation(api.sign.saveLayout, { versionId, title: "T", signers: goodSigners, boxes: goodBoxes, signingOrder: "any", payment: null });
    await me.mutation(api.sign.approve, { versionId });
    await me.mutation(api.sign.revise, { documentId });
    const d = (await me.query(api.sign.get, { documentId }))!;
    expect(d.chain).toEqual({ ok: true, count: 3 });
    const events = await t.run((ctx) => ctx.db.query("wsEvents").withIndex("by_document", (q) => q.eq("documentId", documentId)).collect());
    expect(await verifyChain(events.map((e) => (e.seq === 2 ? { ...e, detail: e.detail + " (edited)" } : e)))).toEqual({ ok: false, atSeq: 2, reason: "this event was changed" });
    expect(await verifyChain(events.filter((e) => e.seq !== 2))).toEqual({ ok: false, atSeq: 2, reason: "an event is missing" });
    await t.run((ctx) => ctx.db.patch(events[0]._id, { at: events[0].at + 1 }));
    expect((await me.query(api.sign.get, { documentId }))!.chain).toMatchObject({ ok: false, atSeq: 1 });
  });
});

describe("deleting and preview", () => {
  test("a draft or approved document can be deleted with its files; a sent one can't", async () => {
    const { me, store, t } = await setup();
    const { documentId, versionId } = await newDoc(me, store);
    const fileId = (await t.run((ctx) => ctx.db.get(versionId)))!.fileId;
    await t.run((ctx) => ctx.db.patch(documentId, { status: "sent" }));
    await expect(me.mutation(api.sign.remove, { documentId })).rejects.toThrow(/kept for the record/);
    await t.run((ctx) => ctx.db.patch(documentId, { status: "approved" }));
    await me.mutation(api.sign.remove, { documentId });
    expect(await me.query(api.sign.get, { documentId })).toBeNull();
    expect(await t.run(async (ctx) => (await ctx.storage.get(fileId)) !== null)).toBe(false);
    expect(await t.run((ctx) => ctx.db.query("wsEvents").collect())).toHaveLength(0);
  });

  test("the preview is a real PDF with a certificate page, kept only briefly", async () => {
    const { me, store, t } = await setup();
    await adopt(me, store);
    const { versionId } = await newDoc(me, store);
    await me.mutation(api.sign.saveLayout, { versionId, title: "T", signers: goodSigners, boxes: goodBoxes, signingOrder: "any", payment: null });
    const r = await me.action(api.sign.preview, { versionId });
    expect(r.fileName).toBe("WS-00001 v1 PREVIEW.pdf");
    const files = await t.run((ctx) => ctx.db.system.query("_storage").collect());
    const previewFile = files[files.length - 1];
    const buf = await t.run(async (ctx) => (await ctx.storage.get(previewFile._id))!.arrayBuffer());
    const pdf = await PDFDocument.load(new Uint8Array(buf));
    expect(pdf.getPageCount()).toBe(3); // 2 pages + the certificate
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.some((s) => s.name.includes("deletePreview"))).toBe(true);
  });
});

describe("T-S1.4 access", () => {
  test("a client account and nobody are refused everything", async () => {
    const { me, client, store, t } = await setup();
    const { documentId, versionId } = await newDoc(me, store);
    for (const who of [client, t]) {
      await expect(who.query(api.sign.list, {})).rejects.toThrow(/Not allowed|Sign in/);
      await expect(who.query(api.sign.get, { documentId })).rejects.toThrow(/Not allowed|Sign in/);
      await expect(who.mutation(api.sign.approve, { versionId })).rejects.toThrow(/Not allowed|Sign in/);
      await expect(who.action(api.sign.preview, { versionId })).rejects.toThrow(/Not allowed|Sign in/);
    }
  });
});
