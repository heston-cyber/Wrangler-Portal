// Wrangler Portal, Phase 5e review fixes (Nov 6): file ownership. A storage id proves nothing about who uploaded it, so
// each business may use and delete only its own files. Two businesses: A (Wrangler) and B (another creator).
import { beforeAll, expect, test } from "vitest";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";

const api = anyApi;
const internal = anyApi;
const modules = import.meta.glob("../convex/**/*.ts");

beforeAll(async () => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.CONVEX_SITE_URL = "https://x.convex.site";
});

async function world() {
  const t = convexTest(schema, modules);
  const w = await t.run(async (ctx) => {
    const sess = async (userId: Id<"users">) => `${userId}|${await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 })}`;
    const A = await ctx.db.insert("businesses", { slug: "wrangler", name: "Wrangler Productions", createdAt: 0 });
    const B = await ctx.db.insert("businesses", { slug: "other", name: "Other Films", createdAt: 1 });
    const heston = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston", role: "owner" });
    await ctx.db.insert("memberships", { businessId: A, email: "heston@wranglerproductions.com", userId: heston, role: "owner", createdAt: 0 });
    const boss = await ctx.db.insert("users", { email: "boss@other.example", name: "Boss", role: "owner" });
    await ctx.db.insert("memberships", { businessId: B, email: "boss@other.example", userId: boss, role: "owner", createdAt: 1 });
    return { A, B, hestonSub: await sess(heston), bossSub: await sess(boss) };
  });
  return { t, ...w, heston: t.withIdentity({ subject: w.hestonSub }), boss: t.withIdentity({ subject: w.bossSub }) };
}
type W = Awaited<ReturnType<typeof world>>;
const upload = (w: W, body = "x") => w.t.run((ctx) => ctx.storage.store(new Blob([body])));
const alive = (w: W, id: Id<"_storage">) => w.t.run(async (ctx) => !!(await ctx.storage.get(id)));
const owner = (w: W, id: Id<"_storage">) => w.t.run(async (ctx) => (await ctx.db.query("fileOwners").withIndex("by_storage", (q) => q.eq("storageId", id)).first())?.businessId ?? null);

test("F1 a fresh upload becomes the first business's file; another business is refused", async () => {
  const w = await world();
  const f = await upload(w);
  await w.t.mutation(internal.fileOwners.claim, { storageId: f, purpose: "test", asBusiness: w.A });
  expect(await owner(w, f)).toBe(w.A);
  await expect(w.t.mutation(internal.fileOwners.claim, { storageId: f, purpose: "test", asBusiness: w.B })).rejects.toThrow(/isn't one of yours/);
  // Its own business may use it again (not fresh), and only it may delete it.
  expect(await w.t.mutation(internal.fileOwners.claim, { storageId: f, purpose: "test", asBusiness: w.A })).toEqual({ fresh: false });
  expect(await w.t.mutation(internal.fileOwners.remove, { storageId: f, asBusiness: w.B })).toBe(false);
  expect(await alive(w, f)).toBe(true);
  expect(await w.t.mutation(internal.fileOwners.remove, { storageId: f, asBusiness: w.A })).toBe(true);
  expect(await alive(w, f)).toBe(false);
});

test("F2 an upload older than 30 minutes that nobody claimed is refused", async () => {
  const w = await world();
  const f = await upload(w);
  const real = Date.now;
  Date.now = () => real() + 31 * 60_000;
  try { await expect(w.t.mutation(internal.fileOwners.claim, { storageId: f, purpose: "test", asBusiness: w.B })).rejects.toThrow(/isn't one of yours/); }
  finally { Date.now = real; }
  expect(await owner(w, f)).toBeNull();
});

test("F3 gear photo: another business's file is refused and never deleted", async () => {
  const w = await world();
  const mine = await upload(w, "wrangler's photo");
  await w.t.mutation(internal.fileOwners.claim, { storageId: mine, purpose: "gear", asBusiness: w.A });
  const gearId = await w.t.run((ctx) => ctx.db.insert("gear", { businessId: w.B, name: "FX3", kind: "camera", status: "in_service", createdAt: 0, updatedAt: 0 }));
  await expect(w.boss.mutation(api.gear.setPhoto, { gearId, storageId: mine })).rejects.toThrow(/isn't one of yours/);
  expect(await alive(w, mine)).toBe(true);
  // A fresh file of their own that isn't an image: refused, and that one (theirs) is deleted.
  const theirs = await upload(w, "not an image");
  expect(await w.boss.mutation(api.gear.setPhoto, { gearId, storageId: theirs })).toMatch(/PNG, JPG/);
  expect(await alive(w, theirs)).toBe(false);
});

test("F4 brand kit: another business's file is refused and left alone; removing a planted pointer never deletes it", async () => {
  const w = await world();
  const mine = await upload(w, "wrangler's kit file");
  await w.t.mutation(internal.fileOwners.claim, { storageId: mine, purpose: "brandKit", asBusiness: w.A });
  await expect(w.boss.mutation(api.brandKit.addFile, { storageId: mine, name: "x.pdf" })).rejects.toThrow(/isn't one of yours/);
  // A pointer at A's file planted in B's kit (as before Nov 6): removing it from B's kit leaves A's file.
  await w.t.run((ctx) => ctx.db.patch(w.B, { brandKit: { files: [{ fileId: mine, name: "x.pdf", size: 1, type: "", addedAt: 0 }] } } as never));
  await w.boss.mutation(api.brandKit.removeFile, { fileId: mine });
  expect(await alive(w, mine)).toBe(true);
});

test("F5 logo: clearing a logo that points at another business's file leaves that file", async () => {
  const w = await world();
  const mine = await upload(w, "wrangler's logo");
  await w.t.run(async (ctx) => {
    await ctx.db.insert("fileOwners", { storageId: mine, businessId: w.A, purpose: "logo", at: Date.now() });
    await ctx.db.patch(w.B, { logoFileId: mine });
  });
  await w.boss.mutation(api.business.setLogo, { storageId: null });
  expect(await alive(w, mine)).toBe(true);
  expect(await w.t.run(async (ctx) => (await ctx.db.get(w.B))?.logoFileId ?? null)).toBeNull();
});

test("F6 voice note: a recording another business uploaded can't be registered", async () => {
  const w = await world();
  const mine = await upload(w, "wrangler's recording");
  await w.t.mutation(internal.notes.registerVoice, { storageId: mine, asBusiness: w.A });
  await expect(w.t.mutation(internal.notes.registerVoice, { storageId: mine, asBusiness: w.B })).rejects.toThrow(/isn't one of yours/);
});

test("F7 the backfill records who owns each existing file, and counts a file two businesses point at", async () => {
  const w = await world();
  const logoA = await upload(w, "a logo"), w9B = await upload(w, "b w9"), shared = await upload(w, "both");
  await w.t.run(async (ctx) => {
    await ctx.db.patch(w.A, { logoFileId: logoA });
    await ctx.db.insert("vendors", { businessId: w.B, name: "V", email: "v@x.example", roles: [], rates: [], w9: { fileId: w9B, name: "w9.pdf", uploadedAt: 0 }, createdAt: 0, updatedAt: 0 } as never);
    await ctx.db.insert("gear", { businessId: w.A, name: "Cam", kind: "camera", status: "in_service", photoId: shared, createdAt: 0, updatedAt: 0 });
    await ctx.db.insert("gear", { businessId: w.B, name: "Cam", kind: "camera", status: "in_service", photoId: shared, createdAt: 0, updatedAt: 0 });
  });
  const r = await w.t.action(internal.migrations.ownersAll, {});
  expect(await owner(w, logoA)).toBe(w.A);
  expect(await owner(w, w9B)).toBe(w.B);
  // Second 5e review: a file two businesses point at is recorded for nobody and listed for Heston.
  expect(await owner(w, shared)).toBeNull();
  expect(r).toMatchObject({ recorded: 2, conflicts: 1 }); // listed in the Convex logs, counts only in the result
  // Safe to run again.
  expect(await w.t.action(internal.migrations.ownersAll, {})).toMatchObject({ recorded: 0, already: 2 });
});

test("F8 second review: inside its own business a file already in use isn't a new upload, and a W-9 is only ever a W-9", async () => {
  const w = await world();
  const w9 = await upload(w, "%PDF w9");
  await w.t.mutation(internal.fileOwners.claim, { storageId: w9, purpose: "w9", asBusiness: w.A });
  // The same business can't reuse its W-9 as a style image, a message file, a brand-kit file…
  await expect(w.t.mutation(internal.fileOwners.claim, { storageId: w9, purpose: "style-image", asBusiness: w.A })).rejects.toThrow(/isn't one of yours/);
  // …and a PDF the business already has can't be handed to Sign or the builder as a new document.
  const pdf = await upload(w, "%PDF contract");
  await w.t.mutation(internal.fileOwners.claim, { storageId: pdf, purpose: "contract-pdf", asBusiness: w.A });
  await expect(w.heston.action(api.sign.create, { storageId: pdf, fileName: "x.pdf" })).rejects.toThrow(/Upload the PDF again/);
  await expect(w.heston.action(api.builder.importPdf, { storageId: pdf })).rejects.toThrow(/Upload the PDF again/);
  expect(await alive(w, pdf)).toBe(true);
  // A style may point only at the business's own images.
  const theirs = await upload(w, "their logo");
  await w.t.mutation(internal.fileOwners.claim, { storageId: theirs, purpose: "style-image", asBusiness: w.B });
  await expect(w.heston.mutation(api.builder.saveStyle, { name: "Planted", style: { logo: { fileId: theirs, width: 120, align: "left" } } })).rejects.toThrow(/isn't one of yours/);
});
