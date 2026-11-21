// Wrangler Portal, Phase 0.5d step 3 (Oct 28): two businesses. Business B's owner calls every public function with
// business A's record ids (the very same list and arguments as the access matrix). Nothing of A may come back, and
// nothing of A may change. Then the other way round for what B makes.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { argsFor, call, publicFunctions, setup } from "./matrix";
import { BUSINESS_TABLES } from "../convex/lib/tenancy";

const api = anyApi;

beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.DROPBOX_APP_KEY = "test-key";
  process.env.DROPBOX_APP_SECRET = "test-secret";
  process.env.BUNNY_STREAM_LIBRARY_ID = "785477";
  process.env.BUNNY_STREAM_API_KEY = "bunny-test";
  process.env.RESEND_API_KEY = "re_test";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.CONVEX_SITE_URL = "https://handsome-hummingbird-11.convex.site";
});
afterEach(() => vi.unstubAllGlobals());

// Settings that are still one per deployment until step 4 makes them per business (Dropbox connections, Sign's
// profile and archive, connector and Sheet keys). Their functions are checked again in step 4.
const STEP4 = new Set<string>([]);

async function twoBusinesses() {
  const { t, ids } = await setup();
  const extra = await t.run(async (ctx) => {
    const a = (await ctx.db.query("businesses").withIndex("by_slug", (q) => q.eq("slug", "wrangler")).unique())?._id ?? await ctx.db.insert("businesses", { slug: "wrangler", name: "Wrangler Productions", createdAt: 0 });
    await ctx.db.insert("memberships", { businessId: a, email: "heston@wranglerproductions.com", role: "owner", createdAt: 0 });
    const b = await ctx.db.insert("businesses", { slug: "other", name: "Other Films", createdAt: 1 });
    const bOwner = await ctx.db.insert("users", { email: "boss@otherfilms.example", name: "Boss", role: "owner" });
    await ctx.db.insert("memberships", { businessId: b, email: "boss@otherfilms.example", userId: bOwner, role: "owner", createdAt: 1 });
    const bSub = `${bOwner}|${await ctx.db.insert("authSessions", { userId: bOwner, expirationTime: Date.now() + 3_600_000 })}`;
    // 5e review (Nov 6): A's uploaded file is recorded as A's (as attaching it does), so B can neither use nor delete it.
    if (!(await ctx.db.query("fileOwners").withIndex("by_storage", (q) => q.eq("storageId", ids.storageId)).first())) await ctx.db.insert("fileOwners", { storageId: ids.storageId, businessId: a, purpose: "test", at: Date.now() });
    return { a, b, bSub };
  });
  return { t, ids, ...extra };
}

/** Is the file still there, and whose is it? */
const aFile = (t: Awaited<ReturnType<typeof setup>>["t"], id: Id<"_storage">) => t.run(async (ctx) => ({
  alive: !!(await ctx.storage.get(id)),
  owner: (await ctx.db.query("fileOwners").withIndex("by_storage", (q) => q.eq("storageId", id)).first())?.businessId ?? null,
}));

async function snapshot(t: Awaited<ReturnType<typeof setup>>["t"], biz: Id<"businesses">, isDefault: boolean) {
  return t.run(async (ctx) => {
    const out: Record<string, unknown[]> = {};
    for (const table of BUSINESS_TABLES) {
      const rows = (await ctx.db.query(table as never).collect()) as Array<{ businessId?: string }>;
      out[table] = rows.filter((r) => r.businessId === biz || (isDefault && r.businessId === undefined));
    }
    return out;
  });
}

describe("two businesses", () => {
  test("B's owner gets nothing of A from any function, and changes nothing of A", async () => {
    const { t, ids, a, bSub } = await twoBusinesses();
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 })); // nothing external may be reached
    // Nov 21 (EIN re-review): A's EIN, with its Stripe tax ID. Never shown to B, never changed or removed by B.
    // (The matrix's own EIN, 12-3456789, is what B saves for itself, so A's is a different number.)
    await t.run(async (ctx) => { await ctx.db.patch(a, { taxId: { type: "us_ein", value: "77-7000777", stripeId: "txi_A", accountId: "acct_A", updatedAt: 0 } }); });
    const aEin = () => t.run(async (ctx) => JSON.stringify((await ctx.db.get(a))!.taxId));
    const einBefore = await aEin();
    const before = await snapshot(t, a, true);
    const b = t.withIdentity({ subject: bSub });
    const table = argsFor(ids);
    // File ids (Convex storage) aren't business records, so they aren't in the leak list; since the 5e review (Nov 6)
    // each file has an owner (fileOwners), and A's file is checked below: still there, still A's.
    const aIds = Object.entries(ids).filter(([k]) => !/Sub$/.test(k) && k !== "storageId").map(([, v]) => String(v));
    const leaks: string[] = [];
    for (const f of publicFunctions()) {
      if (STEP4.has(f.key)) continue;
      let out: unknown;
      try { out = await call(b, f.ref, table[f.key], ""); } catch { continue; } // refused or failed: nothing returned
      const json = JSON.stringify(out ?? null);
      const hit = aIds.find((id) => json.includes(id)) ?? (json.includes("7000777") ? "EIN" : json.includes("txi_A") ? "Stripe tax ID" : undefined);
      if (hit) leaks.push(`${f.key} returned A's ${hit}`);
    }
    expect(leaks).toEqual([]);
    const after = await snapshot(t, a, true);
    const changed = Object.keys(before).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    expect(changed).toEqual([]);
    expect(await aEin()).toBe(einBefore);
    expect(await aFile(t, ids.storageId)).toEqual({ alive: true, owner: a }); // 5e review: A's stored file is untouched
  });

  test("Phase 5e: a team member of B with every switch on gets nothing of A, and neither B's owner nor B's team changes A's team", async () => {
    const { t, ids, a, b, bSub } = await twoBusinesses();
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 }));
    const { PERMS } = await import("../convex/lib/perms");
    const all = Object.fromEntries(PERMS.map((p) => [p, true]));
    const tSub = await t.run(async (ctx) => {
      const u = await ctx.db.insert("users", { email: "bteam@otherfilms.example", name: "B Team", role: "team", emailVerificationTime: 0 });
      await ctx.db.insert("memberships", { businessId: b, email: "bteam@otherfilms.example", userId: u, role: "team", teamRole: "bookkeeper", perms: all, createdAt: 1 });
      return `${u}|${await ctx.db.insert("authSessions", { userId: u, expirationTime: Date.now() + 3_600_000 })}`;
    });
    const aTeam = () => t.run(async (ctx) => (await ctx.db.query("memberships").collect()).filter((m) => m.businessId === a || m.businessId === undefined).map((m) => JSON.stringify(m)).sort());
    const teamBefore = await aTeam();
    const before = await snapshot(t, a, true);
    const table = argsFor(ids);
    const aIds = Object.entries(ids).filter(([k]) => !/Sub$/.test(k) && k !== "storageId").map(([, v]) => String(v));
    const leaks: string[] = [];
    for (const sub of [tSub, bSub]) {
      const as = t.withIdentity({ subject: sub });
      for (const f of publicFunctions()) {
        if (STEP4.has(f.key)) continue;
        let out: unknown;
        try { out = await call(as, f.ref, table[f.key], ""); } catch { continue; }
        const json = JSON.stringify(out ?? null);
        const hit = aIds.find((id) => json.includes(id));
        if (hit) leaks.push(`${sub === tSub ? "B's team" : "B's owner"}: ${f.key} returned A's ${hit}`);
      }
    }
    expect(leaks).toEqual([]);
    const after = await snapshot(t, a, true);
    expect(Object.keys(before).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))).toEqual([]);
    expect(await aTeam()).toEqual(teamBefore);
    expect(await aFile(t, ids.storageId)).toEqual({ alive: true, owner: a });
  });

  test("a call-sheet guest of B (signed in) gets nothing of A from any function, and changes nothing of A", async () => {
    const { t, ids, a, b } = await twoBusinesses();
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 }));
    const gSub = await t.run(async (ctx) => {
      const p = await ctx.db.insert("projects", { businessId: b, name: "B project", createdAt: 0 });
      const s = await ctx.db.insert("shoots", { businessId: b, projectId: p, date: "2030-01-03", call: "08:00", location: "B", prepare: [], crew: [], status: "scheduled", history: [], createdAt: 0, updatedAt: 0 });
      const cs = await ctx.db.insert("callSheets", { businessId: b, shootId: s, projectId: p, how: "blank", status: "sent", sentAt: 0, updates: 0,
        recipients: [{ id: "guest:b", kind: "guest", name: "Bea", email: "bea@x.example", on: true, sentAt: 1, addedAt: 0 }],
        sent: { title: "B", page: { type: "doc", content: [] }, fields: {}, style: {}, at: 0, round: 0 }, history: [], createdAt: 0, updatedAt: 0 });
      await ctx.db.insert("guestPasses", { businessId: b, callSheetId: cs, personId: "guest:b", email: "bea@x.example", token: "beatokenbeatokenbeatoken", createdAt: 0, sentAt: 1, date: "2030-01-03" });
      const u = await ctx.db.insert("users", { email: "bea@x.example", name: "Bea", role: "guest" });
      return `${u}|${await ctx.db.insert("authSessions", { userId: u, expirationTime: Date.now() + 3_600_000 })}`;
    });
    const guest = t.withIdentity({ subject: gSub });
    expect((await guest.query(api.guests.home, {})).sheets).toHaveLength(1); // B's own sheet, so the caller is a working guest
    const before = await snapshot(t, a, true);
    const table = argsFor(ids);
    const aIds = Object.entries(ids).filter(([k]) => !/Sub$/.test(k) && k !== "storageId").map(([, v]) => String(v));
    const leaks: string[] = [];
    for (const f of publicFunctions()) {
      let out: unknown;
      try { out = await call(guest, f.ref, table[f.key], ""); } catch { continue; }
      const json = JSON.stringify(out ?? null);
      const hit = aIds.find((id) => json.includes(id));
      if (hit) leaks.push(`${f.key} returned A's ${hit}`);
    }
    expect(leaks).toEqual([]);
    const after = await snapshot(t, a, true);
    expect(Object.keys(before).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))).toEqual([]);
  });

  // CLAUDE.md rule 5's open item (Phase 6, Nov 17): vendor logins in the matrix's isolation pass. Vee (a vendor of A, the
  // matrix's vendor caller) and a vendor of B call every public function with the records of V (another vendor of A:
  // V's booking, briefing and invoice) and A's client and money records. Nothing of V or of A's clients comes back to
  // Vee; nothing of A comes back to B's vendor; nothing of A changes, beyond Vee's own vendor row and settings.
  test("Phase 6: a vendor gets nothing of another vendor or of the clients, and a vendor of B nothing of A; nothing changes", async () => {
    const { t, ids, a, b } = await twoBusinesses();
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 }));
    const bvSub = await t.run(async (ctx) => {
      const u = await ctx.db.insert("users", { email: "bv@otherfilms.example", name: "B Vendor", role: "vendor" });
      await ctx.db.insert("memberships", { businessId: b, email: "bv@otherfilms.example", userId: u, role: "vendor", createdAt: 1 });
      await ctx.db.insert("vendors", { businessId: b, name: "B Vendor", email: "bv@otherfilms.example", roles: [], rates: [], createdAt: 1, updatedAt: 1, joinedAt: 1 } as never);
      return `${u}|${await ctx.db.insert("authSessions", { userId: u, expirationTime: Date.now() + 3_600_000 })}`;
    });
    // Review (Nov 17): V carries the details a leak would show without an id (name, email, pay note, address, bank).
    await t.run(async (ctx) => { await ctx.db.patch(ids.vendorId, { name: "Vincent Vendore", payMethod: { method: "zelle", note: "Zelle to vincent-secret" }, address: "77 Hidden Lane", payout: { recipientId: "acct_vsecret", mode: "test", ready: true, payoutMethodId: "pm_vsecret", last4: "9876", bankName: "Secret Bank", checkedAt: 0 } } as never); });
    const vDetails = ["Vincent Vendore", "v@x.example", "vincent-secret", "77 Hidden Lane", "acct_vsecret", "pm_vsecret", "Secret Bank"];
    const mineVee = (r: Record<string, unknown>) => r.email === "vee@x.example";
    const rowsOf = async () => { const s = await snapshot(t, a, true); const m = new Map<string, string>(); for (const [table, rows] of Object.entries(s)) for (const r of rows as Array<Record<string, unknown>>) if (!mineVee(r)) m.set(`${table}:${String(r._id)}`, JSON.stringify(r)); return m; };
    const before = await rowsOf();
    const table = argsFor(ids);
    const theirs = ["vendorId", "bookingId", "briefingId", "vendorInvoiceId", "clientRecId", "personId", "invoiceId", "quoteId", "proposalId", "subscriptionId", "dealId", "estimateId", "entryId", "inboxItemId", "inboxNoteId", "threadId", "deliveryId", "releaseId", "testimonialId", "callId"];
    const vIds = [...theirs.map((k) => String((ids as Record<string, unknown>)[k])).filter((x) => x && x !== "undefined"), ...vDetails];
    const aIds = Object.entries(ids).filter(([k]) => !/Sub$/.test(k) && k !== "storageId").map(([, v]) => String(v));
    const leaks: string[] = [];
    const answered: Record<string, string[]> = {};
    for (const [who, sub, watch] of [["Vee (A's vendor)", ids.vendorSub, vIds], ["B's vendor", bvSub, aIds]] as const) {
      const as = t.withIdentity({ subject: sub });
      answered[who] = [];
      for (const f of publicFunctions()) {
        if (STEP4.has(f.key)) continue;
        let out: unknown;
        try { out = await call(as, f.ref, table[f.key], ""); } catch { continue; }
        if (f.key.startsWith("vendorPortal.")) answered[who].push(f.key);
        const json = JSON.stringify(out ?? null);
        const hit = watch.find((id) => json.includes(id));
        if (hit) leaks.push(`${who}: ${f.key} returned ${hit}`);
      }
    }
    expect(leaks).toEqual([]);
    expect(answered["Vee (A's vendor)"]).toEqual(expect.arrayContaining(["vendorPortal.home", "vendorPortal.bookings", "vendorPortal.invoices"])); // a working vendor, not refused outright
    const after = await rowsOf();
    const changed = [...before.keys()].filter((k) => before.get(k) !== after.get(k));
    expect(changed).toEqual([]);
    expect(await aFile(t, ids.storageId)).toEqual({ alive: true, owner: a });
  });

  test("each owner sees only their own projects; B's records are stamped with B", async () => {
    const { t, ids, b, bSub } = await twoBusinesses();
    const heston = t.withIdentity({ subject: ids.ownerSub });
    const boss = t.withIdentity({ subject: bSub });
    const bProject = await boss.mutation(api.library.createProject, { name: "Other Films Project" });
    const bRow = await t.run(async (ctx) => ctx.db.get(bProject as Id<"projects">));
    expect(bRow?.businessId).toBe(b);
    const names = (o: { projects?: Array<{ name: string }> }) => (o.projects ?? []).map((p) => p.name);
    expect(names(await boss.query(api.library.overview, {}))).toEqual(["Other Films Project"]);
    expect(names(await heston.query(api.library.overview, {}))).not.toContain("Other Films Project");
    // A's owner can't open, rename or delete B's project either.
    await expect(heston.mutation(api.library.renameProject, { projectId: bProject, name: "x" })).rejects.toThrow();
    expect((await t.run(async (ctx) => ctx.db.get(bProject as Id<"projects">)))?.name).toBe("Other Films Project");
  });

  test("a guest on A's share link sees A's video; B's owner on it sees nothing", async () => {
    const { t, bSub } = await twoBusinesses();
    const guest = await t.query(api.shares.open, { token: "tok" });
    expect(JSON.stringify(guest)).toContain('"title":"V"');
    const asB = await t.withIdentity({ subject: bSub }).query(api.shares.open, { token: "tok" });
    expect(JSON.stringify(asB)).not.toContain('"title":"V"');
  });

  // Phase 8b (CLAUDE.md rule 5): B's Claude connector key runs every site action with A's record ids, the way B's
  // owner's own pages would: nothing of A comes back, and nothing of A changes (asks are tried and undone, and the
  // request they make is B's).
  test("Phase 8b: B's connector key gets nothing of A from any site action, and changes nothing of A", async () => {
    const { t, ids, a, bSub } = await twoBusinesses();
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 }));
    const { ACTIONS } = await import("../convex/lib/siteActions");
    const key = (await t.withIdentity({ subject: bSub }).action(api.portalKeys.createKey, {})).key as string;
    const before = await snapshot(t, a, true);
    const table = argsFor(ids);
    const aIds = Object.entries(ids).filter(([k]) => !/Sub$/.test(k) && k !== "storageId").map(([, v]) => String(v));
    const leaks: string[] = [];
    for (const [name, e] of Object.entries(ACTIONS)) {
      const tool = e.mode === "read" ? "site_read" : e.mode === "change" ? "site_change" : "site_ask";
      const args = { action: name, args: table[name] ?? {}, ...(tool === "site_ask" ? { heston_ok: "yes, go ahead" } : {}) };
      const r = await t.fetch("/portal-mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }) });
      const json = await r.text();
      const hit = aIds.find((id) => json.includes(id) && !JSON.stringify(args).includes(id)); // A's ids it was handed don't count
      if (hit) leaks.push(`${name} returned A's ${hit}`);
    }
    expect(leaks).toEqual([]);
    const after = await snapshot(t, a, true);
    expect(Object.keys(before).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))).toEqual([]);
    expect(await aFile(t, ids.storageId)).toEqual({ alive: true, owner: a });
  });

  // Phase 8f (review M2, CLAUDE.md rule 5): the Review and Sign tools are reachable only through the one connector now.
  // B's key calls every one of them with A's record ids and names: nothing of A comes back, and nothing of A changes.
  test("Phase 8f: B's connector key gets nothing of A from any Review or Sign tool, and changes nothing of A", async () => {
    const { t, ids, a, bSub } = await twoBusinesses();
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 }));
    const { TOOLS: REVIEW_TOOLS } = await import("../convex/mcp");
    const { TOOLS: SIGN_TOOLS } = await import("../convex/wsMcp");
    // A's document finished, so get_signed_pdf, verify_pdf and import_pdf have something real to find.
    await t.run(async (ctx) => { await ctx.db.patch(ids.docId as never, { status: "completed", sentVersion: 1, completedAt: 1, final: { fileId: ids.storageId, fileName: "A-signed.pdf", sha256: "a".repeat(64), bytes: 1, at: 1 } } as never); });
    const key = (await t.withIdentity({ subject: bSub }).action(api.portalKeys.createKey, {})).key as string;
    const before = await snapshot(t, a, true);
    const I = ids as unknown as Record<string, string>;
    const ok = "Heston said: yes, go ahead";
    const calls: Array<[string, Record<string, unknown>]> = [
      ["find_videos", {}], ["find_videos", { query: "V" }],
      ["get_notes", { video_id: I.videoId, status: "all" }], ["get_notes", { video: "V", status: "all" }],
      ["get_note_images", { note_ids: [I.noteId] }], ["get_resolve_markers", { video_id: I.videoId, status: "all" }],
      ["get_transcript", { video_id: I.videoId }], ["reply_to_note", { note_id: I.noteId, text: "x" }],
      ["mark_notes", { note_ids: [I.noteId], status: "done" }], ["register_video", { title: "X", project: "P" }],
      ["add_to_register", { video_id: I.videoId, short_title: "X" }], ["next_render_name", { video_id: I.videoId }],
      ["set_version_description", { video_id: I.videoId, description: "x", heston_ok: ok }],
      ["get_client_inbox", { client: "Harbor" }], ["list_follow_ups", {}], ["draft_follow_up", { who: "A", about: "B", due: "2030-01-01", company: "Harbor" }],
      ["draft_ledger_entry", { project: "P", kind: "hours", hours: 1, date: "2030-01-01" }],
      ["draft_client_note", { client: "Harbor", title: "t", text: "x", said: ok }],
      ["list_documents", { status: "all" }], ["get_document", { document: I.docId }], ["get_document", { document: "WS-00001" }], ["get_document", { document: "D" }],
      ["create_document", { title: "B's own", pdf_base64: "JVBERi0=", signers: [{ name: "Q", email: "q@b.example" }] }],
      ["update_document", { document: I.docId, title: "x" }], ["preview_document", { document: I.docId }],
      ["approve_document", { document: I.docId, heston_ok: ok }], ["send_document", { document: I.docId, heston_ok: ok }], ["void_document", { document: I.docId, heston_ok: ok }],
      ["send_reminder", { document: I.docId, signer: "client", heston_ok: ok }], ["get_audit_trail", { document: I.docId }], ["get_signed_pdf", { document: I.docId }],
      ["list_templates", {}], ["get_template", { template: I.templateId }], ["list_drafts", {}], ["create_draft", { template: I.templateId }],
      ["get_draft", { draft: I.buildId }], ["update_draft", { draft: I.buildId, title: "x" }], ["import_pdf", { document: I.docId }],
      ["draft_to_signing", { draft: I.buildId }], ["save_draft_as_template", { draft: I.buildId, name: "x" }],
      ["list_proposals", {}], ["get_proposal", { proposal: I.proposalId }], ["get_proposal", { proposal: "X-P-0001" }],
      ["write_proposal_draft", { proposal: I.proposalId, markdown: "# x" }], ["verify_pdf", { sha256: "a".repeat(64) }],
      ["send_client_note", { note_id: I.inboxNoteId, heston_ok: ok }], ["request_status", { request_id: I.pendingId }],
    ];
    // Every Review and Sign tool is in the sweep, so a new one can't slip past it.
    const covered = new Set(calls.map(([n]) => n));
    expect([...REVIEW_TOOLS, ...SIGN_TOOLS].map((x) => x.name).filter((n) => !covered.has(n))).toEqual([]);
    const aIds = Object.entries(ids).filter(([k]) => !/Sub$/.test(k) && k !== "storageId").map(([, v]) => String(v));
    const leaks: string[] = [];
    for (const [name, args] of calls) {
      const r = await t.fetch("/portal-mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
      const txt = await r.text();
      if (r.status !== 200 || !/"result"/.test(txt)) leaks.push(`${name} never got through (HTTP ${r.status}): the sweep would prove nothing`);
      const hit = aIds.find((id) => txt.includes(id) && !JSON.stringify(args).includes(id));
      if (hit) leaks.push(`${name} returned A's ${hit}`);
      for (const word of ["A-signed.pdf", "\"title\":\"D\"", "Harbor", "a.mp4", "X-P-0001"]) {
        if (txt.includes(word) && !JSON.stringify(args).includes(word.replace(/"/g, ""))) leaks.push(`${name} mentions ${word}`);
      }
    }
    expect(leaks).toEqual([]);
    const after = await snapshot(t, a, true);
    expect(Object.keys(before).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))).toEqual([]);
    expect(await aFile(t, ids.storageId)).toEqual({ alive: true, owner: a });
  });
});
