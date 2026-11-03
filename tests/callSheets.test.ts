// Phase 5b step 3 · call sheets. T5b.2: questions → template → editor → send. Each crew member and each client person
// gets email 40 exactly once; opens are recorded per person; Remind goes only to people who haven't opened it; Send an
// update sends email 42 once per person per update; guests (step 4) get email 41 with their own link, and 42 for updates
// (their sign-in and pages are in callSheetGuests.test.ts);
// a vendor not booked on the shoot and a client of another project can't open it. Contracts in the builder are
// untouched (their own tests run unchanged; here: call sheets stay out of Docs' lists and can't go to signing).
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { internal } from "../convex/_generated/api";
import { world } from "./payHarness";
import { todayCentral } from "../convex/lib/bookings";
import { nodesOf, pageOf, type Page } from "../convex/lib/wsBuilder";
import { STARTER_TEMPLATES, callFor, fillSheet, emptyLocation, whatChanged, withoutPeople } from "../convex/lib/callSheet";
import { callSheetMail, callSheetUpdateMail } from "../convex/lib/mails";
import { brandFrom } from "../convex/lib/mail";

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
  return new Response("{}", { status: 500 }); // nothing else may be reached
}));
const settle = async (w: W) => { vi.useFakeTimers(); await w.t.finishAllScheduledFunctions(vi.runAllTimers); vi.useRealTimers(); };
const day = (n: number) => { const d = new Date(`${todayCentral()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const JORDAN = "jordan@ellisfilms.com", SAMR = "sam@riverasound.example", RILEY = "riley@example.com";
const sheetMails = (mails: Sent[]) => mails.filter((m) => /call sheet/i.test(m.subject));

/** Maya can open the project (a project share); Jo is one of Harbor's people but can't. Jordan (vendor login) is booked
 *  for the shoot day; Sam Rivera (vendor login) is booked on the project for another day. Sam (client) is on another
 *  project only. */
async function setup(w: W) {
  await w.t.run(async (ctx) => {
    const owner = (await ctx.db.query("users").first())!._id;
    const s = await ctx.db.insert("shares", { businessId: w.A, token: "tok-proj-1", kind: "project", projectId: w.p, access: "comment", who: "invited", allVersions: true, downloads: false, emailNewVersions: true, createdAt: 0, createdBy: owner });
    await ctx.db.insert("shareMembers", { businessId: w.A, shareId: s, email: "maya@harbor.example", addedAt: 0 });
    const other = await ctx.db.insert("projects", { businessId: w.A, name: "Elsewhere", createdAt: 0 });
    const s2 = await ctx.db.insert("shares", { businessId: w.A, token: "tok-proj-2", kind: "project", projectId: other, access: "comment", who: "invited", allVersions: true, downloads: false, emailNewVersions: true, createdAt: 0, createdBy: owner });
    await ctx.db.insert("shareMembers", { businessId: w.A, shareId: s2, email: "sam@elsewhere.example", addedAt: 0 });
  });
  const jordan = await w.heston.mutation(api.vendors.add, { name: "Jordan Ellis", email: JORDAN, roles: ["Camera"], rates: [], invite: true }) as Id<"vendors">;
  const samR = await w.heston.mutation(api.vendors.add, { name: "Sam Rivera", email: SAMR, roles: ["Sound"], rates: [], invite: true }) as Id<"vendors">;
  const kJ = await w.heston.mutation(api.bookings.create, { vendorId: jordan, projectId: w.p, role: "Camera", start: day(4), end: day(4), cents: 100_000, unit: "day" }) as Id<"vendorBookings">;
  await w.heston.mutation(api.bookings.create, { vendorId: samR, projectId: w.p, role: "Sound", start: day(9), end: day(9), cents: 90_000, unit: "day" });
  const subs = await w.t.run(async (ctx) => {
    const out: Record<string, string> = {};
    for (const e of [JORDAN, SAMR]) {
      const userId = await ctx.db.insert("users", { email: e, name: e === JORDAN ? "Jordan Ellis" : "Sam Rivera", role: "vendor" });
      await ctx.db.insert("memberships", { businessId: w.A, email: e, userId, role: "vendor", createdAt: Date.now() });
      out[e] = `${userId}|${await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 })}`;
    }
    return out;
  });
  const { shootId } = await w.heston.mutation(api.shoots.schedule, { projectId: w.p, date: day(4), call: "07:30", wrap: "13:00", location: "Studio B", parking: "", prepare: [], withOwner: true, bookingIds: [kJ], calendar: false }) as { shootId: Id<"shoots"> };
  return { shootId, kJ, jordan: w.t.withIdentity({ subject: subs[JORDAN] }), samR: w.t.withIdentity({ subject: subs[SAMR] }) };
}

const answers = (templateId: string | null) => ({
  templateId, crewCall: "07:30", talentCall: "09:00", wrap: "13:00", locationName: "Studio B", address: "1 Film Row", parking: "Park behind the studio. Load-in is through the side door.", weather: true,
  schedule: [{ id: "r1", time: "07:30", what: "Crew call and load-in", who: "Crew" }, { id: "r2", time: "09:00", what: "Talent call, hair and makeup", who: "Talent" }, { id: "r3", time: "11:30", what: "Lunch", who: "Everyone" }],
  notes: "Bring water and a layer.",
});

describe("call sheets", () => {
  test("T5b.2 questions → template → editor → send → opens → remind → updates; guests by their own link", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const { shootId, kJ, jordan, samR } = await setup(w);
    await settle(w);
    mails.length = 0; // the vendor invites and email 29

    // Starter templates, once.
    expect(await w.heston.mutation(api.callSheets.ensureStarters, {})).toEqual({ added: 4 });
    expect(await w.heston.mutation(api.callSheets.ensureStarters, {})).toEqual({ added: 0 });
    const opts = await w.heston.query(api.callSheets.newOptions, {});
    expect(opts.templates.map((t: { name: string }) => t.name).sort()).toEqual(STARTER_TEMPLATES.map((t) => t.name).sort());
    expect(opts.shoots).toEqual([expect.objectContaining({ _id: shootId, label: expect.stringMatching(/^Launch · Harbor Coffee · /) })]);
    // Contracts: call-sheet templates stay out of Docs' templates and can't start a contract.
    expect((await w.heston.query(api.builder.listTemplates, {})).some((t: { name: string }) => t.name === "Standard shoot day")).toBe(false);
    const std = opts.templates.find((t: { name: string }) => t.name === "Standard shoot day")._id;
    await expect(w.heston.mutation(api.builder.createBuild, { templateId: std })).rejects.toThrow(/call sheet template/);

    // The questions.
    const csId = await w.heston.mutation(api.callSheets.create, { shootId, how: "questions" }) as Id<"callSheets">;
    await expect(w.heston.mutation(api.callSheets.create, { shootId, how: "blank" })).rejects.toThrow(/already has a call sheet/);
    let cs = await w.heston.query(api.callSheets.get, { callSheetId: csId });
    expect(cs).toMatchObject({ status: "draft", how: "questions", buildId: null, title: "Launch · Harbor Coffee", answers: expect.objectContaining({ crewCall: "07:30", locationName: "Studio B", templateId: std }) });
    const who = (id: string) => cs.people.find((p: { id: string }) => p.id === id);
    expect(who(`crew:${kJ}`)).toMatchObject({ name: "Jordan Ellis", role: "Camera", on: true, access: true });
    expect(who("client:maya@harbor.example")).toMatchObject({ kind: "client", on: true, access: true });
    expect(who("client:jo@harbor.example")).toMatchObject({ on: false, access: false });
    expect(cs.people.some((p: { email: string }) => p.email === SAMR)).toBe(false); // booked for another day
    await expect(w.heston.mutation(api.callSheets.toggle, { callSheetId: csId, id: "client:jo@harbor.example", on: true })).rejects.toThrow(/portal/);
    const guest = await w.heston.mutation(api.callSheets.addGuest, { callSheetId: csId, name: "Riley Quinn", email: RILEY, role: "Talent" });
    await expect(w.heston.mutation(api.callSheets.addGuest, { callSheetId: csId, name: "Riley", email: RILEY, role: "Talent" })).rejects.toThrow(/already/);
    await w.heston.mutation(api.callSheets.saveAnswers, { callSheetId: csId, answers: answers(std), step: 4 });
    const buildId = await w.heston.mutation(api.callSheets.make, { callSheetId: csId }) as Id<"wsBuilds">;
    expect(await w.heston.mutation(api.callSheets.make, { callSheetId: csId })).toBe(buildId); // once

    // The editor: the Docs builder's own build, its own kind, filled from the answers.
    const build = await w.heston.query(api.builder.getBuild, { buildId });
    expect(build.kind).toBe("callsheet");
    const page = pageOf(build.blocks);
    expect(nodesOf(page, "location")[0].attrs).toMatchObject({ crewCall: "07:30", talentCall: "09:00", wrap: "13:00", name: "Studio B", weather: true });
    expect((nodesOf(page, "schedule")[0].attrs!.rows as Array<{ what: string }>).map((r) => r.what)).toEqual(["Crew call and load-in", "Talent call, hair and makeup", "Lunch"]);
    expect((nodesOf(page, "crew")[0].attrs!.rows as Array<{ name: string; call: string }>).map((r) => [r.name, r.call])).toEqual([["Jordan Ellis", "07:30"], ["Maya Brooks", "07:30"], ["Riley Quinn", "09:00"]]);
    expect(JSON.stringify(page)).toContain("Bring water and a layer.");
    expect((await w.heston.query(api.builder.listBuilds, {})).some((b: { _id: string }) => b._id === buildId)).toBe(false); // not in Docs
    await expect(w.heston.mutation(api.builder.deleteBuild, { buildId })).rejects.toThrow(/call sheet/);

    // Send (766:6190): crew and client people get email 40, once each; the guest gets 41 (step 4); Jo gets nothing.
    const r = await w.heston.mutation(api.callSheets.send, { callSheetId: csId, crew: true, client: true, guests: true, message: "Looking forward to it." });
    expect(r).toEqual({ sent: 3, skipped: [], guests: 1 });
    await expect(w.heston.mutation(api.callSheets.send, { callSheetId: csId, crew: true, client: true })).rejects.toThrow(/Send an update/);
    await settle(w);
    let sm = sheetMails(mails);
    expect(sm.map((m) => m.to).sort()).toEqual([JORDAN, "maya@harbor.example", RILEY]);
    const m40 = sm.find((m) => m.to === JORDAN)!;
    expect(m40.subject).toMatch(/^Call sheet for \w+day, \w{3} \d+: Launch · Harbor Coffee$/);
    expect(m40.text).toContain("Hi Jordan,");
    expect(m40.text).toContain("7:30 AM");
    expect(m40.text).toContain("Looking forward to it.");
    expect(m40.text).toContain(`https://app.wranglerportal.com/vendor/call-sheets/${csId}`);
    expect(sm.find((m) => m.to === "maya@harbor.example")!.text).toContain(`https://app.wranglerportal.com/call-sheets/${csId}`);
    // A retried job sends nothing twice.
    const again = await w.t.action(internal.callSheets.mail, { callSheetId: csId, out: [{ id: `crew:${kJ}`, email: JORDAN, name: "Jordan Ellis", kind: "crew", mail: "first", key: `callsheet:${csId}:first:crew:${kJ}`, call: "07:30" }] });
    expect(again).toBe(0);
    expect(sheetMails(mails)).toHaveLength(3);
    // Maya's Inbox.
    const inbox = await w.maya.query(api.inbox.mine, {});
    const items = (inbox.items ?? inbox) as Array<{ title: string; link: string | null }>;
    expect(items.find((i) => i.link === `/call-sheets/${csId}`)).toMatchObject({ title: expect.stringMatching(/^Call sheet: /) });

    // Readers: Maya (client side) and Jordan (vendor side) read the sent copy; nobody else.
    const view = await w.maya.query(api.callSheets.forClient, { callSheetId: csId });
    expect(view).toMatchObject({ title: "Launch · Harbor Coffee", me: { name: "Maya Brooks", call: "07:30" }, openedAt: null });
    expect(await w.jo.query(api.callSheets.forClient, { callSheetId: csId })).toBeNull();
    expect(await w.sam.query(api.callSheets.forClient, { callSheetId: csId })).toBeNull();
    expect(await w.heston.query(api.callSheets.forClient, { callSheetId: csId })).toBeNull();
    expect(await w.boss.query(api.callSheets.get, { callSheetId: csId })).toBeNull();
    expect((await jordan.query(api.vendorPortal.callSheet, { callSheetId: csId }))?.me).toMatchObject({ name: "Jordan Ellis", call: "07:30" });
    expect(await samR.query(api.vendorPortal.callSheet, { callSheetId: csId })).toBeNull(); // booked, but not for this shoot
    await expect(samR.mutation(api.vendorPortal.openCallSheet, { callSheetId: csId })).rejects.toThrow(/isn't here/);
    await expect(w.jo.mutation(api.callSheets.opened, { callSheetId: csId })).rejects.toThrow(/isn't here/);
    // Even put on the sheet by hand, a client of another project can't open it.
    await w.t.run(async (ctx) => { const x = (await ctx.db.get(csId))!; await ctx.db.patch(csId, { recipients: [...x.recipients, { id: "client:sam@elsewhere.example", kind: "client", name: "Sam", email: "sam@elsewhere.example", on: true, sentAt: 1, addedAt: 1 }] }); });
    expect(await w.sam.query(api.callSheets.forClient, { callSheetId: csId })).toBeNull();
    await w.t.run(async (ctx) => { const x = (await ctx.db.get(csId))!; await ctx.db.patch(csId, { recipients: x.recipients.filter((p) => p.email !== "sam@elsewhere.example") }); });
    // The guest is on it, with access by their own link (step 4), and got email 41.
    cs = await w.heston.query(api.callSheets.get, { callSheetId: csId });
    expect(who(guest)).toMatchObject({ kind: "guest", name: "Riley Quinn", role: "Talent", on: true, access: true, sentAt: expect.any(Number), note: null });
    expect(sm.find((m) => m.to === RILEY)!.text).toMatch(/https:\/\/app\.wranglerportal\.com\/guest\/[A-Za-z0-9_-]{24}/);

    // Opens are per person.
    await w.maya.mutation(api.callSheets.opened, { callSheetId: csId });
    cs = await w.heston.query(api.callSheets.get, { callSheetId: csId });
    expect(who("client:maya@harbor.example").openedAt).toBeTypeOf("number");
    expect(who(`crew:${kJ}`).openedAt).toBeNull();
    const list = await w.heston.query(api.callSheets.list, {});
    expect(list.rows[0]).toMatchObject({ _id: csId, state: "sent", opened: 1, of: 3, people: 3, guests: 1 });
    const shoots = await w.heston.query(api.production.shoots, {});
    expect(shoots.upcoming[0].sheet).toMatchObject({ _id: csId, state: "sent", opened: 1, of: 3 });

    // Remind: Jordan and the guest (Maya opened it).
    await expect(w.heston.mutation(api.callSheets.remind, { callSheetId: csId, id: "client:maya@harbor.example" })).rejects.toThrow(/opened it already/);
    expect(await w.heston.mutation(api.callSheets.remind, { callSheetId: csId })).toEqual({ sent: 2 });
    await settle(w);
    sm = sheetMails(mails);
    expect(sm).toHaveLength(5);
    expect(sm.slice(3).map((m) => m.to).sort()).toEqual([JORDAN, RILEY]);
    expect(sm.slice(3).every((m) => /^Reminder: call sheet for /.test(m.subject))).toBe(true);
    expect(await w.heston.mutation(api.callSheets.remind, { callSheetId: csId })).toEqual({ sent: 0 }); // not again within minutes
    await jordan.mutation(api.vendorPortal.openCallSheet, { callSheetId: csId });

    // An edit after sending shows on the Detail page, and readers still see the sent copy until an update goes out.
    const edited: Page = JSON.parse(JSON.stringify(page));
    (nodesOf(edited, "location")[0].attrs as { talentCall: string }).talentCall = "10:00";
    await w.heston.mutation(api.builder.saveBuild, { buildId, title: build.title, blocks: edited, fields: build.fields, signers: [], style: build.style });
    cs = await w.heston.query(api.callSheets.get, { callSheetId: csId });
    expect(cs).toMatchObject({ changed: true, changes: ["Talent call moved to 10:00 AM"] });
    expect(nodesOf((await w.maya.query(api.callSheets.forClient, { callSheetId: csId })).page, "location")[0].attrs.talentCall).toBe("09:00");

    // Send an update: email 42 once per person per update.
    await w.heston.mutation(api.callSheets.sendUpdate, { callSheetId: csId, changed: "Talent call moved to 10:00 AM" });
    await settle(w);
    const updates = () => sheetMails(mails).filter((m) => m.subject.startsWith("Call sheet updated"));
    expect(updates().map((m) => m.to).sort()).toEqual([JORDAN, "maya@harbor.example", RILEY]);
    const m42 = updates().find((m) => m.to === JORDAN)!;
    expect(m42.text).toContain("Talent call moved to 10:00 AM");
    expect(m42.text).toContain("7:30 AM (same)");
    expect(m42.text).toContain("Nothing else changed for you.");
    expect(nodesOf((await w.maya.query(api.callSheets.forClient, { callSheetId: csId })).page, "location")[0].attrs.talentCall).toBe("10:00");
    expect((await w.heston.query(api.callSheets.get, { callSheetId: csId })).changed).toBe(false);
    const retry = await w.t.action(internal.callSheets.mail, { callSheetId: csId, changed: "x", out: [{ id: "client:maya@harbor.example", email: "maya@harbor.example", name: "Maya Brooks", kind: "client", mail: "update", key: `callsheet:${csId}:update:1:client:maya@harbor.example`, call: "07:30", was: "07:30" }] });
    expect(retry).toBe(0);
    // A second update is a second email each; Maya has switched call sheet emails off (her Inbox still gets it).
    await w.maya.mutation(api.notifications.setClient, { key: "call_sheets", on: false });
    await w.heston.mutation(api.callSheets.sendUpdate, { callSheetId: csId, changed: "Lunch moved to noon" });
    await settle(w);
    expect(updates().map((m) => m.to).sort()).toEqual([JORDAN, JORDAN, "maya@harbor.example", RILEY, RILEY]);
    const items2 = ((await w.maya.query(api.inbox.mine, {})).items ?? await w.maya.query(api.inbox.mine, {})) as Array<{ text: string }>;
    expect(items2.some((i) => i.text === "Lunch moved to noon.")).toBe(true);

    // A cancelled booking ends the vendor's access.
    await w.heston.mutation(api.bookings.cancel, { bookingId: kJ });
    expect(await jordan.query(api.vendorPortal.callSheet, { callSheetId: csId })).toBeNull();
  }, 60_000);

  test("from a template, or blank; groups left out of Send stay unticked; drafts can be deleted", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const { shootId, kJ } = await setup(w);
    await w.heston.mutation(api.callSheets.ensureStarters, {});
    const tpl = (await w.heston.query(api.callSheets.newOptions, {})).templates.find((t: { name: string }) => t.name === "Interview day")._id;
    const csId = await w.heston.mutation(api.callSheets.create, { shootId, how: "template", templateId: tpl }) as Id<"callSheets">;
    const cs = await w.heston.query(api.callSheets.get, { callSheetId: csId });
    expect(cs.buildId).toBeTruthy();
    const page = pageOf((await w.heston.query(api.builder.getBuild, { buildId: cs.buildId })).blocks);
    expect(nodesOf(page, "location")[0].attrs).toMatchObject({ crewCall: "07:30", wrap: "13:00", name: "Studio B" });
    await settle(w);
    mails.length = 0;
    await w.heston.mutation(api.callSheets.send, { callSheetId: csId, crew: false, client: true });
    await settle(w);
    expect(sheetMails(mails).map((m) => m.to)).toEqual(["maya@harbor.example"]);
    expect((await w.heston.query(api.callSheets.get, { callSheetId: csId })).people.find((p: { id: string }) => p.id === `crew:${kJ}`)).toMatchObject({ on: false, sentAt: null });
    await expect(w.heston.mutation(api.callSheets.deleteDraft, { callSheetId: csId })).rejects.toThrow(/stays/);
    // A blank one on another shoot, deleted while a draft (its build goes too).
    const { shootId: s2 } = await w.heston.mutation(api.shoots.schedule, { projectId: w.p, date: day(6), call: "08:00", location: "Lake", prepare: [], withOwner: true, bookingIds: [], calendar: false }) as { shootId: Id<"shoots"> };
    const blank = await w.heston.mutation(api.callSheets.create, { shootId: s2, how: "blank" }) as Id<"callSheets">;
    const bId = (await w.heston.query(api.callSheets.get, { callSheetId: blank })).buildId;
    await w.heston.mutation(api.callSheets.deleteDraft, { callSheetId: blank });
    expect(await w.t.run(async (ctx) => [await ctx.db.get(blank), await ctx.db.get(bId as Id<"wsBuilds">)])).toEqual([null, null]);
    const o = await w.heston.query(api.production.overview, {});
    expect(o.callSheets).toMatchObject({ notSent: 0, sentWeek: 1, templates: 4 });
  }, 30_000);

  test("the pieces: filling a page, each person's call, what changed, templates keep no people, the emails", () => {
    const loc = { ...emptyLocation(), crewCall: "07:30", talentCall: "09:00", name: "Studio B" };
    const page = fillSheet(STARTER_TEMPLATES[0].page(), { location: loc, schedule: [], crew: [{ id: "a", name: "Jordan Ellis", role: "Camera", call: "06:45", phone: "" }], contacts: [] });
    expect(callFor(page, { name: "jordan ellis", kind: "crew" })).toBe("06:45");
    expect(callFor(page, { name: "Maya", kind: "client" })).toBe("07:30");
    expect(callFor(page, { name: "Riley", kind: "guest" })).toBe("09:00");
    const blankPage = fillSheet(null, { location: loc, schedule: [], crew: [], contacts: [], notes: "Quiet on set" });
    expect(["location", "schedule", "crew", "contacts"].every((t) => nodesOf(blankPage, t).length === 1)).toBe(true);
    const moved = fillSheet(STARTER_TEMPLATES[0].page(), { location: { ...loc, talentCall: "10:00", name: "Studio C" }, schedule: [], crew: [], contacts: [] });
    expect(whatChanged(page, moved)).toEqual(["Talent call moved to 10:00 AM", "Location is now Studio C", "The crew list changed"]);
    const t = withoutPeople(page);
    expect(nodesOf(t, "crew")[0].attrs!.rows).toEqual([]);
    expect(nodesOf(t, "location")[0].attrs!.name).toBe("");
    const b = brandFrom(null, { ownerEmail: "h@w.co", logoUrl: null, isDefault: true });
    const m40 = callSheetMail(b, { name: "Jordan Ellis", title: "Launch · Harbor Coffee", date: "2030-11-05", dayLong: "Tuesday, Nov 5", call: "7:30 AM", where: "Studio B", from: "Heston Hill", link: "https://x/y" });
    expect(m40.subject).toBe("Call sheet for Tuesday, Nov 5: Launch · Harbor Coffee");
    expect(m40.text).toContain("Open the call sheet");
    const m42 = callSheetUpdateMail(b, { name: "Jordan", title: "T", dayLong: "Tuesday, Nov 5", changed: "Talent call moved to 9:00 AM", call: "8:00 AM", was: "7:30 AM", from: "Heston Hill", link: "https://x/y" });
    expect(m42.text).toContain("8:00 AM (was 7:30 AM)");
    expect(m42.text).not.toContain("Nothing else changed for you.");
  });
});
