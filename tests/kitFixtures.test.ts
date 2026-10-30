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
      return { A, harbor, heston, maya, p1, harbor30, d1, d2, d3, hestonSub: await sess(heston), mayaSub: await sess(maya) };
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
    const noteIds = await t.run(async (ctx) => (await ctx.db.query("inboxNotes").collect()).map((n) => n._id));
    const OWNER: [string, Record<string, unknown>][] = [
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
      ["projects.page#" + w.p1, { projectId: w.p1 }], ["projects.nextRound#" + w.harbor30.v, { videoId: w.harbor30.v }],
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
      ["projects.mine", {}], ["projects.forClient#" + w.p1, { projectId: w.p1 }]];
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
    const fixtures = { owner: owned, client: await run(client, CLIENT), ids: { shares: shareTokens, harbor: w.harbor, video: w.harbor30.v, docSent: w.d1, docSigned: w.d2, docDraft: w.d3, notes: noteIds } };
    writeFileSync(join(__dirname, "..", "src", "dev", "fixtures.json"), JSON.stringify(fixtures, null, 1));
    vi.useRealTimers();
  });
});
