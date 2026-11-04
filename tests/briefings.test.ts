// Phase 3c step 3 · briefings (D97). T3c.3: a briefing starts from Shoot brief / Edit brief (by the role) with who it's
// for filled in, stays out of Docs and signing, goes only to a vendor booked on the project, freezes its PDF and emails
// them once (email 25), then can't change; a copy can. Isolation.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { world } from "./payHarness";
import { briefingHeadings, briefingProblems, briefingStarterPage, starterFor } from "../convex/lib/wsBriefing";
import { atom, emptyFields, missingFields, pageOf } from "../convex/lib/wsBuilder";

const api = anyApi;
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
async function booked(w: W, role = "Shooter", email = "jordan@ellisfilms.com") {
  const vendorId = await w.heston.mutation(api.vendors.add, { name: role === "Shooter" ? "Jordan Ellis" : "Riley Chen", email, roles: [role], rates: [], invite: false }) as Id<"vendors">;
  const bookingId = await w.heston.mutation(api.bookings.create, { vendorId, projectId: w.p, role, start: "2030-11-06", end: "2030-11-07", cents: 100_000, unit: "day" }) as Id<"vendorBookings">;
  return { vendorId, bookingId };
}

describe("briefings: the pure parts", () => {
  test("the starters, who they're for, the headings and the problems", () => {
    expect(starterFor("Shooter")).toBe("shoot");
    expect(starterFor("Drone pilot")).toBe("shoot");
    expect(starterFor("Editor")).toBe("edit");
    expect(starterFor("Colourist")).toBe("edit");
    const page = briefingStarterPage("shoot");
    expect(briefingHeadings(page)).toEqual(["Call sheet", "Schedule", "Shot list", "Gear", "Contacts", "Deliverables", "Notes"]);
    expect(briefingHeadings(briefingStarterPage("edit"))).toEqual(["Story", "Cuts and lengths", "Music", "References", "Files", "Deadlines"]);
    const f = emptyFields();
    expect(missingFields(page, f).sort()).toEqual(["dates", "project", "vendor"]);
    expect(briefingProblems({ title: "T", page, fields: f, signers: [], style: {} as never }).join(" ")).toMatch(/Fill in: .*\{vendor\}/);
    const signed = { ...page, content: [...page.content, atom("signatures", {})] };
    expect(briefingProblems({ title: "T", page: signed, fields: { ...f, project: "P", custom: [{ key: "vendor", label: "", value: "J" }, { key: "dates", label: "", value: "D" }] }, signers: [], style: {} as never })).toEqual([expect.stringMatching(/aren't signed/)]);
  });
});

describe("briefings", () => {
  test("T3c.3 create from a booking, out of Docs, send once (email 25), locked after, a copy can change", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const { vendorId, bookingId } = await booked(w);
    const id = await w.heston.mutation(api.briefings.create, { bookingId }) as Id<"briefings">;
    const b = await w.heston.query(api.briefings.get, { briefingId: id });
    expect(b).toMatchObject({ title: "Shoot brief · 26127 Launch", state: "draft", starter: "shoot", kindName: "Shoot brief", project: { label: "26127 Launch" },
      sendTo: [expect.objectContaining({ vendorId, email: "jordan@ellisfilms.com", label: "Jordan Ellis", booked: true })] }); // D147: the booking's vendor starts in Send to
    const build = await w.heston.query(api.builder.getBuild, { buildId: b.buildId });
    expect(build.kind).toBe("briefing");
    expect(build.fields.project).toBe("26127 Launch");
    expect(build.fields.custom.slice(0, 2)).toEqual([{ key: "vendor", label: "Vendor", value: "Jordan Ellis, Shooter" }, { key: "dates", label: "Dates", value: "Nov 6 – 7, 2030" }]);
    expect(missingFields(pageOf(build.blocks), build.fields)).toEqual([]);
    expect(await w.heston.query(api.builder.listBuilds, {})).toEqual([]); // not in Docs
    await expect(w.heston.mutation(api.builder.deleteBuild, { buildId: b.buildId })).rejects.toThrow(/Vendors › Briefings/);
    expect((await w.heston.query(api.bookings.get, { bookingId })).brief).toBe("draft");

    const shared = await w.heston.action(api.briefings.share, { briefingId: id, storageId: await pdf(w), to: [{ vendorId, email: "x@example.com" }] });
    expect(shared).toMatchObject({ sent: 1, failed: [], link: null });
    mails.splice(0, mails.length, ...mails.filter((m) => m.subject.startsWith("Briefing:"))); // the booking's own email (24) aside
    expect(mails.map((m) => [m.to, m.subject])).toEqual([["jordan@ellisfilms.com", "Briefing: 26127 Launch"]]); // email 58
    expect(mails[0].text).toContain("Hi Jordan,");
    expect(mails[0].text).toContain("Heston sent you a briefing: the shoot brief for 26127 Launch.");
    expect(mails[0].text).toContain("Call sheet, schedule, shot list and gear are in the brief.");
    expect(mails[0].text).toMatch(/https:\/\/app\.wranglerportal\.com\/b\/[A-Za-z0-9_-]{20,}/);
    const sent = await w.heston.query(api.briefings.get, { briefingId: id });
    expect(sent).toMatchObject({ state: "sent", who: [expect.objectContaining({ label: "Jordan Ellis", booked: true, openedAt: null })], sendTo: [], pdfUrl: expect.any(String) });
    expect((await w.heston.query(api.bookings.get, { bookingId })).brief).toBe("sent");
    expect(await w.heston.query(api.briefings.forVendor, { vendorId })).toEqual([expect.objectContaining({ _id: id, state: "sent" })]);
    expect(await w.heston.query(api.briefings.list, {})).toEqual([expect.objectContaining({ _id: id, vendor: "Jordan Ellis", project: "26127 Launch" })]);

    // Locked: no edit, no delete; Share again to the same person emails them the same link again.
    await expect(w.heston.mutation(api.builder.saveBuild, { buildId: b.buildId, title: "X", blocks: build.blocks, fields: build.fields, signers: [], style: build.style })).rejects.toThrow(/has been sent/);
    await expect(w.heston.mutation(api.briefings.deleteDraft, { briefingId: id })).rejects.toThrow(/stays/);
    await expect(w.heston.mutation(api.briefings.setDetails, { briefingId: id, projectId: null, sendTo: [] })).rejects.toThrow(/Share again/);
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 11 * 60_000); // review L2: not again within 10 minutes
    await w.heston.action(api.briefings.share, { briefingId: id, to: [{ email: "JORDAN@ellisfilms.com" }] });
    vi.useRealTimers();
    const again = mails.filter((m) => m.subject.startsWith("Briefing:"));
    expect(again).toHaveLength(2);
    expect(again[1].text.match(/\/b\/([\w-]+)/)![1]).toBe(again[0].text.match(/\/b\/([\w-]+)/)![1]);
    expect((await w.heston.query(api.briefings.get, { briefingId: id })).who).toHaveLength(1);

    const copyId = await w.heston.mutation(api.briefings.copy, { briefingId: id }) as Id<"briefings">;
    expect(await w.heston.query(api.briefings.get, { briefingId: copyId })).toMatchObject({ state: "draft", sendTo: [expect.objectContaining({ vendorId })] });
    await w.heston.mutation(api.briefings.deleteDraft, { briefingId: copyId });
    expect(await w.heston.query(api.briefings.get, { briefingId: copyId })).toBeNull();
  });

  test("D147 a briefing for anyone: no booking, project optional; declined or cancelled bookings can't start one", async () => {
    const w = await world();
    stub([]);
    const { bookingId } = await booked(w);
    const editor = await booked(w, "Editor", "riley@chen.example");
    const id = await w.heston.mutation(api.briefings.create, { bookingId: editor.bookingId }) as Id<"briefings">;
    expect((await w.heston.query(api.briefings.get, { briefingId: id })).starter).toBe("edit");
    // No project, no booking: a Shoot brief for "your crew".
    const free = await w.heston.mutation(api.briefings.create, {}) as Id<"briefings">;
    const fb = await w.heston.query(api.briefings.get, { briefingId: free });
    expect(fb).toMatchObject({ title: "Shoot brief", project: null, sendTo: [], state: "draft" });
    expect(JSON.stringify((await w.heston.query(api.builder.getBuild, { buildId: fb.buildId })).blocks)).not.toContain("{project}"); // no project, none in the title
    expect((await w.heston.query(api.builder.getBuild, { buildId: fb.buildId })).fields.custom[0]).toEqual({ key: "vendor", label: "Vendor", value: "your crew" });
    // Send to: a vendor from the list (their own address is used), and a typed email; duplicates and junk.
    const vendorId = (await w.heston.query(api.bookings.get, { bookingId })).vendorId;
    await w.heston.mutation(api.briefings.setDetails, { briefingId: free, projectId: w.p, sendTo: [{ vendorId, email: "whatever@x.com" }, { email: " Ana@StudioFour.com ", name: " Ana " }, { email: "ana@studiofour.com" }] });
    expect((await w.heston.query(api.briefings.get, { briefingId: free })).sendTo).toEqual([
      expect.objectContaining({ vendorId, email: "jordan@ellisfilms.com", label: "Jordan Ellis", booked: true }), expect.objectContaining({ email: "ana@studiofour.com", name: "Ana", label: "Ana", booked: false })]);
    await expect(w.heston.mutation(api.briefings.setDetails, { briefingId: free, projectId: null, sendTo: [{ email: "not an email" }] })).rejects.toThrow(/isn't an email/);
    await expect(w.heston.mutation(api.briefings.setDetails, { briefingId: free, projectId: null, sendTo: Array.from({ length: 26 }, (_, i) => ({ email: `p${i}@x.com` })) })).rejects.toThrow(/Up to 25/);
    // Cancel a booking: a new briefing can't be made from it.
    await w.heston.mutation(api.bookings.cancel, { bookingId });
    await expect(w.heston.mutation(api.briefings.create, { bookingId })).rejects.toThrow(/cancelled/);
    // A briefing template is kept apart from contract templates, and can start a briefing.
    const b = await w.heston.query(api.briefings.get, { briefingId: id });
    const build = await w.heston.query(api.builder.getBuild, { buildId: b.buildId });
    const tId = await w.heston.mutation(api.builder.saveAsTemplate, { name: "Our edit brief", kind: "briefing", title: build.title, blocks: build.blocks, fields: build.fields, signers: [], style: build.style });
    expect(await w.heston.query(api.builder.listTemplates, {})).toEqual([]);
    expect((await w.heston.query(api.briefings.templates, {})).saved).toEqual([expect.objectContaining({ _id: tId, name: "Our edit brief" })]);
    await expect(w.heston.mutation(api.builder.createBuild, { templateId: tId })).rejects.toThrow(/briefing template/);
    const fromT = await w.heston.mutation(api.briefings.create, { bookingId: editor.bookingId, templateId: tId }) as Id<"briefings">;
    expect((await w.heston.query(api.briefings.get, { briefingId: fromT })).title).toBe("Our edit brief · 26127 Launch");
  });

  test("T3c.3 isolation: another business and clients see and change none of it", async () => {
    const w = await world();
    stub([]);
    const { bookingId } = await booked(w);
    const id = await w.heston.mutation(api.briefings.create, { bookingId }) as Id<"briefings">;
    expect(await w.boss.query(api.briefings.list, {})).toEqual([]);
    expect(await w.boss.query(api.briefings.get, { briefingId: id })).toBeNull();
    await w.boss.mutation(api.briefings.deleteDraft, { briefingId: id }); // invisible to them: nothing happens
    expect(await w.heston.query(api.briefings.get, { briefingId: id })).not.toBeNull();
    await expect(w.boss.mutation(api.briefings.create, { bookingId })).rejects.toThrow();
    await expect(w.boss.action(api.briefings.share, { briefingId: id, storageId: await pdf(w), to: [{ email: "x@y.com" }] })).rejects.toThrow();
    await expect(w.boss.mutation(api.briefings.setDetails, { briefingId: id, projectId: null, sendTo: [] })).rejects.toThrow();
    await expect(w.maya.query(api.briefings.list, {})).rejects.toThrow();
  });
});
