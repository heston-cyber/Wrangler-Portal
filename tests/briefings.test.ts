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
    expect(b).toMatchObject({ title: "Shoot brief · 26127 Launch", state: "draft", starter: "shoot", kindName: "Shoot brief", bookingId, vendor: "Jordan Ellis", project: { label: "26127 Launch" },
      recipients: [expect.objectContaining({ _id: bookingId, name: "Jordan Ellis", role: "Shooter", vendor: "Jordan Ellis, Shooter", dates: "Nov 6 – 7, 2030" })] });
    const build = await w.heston.query(api.builder.getBuild, { buildId: b.buildId });
    expect(build.kind).toBe("briefing");
    expect(build.fields.project).toBe("26127 Launch");
    expect(build.fields.custom.slice(0, 2)).toEqual([{ key: "vendor", label: "Vendor", value: "Jordan Ellis, Shooter" }, { key: "dates", label: "Dates", value: "Nov 6 – 7, 2030" }]);
    expect(missingFields(pageOf(build.blocks), build.fields)).toEqual([]);
    expect(await w.heston.query(api.builder.listBuilds, {})).toEqual([]); // not in Docs
    await expect(w.heston.mutation(api.builder.deleteBuild, { buildId: b.buildId })).rejects.toThrow(/Vendors › Briefings/);
    expect((await w.heston.query(api.bookings.get, { bookingId })).brief).toBe("draft");

    await w.heston.action(api.briefings.send, { briefingId: id, storageId: await pdf(w) });
    mails.splice(0, mails.length, ...mails.filter((m) => m.subject.startsWith("Brief:"))); // the booking's own email (24) aside
    expect(mails.map((m) => [m.to, m.subject])).toEqual([["jordan@ellisfilms.com", "Brief: 26127 Launch"]]);
    expect(mails[0].text).toContain("Heston sent you the shoot brief for 26127 Launch.");
    expect(mails[0].text).toContain("Call sheet, schedule, shot list and gear are in the brief.");
    expect(mails[0].text).toContain(`https://app.wranglerportal.com/vendor/briefings/${id}`);
    const sent = await w.heston.query(api.briefings.get, { briefingId: id });
    expect(sent).toMatchObject({ state: "sent", sentTo: { vendorId, name: "Jordan Ellis", email: "jordan@ellisfilms.com" }, pdfUrl: expect.any(String) });
    expect((await w.heston.query(api.bookings.get, { bookingId })).brief).toBe("sent");
    expect(await w.heston.query(api.briefings.forVendor, { vendorId })).toEqual([expect.objectContaining({ _id: id, state: "sent" })]);
    expect(await w.heston.query(api.briefings.list, {})).toEqual([expect.objectContaining({ _id: id, vendor: "Jordan Ellis", project: "26127 Launch" })]);

    // Locked: no second send, no edit, no delete; Send again only emails.
    await expect(w.heston.action(api.briefings.send, { briefingId: id, storageId: await pdf(w) })).rejects.toThrow(/already been sent/);
    await expect(w.heston.mutation(api.builder.saveBuild, { buildId: b.buildId, title: "X", blocks: build.blocks, fields: build.fields, signers: [], style: build.style })).rejects.toThrow(/has been sent/);
    await expect(w.heston.mutation(api.briefings.deleteDraft, { briefingId: id })).rejects.toThrow(/stays/);
    await w.heston.action(api.briefings.send, { briefingId: id, resend: true });
    expect(mails.filter((m) => m.subject.startsWith("Brief:"))).toHaveLength(2);

    const copyId = await w.heston.mutation(api.briefings.copy, { briefingId: id }) as Id<"briefings">;
    expect(await w.heston.query(api.briefings.get, { briefingId: copyId })).toMatchObject({ state: "draft", bookingId });
    await w.heston.mutation(api.briefings.deleteDraft, { briefingId: copyId });
    expect(await w.heston.query(api.briefings.get, { briefingId: copyId })).toBeNull();
  });

  test("only vendors booked on the project; declined or cancelled bookings can't get one", async () => {
    const w = await world();
    stub([]);
    const { bookingId } = await booked(w);
    const editor = await booked(w, "Editor", "riley@chen.example");
    const id = await w.heston.mutation(api.briefings.create, { bookingId: editor.bookingId }) as Id<"briefings">;
    expect((await w.heston.query(api.briefings.get, { briefingId: id })).starter).toBe("edit");
    await w.heston.mutation(api.briefings.setBooking, { briefingId: id, bookingId });
    // A booking on another project can't be picked.
    const other = await w.t.run((ctx) => ctx.db.insert("projects", { businessId: w.A, name: "Other job", createdAt: 0 }));
    const vendorId = (await w.heston.query(api.bookings.get, { bookingId })).vendorId;
    const elsewhere = await w.heston.mutation(api.bookings.create, { vendorId, projectId: other, role: "Shooter", start: "2030-12-01", end: "2030-12-01", cents: 100_000, unit: "day" });
    await expect(w.heston.mutation(api.briefings.setBooking, { briefingId: id, bookingId: elsewhere })).rejects.toThrow(/booked on this project/);
    // Cancel the booking it's for: it can't be sent, and a new one can't be made for it.
    await w.heston.mutation(api.bookings.cancel, { bookingId });
    await expect(w.heston.action(api.briefings.send, { briefingId: id, storageId: await pdf(w) })).rejects.toThrow(/declined or cancelled/);
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
    await expect(w.boss.action(api.briefings.send, { briefingId: id, storageId: await pdf(w) })).rejects.toThrow();
    await expect(w.maya.query(api.briefings.list, {})).rejects.toThrow();
  });
});
