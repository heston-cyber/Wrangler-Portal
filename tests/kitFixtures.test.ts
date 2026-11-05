// Dev only (Phase 1 front end, Oct 29): builds the sample data the component page (/__kit) shows the real pages
// with. A made-up world (Harbor Coffee, Maya Brooks, the Figma file's sample data) goes into the real backend in
// convex-test, every query the pages ask is answered by the real functions, and the answers are written to
// src/dev/fixtures.json. Runs only with KIT_FIXTURES=1, so CI never writes anything:
//   KIT_FIXTURES=1 npx vitest run tests/kitFixtures.test.ts
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import { beforeAll, describe, test, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";
import { internal } from "../convex/_generated/api";
import { nodesOf, pageOf, type Page } from "../convex/lib/wsBuilder";
import { weatherAddress } from "../convex/lib/callSheet";

const api = anyApi;
const modules = import.meta.glob("../convex/**/*.ts");
const HOUR = 3_600_000, DAY = 24 * HOUR;

beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.RESEND_API_KEY = "re_test";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.CONVEX_SITE_URL = "https://x.convex.site";
  process.env.STRIPE_PLATFORM_KEY = "sk_test_kit";
  process.env.BUNNY_STREAM_LIBRARY_ID = "785477";
  process.env.BUNNY_STREAM_API_KEY = "bunny-test";
  process.env.BUNNY_STILLS_CDN = "stills.example";
  process.env.BUNNY_SCRUB_CDN = "scrub.example";
});

describe.skipIf(!process.env.KIT_FIXTURES)("kit fixtures", () => {
  test("write src/dev/fixtures.json", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 }));
    const t = convexTest(schema, modules);
    const now = Date.UTC(2026, 9, 29, 16, 0);
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
    const w = await t.run(async (ctx) => {
      const sess = async (userId: Id<"users">) => `${userId}|${await ctx.db.insert("authSessions", { userId, expirationTime: now + 30 * DAY })}`;
      const A = await ctx.db.insert("businesses", { slug: "wrangler", name: "Wrangler Productions", legalName: "Hill Creative LLC", ownerName: "Heston Hill", createdAt: 0 });
      const heston = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston Hill", role: "owner" });
      await ctx.db.insert("memberships", { businessId: A, email: "heston@wranglerproductions.com", userId: heston, role: "owner", createdAt: 0 });
      const mk = async (name: string) => ctx.db.insert("clients", { businessId: A, name, createdAt: now - 40 * DAY });
      const harbor = await mk("Harbor Coffee"), northline = await mk("Northline"), lc = await mk("4M LC"), floor = await mk("Floor Trader");
      const person = async (clientId: Id<"clients">, email: string, name: string, role: "signer" | "contact", account: boolean, invited: boolean) => {
        let userId: Id<"users"> | undefined;
        if (account) {
          userId = await ctx.db.insert("users", { email, name, role: "client" });
          await ctx.db.insert("memberships", { businessId: A, email, userId, role: "client", createdAt: now - 20 * DAY });
        }
        if (invited) await ctx.db.insert("invites", { businessId: A, email, name, createdAt: now - 20 * DAY, ...(account ? { acceptedAt: now - 19 * DAY, userId } : {}) });
        await ctx.db.insert("clientPeople", { businessId: A, clientId, email, name, role, createdAt: now - 20 * DAY } as never);
        return userId;
      };
      const maya = (await person(harbor, "maya@harborcoffee.com", "Maya Brooks", "signer", true, true))!;
      await person(harbor, "jordan@harborcoffee.com", "Jordan Lee", "contact", false, true);
      await person(harbor, "sam@harborcoffee.com", "Sam Ortiz", "contact", false, false);
      await person(northline, "dan@northline.church", "Dan Price", "signer", true, true);
      await person(lc, "ops@4mlc.com", "Ana Ruiz", "signer", false, true);

      const proj = async (name: string, jobNumber: string, client: string, clientId: Id<"clients">, age: number) =>
        ctx.db.insert("projects", { businessId: A, name, jobNumber, client, clientId, createdAt: now - age });
      const p1 = await proj("Harbor Coffee Launch", "26127", "Harbor Coffee", harbor, 12 * DAY);
      const p2 = await proj("Spirit Days", "26122", "Northline", northline, 30 * DAY);
      const p3 = await proj("Arizona", "26210", "4M LC", lc, 9 * DAY);
      const p4 = await proj("Backrooms", "26133", "Floor Trader", floor, 3 * DAY);
      let n = 0;
      const vid = async (projectId: Id<"projects">, title: string, short: string, versions: number, age: number, still: string) => {
        const number = 1 + n++;
        const v = await ctx.db.insert("videos", { businessId: A, projectId, title, number, shortTitle: short, createdAt: now - age, updatedAt: now - age / 4 });
        let last: Id<"versions"> | null = null;
        for (let i = 1; i <= versions; i++) {
          last = await ctx.db.insert("versions", {
            businessId: A, videoId: v, number: i, status: "ready", bunnyGuid: `kit-${still}`, fileName: `${String(number).padStart(5, "0")}_${short}_v${i}.mp4`,
            startTimecode: "01:00:00:00", createdAt: now - age + i * HOUR * 20, frameCount: 720, fpsNum: 24000, fpsDen: 1001, lengthSeconds: 30, width: 1920, height: 1080, mp4Heights: [720, 1080],
          } as never);
        }
        await ctx.db.insert("opens", { businessId: A, userId: heston, videoId: v, openedAt: now - age / 6 });
        return { v, last: last! };
      };
      const harbor30 = await vid(p1, "Harbor Coffee 30s", "Harbor30", 4, 6 * DAY, "premiere");
      await vid(p1, "Harbor Coffee 15s cutdown", "Harbor15", 2, 4 * DAY, "bts");
      const spirit = await vid(p2, "Spirit Days Intro", "SpiritDays", 3, 20 * DAY, "aerial");
      const az = await vid(p3, "LC Arizona", "LCArizona", 4, 8 * DAY, "landscape");
      await vid(p4, "Northline Teaser", "Northline", 1, 2 * DAY, "stadium");
      for (const [text, who] of [["Pull the logo up two frames.", "Maya Brooks"], ["Can the music come in on the cut?", "Maya Brooks"], ["Love this shot.", "Jordan Lee"]] as const)
        await ctx.db.insert("notes", { businessId: A, versionId: harbor30.last, videoId: harbor30.v, kind: "frame", inFrame: 120, text, status: "open", authorName: who, authorKind: "client", visibility: "shared", createdAt: now - 5 * HOUR, updatedAt: now - 5 * HOUR } as never);
      await ctx.db.insert("notes", { businessId: A, versionId: spirit.last, videoId: spirit.v, kind: "general", text: "Approved from our side.", status: "done", authorName: "Dan Price", visibility: "shared", createdAt: now - 2 * DAY, updatedAt: now - 2 * DAY } as never);
      for (const [vv, who, ago] of [[harbor30, "Maya Brooks", 3 * HOUR], [az, "Ana Ruiz", 26 * HOUR], [spirit, "Dan Price", 2 * DAY]] as const)
        await ctx.db.insert("views", { businessId: A, videoId: vv.v, versionId: vv.last, session: `s-${who}`, kind: "client", who, whoKey: who, startedAt: now - ago, lastAt: now - ago + 40_000, watchedSec: 30, maxSec: 30, lengthSec: 30, completed: true });

      // Docs: one out for signature to Maya, one signed by Dan, one draft.
      const pdf = await ctx.storage.store(new Blob(["%PDF-1.4 kit"], { type: "application/pdf" }));
      const doc = async (number: number, title: string, status: "sent" | "completed" | "draft", age: number, signer: [string, string]) => {
        const documentId = await ctx.db.insert("wsDocuments", { businessId: A, number, title, status, currentVersion: 1, createdAt: now - age, updatedAt: now - age / 2, ...(status !== "draft" ? { sentAt: now - age / 2, sentVersion: 1 } : {}), ...(status === "completed" ? { completedAt: now - age / 4 } : {}) } as never);
        await ctx.db.insert("wsVersions", { businessId: A, documentId, number: 1, fileId: pdf, fileName: `WS-${String(number).padStart(5, "0")}.pdf`, fileSha256: "0".repeat(64), fileBytes: 12, pages: [{ width: 612, height: 792, rotate: 0 }, { width: 612, height: 792, rotate: 0 }],
          signers: [{ key: "heston", name: "Heston Hill", email: "heston@wranglerproductions.com", order: 1 }, { key: "client", name: signer[0], email: signer[1], order: 1 }],
          boxes: [
            { id: "b1", signer: "client", kind: "sign", page: 1, x: 0.12, y: 0.68, w: 0.32, h: 0.06, fromMarker: true }, { id: "b2", signer: "client", kind: "date", page: 1, x: 0.12, y: 0.76, w: 0.32, h: 0.05, fromMarker: true },
            { id: "b3", signer: "heston", kind: "sign", page: 1, x: 0.56, y: 0.68, w: 0.32, h: 0.06, fromMarker: true }, { id: "b4", signer: "heston", kind: "date", page: 1, x: 0.56, y: 0.76, w: 0.32, h: 0.05, fromMarker: true },
          ],
          signingOrder: "any", ...(status !== "draft" ? { approvedAt: now - age / 2 } : {}), createdAt: now - age, updatedAt: now - age } as never);
        return documentId;
      };
      const d1 = await doc(12, "Service Agreement — Harbor Coffee Launch", "sent", 2 * DAY, ["Maya Brooks", "maya@harborcoffee.com"]);
      const d2 = await doc(11, "Change Order — Spirit Days", "completed", 9 * DAY, ["Dan Price", "dan@northline.church"]);
      const d3 = await doc(13, "Service Agreement — Backrooms", "draft", 1 * DAY, ["Floor Trader", "hello@floortrader.example"]);
      await ctx.db.insert("wsSignings", { businessId: A, documentId: d1, versionNumber: 1, signerKey: "client", name: "Maya Brooks", email: "maya@harborcoffee.com", order: 1, token: "kittokenkittokenkit1", status: "sent", sentAt: now - DAY, openedAt: now - 3 * HOUR } as never);
      await ctx.db.insert("wsSignings", { businessId: A, documentId: d1, versionNumber: 1, signerKey: "heston", name: "Heston Hill", email: "heston@wranglerproductions.com", order: 1, token: "kittokenkittokenkit3", status: "signed", sentAt: now - DAY, signedAt: now - DAY } as never);
      await ctx.db.insert("wsSignings", { businessId: A, documentId: d2, versionNumber: 1, signerKey: "client", name: "Dan Price", email: "dan@northline.church", order: 1, token: "kittokenkittokenkit2", status: "signed", sentAt: now - 6 * DAY, signedAt: now - 5 * DAY } as never);
      // Audit trails through the real chain, so they read "Intact".
      const { appendEvent } = await import("../convex/lib/wsAudit");
      for (const [d, sent] of [[d1, true], [d2, true]] as const) {
        await appendEvent(ctx as never, d, { kind: "created", actor: "heston", versionNumber: 1, detail: "Uploaded (2 pages)" });
        if (sent) { await appendEvent(ctx as never, d, { kind: "approved", actor: "heston", versionNumber: 1, detail: "Version 1 approved and locked." }); await appendEvent(ctx as never, d, { kind: "owner_signed", actor: "heston", versionNumber: 1 }); await appendEvent(ctx as never, d, { kind: "sent", actor: "heston", versionNumber: 1, email: "maya@harborcoffee.com" }); }
      }
      await appendEvent(ctx as never, d1, { kind: "opened", actor: "signer:client", versionNumber: 1, email: "maya@harborcoffee.com", ip: "198.51.100.4", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari" });
      await appendEvent(ctx as never, d3, { kind: "created", actor: "heston", versionNumber: 1, detail: "Uploaded (2 pages)", ip: "203.0.113.8", userAgent: "Mozilla/5.0 (Macintosh) Chrome" });
      return { A, harbor, heston, maya, p1, p2, p3, p4, harbor30, d1, d2, d3, hestonSub: await sess(heston), mayaSub: await sess(maya) };
    });
    const owner = t.withIdentity({ subject: w.hestonSub });
    const client = t.withIdentity({ subject: w.mayaSub });
    // Shares and Inbox through the real mutations, so their records look exactly as the site makes them.
    const base = { allVersions: true, downloads: true, emailNewVersions: true };
    await owner.mutation(api.shares.create, { target: { kind: "project", projectId: w.p1 }, ...base, access: "comment", who: "invited", emails: ["maya@harborcoffee.com", "jordan@harborcoffee.com"] });
    await owner.mutation(api.shares.create, { target: { kind: "video", videoId: w.harbor30.v }, ...base, access: "view", who: "link" });
    const note = await owner.mutation(api.inbox.saveNote, { clientId: w.harbor, title: "Shoot moved to Friday", text: "Same time, same place. We'll start with the counter shots." });
    await owner.mutation(api.inbox.sendNote, { noteId: note });
    await owner.mutation(api.inbox.saveNote, { clientId: w.harbor, title: "Cutdown ready next week", text: "The 15s is on its way." });
    await t.mutation((anyApi as never as { inbox: { draftNoteAs: never } }).inbox.draftNoteAs, { clientId: w.harbor, title: "Shoot moved to Thursday, Nov 6", text: "Same call time. We'll send the shot list Monday.", said: "tell Harbor the shoot moved to Thursday", asBusiness: w.A } as never);
    await t.run(async (ctx) => { for (const i of await ctx.db.query("inboxItems").collect()) if (i.kind === "note" && i.email === "maya@harborcoffee.com") await ctx.db.patch(i._id, { readAt: now - 20 * HOUR }); });
    await t.run(async (ctx) => {
      const { postToInbox } = await import("../convex/lib/inbox");
      await postToInbox(ctx as never, { businessId: w.A, clientId: w.harbor, email: "maya@harborcoffee.com", kind: "cut_ready", title: "New cut ready", text: "Harbor Coffee 30s · v4", link: `/s/x/v/${w.harbor30.v}`, source: { module: "review", id: w.harbor30.last }, key: "kit-v4" });
      await postToInbox(ctx as never, { businessId: w.A, clientId: w.harbor, email: "maya@harborcoffee.com", kind: "to_sign", title: "Document to sign", text: "Service Agreement — Harbor Coffee Launch · WS-00012", link: "/x/kittokenkittokenkit1", source: { module: "sign", id: "d1" }, key: "kit-sign" });
      await postToInbox(ctx as never, { businessId: w.A, clientId: w.harbor, email: "maya@harborcoffee.com", kind: "reply", title: "Reply on your note at 01:00:05:00", text: "Harbor Coffee 30s · v4", link: `/s/x/v/${w.harbor30.v}`, source: { module: "review", id: "n1" }, key: "kit-reply" });
    });

    // Docs: the starter template plus two more, and two drafts still in the builder.
    await owner.mutation(api.builder.ensureStarter, {});
    const starter = (await owner.query(api.builder.listTemplates, {}))[0];
    const b1 = await owner.mutation(api.builder.createBuild, { templateId: starter._id });
    const b2 = await owner.mutation(api.builder.createBuild, {});
    await t.run(async (ctx) => {
      const tpl = (await ctx.db.query("wsTemplates").collect())[0];
      await ctx.db.patch(tpl._id, { description: "Wrangler's standard agreement" });
      const { _id: _a, _creationTime: _b, ...rest } = tpl;
      await ctx.db.insert("wsTemplates", { ...rest, name: "Change Order", description: undefined });
      await ctx.db.insert("wsTemplates", { ...rest, name: "Usage Release", description: undefined });
      await ctx.db.patch(b1, { title: "Spirit Days Service Agreement", updatedAt: Date.now() - 2 * 3_600_000 });
      await ctx.db.patch(b2, { title: "Northline Usage Release", updatedAt: Date.now() - 4 * 86_400_000 });
    });

    // Phase 2 Part A: the Harbor Coffee Launch hub (stage, next step, dates, rounds, a final file).
    await owner.mutation(api.projects.setStage, { projectId: w.p1, stage: "polish", post: true, note: "Notes on Harbor Coffee 30s by Nov 4." });
    await owner.mutation(api.projects.setNextStep, { projectId: w.p1, text: "Notes on Harbor Coffee 30s v4 from Maya by Nov 4." });
    await owner.mutation(api.projects.setKeyDates, { projectId: w.p1, dates: [{ label: "Kickoff", date: "2026-10-06" }, { label: "Shoot", date: "2026-10-14" }, { label: "First cut", date: "2026-10-21" }, { label: "Final due", date: "2026-11-07" }] });
    await owner.mutation(api.projects.addDeliveryFile, { projectId: w.p1, file: { kind: "dropbox", path: "/clients/harbor coffee/launch/final/harborcoffee_30s_final.mov", name: "HarborCoffee_30s_FINAL.mov", size: 4_200_000_000 } });
    await owner.mutation(api.projects.addDeliveryFile, { projectId: w.p1, file: { kind: "version", versionId: w.harbor30.last } });
    // Phase 2 Part B: Stripe connected, and invoices in every state (made directly: the kit has no Stripe).
    const invIds = await t.run(async (ctx) => {
      await ctx.db.patch(w.A, { stripe: { accountId: "acct_kit", status: "connected", chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, displayName: "Wrangler Productions", bankLast4: "6789", livemode: false, startedAt: now - 9 * DAY, connectedAt: now - 9 * DAY, checkedAt: now } });
      const base = { businessId: w.A, clientId: w.harbor, projectId: w.p1, billTo: { name: "Maya Brooks", email: "maya@harborcoffee.com", company: "Harbor Coffee" } };
      const mk = async (o: Record<string, unknown>, lines: Array<[string, number, number]>, extra: Record<string, unknown> = {}) => {
        const ls = lines.map(([d, q, c], n) => ({ id: `l${n}`, description: d, qty: q, unitCents: c }));
        const total = ls.reduce((s2, l) => s2 + l.qty * l.unitCents, 0);
        const { age, ...rest } = o as { age?: number };
        return ctx.db.insert("invoices", { ...base, history: [{ kind: "created", at: now - 8 * DAY, by: "Heston Hill" }], createdAt: now - 8 * DAY, updatedAt: now - (age ?? 0), totalCents: total, amountPaidCents: 0, amountRemainingCents: total, ...rest, lines: ls, ...extra } as never);
      };
      const paid = await mk({ payToken: "kitpaidtoken000000001", payments: [{ id: "pi_k1", at: now - 7 * DAY, method: "Visa •••• 4242", cents: 300000, status: "paid" }], kind: "deposit", title: "Deposit · WS-00012", number: "WRNGLR-0001", status: "paid", dueDate: "2026-10-24", sentAt: now - 8 * DAY, paidAt: now - 7 * DAY, age: 7 * DAY, stripe: { accountId: "acct_kit", invoiceId: "in_kit1", customerId: "cus_kit", number: "WRNGLR-0001", livemode: false, pdfUrl: "/kit-pdf/" } }, [["Deposit (25%) · 26127 Harbor Coffee Launch", 1, 300000]], { amountPaidCents: 300000, amountRemainingCents: 0, history: [{ kind: "created", at: now - 8 * DAY, by: "Heston Hill" }, { kind: "sent", at: now - 8 * DAY, by: "Heston Hill", detail: "maya@harborcoffee.com" }, { kind: "viewed", at: now - 7.5 * DAY, detail: "Maya Brooks" }, { kind: "paid", at: now - 7 * DAY, detail: "Paid in full" }] });
      const due = await mk({ payToken: "kitduetoken0000000002", kind: "other", title: "Change order WS-00014", number: "WRNGLR-0002", status: "open", dueDate: "2026-11-28", sentAt: now - DAY, age: DAY, stripe: { accountId: "acct_kit", invoiceId: "in_kit2", customerId: "cus_kit", number: "WRNGLR-0002", livemode: false, pdfUrl: "/kit-pdf/", hostedUrl: "https://invoice.stripe.com/kit" } }, [["Change order WS-00014 · extra revision round", 1, 45000]], { memo: "Thanks, Maya.", history: [{ kind: "created", at: now - 2 * DAY, by: "Heston Hill" }, { kind: "sent", at: now - DAY, by: "Heston Hill", detail: "maya@harborcoffee.com" }] });
      const draft = await mk({ kind: "final", title: "Final invoice", status: "draft", dueDate: "2026-11-21", age: 3 * HOUR }, [["Final payment · 26127 Harbor Coffee Launch", 1, 900000], ["Extra shoot day", 1, 120000]], { memo: "Thank you, Maya. Final files unlock as soon as this is paid." });
      await mk({ payToken: "kitproctoken000000003", payments: [{ id: "pi_k3", at: now - 2 * DAY, method: "Bank •••• 6789", cents: 120000, status: "processing" }], kind: "other", title: "Extra shoot day", number: "WRNGLR-0003", status: "open", dueDate: "2026-11-20", sentAt: now - 3 * DAY, processing: true, age: 2 * DAY, stripe: { accountId: "acct_kit", invoiceId: "in_kit3", customerId: "cus_kit", number: "WRNGLR-0003", livemode: false, pdfUrl: "/kit-pdf/" } }, [["Extra shoot day · Nov 14", 1, 120000]]);
      await ctx.db.insert("counters", { businessId: w.A, key: "invoiceSeq", value: 3 });
      return { paid, due, draft };
    });
    // Phase 4: a shoot on the Harbor Coffee Launch (in four days), not confirmed yet.
    const inDays = (n: number) => new Date(now + n * DAY).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const { shootId } = await owner.mutation(api.shoots.schedule, { projectId: w.p1, date: inDays(4), call: "07:00", wrap: "17:00", location: "Harbor Coffee, 412 Main St.", parking: "Behind the shop",
      prepare: ["Shop open and lights on by 7:00", "Two baristas on shift for B-roll", "Menu boards up to date", "Signed releases from anyone on camera"], withOwner: true, bookingIds: [], calendar: true }) as { shootId: string };
    // Phase 5d step 3: gear. Nine items across the kinds (one in repair, one retired, one with maintenance due), two on the shoot.
    const gearIds = await (async () => {
      const mk = async (name: string, kind: string, extra: Record<string, unknown> = {}) => await owner.mutation(api.gear.add, { name, kind, ...extra }) as Id<"gear">;
      const fx3 = await mk("Sony FX3", "camera", { serial: "4402158831", boughtOn: "2028-03-14", priceCents: 389800, insuredCents: 420000, notes: "A-camera. Cage and top handle on." });
      const a7 = await mk("Sony A7 IV", "camera", { serial: "5100229374", boughtOn: "2028-09-02", priceCents: 249800, insuredCents: 260000 });
      const gm = await mk("Sony 24-70mm f/2.8 GM II", "lens", { serial: "1829455", boughtOn: "2028-03-14", priceCents: 229800, insuredCents: 240000 });
      const aput = await mk("Aputure 300d II", "lighting", { boughtOn: "2027-06-20", priceCents: 107500, insuredCents: 90000 });
      const rode = await mk("Rode Wireless PRO", "audio", { serial: "RWP-20931", priceCents: 39900, insuredCents: 40000 });
      const mavic = await mk("DJI Mavic 3 Pro", "drone", { serial: "1581F5FJB22", boughtOn: "2029-01-11", priceCents: 219900, insuredCents: 230000 });
      const tripod = await mk("Sachtler Aktiv8 tripod", "grip", { priceCents: 139900, insuredCents: 120000 });
      const mac = await mk("MacBook Pro 16\"", "computer", { serial: "C02ZK3XYMD6T", boughtOn: "2029-02-20", priceCents: 349900, insuredCents: 350000 });
      const old = await mk("Canon C100", "camera", { boughtOn: "2022-05-02", priceCents: 349900, insuredCents: 0, notes: "Sold to a friend." });
      await owner.mutation(api.gear.setStatus, { gearId: gm, status: "in_repair" });
      await owner.mutation(api.gear.setStatus, { gearId: old, status: "retired" });
      await owner.mutation(api.gear.logMaintenance, { gearId: fx3, date: inDays(-120), what: "Sensor cleaned and firmware updated", costCents: 8500, nextDue: inDays(-5) });
      await owner.mutation(api.gear.logMaintenance, { gearId: fx3, date: inDays(-400), what: "Fan replaced", costCents: 12000 });
      await owner.mutation(api.gear.logMaintenance, { gearId: aput, date: inDays(-30), what: "Fresnel lens cleaned", nextDue: inDays(150) });
      await owner.mutation(api.gear.addToShoot, { shootId: shootId as Id<"shoots">, gearId: fx3 });
      await owner.mutation(api.gear.addToShoot, { shootId: shootId as Id<"shoots">, gearId: aput });
      await owner.mutation(api.gear.addToShoot, { shootId: shootId as Id<"shoots">, gearId: rode });
      return { fx3, a7, gm, aput, rode, mavic, tripod, mac, old };
    })();
    // Phase 5d step 4: one guide the business has edited (so the owner's list shows the Edited chip).
    await owner.mutation(api.help.edit, { slug: "paying-an-invoice" });
    // Phase 4: two file requests, one with files in (made directly: the kit has no Dropbox).
    const reqIds = await t.run(async (ctx) => {
      const folder = "/File requests/Harbor Coffee/26127 Harbor Coffee Launch";
      const a = await ctx.db.insert("fileRequests", { businessId: w.A, projectId: w.p1, title: "Upload your logo and brand guide", details: "Your logo (SVG or PNG), the brand guide, and any photos of the new menu boards.", due: inDays(1), folder: `${folder}/Logo and brand guide`, remind: true, status: "open",
        files: [{ name: "harbor-logo.svg", size: 52_000, path: `${folder}/Logo and brand guide/harbor-logo.svg`, at: now - HOUR, by: "maya@harborcoffee.com" }, { name: "Harbor brand guide.pdf", size: 8_400_000, path: `${folder}/Logo and brand guide/Harbor brand guide.pdf`, at: now - HOUR, by: "maya@harborcoffee.com" }], lastUploadAt: now - HOUR, history: [], createdAt: now - DAY, updatedAt: now - HOUR });
      const b = await ctx.db.insert("fileRequests", { businessId: w.A, projectId: w.p1, title: "Send your music references", due: inDays(6), folder: `${folder}/Music references`, remind: true, status: "open", files: [], history: [], createdAt: now - DAY, updatedAt: now - DAY });
      return { a, b };
    });
    // Phase 4: the kickoff brief, sent back by Maya (740:2074) (made directly, like the requests).
    const briefId = await t.run(async (ctx) => {
      const { KICKOFF_BRIEF } = await import("../convex/lib/kickoff");
      return await ctx.db.insert("briefs", { businessId: w.A, projectId: w.p1, questions: KICKOFF_BRIEF, step: 3, status: "submitted", sentAt: now - 3 * DAY, startedAt: now - 2 * DAY, submittedAt: now - DAY, submittedBy: "maya@harborcoffee.com", updatedBy: "maya@harborcoffee.com", submits: 1,
        answers: { goal: "Launch the new menu and bring in the morning crowd.", audience: "Regulars and downtown office workers", where: ["Instagram", "In-store screens"], must: "Latte art, the new menu boards, the team.",
          feel: ["Warm", "Honest", "community"], colors: ["#3B2A20", "#F2E6D8"], refs: ["https://vimeo.com/76979871"], ready: inDays(18), launch: inDays(20), filming: "Weekdays before 9 AM, when the morning rush is on.", contact: "Maya Brooks, 512 555 0142" },
        history: [], createdAt: now - 3 * DAY, updatedAt: now - DAY });
    });
    // Phase 5 (Nov 3): the raw footage offer on 26127, a testimonial request to Maya, and two answers from others.
    const askId = await t.run(async (ctx) => {
      const { postToInbox } = await import("../convex/lib/inbox");
      await ctx.db.insert("footageStorage", { businessId: w.A, projectId: w.p1, clientId: w.harbor, priceCents: 10_000, offeredAt: now - DAY, keepUntil: inDays(29), status: "offered", history: [{ at: now - DAY, text: "Offered at delivery" }], createdAt: now - DAY, updatedAt: now - DAY });
      const id = await ctx.db.insert("inboxNotes", { businessId: w.A, clientId: w.harbor, title: "A few words about 26127 Harbor Coffee Launch?", text: "Two quick questions, about a minute.", status: "sent", draftedBy: "owner", testimonialProjectId: w.p1, createdAt: now - 2 * HOUR, updatedAt: now - 2 * HOUR, sentAt: now - 2 * HOUR, recipients: 1 });
      await ctx.db.patch(id, { link: `/words/${id}`, linkLabel: "Share a few words" });
      await postToInbox(ctx as never, { businessId: w.A, clientId: w.harbor, email: "maya@harborcoffee.com", kind: "note", title: "A few words about 26127 Harbor Coffee Launch?", text: "Two quick questions, about a minute.", link: `/words/${id}`, linkLabel: "Share a few words", source: { module: "inbox", id }, key: `note:${id}`, noteId: id });
      await ctx.db.insert("testimonials", { businessId: w.A, noteId: id, projectId: w.p1, clientId: w.harbor, email: "ava@harborcoffee.com", name: "Ava Chen", company: "Harbor Coffee", working: "Clear, fast, and they actually listened.", film: "We use the launch film on every pitch now.", permission: true, dropboxPath: "/Apps/Wrangler Review/Testimonials/2026-10-29 Ava Chen - 26127 Harbor Coffee Launch.md", savedAt: now - HOUR, createdAt: now - HOUR, updatedAt: now - HOUR });
      await ctx.db.insert("testimonials", { businessId: w.A, noteId: id, projectId: w.p1, clientId: w.harbor, email: "jordan@harborcoffee.com", name: "Jordan Reyes", company: "Harbor Coffee", working: "Great to work with.", film: "Customers mention the recap.", permission: false, readAt: now - HOUR, saveError: "Dropbox isn't connected. Connect it in Settings › Dropbox drop folder, then Save again.", createdAt: now - 3 * DAY, updatedAt: now - 3 * DAY });
      return id;
    });

    // ---- Phone pass (Nov 4): a Production world. Projects in production/polish, shoots (today, this week, next week, one
    // past), call sheets in every state (questions, draft, sent, updated today) with a Weather block in each of its four
    // states, crew, client people and guests, and a connected Google Calendar with events. ----
    const PICKED = "wrangler@group.calendar.google.com", PERSONAL = "heston.hill@gmail.com", HOLIDAYS = "holidays@group.v.calendar.google.com";
    const prod = await (async () => {
      for (const p of [w.p2, w.p3, w.p4]) await owner.mutation(api.projects.setStage, { projectId: p, stage: "production", post: false });
      await owner.mutation(api.projects.setNextStep, { projectId: w.p3, text: "Rough cut of the Arizona highlights by Nov 10." });
      await owner.mutation(api.projects.setNextStep, { projectId: w.p4, text: "Shoot the backrooms scenes Saturday night." });
      await owner.mutation(api.projects.setKeyDates, { projectId: w.p3, dates: [{ label: "Shoot", date: inDays(0) }, { label: "First cut", date: inDays(12) }, { label: "Final due", date: inDays(25) }] });
      await owner.mutation(api.projects.setKeyDates, { projectId: w.p4, dates: [{ label: "Shoot", date: inDays(2) }, { label: "First cut", date: inDays(5) }] });
      await owner.mutation(api.projects.setKeyDates, { projectId: w.p2, dates: [{ label: "Rough cut", date: inDays(3) }, { label: "Final due", date: inDays(20) }] });
      // Crew: two vendors, invited to the portal, booked on the shoot days.
      const vend = async (name: string, email: string, role: string) => {
        const id = await owner.mutation(api.vendors.add, { name, email, roles: [role], rates: [], invite: false }) as Id<"vendors">;
        await t.run(async (ctx) => { await ctx.db.patch(id, { invitedAt: now - 5 * DAY }); });
        return id;
      };
      const jordanV = await vend("Jordan Ellis", "jordan@ellisfilms.com", "Shooter"), samV = await vend("Sam Rivera", "sam@riverasound.example", "Sound");
      const book = (vendorId: Id<"vendors">, projectId: Id<"projects">, role: string, start: string, end = start) =>
        owner.mutation(api.bookings.create, { vendorId, projectId, role, start, end, cents: 85_000, unit: "day" }) as Promise<Id<"vendorBookings">>;
      const bAz = await book(jordanV, w.p3, "Shooter", inDays(0));
      const bBack = await book(jordanV, w.p4, "Shooter", inDays(2));
      await book(jordanV, w.p1, "Shooter", inDays(4));
      await book(samV, w.p1, "Sound", inDays(4));
      const shoot = async (projectId: Id<"projects">, n: number, call: string, wrap: string, location: string, bookingIds: Id<"vendorBookings">[] = []) =>
        (await owner.mutation(api.shoots.schedule, { projectId, date: inDays(n), call, wrap, location, parking: "", prepare: [], withOwner: true, bookingIds, calendar: false }) as { shootId: Id<"shoots"> }).shootId;
      const sA = await shoot(w.p3, 0, "08:00", "17:00", "Chase Field loading dock, Phoenix", [bAz]);
      const sB = await shoot(w.p4, 2, "18:00", "23:00", "Floor Trader HQ, Oklahoma City", [bBack]);
      const sD = await shoot(w.p4, 5, "19:00", "23:30", "Floor Trader HQ, Oklahoma City");
      const sE = await shoot(w.p2, 6, "09:00", "14:00", "Northline Church, Edmond");
      const sF = await shoot(w.p2, 8, "10:00", "15:00", "Northline Church, Edmond");
      const sG = await shoot(w.p1, 11, "07:00", "12:00", "Harbor Coffee, 412 Main St.");
      await shoot(w.p3, 14, "08:00", "16:00", "Camelback Mountain trailhead, Phoenix");
      const ADDR = { A: "1 Chase Field Way, Phoenix, AZ 85004", B: "100 N Broadway Ave, Oklahoma City, OK 73102", C: "412 Main St, Oklahoma City, OK 73102", D: "100 N Broadway Ave, Oklahoma City, OK 73102", E: "1 Church Rd, Edmond, OK 73034", F: "1 Church Rd, Edmond, OK 73034" };
      const rows = (call: string) => [
        { id: "r1", time: call, what: "Crew call and load-in", who: "Crew" }, { id: "r2", time: "09:30", what: "Talent call, hair and makeup", who: "Talent" },
        { id: "r3", time: "11:00", what: "First setup", who: "Everyone" }, { id: "r4", time: "13:00", what: "Lunch", who: "Everyone" }, { id: "r5", time: "15:30", what: "Pickups and wrap", who: "Crew" },
      ];
      const mk = async (shootId: Id<"shoots">, call: string, wrap: string, place: string, address: string, weather: boolean, notes = "", step = 4, make = true) => {
        const id = await owner.mutation(api.callSheets.create, { shootId, how: "questions" }) as Id<"callSheets">;
        await owner.mutation(api.callSheets.saveAnswers, { callSheetId: id, step, answers: { templateId: null, crewCall: call, talentCall: "09:30", wrap, locationName: place, address, parking: "Park behind the building. Load-in is through the side door.", weather, schedule: rows(call), notes } });
        const buildId = make ? await owner.mutation(api.callSheets.make, { callSheetId: id }) as Id<"wsBuilds"> : null;
        return { id, buildId };
      };
      const edit = async (buildId: Id<"wsBuilds">, fn: (page: Page) => void) => {
        const b = await owner.query(api.builder.getBuild, { buildId });
        const page = JSON.parse(JSON.stringify(pageOf(b.blocks))) as Page;
        fn(page);
        await owner.mutation(api.builder.saveBuild, { buildId, title: b.title, blocks: page, fields: b.fields, signers: [], style: b.style });
      };
      const wx = async (csId: Id<"callSheets">, kind: "forecast" | "none", date: string, buildId: Id<"wsBuilds">, location: string, line = "") => {
        const page = pageOf((await owner.query(api.builder.getBuild, { buildId })).blocks);
        await t.mutation(internal.callSheets.weatherStore, { callSheetId: csId, address: weatherAddress(page, location).address, date, kind, ...(line ? { line } : {}) });
      };
      await owner.mutation(api.callSheets.ensureStarters, {});
      const RILEY = "riley@talent.example", PAT = "pat@stylist.example";
      // The Chase Field sheet from a week ago, sent to Riley while the shoot was still ahead (the guest's Ended list).
      vi.setSystemTime(now - 7 * DAY);
      const sP = await shoot(w.p3, -5, "08:00", "16:00", "Chase Field loading dock, Phoenix");
      const P = await mk(sP, "08:00", "16:00", "Chase Field loading dock, Phoenix", ADDR.A, true);
      const rP = await owner.mutation(api.callSheets.addGuest, { callSheetId: P.id, name: "Riley Quinn", email: RILEY, role: "Talent" }) as string;
      await owner.mutation(api.callSheets.send, { callSheetId: P.id, crew: false, client: false, guests: true });
      vi.setSystemTime(now);
      // Today: the Chase Field sheet, sent to the crew and Riley, with an update this morning.
      const A = await mk(sA, "08:00", "17:00", "Chase Field loading dock, Phoenix", ADDR.A, true, "Hydrate. It will be 90 degrees by noon.");
      await wx(A.id, "forecast", inDays(0), A.buildId!, "Chase Field loading dock, Phoenix", "Sunny · 91°/68° · 0% rain · wind 5 mph");
      const rA = await owner.mutation(api.callSheets.addGuest, { callSheetId: A.id, name: "Riley Quinn", email: RILEY, role: "Talent" }) as string;
      await owner.mutation(api.callSheets.send, { callSheetId: A.id, crew: true, client: true, guests: true, message: "See you at the dock." });
      await edit(A.buildId!, (pg) => { nodesOf(pg, "location")[0].attrs!.talentCall = "10:00"; });
      vi.setSystemTime(now + 60_000);
      await owner.mutation(api.callSheets.sendUpdate, { callSheetId: A.id, changed: "Talent call moved to 10:00 AM" });
      vi.setSystemTime(now);
      // Halloween: a built draft with the forecast in.
      const B = await mk(sB, "18:00", "23:00", "Floor Trader HQ, Oklahoma City", ADDR.B, true);
      await wx(B.id, "forecast", inDays(2), B.buildId!, "Floor Trader HQ, Oklahoma City", "Mostly cloudy · 58°/44° · 20% rain · wind 8 mph");
      // Monday: the Harbor Coffee sheet, sent to Maya, both crew and two guests; Pat's access ended by hand; the forecast changed after it went out.
      const C = await mk(shootId as Id<"shoots">, "07:00", "17:00", "Harbor Coffee, 412 Main St.", ADDR.C, true, "Shop opens at 7:00. Keep the espresso machine warm.");
      await wx(C.id, "forecast", inDays(4), C.buildId!, "Harbor Coffee, 412 Main St.", "Partly cloudy · 64°/47° · 10% rain · wind 7 mph");
      const rC = await owner.mutation(api.callSheets.addGuest, { callSheetId: C.id, name: "Riley Quinn", email: RILEY, role: "Talent" }) as string;
      const pC = await owner.mutation(api.callSheets.addGuest, { callSheetId: C.id, name: "Pat Lee", email: PAT, role: "Stylist" }) as string;
      await owner.mutation(api.callSheets.send, { callSheetId: C.id, crew: true, client: true, guests: true, message: "Looking forward to it." });
      await owner.mutation(api.callSheets.endGuest, { callSheetId: C.id, id: pC });
      vi.setSystemTime(now + 3 * HOUR);
      await wx(C.id, "forecast", inDays(4), C.buildId!, "Harbor Coffee, 412 Main St.", "Light rain · 58°/46° · 60% rain · wind 12 mph");
      vi.setSystemTime(now);
      await t.run(async (ctx) => {
        for (const [id, who] of [[C.id, ["maya@harborcoffee.com", "jordan@ellisfilms.com"]], [A.id, ["jordan@ellisfilms.com"]]] as const) {
          const cs = (await ctx.db.get(id))!;
          await ctx.db.patch(id, { recipients: cs.recipients.map((r) => (who.includes(r.email as never) ? { ...r, openedAt: now - 2 * HOUR, lastOpenedAt: now - 2 * HOUR } : r)) });
        }
      });
      // A typed-over line, no forecast, and "too early".
      const D = await mk(sD, "19:00", "23:30", "Floor Trader HQ, Oklahoma City", ADDR.D, true);
      await edit(D.buildId!, (pg) => { nodesOf(pg, "weather")[0].attrs = { typed: true, line: "Overcast, around 55°. Bring layers and rain covers." }; });
      const E = await mk(sE, "09:00", "14:00", "Northline Church, Edmond", ADDR.E, true);
      await wx(E.id, "none", inDays(6), E.buildId!, "Northline Church, Edmond");
      const F = await mk(sF, "10:00", "15:00", "Northline Church, Edmond", ADDR.F, true);
      // Next week: still on the questions (step 3).
      const G = await mk(sG, "07:00", "12:00", "Harbor Coffee, 412 Main St.", "412 Main St, Oklahoma City, OK 73102", false, "", 2, false);
      // A connected Google Calendar with events around the shoots.
      await t.run(async (ctx) => {
        await ctx.db.insert("calendars", { businessId: w.A, email: "heston.hill@gmail.com", refreshToken: "kit", calendarId: PICKED, calendarName: "Wrangler Productions", inviteVendors: true, inviteClient: false, connectedAt: now - 20 * DAY, lastSyncedAt: now - 4 * 60_000,
          list: [{ id: PERSONAL, name: "Personal", color: 4, on: true, writable: true, primary: true }, { id: PICKED, name: "Wrangler Productions", color: 7, on: true, writable: true, primary: false }, { id: HOLIDAYS, name: "Holidays", color: 2, on: true, writable: false, primary: false }] });
        const ev = (cal: string, id: string, title: string, d0: number, d1: number, start?: string, end?: string, extra: Record<string, unknown> = {}) =>
          ctx.db.insert("calendarEvents", { businessId: w.A, kind: "google", calendarId: cal, googleId: id, title, date: inDays(d0), endDate: inDays(d1), ...(start ? { start, end } : {}), guests: [], gUpdated: 1, syncedAt: now, createdAt: now, ...extra } as never);
        await ev(PICKED, "kit0001", "Team call", 1, 1, "10:00", "10:30", { guests: [{ email: "sam@riverasound.example", name: "Sam Rivera" }, { email: "jordan@ellisfilms.com", name: "Jordan Ellis" }], recurring: true });
        await ev(PICKED, "kit0002", "Studio rental: Stage 4", 3, 4, undefined, undefined, { location: "Stage 4, Oklahoma Film Studios" });
        await ev(PICKED, "kit0003", "Edit session: Harbor Coffee 30s", 0, 0, "13:00", "16:30", { projectId: w.p1 });
        await ev(PICKED, "kit0004", "Color review with Maya", 6, 6, "15:00", "16:00", { guests: [{ email: "maya@harborcoffee.com", name: "Maya Brooks" }], location: "Video call" });
        await ev(PICKED, "kit0005", "Gear pickup", 2, 2, "09:00", "10:00", { location: "Rental House, Bricktown" });
        await ev(PERSONAL, "kit0006", "Dentist", 4, 4, "14:00", "15:00");
        await ev(PERSONAL, "kit0007", "Dinner with Emily-Rose", 1, 1, "18:30", "20:00", { location: "Cheever's Cafe" });
        await ev(PERSONAL, "kit0008", "Move-in weekend", 9, 10);
        await ev(HOLIDAYS, "kit0009", "Halloween", 2, 2, undefined, undefined, { readOnly: true });
        await ev(HOLIDAYS, "kit0010", "Daylight saving time ends", 3, 3, undefined, undefined, { readOnly: true });
        await ev(PICKED, "kit0011", "Edit week: Spirit Days", 7, 11, undefined, undefined, { projectId: w.p2 });
      });
      return { A, B, C, D, E, F, G, P, shoots: { sA, sB, sD, sE, sF, sG, sP }, riley: { A: rA, C: rC, P: rP }, RILEY, bookings: { bAz, bBack } };
    })();
    const sheetIds = [prod.A, prod.B, prod.C, prod.D, prod.E, prod.F, prod.G, prod.P];
    const guest = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { email: prod.RILEY, name: "Riley Quinn", role: "guest" });
      const passes = await ctx.db.query("guestPasses").collect();
      const tok = (id: Id<"callSheets">) => passes.find((x) => x.callSheetId === id && x.email === prod.RILEY)!.token;
      return { sub: `${userId}|${await ctx.db.insert("authSessions", { userId, expirationTime: now + 30 * DAY })}`, tokens: { A: tok(prod.A.id), C: tok(prod.C.id), P: tok(prod.P.id) } };
    });
    // Calendar events for the whole stretch Production › Calendar may ask for (the kit answers any month, week or agenda from this).
    const calRange = { from: inDays(-60), to: inDays(35) };
    const noteIds = await t.run(async (ctx) => (await ctx.db.query("inboxNotes").collect()).map((n) => n._id));
    // Phase 5c screens (Nov 4): a Site watch report with one of each status, and four mornings of history.
    const sw = await t.run(async (ctx) => {
      const f = async (key: string, area: string, title: string, count: number, status: "found" | "fix_ready" | "fixed" | "needs_you", extra: Record<string, unknown> = {}) =>
        ctx.db.insert("siteWatchFindings", { key, area, title, count, status, firstAt: now - 7 * DAY, lastAt: now - 3 * HOUR, updatedAt: now - 3 * HOUR, ...extra } as never);
      const ids = [
        await f("stored:wsDocuments.signDone", "stored", "Signed copies are not saving", 3, "needs_you", { urgent: true, hits: 2, note: "Touches signing: yours to decide." }),
        await f("email:invoice", "email", "Emails not sending: invoice reminder", 14, "fix_ready", { hits: 6, branch: "watch/invoice-reminder-retry", commit: "a1b2c3d4e5f6", note: "Retries once after Resend answers 5xx." }),
        await f("job:dropbox.poll", "job", "Dropbox connection failed", 2, "found", { hits: 1 }),
        await f("stored:transcripts.failed", "stored", "Transcripts left failed", 5, "fixed", { doneAt: now - 2 * DAY }),
        await f("stored:waveforms.failed", "stored", "Waveform not built", 1, "fixed", { doneAt: now - 2 * DAY }),
        await f("page:/s/phone", "page", "Page check: Client share on a phone", 1, "fixed", { doneAt: now - 2 * DAY, detail: "1 load at 390 px" }),
      ];
      const open = (n: number) => [
        { key: "stored:wsDocuments.signDone", area: "stored", title: "Signed copies are not saving", status: "needs_you", urgent: true, count: 3 },
        { key: "email:invoice", area: "email", title: "Emails not sending: invoice reminder", status: "fix_ready", urgent: false, count: 14 },
        { key: "job:dropbox.poll", area: "job", title: "Dropbox connection failed", status: "found", urgent: false, count: 2 },
      ].slice(0, n);
      const runs = [
        await ctx.db.insert("siteWatchRuns", { at: now - 8 * HOUR, by: "app", found: 6, cleared: 0, open: open(3) }),
        await ctx.db.insert("siteWatchRuns", { at: now - 1 * DAY - 8 * HOUR, by: "app", found: 4, cleared: 4, open: open(2) }),
        await ctx.db.insert("siteWatchRuns", { at: now - 2 * DAY - 8 * HOUR, by: "app", found: 0, cleared: 0, open: [] }),
        await ctx.db.insert("siteWatchRuns", { at: now - 3 * DAY - 8 * HOUR, by: "app", found: 2, cleared: 2, open: open(1) }),
      ];
      return { ids, runs };
    });
    // Phase 5d step 1: booking calls. Settings saved, busy times just read (the Team call and Gear pickup), a lead who
    // booked a call (their card, the Upcoming call card and a Needs you row), and their private link.
    process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "kit"; process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "kit";
    const callKit = await t.run(async (ctx) => {
      const biz = (await ctx.db.get(w.A))!;
      const hours = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ on: d < 5, start: "09:00", end: d === 4 ? "15:00" : "17:00" }));
      const z = (dd: number, h: number, m = 0) => Date.UTC(2026, 9, 29 + dd, h + 5, m); // Central (CDT) wall clock
      await ctx.db.insert("callSettings", { businessId: w.A, lengthMin: 30, bufferMin: 10, aheadDays: 30, noticeHours: 4, hours, calendarId: PICKED,
        busy: { at: Date.now() + 10 * 365 * DAY, s: now, e: now + 31 * DAY, spans: [{ s: z(1, 10), e: z(1, 10, 30) }, { s: z(2, 9), e: z(2, 10) }] }, updatedAt: now });
      const dealId = await ctx.db.insert("deals", { businessId: w.A, title: "Tom Silva", stage: "lead", source: "call", contactEmail: "tom@silvaroasters.example",
        lead: { name: "Tom Silva", email: "tom@silvaroasters.example", message: "We're opening a second shop in the spring and want a launch video.", fields: [], at: now - 2 * HOUR },
        history: [{ kind: "call", at: now - 2 * HOUR, detail: "Booked a call: Fri, Oct 30, 10:00 AM" }], createdAt: now - 2 * HOUR, updatedAt: now - 2 * HOUR });
      const token = "kitcalltoken0000000000001";
      await ctx.db.insert("calls", { businessId: w.A, dealId, name: "Tom Silva", email: "tom@silvaroasters.example", note: "We're opening a second shop in the spring and want a launch video.",
        start: z(1, 10), end: z(1, 10, 30), tz: "America/New_York", status: "booked", token, event: { id: "kitcall1", calendarId: PICKED }, meet: "https://meet.google.com/abc-defg-hij",
        notice: { kind: "booked", at: now - 2 * HOUR }, history: [], createdAt: now - 2 * HOUR, updatedAt: now - 2 * HOUR });
      return { slug: biz.slug, dealId, token };
    });
    const OWNER: [string, Record<string, unknown>][] = [
      ["siteWatch.summary", {}], ["siteWatch.report", {}],
      ...sw.ids.map((id): [string, Record<string, unknown>] => ["siteWatch.finding#" + id, { id }]),
      ...sw.runs.map((id): [string, Record<string, unknown>] => ["siteWatch.run#" + id, { id }]),
      ["users.me", {}], ["business.brand", {}], ["business.settings", {}], ["payments.settings", {}], ["library.overview", {}], ["activity.feed", { limit: 100 }], ["activity.recent", {}], ["home.needs", {}],
      ["sign.list", {}], ["builder.listBuilds", {}], ["builder.listTemplates", {}], ["builder.listClauses", {}], ["sign.ownerSignature", {}],
      ["clients.listInvites", {}], ["clients.directory", {}], ["clients.page", { clientId: w.harbor }], ["clients.people", { clientId: w.harbor }],
      ["inbox.notes", {}], ["inbox.sent", {}], ["inbox.forClient", { clientId: w.harbor }], ["inbox.noteRecipients#" + w.harbor, { clientId: w.harbor }],
      ...noteIds.map((id): [string, Record<string, unknown>] => ["inbox.noteDetail#" + id, { noteId: id }]),
      ["library.video", { videoId: w.harbor30.v }], ["notes.forVersion", { versionId: w.harbor30.last }], ["transcripts.forVersion", { versionId: w.harbor30.last }],
      ["waveforms.forVersion", { versionId: w.harbor30.last }], ["views.forVideo", { videoId: w.harbor30.v }], ["shares.coveringVideo", { videoId: w.harbor30.v }], ["connector.listKeys", {}], ["register.sheetKey", {}], ["dropbox.status", {}], ["dropbox.flagged", {}], ["wsConnector.listKeys", {}], ["shares.list", {}],
      ["sign.pendingRequests", {}], ["approvals.forVideo", { videoId: w.harbor30.v }], ["sign.requestsFor", { documentId: w.d1 }],
["builder.getBuild#" + b1, { buildId: b1 }], ["builder.getProfile", {}], ["builder.listFonts", {}], ["builder.listStyles", {}],
      ["sign.get#" + w.d1, { documentId: w.d1 }], ["sign.get#" + w.d2, { documentId: w.d2 }], ["sign.get#" + w.d3, { documentId: w.d3 }],
      ["projects.page#" + w.p1, { projectId: w.p1 }], ["shoots.forProject#" + w.p1, { projectId: w.p1 }], ["fileRequests.forProject#" + w.p1, { projectId: w.p1 }], ["briefs.forProject#" + w.p1, { projectId: w.p1 }], ["briefs.settings", {}], ["calendar.settings", {}], ["projects.nextRound#" + w.harbor30.v, { videoId: w.harbor30.v }],
      ["footage.settings", {}], ["footage.forProject#" + w.p1, { projectId: w.p1 }], ["testimonials.list", {}], ["testimonials.projectsFor#" + w.harbor, { clientId: w.harbor }],
      ["invoices.list", {}], ["invoices.overview", { tzOffsetMin: 300 }], ["invoices.options", {}], ["invoices.forProject#" + w.p1, { projectId: w.p1 }],
      ["production.overview", {}], ["production.shoots", {}], ["calls.settings", {}], ["calls.forDeal#" + callKit.dealId, { dealId: callKit.dealId }], ["crm.deal#" + callKit.dealId, { dealId: callKit.dealId }], ["calls.page#" + callKit.slug, { slug: callKit.slug }], ["calls.manage#" + callKit.token, { token: callKit.token }], ["help.list", {}], ["help.guide#signing-in", { slug: "signing-in" }], ["help.guide#paying-an-invoice", { slug: "paying-an-invoice" }], ["gear.list", {}], ["gear.exportCsv", {}], ["gear.forShoot#" + shootId, { shootId }], ...Object.values(gearIds).map((id): [string, Record<string, unknown>] => ["gear.get#" + id, { gearId: id }]), ["production.projectsForShoot", {}], ["callSheets.list", {}], ["callSheets.newOptions", {}], ["calendarSync.range", calRange], ["calendarSync.linkOptions", {}],
      ["overviews.clients", {}], ["overviews.review", {}], ["overviews.docs", {}], ["overviews.proposals", {}], ["overviews.vendors", {}], ["home.dashboard", { tzOffsetMin: 300 }], ["crm.due", {}],
      ...sheetIds.map(({ id }): [string, Record<string, unknown>] => ["callSheets.get#" + id, { callSheetId: id }]),
      ...sheetIds.filter((x) => x.buildId).map(({ buildId }): [string, Record<string, unknown>] => ["builder.getBuild#" + buildId, { buildId }]),
      ...[w.p2, w.p3, w.p4].map((p): [string, Record<string, unknown>] => ["shoots.forProject#" + p, { projectId: p }]),
      ["invoices.get#" + invIds.paid, { invoiceId: invIds.paid }], ["invoices.get#" + invIds.due, { invoiceId: invIds.due }], ["invoices.get#" + invIds.draft, { invoiceId: invIds.draft }],
    ];
    const shareTokens = await t.run(async (ctx) => (await ctx.db.query("shares").collect()).map((x) => (x as unknown as { token: string }).token));
    const CLIENT: [string, Record<string, unknown>][] = [["users.me", {}], ["business.brand", {}], ["shares.mine", {}], ["inbox.mine", {}], ["inbox.unreadCount", {}], ["documents.mine", {}], ["portal.waiting", {}], ["emails.myPrefs", {}],
      ...shareTokens.map((tok): [string, Record<string, unknown>] => ["shares.open#" + tok, { token: tok }]),
      // The share video page for Harbor Coffee 30s (through the project share), as a signed-in client.
      ["library.video#" + w.harbor30.v, { videoId: w.harbor30.v, share: { token: shareTokens[0] } }],
      ["notes.forVersion#" + w.harbor30.last, { versionId: w.harbor30.last, share: { token: shareTokens[0] } }],
      ["waveforms.forVersion#" + w.harbor30.last, { versionId: w.harbor30.last, share: { token: shareTokens[0] } }],
      ["transcripts.forVersion#" + w.harbor30.last, { versionId: w.harbor30.last, share: { token: shareTokens[0] } }],
      ["approvals.forVideo#" + w.harbor30.v, { videoId: w.harbor30.v, share: { token: shareTokens[0] } }],
      ["help.list", {}], ["help.guide#paying-an-invoice", { slug: "paying-an-invoice" }], ["projects.mine", {}], ["projects.forClient#" + w.p1, { projectId: w.p1 }], ["shoots.forClientProject#" + w.p1, { projectId: w.p1 }], ["shoots.page#" + shootId, { shootId }], ["fileRequests.forClientProject#" + w.p1, { projectId: w.p1 }], ["fileRequests.page#" + reqIds.a, { requestId: reqIds.a }], ["fileRequests.page#" + reqIds.b, { requestId: reqIds.b }],
      ["briefs.forClientProject#" + w.p1, { projectId: w.p1 }], ["briefs.page#" + briefId, { briefId }],
      ["footage.forClientProject#" + w.p1, { projectId: w.p1 }], ["testimonials.ask#" + askId, { noteId: askId }],
      ["callSheets.forClient#" + prod.C.id, { callSheetId: prod.C.id }], ["callSheets.forClientProject#" + w.p1, { projectId: w.p1 }], ["invoicePay.mine", {}], ...["kitpaidtoken000000001", "kitduetoken0000000002", "kitproctoken000000003"].map((tok): [string, Record<string, unknown>] => ["invoicePay.page#" + tok, { token: tok }])];
    const run = async (as: typeof owner, list: [string, Record<string, unknown>][]) => {
      const out: Record<string, unknown> = {};
      for (const [key, args] of list) {
        const [m, f] = key.split("#")[0].split(".");
        try { out[key] = await as.query((api as never)[m][f], args as never); }
        catch (e) { out[key] = null; console.warn(`kit: ${key} refused: ${(e as Error).message.slice(0, 120)}`); }
      }
      return out;
    };
    const owned = await run(owner, OWNER);
    // The PDFs in convex-test storage can't be fetched by a browser: point them at the kit's sample PDF.
    const pdfs = (v: unknown): unknown => JSON.parse(JSON.stringify(v), (k, x) => ((k === "fileUrl" || k === "finalUrl") && typeof x === "string" ? "/kit-pdf/" : x));
    for (const k of Object.keys(owned)) if (k.startsWith("sign.get#")) owned[k] = pdfs(owned[k]);
    // The call-sheet guest (signed in), and the link's own page for a guest who isn't (guests.intro answers anyone).
    const GUEST: [string, Record<string, unknown>][] = [["users.me", {}], ["business.brand", {}], ["guests.home", {}],
      ...(["A", "C", "P"] as const).map((k): [string, Record<string, unknown>] => ["guests.sheet#" + guest.tokens[k], { token: guest.tokens[k] }])];
    const guestOwn = await run(t.withIdentity({ subject: guest.sub }) as never, GUEST);
    Object.assign(guestOwn, await run(t as never, (["A", "C", "P"] as const).map((k): [string, Record<string, unknown>] => ["guests.intro#" + guest.tokens[k], { token: guest.tokens[k] }])));
    if (!guestOwn["business.brand"]) guestOwn["business.brand"] = owned["business.brand"];
    // An owner with nothing yet: every page that can be asked without a record's id, answered by a business with no records.
    const empty = convexTest(schema, modules);
    const esub = await empty.run(async (ctx) => {
      const A = await ctx.db.insert("businesses", { slug: "wrangler", name: "Wrangler Productions", legalName: "Hill Creative LLC", ownerName: "Heston Hill", createdAt: 0 });
      const heston = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston Hill", role: "owner" });
      await ctx.db.insert("memberships", { businessId: A, email: "heston@wranglerproductions.com", userId: heston, role: "owner", createdAt: 0 });
      return `${heston}|${await ctx.db.insert("authSessions", { userId: heston, expirationTime: now + 30 * DAY })}`;
    });
    const emptyOwn = await run(empty.withIdentity({ subject: esub }) as never, OWNER.filter(([k, a]) => !k.includes("#") && (k === "calendarSync.range" || Object.values(a).every((x) => typeof x === "number" || typeof x === "boolean"))));
    const fixtures = { owner: owned, client: await run(client, CLIENT), guest: guestOwn, empty: emptyOwn, ids: { prod: { sheets: Object.fromEntries(Object.entries({ A: prod.A, B: prod.B, C: prod.C, D: prod.D, E: prod.E, F: prod.F, G: prod.G, P: prod.P }).map(([k, x]) => [k, { id: x.id, buildId: x.buildId }])), guest: guest.tokens, shoots: prod.shoots },  invoices: invIds, shares: shareTokens, harbor: w.harbor, video: w.harbor30.v, docSent: w.d1, docSigned: w.d2, docDraft: w.d3, notes: noteIds, gear: gearIds, calls: callKit, shoot: shootId, project: w.p1, requests: reqIds, brief: briefId } };
    writeFileSync(join(__dirname, "..", "src", "dev", "fixtures.json"), JSON.stringify(fixtures, null, 1));
    vi.useRealTimers();
  });
});
