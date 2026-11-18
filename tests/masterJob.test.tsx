// Phase 6 · T6.1 the master job (Nov 17): one real job through every part of the portal, through the same public
// functions and HTTP routes the pages, the website and Stripe use. Harbor Coffee (Maya Brooks, an invited client)
// asks for a new film on the website; the owner estimates it, sends the contract, Maya signs, pays the deposit,
// answers the brief, confirms the shoot, uploads her files, reviews the cuts in two rounds, pays the final invoice,
// gets her files in Delivery, is offered footage storage and leaves a testimonial. At every step the client's Inbox
// and the CRM card follow along. Nothing leaves the test: email, Stripe and Dropbox are stand-ins.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import { internal } from "../convex/_generated/api";
import { renderToBuffer } from "@react-pdf/renderer";
import type { Id } from "../convex/_generated/dataModel";
import { DocPdf } from "../src/modules/docs/builder/pdf";
import { DEFAULT_STYLE, emptyFields, textOf, type BuildDoc, type PNode } from "../convex/lib/wsBuilder";
import { serviceAgreementPage } from "../convex/lib/wsStarter";
import { fakeStripe, refreshNow, world } from "./payHarness";

const api = anyApi;
const WF = "wf_master";
beforeAll(() => {
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_ONLY_TO = "";
  process.env.WEBFLOW_WEBHOOK_SECRET = WF;
  process.env.WS_DEBUG = "1";
  process.env.STRIPE_PLATFORM_KEY = "sk_test_platform"; // test mode (rule 8)
  process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_platform";
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

type W = Awaited<ReturnType<typeof world>>;
type Mail = { to: string; subject: string; text: string };
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PNG = Uint8Array.from(atob(PNG_B64), (c) => c.charCodeAt(0));
const CLIENT = "maya@harbor.example";
let OWNER = "";

async function webflowSign(body: string, t = Date.now()) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(WF), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${t}:${body}`)))].map((x) => x.toString(16).padStart(2, "0")).join("");
  return { "x-webflow-timestamp": String(t), "x-webflow-signature": sig };
}

/** Email, Stripe and Dropbox stand-ins. Emails are kept; Stripe answers as the payments tests' stand-in does (switched
 *  per step: sent, then paid); Dropbox keeps the files the client's browser "uploaded". */
function outside() {
  const rig = { mails: [] as Mail[], stripe: null as typeof fetch | null, dropbox: new Map<string, number>(), uploads: [] as string[] };
  const ok = (j: unknown) => new Response(JSON.stringify(j), { status: 200 });
  const handler = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === "https://api.resend.com/emails") { const b = JSON.parse(String(init?.body)); rig.mails.push({ to: b.to[0], subject: b.subject, text: b.text }); return ok({ id: "em" }); }
    if (url.startsWith("https://api.stripe.com/") && rig.stripe) return rig.stripe(input as string, init);
    if (url === "https://api.dropboxapi.com/oauth2/token") return ok({ access_token: "at", expires_in: 14400 });
    if (url === "https://api.dropboxapi.com/2/files/get_temporary_upload_link") { const b = JSON.parse(String(init?.body)); rig.uploads.push(b.commit_info.path); return ok({ link: `https://content.dropboxapi.com/apitul/1/link${rig.uploads.length}` }); }
    if (url === "https://api.dropboxapi.com/2/files/get_metadata") { const b = JSON.parse(String(init?.body)); const size = rig.dropbox.get(b.path); return size === undefined ? new Response(JSON.stringify({ error_summary: "path/not_found/" }), { status: 409 }) : ok({ ".tag": "file", path_display: b.path, name: b.path.split("/").pop(), size }); }
    if (url === "https://content.dropboxapi.com/2/files/upload") { const h = (init?.headers ?? {}) as Record<string, string>; const a = JSON.parse(h["Dropbox-API-Arg"]); rig.dropbox.set(a.path, 1); return ok({ path_display: a.path, name: a.path.split("/").pop() }); }
    return new Response("{}", { status: 500 });
  };
  vi.stubGlobal("fetch", handler);
  /** Stripe answers as `fakeStripe(opts)` does from here on. */
  const stripe = (opts: Parameters<typeof fakeStripe>[0] = {}) => { fakeStripe(opts); rig.stripe = globalThis.fetch; vi.stubGlobal("fetch", handler); };
  return { rig, stripe };
}

const settle = async (w: W) => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); await w.t.finishAllScheduledFunctions(vi.runAllTimers); vi.useRealTimers(); };
const inbox = async (w: W) => ((await w.maya.query(api.inbox.mine, {})) as { items: Array<{ kind: string; title: string }> }).items;
const stage = async (w: W, dealId: Id<"deals">) => (await w.heston.query(api.crm.deal, { dealId })).stage as string;

/** What the run found that isn't a failure but Heston should know (recorded in the Master Plan). */
const findings: string[] = [];
const KNOWN: string[] = [];

describe("T6.1 the master job", () => {
  test("website lead → estimate → contract → deposit → brief → shoot → files → review rounds → final paid → delivery → storage offer → testimonial", async () => {
    const w = await world();
    OWNER = (await w.t.run((ctx) => ctx.db.query("users").first()))!.email!;
    const { rig, stripe } = outside();
    const mails = rig.mails;

    // 1 · The website's quote form (signed by Webflow) makes a Lead card for Maya, who is already Harbor Coffee's.
    const body = JSON.stringify({ triggerType: "form_submission", payload: { name: "Quote", id: "sub_master", data: { Name: "Maya Brooks", Email: CLIENT, Company: "Harbor Coffee", Message: "A spring menu film, 2 shoot days", Budget: "$10k–15k" } } });
    expect((await w.t.fetch("/leads/webflow", { method: "POST", body, headers: await webflowSign(body) })).status).toBe(200);
    const deals = (await w.heston.query(api.crm.board, {})).deals;
    expect(deals).toEqual([expect.objectContaining({ stage: "lead", website: true })]);
    const dealId = deals[0]._id as Id<"deals">;

    // 2 · The estimate: the card moves to Quoted and is Harbor Coffee's; the job is the Launch project.
    const estimateId = await w.heston.mutation(api.crm.saveEstimate, { dealId, title: "Spring menu film", scope: "2 shoot days, one 60s film", input: { unit: "days", amount: 2 } }) as Id<"estimates">;
    expect(await w.heston.query(api.crm.deal, { dealId })).toMatchObject({ stage: "quoted", clientId: w.harbor });
    await w.heston.mutation(api.crm.linkProject, { dealId, projectId: w.p });

    // 3 · The contract: made from the estimate in the builder, the revisions clause picked, rendered, to signing.
    const png = () => w.t.run((ctx) => ctx.storage.store(new Blob([PNG], { type: "image/png" })));
    await w.heston.action(api.sign.adoptSignature, { name: "Owner Signer", title: "Founder", method: "typed", signatureStorageId: await png(), initialsStorageId: await png() });
    // (the business's Service Agreement template, as Docs › Templates has it)
    await w.heston.mutation(api.builder.saveAsTemplate, { name: "Service Agreement", title: "Service Agreement", blocks: serviceAgreementPage(), fields: emptyFields(), signers: [], style: DEFAULT_STYLE });
    const { buildId } = await w.heston.action(api.crm.makeContract, { estimateId });
    const b = await w.heston.query(api.builder.getBuild, { buildId });
    const pick = (n: PNode): PNode => n.type === "section" && /PICK ONE:/.test(textOf(n)) ? { ...n, content: (n.content ?? []).filter((c) => !/PICK ONE:|One round of revisions/.test(textOf(c))) } : n;
    const d: BuildDoc = { title: b.title, page: { type: "doc", content: (b.blocks.content as PNode[]).map(pick) }, fields: b.fields, signers: b.signers ?? [], style: b.style };
    expect(d.fields.client).toMatchObject({ name: "Maya Brooks", email: CLIENT });
    await w.heston.mutation(api.builder.saveBuild, { buildId, title: d.title, blocks: d.page, fields: d.fields, signers: d.signers, style: d.style });
    const pdf = new Uint8Array(await renderToBuffer(<DocPdf d={d} assets={{ fonts: [], files: {} }} label="WS-00001" />));
    const { documentId } = await w.heston.action(api.builder.toSigning, { buildId, storageId: await w.t.run((ctx) => ctx.storage.store(new Blob([pdf], { type: "application/pdf" }))) });
    const doc0 = await w.heston.query(api.sign.get, { documentId });
    expect(doc0.problems).toEqual([]);
    await w.heston.mutation(api.sign.approve, { versionId: doc0.version._id });
    await w.heston.mutation(api.sign.send, { versionId: doc0.version._id });
    await settle(w);
    expect(await stage(w, dealId)).toBe("contract_sent");
    expect((await inbox(w)).map((i) => i.kind)).toContain("to_sign");

    // 4 · Maya signs on the signing page (the same requests it makes): code, consent, adopt, every initial, sign.
    const call = async (op: string, payload: Record<string, unknown>) => {
      const r = await w.t.fetch(`/ws/${op}`, { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7", "user-agent": "Mozilla/5.0 (iPhone)", origin: "https://sign.wranglerportal.com" }, body: JSON.stringify(payload) });
      return (await r.json()) as Record<string, any>;
    };
    const token = (await w.t.run((ctx) => ctx.db.query("wsSignings").collect())).find((s) => s.signerKey === "client")!.token;
    await call("open", { token });
    expect(await call("code", { token })).toMatchObject({ sent: true });
    const code = [...mails].reverse().find((m) => m.to === CLIENT && /code/.test(m.subject))!.subject.match(/^(\d{6})/)![1];
    const session = (await call("verify", { token, code })).session as string;
    await call("consent", { token, session, agreed: true });
    await call("adopt", { token, session, name: "Maya Brooks", method: "typed", signature: PNG_B64, initials: PNG_B64 });
    const v = (await w.heston.query(api.sign.get, { documentId })).version;
    for (const box of v.boxes.filter((x: { signer: string; kind: string }) => x.signer === "client" && x.kind === "initials")) await call("initial", { token, session, boxId: box.id });
    expect(await call("sign", { token, session, agreed: true })).toMatchObject({ ok: true, complete: true });
    await settle(w);
    expect((await w.heston.query(api.sign.get, { documentId })).doc.status).toBe("completed");
    expect(await stage(w, dealId)).toBe("signed");
    expect((await inbox(w)).map((i) => i.kind)).toContain("signed");

    // 5 · The deposit: signing made a draft invoice in Payments, on the project (nothing sent). The owner sends it, and
    //     Maya pays it on her invoice page (Stripe's answer read back).
    const draft = (await w.t.run((ctx) => ctx.db.query("invoices").collect())).filter((i) => i.businessId === w.A);
    expect(draft).toEqual([expect.objectContaining({ status: "draft", kind: "deposit", clientId: w.harbor, billTo: expect.objectContaining({ email: CLIENT }) })]);
    const depositId = draft[0]._id;
    // F1 (fixed in this run): it lands on the card's project, not in Not attached
    expect(draft[0].projectId).toBe(w.p);
    stripe();
    await w.heston.action(api.invoices.send, { invoiceId: depositId });
    await settle(w);
    const dep = (await w.t.run((ctx) => ctx.db.get(depositId)))!;
    expect(dep).toMatchObject({ status: "open", projectId: w.p }); // sent: open at Stripe
    expect((await inbox(w)).find((i) => i.kind === "invoice")).toBeTruthy();
    const paidAt = { status: "paid", amount_requested: dep.totalCents, amount_paid: dep.totalCents, created: 1_790_000_200, status_transitions: { paid_at: 1_790_100_000 },
      payment: { type: "payment_intent", payment_intent: { id: "pi_dep", status: "succeeded", amount: dep.totalCents, created: 1_790_000_200, payment_method: { type: "card", card: { brand: "visa", last4: "4242" } } } } };
    stripe({ payments: [paidAt], invoiceStatus: "paid", totalOverride: dep.totalCents });
    await refreshNow(w, dep.payToken!);
    await settle(w);
    expect((await w.t.query(api.invoicePay.page, { token: dep.payToken! }))).toMatchObject({ status: "paid", amountRemainingCents: 0 });
    expect(await stage(w, dealId)).toBe("signed"); // a deposit doesn't move the card

    // 6 · The project is shared with Maya; the kickoff brief goes out and she answers it.
    await w.heston.mutation(api.shares.create, { target: { kind: "project", projectId: w.p }, allVersions: true, downloads: false, emailNewVersions: true, access: "comment", who: "invited", emails: [CLIENT] });
    const { briefId } = await w.heston.mutation(api.briefs.send, { projectId: w.p }) as { briefId: Id<"briefs"> };
    await settle(w);
    expect((await inbox(w)).find((i) => i.kind === "brief")).toBeTruthy();
    await w.maya.mutation(api.briefs.submit, { briefId, changes: { goal: "Launch the spring menu.", audience: "Regulars", where: ["Instagram"], must: "The new menu boards.", feel: ["Warm"], ready: "2031-04-01" } });
    await settle(w);
    expect((await w.heston.query(api.briefs.forProject, { projectId: w.p })).brief).toMatchObject({ status: "submitted", by: "Maya Brooks" });

    // 7 · The shoot: scheduled, Maya told, and she confirms.
    await w.heston.mutation(api.projects.setStage, { projectId: w.p, stage: "production", post: false });
    expect(await stage(w, dealId)).toBe("in_production");
    const { shootId } = await w.heston.mutation(api.shoots.schedule, { projectId: w.p, date: "2031-03-10", call: "07:00", wrap: "17:00", location: "Harbor Coffee, 412 Main St.", parking: "Behind the shop", prepare: ["Shop open by 7:00"], withOwner: true, bookingIds: [], calendar: false }) as { shootId: Id<"shoots"> };
    await settle(w);
    expect((await inbox(w)).find((i) => i.kind === "shoot")).toBeTruthy();
    expect(await w.maya.mutation(api.shoots.confirm, { shootId })).toEqual({ already: false });
    expect((await w.heston.query(api.shoots.forProject, { projectId: w.p })).shoots[0].confirmed).toMatchObject({ name: "Maya Brooks" });

    // 8 · Files: the owner asks for the logo; Maya's browser uploads it straight to Dropbox; the portal checks it landed.
    await w.t.run(async (ctx) => { await ctx.db.insert("dropbox", { businessId: w.A, accountId: "dbid", refreshToken: "rt", accessToken: "at", accessExpiresAt: Date.now() + 3_600_000, connectedAt: 0 }); });
    const { requestId } = await w.heston.mutation(api.fileRequests.create, { projectId: w.p, title: "Upload your logo", details: "SVG or PNG.", due: "2031-03-01", remind: true }) as { requestId: Id<"fileRequests"> };
    await settle(w);
    expect((await inbox(w)).find((i) => i.kind === "files")).toBeTruthy();
    const up = await w.maya.action(api.fileRequests.start, { requestId, name: "harbor-logo.svg", size: 52_000 });
    rig.dropbox.set(rig.uploads.at(-1)!, 52_000); // the browser's upload arrived
    expect(await w.maya.action(api.fileRequests.finishDirect, { uploadId: up.uploadId })).toEqual({ name: "harbor-logo.svg" });
    expect((await w.heston.query(api.fileRequests.forProject, { projectId: w.p })).requests[0]).toMatchObject({ files: [expect.objectContaining({ name: "harbor-logo.svg" })] });

    // 9 · The cuts, reviewed in two rounds. A render arriving (Bunny's processing, then the pipeline's ready hook) puts
    //     "new cut ready" in Maya's Inbox; she leaves notes; the owner marks them done; v2 comes; she approves.
    await w.heston.mutation(api.projects.setStage, { projectId: w.p, stage: "polish", post: true }); // posted to her Inbox
    expect((await inbox(w)).find((i) => i.kind === "stage")).toBeTruthy();
    const videoId = await w.heston.mutation(api.library.createVideo, { projectId: w.p, title: "Spring menu 60s" }) as Id<"videos">;
    const render = async (n: number) => {
      const versionId = await w.t.run((ctx) => ctx.db.insert("versions", { videoId, number: n, status: "ready", bunnyGuid: `guid-${n}`, fileName: `spring_v${n}.mp4`, startTimecode: "01:00:00:00", createdAt: Date.now(), frameCount: 1440, mp4Heights: [360, 1080] } as never)) as Id<"versions">;
      await w.t.mutation(internal.inbox.onVersionReady, { versionId });
      return versionId;
    };
    const v1 = await render(1);
    await settle(w);
    expect((await inbox(w)).filter((i) => i.kind === "cut_ready")).toHaveLength(1);
    const share = { token: (await w.t.run((ctx) => ctx.db.query("shares").collect())).find((s) => s.projectId === w.p && s.who === "invited")!.token }; // the page opens the cut through her project share
    const n1 = await w.maya.mutation(api.notes.create, { versionId: v1, kind: "frame", inFrame: 120, text: "Logo a touch bigger", share }) as Id<"notes">;
    const n2 = await w.maya.mutation(api.notes.create, { versionId: v1, kind: "range", inFrame: 600, outFrame: 720, text: "Hold on the latte art longer", share }) as Id<"notes">;
    expect((await w.heston.query(api.notes.forVersion, { versionId: v1 })).filter((n: { status: string }) => n.status === "open")).toHaveLength(2);
    for (const n of [n1, n2]) await w.heston.mutation(api.notes.setStatus, { noteId: n, status: "done" });
    const v2 = await render(2);
    await settle(w);
    expect((await inbox(w)).filter((i) => i.kind === "cut_ready")).toHaveLength(2);
    await w.maya.mutation(api.notes.create, { versionId: v2, kind: "general", inFrame: 0, text: "Love it. Approved.", share });
    await w.heston.mutation(api.library.approveFinal, { videoId, keep: 2 });

    // 10 · The final file goes on the project's Delivery tab (locked); the final invoice is sent and paid; paying it
    //      opens the files for Maya and moves the card to Paid.
    await w.heston.mutation(api.projects.addDeliveryFile, { projectId: w.p, file: { kind: "version", versionId: v2 } });
    // (the Stripe stand-in names every invoice in_1; the paid deposit keeps its own id so the two stay apart)
    await w.t.run(async (ctx) => { const d = (await ctx.db.get(depositId))!; await ctx.db.patch(depositId, { stripe: { ...d.stripe!, invoiceId: "in_dep" } }); });
    stripe();
    const finalId = await w.heston.mutation(api.invoices.saveDraft, { clientId: w.harbor, projectId: w.p, kind: "final", title: "Final invoice", billTo: { name: "Maya Brooks", email: CLIENT, company: "Harbor Coffee" },
      lines: [{ id: "a", description: "Final payment", qty: 1, unitCents: 450_000 }], dueDate: "2031-05-01" }) as Id<"invoices">;
    await w.heston.action(api.invoices.send, { invoiceId: finalId });
    await settle(w);
    const fin = (await w.t.run((ctx) => ctx.db.get(finalId)))!;
    expect(await w.maya.query(api.footage.forClientProject, { projectId: w.p })).toBeNull(); // nothing offered before delivery
    stripe({ payments: [{ ...paidAt, amount_requested: fin.totalCents, amount_paid: fin.totalCents, payment: { ...paidAt.payment, payment_intent: { ...paidAt.payment.payment_intent, id: "pi_fin", amount: fin.totalCents } } }], invoiceStatus: "paid", totalOverride: fin.totalCents });
    await refreshNow(w, fin.payToken!);
    await settle(w);
    expect((await w.t.query(api.invoicePay.page, { token: fin.payToken! }))).toMatchObject({ status: "paid" });
    expect((await inbox(w)).find((i) => i.kind === "final_files")).toBeTruthy();
    expect(await stage(w, dealId)).toBe("paid");

    // 11 · The raw-footage storage offer comes with the delivery.
    expect(await w.maya.query(api.footage.forClientProject, { projectId: w.p })).toMatchObject({ status: "offered" });
    expect((await inbox(w)).find((i) => i.title === "Keep your raw footage?")).toBeTruthy();

    // 12 · Delivery (long-term): the owner publishes the project's delivery from its Dropbox folder; Maya sees it.
    await w.t.run(async (ctx) => { await ctx.db.patch(w.p, { dropboxFolder: "/Projects/26127 Launch" }); });
    const deliveryId = await w.heston.mutation(api.delivery.ensure, { projectId: w.p });
    const g = await w.heston.query(api.delivery.get, { projectId: w.p });
    await w.heston.mutation(api.delivery.addFiles, { itemId: g.delivery.items[0]._id, files: [{ kind: "dropbox", path: "/Projects/26127 Launch/Spring_menu_60s_FINAL.mp4", name: "Spring_menu_60s_FINAL.mp4", size: 900 }] });
    expect(await w.maya.query(api.delivery.forClient, {})).toEqual([]); // a draft
    await w.heston.mutation(api.delivery.publish, { deliveryId, tell: true });
    expect((await w.maya.query(api.delivery.forClient, {}))[0].items[0].assets).toHaveLength(1);
    expect((await inbox(w)).find((i) => i.title === "Your files are ready in Delivery")).toBeTruthy();

    // 13 · The testimonial: asked from the client's page, answered on the form, saved for the owner.
    const noteId = await w.heston.mutation(api.inbox.saveNote, { clientId: w.harbor, title: "A few words about 26127 Launch?", text: "Two quick questions.", testimonialProjectId: w.p }) as Id<"inboxNotes">;
    await w.heston.mutation(api.inbox.sendNote, { noteId });
    await w.maya.mutation(api.testimonials.send, { noteId, working: "Easy from start to finish.", film: "Our best spring yet.", permission: true });
    await settle(w);
    expect(await w.heston.query(api.testimonials.list, {})).toEqual([expect.objectContaining({ name: "Maya Brooks", project: "26127 Launch", permission: true })]);

    // The whole way through: Maya's Inbox told her each step; the card ended at Paid; another business saw none of it.
    const kinds = new Set((await inbox(w)).map((i) => i.kind));
    for (const k of ["to_sign", "signed", "invoice", "brief", "shoot", "files", "stage", "cut_ready", "final_files", "note"]) expect(kinds.has(k), k).toBe(true);
    expect((await w.boss.query(api.crm.board, {})).deals).toEqual([]);
    expect(await w.boss.query(api.testimonials.list, {})).toEqual([]);
    expect(rig.mails.filter((m) => !/@harbor\.example$/.test(m.to) && m.to !== OWNER).map((m) => m.to)).toEqual([]); // email only to the client and the owner
    expect(findings.filter(Boolean)).toEqual(KNOWN);
  }, 120_000);
});
