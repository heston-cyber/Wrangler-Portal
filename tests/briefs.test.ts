// Phase 4 · the kickoff brief, option B. T4.3: the owner sends it; the client answers step by step (saved as they go),
// sends it back, and changes it later; the owner sees the answers, gets an email, and starts an estimate from them.
// Plus Settings › Kickoff brief (its own set, no built-in steps) and who can see what. Resend is faked.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { world } from "./payHarness";
import { KICKOFF_BRIEF } from "../convex/lib/kickoff";
import { cleanAnswers } from "../convex/briefs";
import { cleanQuestionnaire } from "../convex/lib/questionnaire";

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

function fake() {
  const s = { mails: [] as Sent[] };
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === "https://api.resend.com/emails") { const b = JSON.parse(String(init?.body)); s.mails.push({ to: b.to[0], subject: b.subject, text: b.text }); return new Response(JSON.stringify({ id: "em" }), { status: 200 }); }
    return new Response("{}", { status: 500 });
  }));
  return s;
}
const settle = async (w: W) => { vi.useFakeTimers(); await w.t.finishAllScheduledFunctions(vi.runAllTimers); vi.useRealTimers(); };
async function share(w: W, emails = ["maya@harbor.example"]) {
  await w.t.run(async (ctx) => {
    const owner = (await ctx.db.query("users").first())!._id;
    const s = await ctx.db.insert("shares", { businessId: w.A, token: "tok-proj-1", kind: "project", projectId: w.p, access: "comment", who: "invited", allVersions: true, downloads: false, emailNewVersions: true, createdAt: 0, createdBy: owner });
    for (const email of emails) await ctx.db.insert("shareMembers", { businessId: w.A, shareId: s, email, addedAt: 0 });
  });
}
const ANSWERS = { goal: "Launch the new menu and bring in the morning crowd.", audience: "Regulars and downtown office workers", where: ["Instagram", "In-store screens"], must: "Latte art, the new menu boards, the team." };

describe("kickoff brief", () => {
  test("sent → answered step by step → sent back → changed; the owner sees it, is emailed, and starts an estimate", async () => {
    const w = await world();
    const s = fake();
    // Nobody can open the project yet: nothing to send to.
    expect((await w.heston.query(api.briefs.forProject, { projectId: w.p }))).toEqual({ brief: null, people: 0 });
    await expect(w.heston.mutation(api.briefs.send, { projectId: w.p })).rejects.toThrow(/Share the project with them first/);
    await share(w, ["maya@harbor.example", "jo@harbor.example"]);
    const { briefId, told } = await w.heston.mutation(api.briefs.send, { projectId: w.p }) as { briefId: Id<"briefs">; told: number };
    expect(told).toBe(2);
    await expect(w.heston.mutation(api.briefs.send, { projectId: w.p })).rejects.toThrow(/already gone/);
    await settle(w);
    // Email 33 and the Inbox item, to each.
    const m33 = s.mails.filter((m) => m.subject === "Before we start, tell us about 26127 Launch");
    expect(m33.map((m) => m.to).sort()).toEqual(["jo@harbor.example", "maya@harbor.example"]);
    expect(m33[0].text).toContain("About 10 minutes");
    expect(m33[0].text).toContain("Project, brand, dates");
    expect(m33[0].text).toContain(`https://app.wranglerportal.com/briefs/${briefId}`);
    const items = await w.t.run((ctx) => ctx.db.query("inboxItems").collect());
    expect(items.filter((i) => i.kind === "brief").map((i) => ({ email: i.email, link: i.link, title: i.title }))).toContainEqual({ email: "maya@harbor.example", link: `/briefs/${briefId}`, title: "Kickoff brief: 26127 Launch" });

    // The client's Coming up row and page.
    expect(await w.maya.query(api.briefs.forClientProject, { projectId: w.p })).toMatchObject({ _id: briefId, status: "sent", started: false });
    const page = await w.maya.query(api.briefs.page, { briefId });
    expect(page.questions.steps.map((x: { title: string }) => x.title)).toEqual(["Project", "Brand", "Dates"]);
    // Saved as they go (unknown keys and oversized answers are dropped or cut).
    await w.maya.mutation(api.briefs.save, { briefId, changes: { ...ANSWERS, nope: "x", ready: "not a date" }, step: 1 });
    const saved = await w.maya.query(api.briefs.page, { briefId });
    expect(saved.answers).toEqual(ANSWERS);
    expect(saved.step).toBe(1);
    expect((await w.heston.query(api.briefs.forProject, { projectId: w.p })).brief).toMatchObject({ status: "sent", startedAt: expect.any(Number) });
    // Required questions first.
    await expect(w.maya.mutation(api.briefs.submit, { briefId, changes: ANSWERS })).rejects.toThrow(/When does it need to be ready/);
    await w.maya.mutation(api.briefs.submit, { briefId, changes: { ...ANSWERS, feel: ["Warm", "community"], ready: "2026-11-20" } });
    await settle(w);
    const owner = await w.heston.query(api.briefs.forProject, { projectId: w.p });
    expect(owner.brief).toMatchObject({ status: "submitted", by: "Maya Brooks", submits: 1 });
    expect(owner.brief.answers[0]).toEqual({ step: "Project", answers: [
      { question: "What's the film for?", answer: ANSWERS.goal }, { question: "Who should it speak to?", answer: ANSWERS.audience },
      { question: "Where will it run?", answer: "Instagram, In-store screens" }, { question: "Anything it must show?", answer: ANSWERS.must },
    ] });
    const toOwner = s.mails.filter((m) => m.to === "heston@wranglerproductions.com");
    expect(toOwner.map((m) => m.subject)).toEqual(["Maya Brooks answered the kickoff brief: 26127 Launch"]);
    expect(toOwner[0].text).toContain("Launch the new menu");
    // Jo sees it as sent back; nobody is reminded of a brief that's back.
    expect(await w.jo.query(api.briefs.forClientProject, { projectId: w.p })).toMatchObject({ status: "submitted" });
    await expect(w.heston.mutation(api.briefs.remind, { briefId })).rejects.toThrow(/already sent it back/);

    // Once it's back, changes only come through Send changes (which checks the required answers).
    await expect(w.jo.mutation(api.briefs.save, { briefId, changes: { goal: "" }, step: 0 })).rejects.toThrow(/sent back/);
    await expect(w.jo.mutation(api.briefs.submit, { briefId, changes: { goal: "" } })).rejects.toThrow(/What's the film for/);
    // Changed later, twice: the owner hears once, 10 minutes after the last change, with the answers as they ended up.
    await w.jo.mutation(api.briefs.submit, { briefId, changes: { ready: "2026-11-21" } });
    await w.maya.mutation(api.briefs.submit, { briefId, changes: { audience: "Regulars" } });
    await settle(w);
    // The 10-minute runs (convex-test doesn't reach them in settle): each one, as the scheduler would.
    const runs = await w.t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).filter((j) => j.name === "briefs:mailOwner" && j.state.kind === "pending").map((j) => j.args[0] as { briefId: Id<"briefs">; n: number }));
    expect(runs.map((r) => r.n).sort()).toEqual([2, 3]);
    for (const r of runs) await w.t.action(anyApi.briefs.mailOwner, r);
    const later = s.mails.filter((m) => m.to === "heston@wranglerproductions.com");
    expect(later.map((m) => m.subject)).toEqual(["Maya Brooks answered the kickoff brief: 26127 Launch", "Maya Brooks changed the kickoff brief: 26127 Launch"]);
    expect(later[1].text).toContain("Regulars");
    expect(later[1].text).toContain("Nov 21, 2026");
    expect((await w.heston.query(api.briefs.forProject, { projectId: w.p })).brief).toMatchObject({ by: "Maya Brooks", updatedBy: "Maya Brooks", submits: 3 });

    // Start an estimate from it.
    const est = await w.heston.query(api.briefs.forEstimate, { briefId });
    expect(est).toMatchObject({ projectId: w.p, clientId: w.harbor, title: "Launch" });
    expect(est.scope).toContain("What's the film for? Launch the new menu");
    expect(est.scope).toContain("When does it need to be ready? Nov 21, 2026");
  });

  test("a reminder: once a day, only while it's out", async () => {
    const w = await world();
    const s = fake();
    await share(w);
    const { briefId } = await w.heston.mutation(api.briefs.send, { projectId: w.p }) as { briefId: Id<"briefs"> };
    await settle(w);
    await expect(w.heston.mutation(api.briefs.remind, { briefId })).rejects.toThrow(/today/);
    await w.t.run(async (ctx) => { await ctx.db.patch(briefId, { sentAt: Date.now() - 25 * 3_600_000 }); });
    expect((await w.heston.query(api.briefs.forProject, { projectId: w.p })).brief.remindAt).toBeLessThan(Date.now());
    await w.heston.mutation(api.briefs.remind, { briefId });
    await settle(w);
    expect(s.mails.filter((m) => m.subject === "Reminder: the kickoff brief for 26127 Launch").map((m) => m.to)).toEqual(["maya@harbor.example"]);
    await expect(w.heston.mutation(api.briefs.remind, { briefId })).rejects.toThrow(/today/);
  });

  test("Settings › Kickoff brief: its own set, kept when sent, with no built-in steps or file questions", async () => {
    const w = await world();
    fake();
    await share(w);
    const s0 = await w.heston.query(api.briefs.settings, {});
    expect(s0).toMatchObject({ custom: false, covers: "Project, brand, dates", questions: 12 });
    const mine = { steps: [{ id: "one", title: "Basics", heading: "The basics.", sub: "", questions: [
      { id: "goal", label: "What's it for?", type: "long", required: true }, { id: "f", label: "Your logo", type: "file" }, { id: "c", label: "Client", type: "client", bind: "client" },
    ] }] };
    await w.heston.mutation(api.briefs.saveSettings, { questionnaire: mine });
    const s1 = await w.heston.query(api.briefs.settings, {});
    expect(s1.custom).toBe(true);
    expect(s1.questionnaire.steps[0].questions.map((q: { type: string }) => q.type)).toEqual(["long", "short", "short"]); // no file or client questions
    expect(s1.questionnaire.steps[0].questions[2].bind).toBeUndefined();
    await expect(w.heston.mutation(api.briefs.saveSettings, { questionnaire: { steps: [{ id: "x", title: "X", heading: "X", sub: "", questions: [] }] } })).rejects.toThrow(/at least one question/);
    const { briefId } = await w.heston.mutation(api.briefs.send, { projectId: w.p }) as { briefId: Id<"briefs"> };
    await w.heston.mutation(api.briefs.resetSettings, {});
    expect((await w.heston.query(api.briefs.settings, {})).custom).toBe(false);
    // The brief keeps the questions it went with.
    expect((await w.maya.query(api.briefs.page, { briefId })).questions.steps.map((x: { title: string }) => x.title)).toEqual(["Basics"]);
    // Only the owner edits them.
    await expect(w.maya.query(api.briefs.settings, {})).rejects.toThrow(/Not allowed/);
    await expect(w.maya.mutation(api.briefs.saveSettings, { questionnaire: mine })).rejects.toThrow(/Not allowed/);
  });

  test("who can see and answer it", async () => {
    const w = await world();
    fake();
    await share(w); // Maya only
    const { briefId } = await w.heston.mutation(api.briefs.send, { projectId: w.p }) as { briefId: Id<"briefs"> };
    // Jo (same client, not on the project), Sam and another business's owner see nothing and can't answer.
    for (const who of [w.jo, w.sam]) {
      expect(await who.query(api.briefs.page, { briefId })).toBeNull();
      expect(await who.query(api.briefs.forClientProject, { projectId: w.p })).toBeNull();
      await expect(who.mutation(api.briefs.save, { briefId, changes: ANSWERS, step: 0 })).rejects.toThrow(/isn't here/);
      await expect(who.mutation(api.briefs.submit, { briefId, changes: ANSWERS })).rejects.toThrow(/isn't here/);
      await expect(who.query(api.briefs.forProject, { projectId: w.p })).rejects.toThrow(/Not allowed/);
    }
    expect(await w.boss.query(api.briefs.forProject, { projectId: w.p })).toBeNull();
    expect(await w.boss.query(api.briefs.forEstimate, { briefId })).toBeNull();
    await expect(w.boss.mutation(api.briefs.send, { projectId: w.p })).rejects.toThrow(/doesn't exist/);
    await expect(w.boss.mutation(api.briefs.remind, { briefId })).rejects.toThrow(/isn't here/);
    // An owner can't answer it as the client.
    expect(await w.heston.query(api.briefs.page, { briefId })).toBeNull();
  });

  test("two people answering at once keep each other's answers; a client of two businesses can send it back", async () => {
    const w = await world();
    const s = fake();
    await share(w, ["maya@harbor.example", "jo@harbor.example"]);
    await w.t.run(async (ctx) => {
      const B = (await ctx.db.query("businesses").collect()).find((b) => b.slug === "other")!._id;
      const maya = (await ctx.db.query("users").collect()).find((u) => u.email === "maya@harbor.example")!._id;
      await ctx.db.insert("memberships", { businessId: B, email: "maya@harbor.example", userId: maya, role: "client", createdAt: 0 });
      await ctx.db.insert("invites", { businessId: B, email: "maya@harbor.example", createdAt: 0, acceptedAt: 0, userId: maya });
    });
    const { briefId } = await w.heston.mutation(api.briefs.send, { projectId: w.p }) as { briefId: Id<"briefs"> };
    await w.maya.mutation(api.briefs.save, { briefId, changes: { goal: ANSWERS.goal, audience: ANSWERS.audience }, step: 0 });
    await w.jo.mutation(api.briefs.save, { briefId, changes: { ready: "2026-11-20" }, step: 2 });
    await w.maya.mutation(api.briefs.save, { briefId, changes: { audience: null }, step: 1 }); // cleared
    expect((await w.jo.query(api.briefs.page, { briefId })).answers).toEqual({ goal: ANSWERS.goal, ready: "2026-11-20" });
    await w.maya.mutation(api.briefs.submit, { briefId, changes: {} });
    await settle(w);
    expect(s.mails.filter((m) => m.to === "heston@wranglerproductions.com").map((m) => m.subject)).toEqual(["Maya Brooks answered the kickoff brief: 26127 Launch"]);
  });

  test("a required choice needs something to pick", async () => {
    const w = await world();
    fake();
    await expect(w.heston.mutation(api.briefs.saveSettings, { questionnaire: { steps: [{ id: "a", title: "A", heading: "A", sub: "", questions: [{ id: "x", label: "Pick", type: "select", required: true, options: [] }] }] } })).rejects.toThrow(/nothing to pick/);
  });

  test("answers keep their shape", () => {
    const qn = cleanQuestionnaire(KICKOFF_BRIEF, "kickoff");
    expect(qn).toEqual(KICKOFF_BRIEF);
    expect(cleanAnswers(qn, { where: ["Instagram", "", 3, "Instagram", "Radio"], refs: ["https://a.example", 5], colors: ["#ff0000", "#"], ready: "2026-02-30x", launch: "2026-11-20", goal: "x".repeat(5000) }))
      .toEqual({ where: ["Instagram", "Radio"], refs: ["https://a.example"], colors: ["#FF0000"], launch: "2026-11-20", goal: "x".repeat(4000) }); // "Other" is on for where
    const strict = { steps: [{ id: "s", title: "S", heading: "S", sub: "", questions: [{ id: "pick", label: "Pick", type: "select" as const, options: ["A", "B"] }, { id: "many", label: "Many", type: "multi" as const, options: ["A"] }, { id: "r", label: "R", type: "daterange" as const }] }] };
    expect(cleanAnswers(strict, { pick: "C", many: ["A", "Z"], r: { start: "2026-11-10", end: "2026-11-01" } })).toEqual({ many: ["A"], r: { start: "2026-11-10" } });
  });
});
