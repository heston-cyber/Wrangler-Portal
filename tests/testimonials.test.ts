// Phase 5 · testimonials. D139: the request is an Inbox note sent from the composer, which links to the form and goes out as
// email 35. Only the people it was sent to can answer, once each. T5.2 (as decided in D141): nothing is published; each
// answer, with or without permission, is saved as a Markdown note in Dropbox for the vault, marked with its permission.
// The owner hears (email and Dashboard) until they mark it read. Another business sees none of it.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { world } from "./payHarness";
import { testimonialNote } from "../convex/testimonials";

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
type Upload = { path: string; body: string };
const stub = (mails: Sent[], uploads: Upload[] = [], dropboxOk = true) => vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url === "https://api.resend.com/emails") { const b = JSON.parse(String(init?.body)); mails.push({ to: b.to[0], subject: b.subject, text: b.text }); return new Response(JSON.stringify({ id: "em" }), { status: 200 }); }
  if (url === "https://content.dropboxapi.com/2/files/upload") {
    const arg = JSON.parse(String((init?.headers as Record<string, string>)["Dropbox-API-Arg"]));
    uploads.push({ path: arg.path, body: new TextDecoder().decode(init?.body as Uint8Array) });
    return dropboxOk ? new Response(JSON.stringify({ path_display: `/Apps/Wrangler Review${arg.path}` }), { status: 200 }) : new Response("nope", { status: 500 });
  }
  return new Response("{}", { status: 500 });
}));
const settle = async (w: W) => { vi.useFakeTimers(); await w.t.finishAllScheduledFunctions(vi.runAllTimers); vi.useRealTimers(); };
const dropbox = (w: W) => w.t.run(async (ctx) => { await ctx.db.insert("dropbox", { businessId: w.A, accountId: "dbid", refreshToken: "r", accessToken: "tok", accessExpiresAt: Date.now() + 3_600_000, connectedAt: 0 }); });

/** Heston asks Harbor Coffee for a testimonial about 26127 Launch (Maya and Jo have portal access; Sam isn't Harbor's). */
async function ask(w: W) {
  const noteId = await w.heston.mutation(api.inbox.saveNote, { clientId: w.harbor, title: "A few words about 26127 Launch?", text: "Two quick questions.", testimonialProjectId: w.p }) as Id<"inboxNotes">;
  const r = await w.heston.mutation(api.inbox.sendNote, { noteId });
  return { noteId, sent: r.sent as number };
}

describe("testimonials", () => {
  test("D139: the composer's request links to the form and goes out as email 35", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    // Only this client's projects; the composer lists them.
    const other = await w.t.run(async (ctx) => { const c = await ctx.db.insert("clients", { businessId: w.A, name: "Northline", createdAt: 0 }); return await ctx.db.insert("projects", { businessId: w.A, name: "Teaser", clientId: c, createdAt: 0 }); });
    await expect(w.heston.mutation(api.inbox.saveNote, { clientId: w.harbor, title: "T", text: "x", testimonialProjectId: other })).rejects.toThrow(/Harbor Coffee's projects/);
    expect(await w.heston.query(api.testimonials.projectsFor, { clientId: w.harbor })).toEqual([expect.objectContaining({ _id: w.p, label: "26127 Launch", asked: false })]);
    const { noteId, sent } = await ask(w);
    expect(sent).toBe(2);
    const items = (await w.maya.query(api.inbox.mine, {}));
    const item = ((items.items ?? items) as Array<{ title: string; link: string; linkLabel: string }>).find((i) => i.title === "A few words about 26127 Launch?");
    expect(item).toMatchObject({ link: `/words/${noteId}`, linkLabel: "Share a few words" });
    await settle(w);
    const m35 = mails.filter((m) => m.subject === "How did 26127 Launch go?");
    expect(m35.map((m) => m.to).sort()).toEqual(["jo@harbor.example", "maya@harbor.example"]);
    expect(m35.find((m) => m.to === "maya@harbor.example")!.text).toContain(`https://app.wranglerportal.com/words/${noteId}`);
    expect(m35[0].text).toContain("Nothing is posted without your OK.");
    expect(await w.heston.query(api.testimonials.projectsFor, { clientId: w.harbor })).toEqual([expect.objectContaining({ _id: w.p, asked: true })]);
    // The draft keeps its project for the composer.
    expect((await w.heston.query(api.inbox.noteDetail, { noteId })).testimonial).toEqual({ projectId: w.p, project: "26127 Launch" });
  });

  test("the form: only people it was sent to, once each; the owner hears and it's saved for the vault", async () => {
    const w = await world();
    const mails: Sent[] = [], uploads: Upload[] = [];
    stub(mails, uploads);
    await dropbox(w);
    const { noteId } = await ask(w);
    expect(await w.sam.query(api.testimonials.ask, { noteId })).toBeNull(); // not sent to Sam
    await expect(w.sam.mutation(api.testimonials.send, { noteId, working: "x", film: "", permission: true })).rejects.toThrow(/isn't here/);
    expect(await w.boss.query(api.testimonials.ask, { noteId })).toBeNull();
    const form = await w.maya.query(api.testimonials.ask, { noteId });
    expect(form).toMatchObject({ project: { label: "26127 Launch" }, business: "Wrangler Productions", name: "Maya Brooks", company: "Harbor Coffee", sent: null,
      questions: { working: "What was it like working with us?", film: "What did the film do for you?" } });
    await expect(w.maya.mutation(api.testimonials.send, { noteId, working: "  ", film: "", permission: true })).rejects.toThrow(/at least one/);
    await w.maya.mutation(api.testimonials.send, { noteId, working: "Easy from start to finish.", film: "Our most-watched post ever.", permission: true });
    await expect(w.maya.mutation(api.testimonials.send, { noteId, working: "Again", film: "", permission: false })).rejects.toThrow(/already sent/);
    expect((await w.maya.query(api.testimonials.ask, { noteId })).sent).toMatchObject({ working: "Easy from start to finish.", permission: true });
    await w.jo.mutation(api.testimonials.send, { noteId, working: "Fine.", film: "", permission: false });
    await settle(w);

    // The owner: the list, the Dashboard and an email for each.
    const list = await w.heston.query(api.testimonials.list, {});
    expect(list).toHaveLength(2);
    const maya = list.find((r: { email: string }) => r.email === "maya@harbor.example");
    expect(maya).toMatchObject({ name: "Maya Brooks", company: "Harbor Coffee", project: "26127 Launch", permission: true, read: false, saved: { path: expect.stringMatching(/^\/Apps\/Wrangler Review\/Testimonials\/\d{4}-\d\d-\d\d Maya Brooks - 26127 Launch\.md$/) } });
    expect(list.find((r: { email: string }) => r.email === "jo@harbor.example")).toMatchObject({ permission: false, saved: expect.anything() });
    expect(mails.find((m) => m.subject === "Maya Brooks sent a few words: 26127 Launch")?.to).toBe("heston@wranglerproductions.com");
    expect((await w.heston.query(api.home.needs, {})).filter((n: { kind: string }) => n.kind === "testimonial")).toHaveLength(2);
    await w.heston.mutation(api.testimonials.markRead, { testimonialId: maya._id });
    expect((await w.heston.query(api.home.needs, {})).filter((n: { kind: string }) => n.kind === "testimonial")).toHaveLength(1);

    // The vault notes: both saved, each with its permission; nothing published anywhere else.
    expect(uploads).toHaveLength(2);
    const note = uploads.find((u) => u.path.includes("Maya Brooks"))!;
    expect(note.path.startsWith("/Testimonials/")).toBe(true);
    expect(note.body).toContain("type: testimonial");
    expect(note.body).toContain("permission: yes");
    expect(note.body).toContain("> Easy from start to finish.");
    expect(uploads.find((u) => u.path.includes("Jo"))!.body).toContain("permission: no");

    // Another business sees none of it.
    expect(await w.boss.query(api.testimonials.list, {})).toEqual([]);
    await expect(w.boss.mutation(api.testimonials.markRead, { testimonialId: maya._id })).rejects.toThrow();
  });

  test("no Dropbox: the answer is kept and says so; Save again saves it once Dropbox is connected", async () => {
    const w = await world();
    const uploads: Upload[] = [];
    stub([], uploads);
    const { noteId } = await ask(w);
    await w.maya.mutation(api.testimonials.send, { noteId, working: "Great.", film: "", permission: false });
    await settle(w);
    let [r] = await w.heston.query(api.testimonials.list, {});
    expect(r).toMatchObject({ saved: null, saveError: expect.stringMatching(/Dropbox isn't connected/) });
    await dropbox(w);
    await w.heston.mutation(api.testimonials.saveAgain, { testimonialId: r._id });
    await settle(w);
    [r] = await w.heston.query(api.testimonials.list, {});
    expect(r).toMatchObject({ saved: expect.anything(), saveError: null });
    expect(uploads).toHaveLength(1);
    expect(await w.heston.mutation(api.testimonials.saveAgain, { testimonialId: r._id })).toEqual({ already: true });
  });

  test("the vault note's shape", () => {
    const md = testimonialNote({ name: "Ava Chen", company: "Northline", email: "ava@northline.example", working: "Clear, fast.\nThey listened.", film: "", permission: false, createdAt: Date.UTC(2026, 9, 4, 18) }, "26112 Northline", "Wrangler Productions");
    expect(md).toContain('date: 2026-10-04');
    expect(md).toContain('name: "Ava Chen"');
    expect(md).toContain("permission: no");
    expect(md).toContain("# Ava Chen, Northline · 26112 Northline");
    expect(md).toContain("> Clear, fast.\n> They listened.");
    expect(md).toContain("> (no answer)");
    expect(md).toContain("Private: keep it for yourself");
  });
});
