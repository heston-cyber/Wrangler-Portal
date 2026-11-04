// D147 (Heston, Nov 3; built Nov 4): briefings sent freely. The read-back's tests: a token opens only its own briefing;
// turning the link off stops every link (emailed ones too) and it can come back on; opens are named for emailed links
// and counted for the copied one; "I've read it" is recorded (Q95: READ once everyone emailed has read it); the PDF is
// served only through a live link; another business, a client and a stranger get nothing.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { world } from "./payHarness";

const api = anyApi;
const internal = anyApi;
beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_ONLY_TO = "";
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

type W = Awaited<ReturnType<typeof world>>;
type Sent = { to: string; subject: string; text: string };
const stub = (mails: Sent[]) => vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url === "https://api.resend.com/emails") { const b = JSON.parse(String(init?.body)); mails.push({ to: b.to[0], subject: b.subject, text: b.text }); return new Response(JSON.stringify({ id: "em" }), { status: 200 }); }
  return new Response("{}", { status: 500 });
}));
const pdf = (w: W) => w.t.run((ctx) => ctx.storage.store(new Blob(["%PDF-1.4 brief"], { type: "application/pdf" })));
const tokenIn = (m: Sent) => m.text.match(/\/b\/([\w-]+)/)![1];
const settle = (w: W) => w.t.finishAllScheduledFunctions(vi.runAllTimers);

async function shared(w: W, mails: Sent[]) {
  const id = await w.heston.mutation(api.briefings.create, { projectId: w.p }) as Id<"briefings">;
  const b = await w.heston.query(api.briefings.get, { briefingId: id });
  const build = await w.heston.query(api.builder.getBuild, { buildId: b.buildId });
  const fields = { ...build.fields, custom: build.fields.custom.map((c: { key: string; label: string; value: string }) => (c.key === "dates" ? { ...c, value: "Nov 6 – 7, 2030" } : c)) };
  await w.heston.mutation(api.builder.saveBuild, { buildId: b.buildId, title: build.title, blocks: build.blocks, fields, signers: [], style: build.style });
  const r = await w.heston.action(api.briefings.share, { briefingId: id, storageId: await pdf(w), to: [{ email: "priya@rao.example", name: "Priya Rao" }, { email: "ana@studiofour.com" }], note: "Call is 7:00 AM.", copyLink: true });
  const priya = tokenIn(mails.find((m) => m.to === "priya@rao.example")!), ana = tokenIn(mails.find((m) => m.to === "ana@studiofour.com")!);
  const link = (r.link as string).split("/b/")[1];
  return { id, r, priya, ana, link };
}

describe("D147 briefings sent freely", () => {
  test("Share: one email each with their own link (email 58), a copied link, the PDF frozen; nothing sent by saving", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const { id, r, priya, ana, link } = await shared(w, mails);
    expect(r).toMatchObject({ sent: 2, held: 0, off: 0, failed: [] });
    expect(new Set([priya, ana, link]).size).toBe(3);
    const p = mails.find((m) => m.to === "priya@rao.example")!, a = mails.find((m) => m.to === "ana@studiofour.com")!;
    expect(p.subject).toBe("Briefing: 26127 Launch");
    expect(p.text).toContain("Hi Priya,");
    expect(a.text).toContain("Hello,"); // Q98's rule: no name, no guess
    expect(p.text).toContain("Call is 7:00 AM.");
    expect(p.text).toContain("Nov 6 – 7, 2030"); // Q91 g: the rows come from the briefing
    expect(p.text).toContain("No login needed.");
    const g = await w.heston.query(api.briefings.get, { briefingId: id });
    expect(g).toMatchObject({ state: "sent", link: { copied: true, off: false, opens: 0 }, who: [expect.objectContaining({ label: "Priya Rao" }), expect.objectContaining({ label: "ana@studiofour.com" })] });
    expect(g.link.url).toBe(`https://app.wranglerportal.com/b/${link}`);
    // A draft never answers a token, and saving a draft sends nothing.
    const draft = await w.heston.mutation(api.briefings.create, {}) as Id<"briefings">;
    await w.heston.mutation(api.briefings.setDetails, { briefingId: draft, projectId: null, sendTo: [{ email: "x@y.com" }] });
    expect(mails).toHaveLength(2);
    // Copy link only, on a briefing already shared: no email, the same link.
    const again = await w.heston.action(api.briefings.share, { briefingId: id, to: [], copyLink: true });
    expect(again.link).toBe(r.link);
    expect(mails).toHaveLength(2);
  });

  test("a token opens only its own briefing; opens are named for emailed links and counted for the copied one; the owner looking isn't counted", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const one = await shared(w, mails);
    mails.length = 0;
    const two = await shared(w, mails);
    const pageA = await w.t.query(api.briefings.page, { token: one.priya });
    expect(pageA).toMatchObject({ withdrawn: false, title: "Shoot brief · 26127 Launch", kind: "Shoot brief", project: "26127 Launch", named: true, name: "Priya Rao", readAt: null, business: { name: "Wrangler Productions" } });
    expect(JSON.stringify(pageA)).not.toContain("ana@studiofour.com"); // nobody sees another person's details
    expect(await w.t.query(api.briefings.page, { token: one.link })).toMatchObject({ named: false, name: null });
    expect(await w.t.query(api.briefings.page, { token: "x".repeat(24) })).toBeNull();
    expect(await w.t.query(api.briefings.page, { token: "short" })).toBeNull();
    await w.t.mutation(api.briefings.opened, { token: one.priya });
    await w.t.mutation(api.briefings.opened, { token: one.priya });
    await w.t.mutation(api.briefings.opened, { token: one.link });
    await w.t.mutation(api.briefings.opened, { token: one.link });
    await w.t.mutation(api.briefings.opened, { token: one.link });
    await w.heston.mutation(api.briefings.opened, { token: one.ana }); // the owner checking it
    const g = await w.heston.query(api.briefings.get, { briefingId: one.id });
    expect(g.who.find((x: { label: string }) => x.label === "Priya Rao")).toMatchObject({ opens: 2, openedAt: expect.any(Number) });
    expect(g.who.find((x: { label: string }) => x.label === "ana@studiofour.com")).toMatchObject({ opens: 0, openedAt: null });
    expect(g.link.opens).toBe(3);
    // The other briefing is untouched.
    const g2 = await w.heston.query(api.briefings.get, { briefingId: two.id });
    expect(g2.link.opens).toBe(0);
    expect(g2.who.every((x: { opens: number }) => x.opens === 0)).toBe(true);
  });

  test("Q95: READ only once everyone emailed has read it; the owner is emailed once per person; a copied-link read is counted, not named", async () => {
    vi.useFakeTimers();
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const { id, priya, ana, link } = await shared(w, mails);
    await w.t.mutation(api.briefings.markRead, { token: link });
    await w.t.mutation(api.briefings.markRead, { token: priya });
    await w.t.mutation(api.briefings.markRead, { token: priya });
    await settle(w);
    let g = await w.heston.query(api.briefings.get, { briefingId: id });
    expect(g.state).toBe("sent");
    expect(g.link.reads).toBe(1);
    expect((await w.heston.query(api.briefings.list, {}))[0].people.filter((p: { readAt: number | null }) => p.readAt)).toHaveLength(1);
    expect(await w.t.query(api.briefings.page, { token: priya })).toMatchObject({ readAt: expect.any(Number) });
    await w.t.mutation(api.briefings.markRead, { token: ana });
    await settle(w);
    g = await w.heston.query(api.briefings.get, { briefingId: id });
    expect(g.state).toBe("read");
    const owner = mails.filter((m) => m.to === "heston@wranglerproductions.com" && /read the brief/.test(m.subject));
    expect(owner.map((m) => m.subject).sort()).toEqual(["Priya Rao read the brief: 26127 Launch", "ana@studiofour.com read the brief: 26127 Launch"]);
  });

  test("turning the link off stops every link (emailed ones too) and the PDF; it can come back on; Share waits for it", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const { id, priya, link } = await shared(w, mails);
    const res = await w.t.fetch(`/b-pdf/${priya}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(await res.text()).toContain("%PDF");
    await w.heston.mutation(api.briefings.setLinkOff, { briefingId: id, off: true });
    for (const tok of [priya, link]) {
      const pg = await w.t.query(api.briefings.page, { token: tok });
      expect(pg).toEqual({ withdrawn: true, business: expect.objectContaining({ name: "Wrangler Productions" }), title: "Shoot brief · 26127 Launch" });
      await expect(w.t.mutation(api.briefings.markRead, { token: tok })).rejects.toThrow(/withdrawn/);
      await w.t.mutation(api.briefings.opened, { token: tok });
      expect((await w.t.fetch(`/b-pdf/${tok}`)).status).toBe(404);
    }
    expect((await w.heston.query(api.briefings.get, { briefingId: id })).link.opens).toBe(0);
    await expect(w.heston.action(api.briefings.share, { briefingId: id, to: [{ email: "new@x.com" }] })).rejects.toThrow(/turned off/);
    await w.heston.mutation(api.briefings.setLinkOff, { briefingId: id, off: false });
    expect(await w.t.query(api.briefings.page, { token: priya })).toMatchObject({ withdrawn: false });
    expect((await w.t.fetch(`/b-pdf/${link}?download`)).headers.get("content-disposition")).toMatch(/^attachment; filename="Shoot brief · 26127 Launch\.pdf"/);
    expect((await w.t.fetch(`/b-pdf/${"x".repeat(24)}`)).status).toBe(404);
  });

  test("isolation: another business's owner, a client and a stranger get none of it and change none of it", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const { id, priya } = await shared(w, mails);
    for (const who of [w.boss]) {
      expect(await who.query(api.briefings.get, { briefingId: id })).toBeNull();
      expect(await who.query(api.briefings.list, {})).toEqual([]);
      await expect(who.mutation(api.briefings.setLinkOff, { briefingId: id, off: true })).rejects.toThrow();
      await expect(who.action(api.briefings.share, { briefingId: id, to: [{ email: "x@y.com" }], copyLink: true })).rejects.toThrow();
      expect(await who.query(api.briefings.page, { token: priya })).toBeNull(); // another business's owner isn't let into A's link
    }
    for (const who of [w.maya]) {
      await expect(who.query(api.briefings.get, { briefingId: id })).rejects.toThrow();
      await expect(who.mutation(api.briefings.setLinkOff, { briefingId: id, off: true })).rejects.toThrow();
    }
    expect((await w.heston.query(api.briefings.get, { briefingId: id })).link.off).toBe(false);
    // A vendor picked from another business's list can't be added.
    const other = await w.boss.mutation(api.vendors.add, { name: "Other Vendor", email: "ov@x.com", roles: ["Shooter"], rates: [], invite: false });
    const draft = await w.heston.mutation(api.briefings.create, {}) as Id<"briefings">;
    await expect(w.heston.mutation(api.briefings.setDetails, { briefingId: draft, projectId: null, sendTo: [{ vendorId: other, email: "ov@x.com" }] })).rejects.toThrow(/isn't on your list/);
    void internal;
  });

  test("review M2: a shared briefing never deletes a file it's handed (another business's PDF stays)", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const a = await shared(w, mails);
    const aPdf = await w.t.run(async (ctx) => (await ctx.db.get(a.id))!.pdfId!);
    // B's own shared briefing, handed A's frozen PDF: refused or ignored, never deleted.
    const bId = await w.boss.mutation(api.briefings.create, {}) as Id<"briefings">;
    const bb = await w.boss.query(api.briefings.get, { briefingId: bId });
    const bd = await w.boss.query(api.builder.getBuild, { buildId: bb.buildId });
    const custom = bd.fields.custom.map((c: { key: string; label: string; value: string }) => (c.key === "dates" ? { ...c, value: "Dec 1, 2030" } : c));
    await w.boss.mutation(api.builder.saveBuild, { buildId: bb.buildId, title: bd.title, blocks: bd.blocks, fields: { ...bd.fields, custom }, signers: [], style: bd.style });
    await w.boss.action(api.briefings.share, { briefingId: bId, storageId: await pdf(w), to: [], copyLink: true });
    await w.boss.action(api.briefings.share, { briefingId: bId, storageId: aPdf, to: [], copyLink: true }).catch(() => null);
    await expect(w.boss.action(api.briefings.share, { briefingId: bId, storageId: aPdf, to: [{ email: "x" }] })).rejects.toThrow();
    expect(await w.t.run(async (ctx) => (await ctx.storage.get(aPdf)) !== null)).toBe(true);
    expect((await w.t.fetch(`/b-pdf/${a.priya}`)).status).toBe(200);
    // A draft can't be frozen with a PDF that's already another briefing's.
    const draft = await w.heston.mutation(api.briefings.create, { projectId: w.p }) as Id<"briefings">;
    await expect(w.heston.action(api.briefings.share, { briefingId: draft, storageId: aPdf, to: [], copyLink: true })).rejects.toThrow(/didn't upload/);
    expect(await w.t.run(async (ctx) => (await ctx.storage.get(aPdf)) !== null)).toBe(true);
  });

  test("review M1: turning the link off withdraws it from the vendor portal too; their PDF comes through their own link", async () => {
    vi.useFakeTimers();
    process.env.CONVEX_SITE_URL = "https://x.convex.site";
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const vendorId = await w.heston.mutation(api.vendors.add, { name: "Jordan Ellis", email: "jordan@ellisfilms.com", roles: ["Shooter"], rates: [], invite: false }) as Id<"vendors">;
    const sub = await w.t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { email: "jordan@ellisfilms.com", name: "Jordan Ellis", role: "vendor" });
      await ctx.db.insert("memberships", { businessId: w.A, email: "jordan@ellisfilms.com", userId, role: "vendor", createdAt: Date.now() });
      return `${userId}|${await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 })}`;
    });
    const jordan = w.t.withIdentity({ subject: sub });
    const id = await w.heston.mutation(api.briefings.create, { projectId: w.p }) as Id<"briefings">;
    const g = await w.heston.query(api.briefings.get, { briefingId: id });
    const bd = await w.heston.query(api.builder.getBuild, { buildId: g.buildId });
    const custom = bd.fields.custom.map((c: { key: string; label: string; value: string }) => (c.key === "dates" ? { ...c, value: "Nov 6, 2030" } : c));
    await w.heston.mutation(api.builder.saveBuild, { buildId: g.buildId, title: bd.title, blocks: bd.blocks, fields: { ...bd.fields, custom }, signers: [], style: bd.style });
    await w.heston.action(api.briefings.share, { briefingId: id, storageId: await pdf(w), to: [{ vendorId, email: "" }] });
    const tok = tokenIn(mails.find((m) => m.to === "jordan@ellisfilms.com")!);
    expect((await jordan.query(api.vendorPortal.briefing, { briefingId: id })).pdfUrl).toBe(`https://x.convex.site/b-pdf/${tok}`);
    expect((await jordan.query(api.vendorPortal.briefings, { businessId: w.A })).rows).toHaveLength(1);
    await w.heston.mutation(api.briefings.setLinkOff, { briefingId: id, off: true });
    expect(await jordan.query(api.vendorPortal.briefing, { briefingId: id })).toBeNull();
    expect((await jordan.query(api.vendorPortal.briefings, { businessId: w.A })).rows).toEqual([]);
    await expect(jordan.mutation(api.vendorPortal.markRead, { briefingId: id })).rejects.toThrow();
    expect((await w.heston.query(api.briefings.get, { briefingId: id })).state).toBe("sent");
    await w.heston.mutation(api.briefings.setLinkOff, { briefingId: id, off: false });
    await jordan.mutation(api.vendorPortal.markRead, { briefingId: id });
    expect((await w.heston.query(api.briefings.get, { briefingId: id })).state).toBe("read");
    delete process.env.CONVEX_SITE_URL;
  });

  test("review L1, L2, L5: copied-link reads don't flood the history; no re-email within 10 minutes; a bad PDF address is a 404", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const { id, link, priya } = await shared(w, mails);
    for (let i = 0; i < 70; i++) await w.t.mutation(api.briefings.markRead, { token: link });
    const g = await w.heston.query(api.briefings.get, { briefingId: id });
    expect(g.link.reads).toBe(70);
    expect(g.history.filter((h: { kind: string }) => h.kind === "read")).toHaveLength(1);
    expect(g.history.some((h: { kind: string }) => h.kind === "sent")).toBe(true);
    await w.t.mutation(api.briefings.markRead, { token: priya }); // the person's own link has its own allowance
    const before = mails.length;
    await w.heston.action(api.briefings.share, { briefingId: id, to: [{ email: "priya@rao.example" }] });
    expect(mails.length).toBe(before);
    expect((await w.t.fetch("/b-pdf/%E0%A4%A")).status).toBe(404);
  });
});
