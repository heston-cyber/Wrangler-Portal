// D149 (Heston, Nov 3–4; approved 13:16 and 13:56): proposals and quotes sent to anyone. The read-back's tests: a quote
// or proposal saves with no client and can't be sent without a recipient; each address gets its own link (a Name only
// with one address); each link opens only its own; one accept closes every other link ("Already accepted", never who),
// two can't both accept; one of several declining leaves it open; a copied link's Accept asks name, email and company;
// whoever accepts becomes the contact (a quiet lead when not a client, off the board until "Move to Quoted?"); stop
// one person's link; a new copied link; another business, a client and a stranger get nothing.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { fakeStripe, world } from "./payHarness";
import { newId, pageOf, type Page } from "../convex/lib/wsBuilder";

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
const quote = (w: W, who?: Record<string, unknown>) => w.heston.mutation(api.quotes.save, {
  ...(who ? { who } : {}), title: "Menu board refresh", lines: [{ id: "a", description: "Shooting · 1 day", qty: 1, unitCents: 160_000 }], deposit: { kind: "percent", value: 50 },
}) as Promise<Id<"quotes">>;
const qpost = (w: W, body: Record<string, unknown>) => w.t.fetch("/q-respond", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7", "user-agent": "T/1" }, body: JSON.stringify(body) });
const ppost = (w: W, body: Record<string, unknown>) => w.t.fetch("/p-respond", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9", "user-agent": "T/2" }, body: JSON.stringify(body) });
const tokenTo = (mails: Sent[], to: string, path = "q") => mails.filter((m) => m.to === to).at(-1)!.text.match(new RegExp(`/${path}/([\\w-]+)`))![1];
const settle = (w: W) => w.t.finishAllScheduledFunctions(vi.runAllTimers);

describe("D149 quotes and proposals to anyone", () => {
  test("No client yet: saves; Send needs a recipient; one link each; Hi {name} with one address, Hello with several", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const id = await quote(w);
    const d0 = await w.heston.query(api.quotes.get, { quoteId: id });
    expect(d0.status).toBe("draft");
    expect(d0.contact).toBeUndefined();
    expect((await w.heston.query(api.quotes.list, {}))[0].company).toBe("No client yet");
    await expect(w.heston.action(api.quotes.send, { quoteId: id })).rejects.toThrow(/Add who it goes to/);
    await expect(w.heston.action(api.quotes.send, { quoteId: id, to: "priya@rao.example, not an email" })).rejects.toThrow(/isn't an email/);
    expect((await w.heston.query(api.quotes.get, { quoteId: id })).status).toBe("draft"); // nothing half-sent
    const r = await w.heston.action(api.quotes.send, { quoteId: id, to: "priya@rao.example, lee@parkstudio.example", name: "Priya" });
    expect(r).toMatchObject({ sent: 2, failed: [] });
    expect(mails.map((m) => m.to).sort()).toEqual(["lee@parkstudio.example", "priya@rao.example"]);
    expect(mails.every((m) => m.text.startsWith("Hello,") || m.text.includes("\nHello,"))).toBe(true); // Q102: no name with several
    expect(tokenTo(mails, "priya@rao.example")).not.toBe(tokenTo(mails, "lee@parkstudio.example"));
    const one = await quote(w);
    await w.heston.action(api.quotes.send, { quoteId: one, to: "sam@patel.example", name: "Sam Patel" });
    expect(mails.at(-1)!.text).toContain("Hi Sam,");
    // Sending again within 10 minutes doesn't email them twice.
    await w.heston.action(api.quotes.send, { quoteId: one, to: "sam@patel.example" });
    expect(mails.filter((m) => m.to === "sam@patel.example")).toHaveLength(1);
  });

  test("each link opens only its own; nobody sees another person; one accept closes every other link (never who); two can't both accept", async () => {
    vi.useFakeTimers();
    const w = await world();
    fakeStripe();
    const mails: Sent[] = [];
    stub(mails);
    const id = await quote(w);
    const r = await w.heston.action(api.quotes.send, { quoteId: id, to: "priya@rao.example, lee@parkstudio.example", copyLink: true });
    const priya = tokenTo(mails, "priya@rao.example"), lee = tokenTo(mails, "lee@parkstudio.example"), link = (r.link as string).split("/q/")[1];
    const pp = await w.t.query(api.quotes.page, { token: priya });
    expect(pp).toMatchObject({ status: "sent", for: { name: "priya@rao.example", company: null, anyone: false }, via: "email", answer: null }); // their own address only
    expect(JSON.stringify(pp)).not.toMatch(/lee@|parkstudio/);
    expect((await w.t.query(api.quotes.page, { token: link })).for).toEqual({ name: null, company: null, anyone: true });
    await w.t.mutation(api.quotes.markViewed, { token: priya });
    await w.t.mutation(api.quotes.markViewed, { token: link });
    await w.t.mutation(api.quotes.markViewed, { token: link });
    // Lee accepts for his company.
    expect((await qpost(w, { token: lee, action: "accept", name: "Lee Park", company: "Park Studio LLC" })).status).toBe(200);
    expect(await (await qpost(w, { token: priya, action: "accept", name: "Priya Rao" })).json()).toEqual({ error: "This quote was already accepted." });
    expect(await (await qpost(w, { token: link, action: "accept", name: "Someone", email: "a@b.example" })).json()).toEqual({ error: "This quote was already accepted." });
    const after = await w.t.query(api.quotes.page, { token: priya });
    expect(after.answer).toEqual({ kind: "already_accepted", at: expect.any(Number), name: null });
    expect(JSON.stringify(after)).not.toMatch(/Lee|Park Studio/); // Q103
    expect((await w.t.query(api.quotes.page, { token: lee })).answer).toMatchObject({ kind: "accepted_by_you", name: "Lee Park" });
    const q = await w.heston.query(api.quotes.get, { quoteId: id });
    expect(q).toMatchObject({ status: "accepted", contact: { name: "Lee Park", email: "lee@parkstudio.example", company: "Park Studio LLC" }, response: { kind: "accepted", name: "Lee Park", company: "Park Studio LLC", via: "email" } });
    expect(q.who.people.find((p: { email: string }) => p.email === "priya@rao.example")).toMatchObject({ openedAt: expect.any(Number), response: null });
    expect(q.who.people.find((p: { email: string }) => p.email === "lee@parkstudio.example").response).toMatchObject({ kind: "accepted", company: "Park Studio LLC" });
    expect(q.who.link).toMatchObject({ copied: true, opens: 2 });
    // Q100: not a client, so a quiet lead: not on the board until "Move to Quoted?" says yes.
    expect(q.deal).toMatchObject({ stage: "lead", quiet: true });
    expect((await w.heston.query(api.crm.board, {})).deals).toEqual([]);
    await w.heston.mutation(api.quotes.answerMove, { quoteId: id, yes: true });
    expect((await w.heston.query(api.crm.board, {})).deals).toEqual([expect.objectContaining({ stage: "quoted" })]);
    // The invoice and the contract are drafted for whoever accepted.
    const made = await w.heston.action(api.quotes.draftFrom, { quoteId: id, contract: false, invoice: "deposit" });
    expect((await w.t.run((ctx) => ctx.db.get(made.invoiceId)))!.billTo).toEqual({ name: "Lee Park", email: "lee@parkstudio.example", company: "Park Studio LLC" });
    await settle(w);
    expect(mails.filter((m) => m.to === "heston@wranglerproductions.com" && /accepted/i.test(m.subject))).toHaveLength(1);
  });

  test("a copied link's Accept asks name, email and company; one of several declining leaves it open", async () => {
    vi.useFakeTimers();
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const id = await quote(w);
    const r = await w.heston.action(api.quotes.send, { quoteId: id, to: "a@one.example, b@two.example", copyLink: true });
    const a = tokenTo(mails, "a@one.example"), b = tokenTo(mails, "b@two.example"), link = (r.link as string).split("/q/")[1];
    await qpost(w, { token: a, action: "decline", name: "A", reason: "Not now" });
    expect((await w.heston.query(api.quotes.get, { quoteId: id })).status).toBe("sent");
    expect((await w.t.query(api.quotes.page, { token: a })).answer).toMatchObject({ kind: "declined_by_you" });
    expect(await (await qpost(w, { token: a, action: "accept", name: "A Person" })).json()).toEqual({ error: "You already declined this quote." });
    await qpost(w, { token: link, action: "decline", name: "" }); // a copied link never closes it
    expect((await w.heston.query(api.quotes.get, { quoteId: id })).status).toBe("sent");
    expect(await (await qpost(w, { token: link, action: "accept", name: "Jo Doe" })).json()).toEqual({ error: "Type your email, so they can send the next steps." });
    expect((await qpost(w, { token: link, action: "accept", name: "Jo Doe", email: "JO@doe.example", company: "Doe Films" })).status).toBe(200);
    expect(await w.heston.query(api.quotes.get, { quoteId: id })).toMatchObject({ status: "accepted", contact: { name: "Jo Doe", email: "jo@doe.example", company: "Doe Films" }, response: { via: "link" } });
    expect((await w.t.query(api.quotes.page, { token: b })).answer).toMatchObject({ kind: "already_accepted", name: null });
    // Everyone emailed declining closes it.
    const id2 = await quote(w);
    await w.heston.action(api.quotes.send, { quoteId: id2, to: "c@three.example, d@four.example" });
    await qpost(w, { token: tokenTo(mails, "c@three.example"), action: "decline", name: "C" });
    expect((await w.heston.query(api.quotes.get, { quoteId: id2 })).status).toBe("sent");
    await qpost(w, { token: tokenTo(mails, "d@four.example"), action: "decline", name: "D" });
    expect((await w.heston.query(api.quotes.get, { quoteId: id2 })).status).toBe("declined");
    await settle(w);
    expect(mails.filter((m) => m.to === "heston@wranglerproductions.com" && /declined/i.test(m.subject)).length).toBe(4); // a, link, c, d
  });

  test("stop one person's link; a new copied link retires the old one", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const id = await quote(w);
    const r = await w.heston.action(api.quotes.send, { quoteId: id, to: "a@one.example, typo@wrong.example", copyLink: true });
    const typo = tokenTo(mails, "typo@wrong.example"), old = (r.link as string).split("/q/")[1];
    const q = await w.heston.query(api.quotes.get, { quoteId: id });
    const person = q.who.people.find((p: { email: string }) => p.email === "typo@wrong.example");
    await w.heston.mutation(api.quotes.stopLink, { quoteId: id, personId: person._id });
    expect(await w.t.query(api.quotes.page, { token: typo })).toBeNull();
    expect(await (await qpost(w, { token: typo, action: "accept", name: "Who" })).json()).toEqual({ error: "This quote isn't here." });
    expect((await w.heston.query(api.quotes.get, { quoteId: id })).who.people.find((p: { email: string }) => p.email === "typo@wrong.example").stopped).toBe(true);
    const fresh = (await w.heston.mutation(api.quotes.newLink, { quoteId: id }) as string).split("/q/")[1];
    expect(fresh).not.toBe(old);
    expect(await w.t.query(api.quotes.page, { token: old })).toBeNull();
    expect(await w.t.query(api.quotes.page, { token: fresh })).toMatchObject({ for: { anyone: true } });
    expect(await w.t.query(api.quotes.page, { token: tokenTo(mails, "a@one.example") })).not.toBeNull();
  });

  test("a proposal to anyone: no client needed; the contract is for whoever accepted", async () => {
    vi.useFakeTimers();
    const w = await world();
    fakeStripe();
    const mails: Sent[] = [];
    stub(mails);
    await w.heston.mutation(api.builder.ensureStarter, {});
    const id = await w.heston.mutation(api.proposals.create, {}) as Id<"proposals">;
    const p = await w.heston.query(api.proposals.get, { proposalId: id });
    const b = await w.heston.query(api.builder.getBuild, { buildId: p.buildId });
    const page = pageOf(b.blocks) as Page;
    const priced = { ...page, content: page.content.map((n) => (n.type === "items" ? { ...n, attrs: { ...n.attrs, rows: [{ id: newId(), description: "Shooting", qty: 1, rate: 5000 }] } } : n)) };
    await w.heston.mutation(api.builder.saveBuild, { buildId: p.buildId, title: "Brand film", blocks: priced, fields: { ...b.fields, project: "Brand film", client: { ...b.fields.client, company: "you" } }, signers: [], style: b.style });
    const pdfId = await w.t.run((ctx) => ctx.storage.store(new Blob(["%PDF-1.4 p"], { type: "application/pdf" })));
    await expect(w.heston.action(api.proposals.send, { proposalId: id, storageId: pdfId })).rejects.toThrow(/client's name|isn't an email/);
    const pdf2 = await w.t.run((ctx) => ctx.storage.store(new Blob(["%PDF-1.4 p"], { type: "application/pdf" })));
    await w.heston.action(api.proposals.send, { proposalId: id, storageId: pdf2, to: "sam@patel.example, kim@lee.example" });
    const sam = tokenTo(mails, "sam@patel.example", "p"), kim = tokenTo(mails, "kim@lee.example", "p");
    expect(mails.find((m) => m.to === "sam@patel.example")!.text).toContain("Hello,");
    expect((await ppost(w, { token: sam, action: "accept", name: "Sam Patel" })).status).toBe(200);
    expect((await w.t.query(api.proposals.page, { token: kim })).answer).toEqual({ kind: "already_accepted", at: expect.any(Number), name: null });
    const g = await w.heston.query(api.proposals.get, { proposalId: id });
    expect(g).toMatchObject({ status: "accepted", response: { name: "Sam Patel", email: "sam@patel.example" }, deal: { quiet: true } });
    const contract = await w.heston.action(api.proposals.startContract, { proposalId: id });
    const cb = await w.heston.query(api.builder.getBuild, { buildId: contract });
    expect(cb.fields.client).toMatchObject({ name: "Sam Patel", email: "sam@patel.example" });
  });

  test("isolation: another business's owner, a client and a stranger get none of it", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const id = await quote(w);
    await w.heston.action(api.quotes.send, { quoteId: id, to: "a@one.example", copyLink: true });
    const q = await w.heston.query(api.quotes.get, { quoteId: id });
    const person = q.who.people[0];
    for (const who of [w.boss, w.maya]) {
      await expect(who.query(api.quotes.get, { quoteId: id })).rejects.toThrow();
      await expect(who.action(api.quotes.send, { quoteId: id, to: "x@y.example" })).rejects.toThrow();
      await expect(who.mutation(api.quotes.stopLink, { quoteId: id, personId: person._id })).rejects.toThrow();
      await expect(who.mutation(api.quotes.newLink, { quoteId: id })).rejects.toThrow();
    }
    await expect(w.t.mutation(api.quotes.newLink, { quoteId: id })).rejects.toThrow();
    expect((await w.heston.query(api.quotes.get, { quoteId: id })).who.people[0].stopped).toBe(false);
    // B's own quote can't stop A's person.
    const bq = await w.boss.mutation(api.quotes.save, { title: "B", lines: [{ id: "a", description: "X", qty: 1, unitCents: 100 }], deposit: { kind: "percent", value: 0 } });
    await expect(w.boss.mutation(api.quotes.stopLink, { quoteId: bq, personId: person._id })).rejects.toThrow();
    expect((await w.heston.query(api.quotes.get, { quoteId: id })).who.people[0].stopped).toBe(false);
  });

  // ---- independent review fixes (Nov 4) ----
  test("H1: a quiet lead from another business's quote lands in that business, never the default one", async () => {
    vi.useFakeTimers();
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const bq = await w.boss.mutation(api.quotes.save, { title: "B's job", lines: [{ id: "a", description: "X", qty: 1, unitCents: 50_000 }], deposit: { kind: "percent", value: 0 } }) as Id<"quotes">;
    const r = await w.boss.action(api.quotes.send, { quoteId: bq, copyLink: true });
    const link = (r.link as string).split("/q/")[1];
    expect((await qpost(w, { token: link, action: "accept", name: "Ana Diaz", email: "ana@diaz.example" })).status).toBe(200);
    const g = await w.boss.query(api.quotes.get, { quoteId: bq });
    expect(g).toMatchObject({ status: "accepted", deal: { quiet: true } });
    const both = await w.t.run(async (ctx) => { const q = await ctx.db.get(bq); const d = await ctx.db.get(q!.dealId!); return { q: q!.businessId, d: d!.businessId }; });
    expect(both.d).toBeDefined();
    expect(both.d).toBe(both.q);
    expect(await w.heston.query(api.crm.deal, { dealId: g.dealId })).toBeNull();
    expect(await w.boss.query(api.crm.deal, { dealId: g.dealId })).not.toBeNull();
    expect(JSON.stringify(await w.heston.query(api.crm.board, {}))).not.toMatch(/ana@diaz/);
  });

  test("M1/M2: one sent before D149 moves its contact onto a person row the first time more people are added", async () => {
    vi.useFakeTimers();
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const id = await quote(w, { name: "Priya Rao", email: "priya@rao.example", company: "Rao Foods" });
    await w.heston.action(api.quotes.send, { quoteId: id });
    const tok = tokenTo(mails, "priya@rao.example");
    // Make it look like it was sent before D149: no person rows, the link on the quote itself.
    await w.t.run(async (ctx) => {
      for (const r of await ctx.db.query("offerRecipients").collect()) await ctx.db.delete(r._id);
      await ctx.db.patch(id, { token: tok });
    });
    await w.t.mutation(api.quotes.markViewed, { token: tok });
    expect((await w.heston.query(api.quotes.get, { quoteId: id })).who.people).toEqual([expect.objectContaining({ _id: `legacy:${id}`, email: "priya@rao.example" })]);
    await w.heston.action(api.quotes.send, { quoteId: id, to: "lee@parkstudio.example" });
    const q = await w.heston.query(api.quotes.get, { quoteId: id });
    expect(q.who.people.map((p: { email: string }) => p.email).sort()).toEqual(["lee@parkstudio.example", "priya@rao.example"]);
    expect(q.who.people.find((p: { email: string }) => p.email === "priya@rao.example")).toMatchObject({ name: "Priya Rao", openedAt: expect.any(Number), stopped: false });
    expect(q.who.people.some((p: { _id: string }) => p._id.startsWith("legacy:"))).toBe(false);
    expect((await w.t.run((ctx) => ctx.db.get(id)))!.token).toBeUndefined();
    // Her old link still works, as her own, and her accept closes Lee's.
    expect(await w.t.query(api.quotes.page, { token: tok })).toMatchObject({ via: "email", for: { name: "Priya Rao", company: "Rao Foods" } });
    expect((await qpost(w, { token: tok, action: "accept", name: "Priya Rao" })).status).toBe(200);
    expect((await w.t.query(api.quotes.page, { token: tokenTo(mails, "lee@parkstudio.example") })).answer).toMatchObject({ kind: "already_accepted", name: null });
    expect(await (await qpost(w, { token: tokenTo(mails, "lee@parkstudio.example"), action: "accept", name: "Lee Park" })).json()).toEqual({ error: "This quote was already accepted." });
  });

  test("M3: declines on the copied link write history once and email the owner at most once an hour; 20 tries an hour", async () => {
    vi.useFakeTimers();
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const id = await quote(w);
    const r = await w.heston.action(api.quotes.send, { quoteId: id, copyLink: true });
    const link = (r.link as string).split("/q/")[1];
    for (let i = 0; i < 5; i++) await qpost(w, { token: link, action: "decline", name: `Spam ${i}` });
    const q = await w.heston.query(api.quotes.get, { quoteId: id });
    expect(q.history.filter((h: { kind: string }) => h.kind === "declined")).toHaveLength(1);
    expect(q.history.find((h: { kind: string }) => h.kind === "declined").detail).toBe("Spam 0 (copied link)");
    await settle(w);
    expect(mails.filter((m) => m.to === "heston@wranglerproductions.com" && /declined/i.test(m.subject))).toHaveLength(1);
    for (let i = 5; i < 20; i++) await qpost(w, { token: link, action: "decline", name: "x" });
    const over = await (await qpost(w, { token: link, action: "accept", name: "Real Person", email: "real@person.example" })).json();
    expect(over.error).toMatch(/a lot in one hour/);
    expect((await w.heston.query(api.quotes.get, { quoteId: id })).status).toBe("sent");
  });

  test("M5: a typed name or company loses braces, angle brackets and control characters", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const id = await quote(w);
    const r = await w.heston.action(api.quotes.send, { quoteId: id, copyLink: true });
    const link = (r.link as string).split("/q/")[1];
    expect((await qpost(w, { token: link, action: "accept", name: "Jo {{sign:heston}} <b>Doe</b>\u0007", email: "jo@doe.example", company: "{{client.company}} Films" })).status).toBe(200);
    const q = await w.heston.query(api.quotes.get, { quoteId: id });
    expect(q.contact.name).not.toMatch(/[{}<>\u0000-\u001f]/);
    expect(q.contact.name).toContain("Jo");
    expect(q.contact.company).toBe("client.company Films");
  });

  test("L1 and L3: a stopped person sent again gets a new link; no stopping once accepted or closed", async () => {
    vi.useFakeTimers();
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const id = await quote(w);
    await w.heston.action(api.quotes.send, { quoteId: id, to: "a@one.example, b@two.example", copyLink: true });
    const oldB = tokenTo(mails, "b@two.example");
    const people = (await w.heston.query(api.quotes.get, { quoteId: id })).who.people;
    const b = people.find((p: { email: string }) => p.email === "b@two.example"), a = people.find((p: { email: string }) => p.email === "a@one.example");
    await w.heston.mutation(api.quotes.stopLink, { quoteId: id, personId: b._id });
    vi.setSystemTime(Date.now() + 60_000);
    await w.heston.action(api.quotes.send, { quoteId: id, to: "b@two.example" });
    const newB = tokenTo(mails, "b@two.example");
    expect(newB).not.toBe(oldB);
    expect(await w.t.query(api.quotes.page, { token: oldB })).toBeNull();
    expect(await w.t.query(api.quotes.page, { token: newB })).not.toBeNull();
    expect((await qpost(w, { token: tokenTo(mails, "a@one.example"), action: "accept", name: "A Person" })).status).toBe(200);
    await expect(w.heston.mutation(api.quotes.stopLink, { quoteId: id, personId: a._id })).rejects.toThrow(/accepted on that link/);
    await expect(w.heston.mutation(api.quotes.stopLink, { quoteId: id, personId: b._id })).rejects.toThrow(/while it's open/);
    await expect(w.heston.mutation(api.quotes.newLink, { quoteId: id })).rejects.toThrow(/while it's open/);
  });
});
