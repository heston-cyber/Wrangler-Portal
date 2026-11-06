// D161 (Heston, Nov 6): edit a briefing after it's sent; "Update the link" puts the new version behind every link.
// E1 a sent briefing saves edits, and the link keeps the live copy until Update; E2 Update swaps the PDF for every link
// (emailed, copied), says Updated, emails nobody unless asked; E3 asked: each emailed person hears, with the same link;
// reads stay read; E4 only the owner (Production) can update; refusals.
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

const pdfBytes = (w: W, body = "%PDF-1.4 brief v2") => w.t.run((ctx) => ctx.storage.store(new Blob([body], { type: "application/pdf" })));
async function edit(w: W, buildId: Id<"wsBuilds">, title: string) {
  const build = await w.heston.query(api.builder.getBuild, { buildId });
  await w.heston.mutation(api.builder.saveBuild, { buildId, title, blocks: build.blocks, fields: build.fields, signers: [], style: build.style });
}
const pdfText = async (w: W, token: string) => (await w.t.fetch(`/b-pdf/${token}`)).text();

describe("D161 · edit a sent briefing", () => {
  test("E1-E2 edits save; the link keeps the live copy until Update; Update puts the new one behind every link", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const { id, priya, link } = await shared(w, mails);
    const before = await w.heston.query(api.briefings.get, { briefingId: id });
    const oldPdf = await pdfText(w, priya);
    expect(oldPdf).toContain("brief");
    vi.setSystemTime(Date.now() + 60_000);
    await edit(w, before.buildId, "Launch shoot, new call time");
    const mid = await w.heston.query(api.briefings.get, { briefingId: id });
    expect(mid).toMatchObject({ state: "sent", changed: true, editedAt: null, emailable: 2 });
    const page = await w.t.query(api.briefings.page, { token: priya });
    expect(page).toMatchObject({ title: before.title, updatedAt: null }); // the live copy until Update
    const r = await w.heston.action(api.briefings.update, { briefingId: id, storageId: await pdfBytes(w), notify: false });
    expect(r).toEqual({ emailed: 0, held: 0, failed: [] });
    const after = await w.heston.query(api.briefings.get, { briefingId: id });
    expect(after.changed).toBe(false);
    expect(after.editedAt).not.toBeNull();
    for (const t of [priya, link]) {
      expect(await pdfText(w, t)).toContain("brief v2");
      expect(await w.t.query(api.briefings.page, { token: t })).toMatchObject({ title: "Launch shoot, new call time", updatedAt: after.editedAt });
    }
    expect(mails).toHaveLength(2); // nobody emailed
    // The old PDF is gone.
    const pdfs = await w.t.run(async (ctx) => (await ctx.db.query("briefings").collect()).map((x) => x.pdfId));
    expect(pdfs).toHaveLength(1);
  });

  test("E3 asked: each emailed person hears, with their same link; reads stay read", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const { id, priya, ana } = await shared(w, mails);
    await w.t.mutation(api.briefings.markRead, { token: priya });
    const b = await w.heston.query(api.briefings.get, { briefingId: id });
    await edit(w, b.buildId, "New title");
    const r = await w.heston.action(api.briefings.update, { briefingId: id, storageId: await pdfBytes(w), notify: true });
    expect(r.emailed).toBe(2);
    const up = mails.filter((m) => m.subject === "Updated: New title");
    expect(up.map((m) => m.to).sort()).toEqual(["ana@studiofour.com", "priya@rao.example"]);
    expect(tokenIn(up.find((m) => m.to === "priya@rao.example")!)).toBe(priya);
    expect(tokenIn(up.find((m) => m.to === "ana@studiofour.com")!)).toBe(ana);
    const after = await w.heston.query(api.briefings.get, { briefingId: id });
    expect(after.who.find((x: { label: string }) => x.label === "Priya Rao").readAt).not.toBeNull(); // Heston: keep as read
    expect(after.history.at(-1)).toMatchObject({ kind: "edited", detail: "emailed 2 people" });
  });

  test("E4 only the owner updates; a draft, a reused file and a turned-off link are handled", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const { id, priya } = await shared(w, mails);
    await expect(w.maya.action(api.briefings.update, { briefingId: id, storageId: await pdfBytes(w), notify: true })).rejects.toThrow();
    await expect(w.boss.action(api.briefings.update, { briefingId: id, storageId: await pdfBytes(w), notify: true })).rejects.toThrow();
    const draft = await w.heston.mutation(api.briefings.create, {}) as Id<"briefings">;
    await expect(w.heston.action(api.briefings.update, { briefingId: draft, storageId: await pdfBytes(w), notify: false })).rejects.toThrow(/Share it instead/);
    const live = (await w.t.run(async (ctx) => (await ctx.db.get(id))!.pdfId))!;
    await expect(w.heston.action(api.briefings.update, { briefingId: id, storageId: live, notify: false })).rejects.toThrow(/didn't upload/);
    await w.heston.mutation(api.briefings.setLinkOff, { briefingId: id, off: true });
    const r = await w.heston.action(api.briefings.update, { briefingId: id, storageId: await pdfBytes(w), notify: true });
    expect(r.emailed).toBe(0); // the link is off: nobody is told to open it
    expect(await w.t.query(api.briefings.page, { token: priya })).toMatchObject({ withdrawn: true });
  });
});
