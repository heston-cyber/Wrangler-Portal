// Wrangler Portal Phase 1 (Oct 29): the Inbox, its hooks, the client's Documents, a client's people, Business
// settings and the connector's draft notes. Two businesses: A (Wrangler, the default) and B.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";

const api = anyApi;
const internal = anyApi;
const modules = import.meta.glob("../convex/**/*.ts");

beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.RESEND_API_KEY = "re_test";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.CONVEX_SITE_URL = "https://x.convex.site";
  process.env.BUNNY_STREAM_LIBRARY_ID = "785477";
  process.env.BUNNY_STREAM_API_KEY = "bunny-test";
});
afterEach(() => vi.unstubAllGlobals());

async function world() {
  const t = convexTest(schema, modules);
  const w = await t.run(async (ctx) => {
    const sess = async (userId: Id<"users">) => `${userId}|${await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 })}`;
    const A = await ctx.db.insert("businesses", { slug: "wrangler", name: "Wrangler Productions", createdAt: 0 });
    const B = await ctx.db.insert("businesses", { slug: "other", name: "Other Films", createdAt: 1 });
    const heston = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston", role: "owner" });
    await ctx.db.insert("memberships", { businessId: A, email: "heston@wranglerproductions.com", userId: heston, role: "owner", createdAt: 0 });
    const boss = await ctx.db.insert("users", { email: "boss@other.example", name: "Boss", role: "owner" });
    await ctx.db.insert("memberships", { businessId: B, email: "boss@other.example", userId: boss, role: "owner", createdAt: 1 });
    // A's client Harbor Coffee: Maya (account), Jordan (invited, no account), Sam (not invited).
    const harbor = await ctx.db.insert("clients", { businessId: A, name: "Harbor Coffee", createdAt: 0 });
    const maya = await ctx.db.insert("users", { email: "maya@harbor.example", name: "Maya Brooks", role: "client" });
    await ctx.db.insert("memberships", { businessId: A, email: "maya@harbor.example", userId: maya, role: "client", createdAt: 0 });
    await ctx.db.insert("invites", { businessId: A, email: "maya@harbor.example", createdAt: 0, acceptedAt: 1, userId: maya });
    await ctx.db.insert("invites", { businessId: A, email: "jordan@harbor.example", createdAt: 5 });
    for (const [email, role] of [["maya@harbor.example", "signer"], ["jordan@harbor.example", "contact"], ["sam@harbor.example", "contact"]] as const)
      await ctx.db.insert("clientPeople", { businessId: A, clientId: harbor, email, role, createdAt: 0 });
    // B's client, with its own person who has an account.
    const bClient = await ctx.db.insert("clients", { businessId: B, name: "Juniper", createdAt: 0 });
    const bob = await ctx.db.insert("users", { email: "bob@juniper.example", name: "Bob", role: "client" });
    await ctx.db.insert("memberships", { businessId: B, email: "bob@juniper.example", userId: bob, role: "client", createdAt: 0 });
    await ctx.db.insert("invites", { businessId: B, email: "bob@juniper.example", createdAt: 0, acceptedAt: 1, userId: bob });
    await ctx.db.insert("clientPeople", { businessId: B, clientId: bClient, email: "bob@juniper.example", role: "signer", createdAt: 0 });
    // A's project and video for Harbor Coffee.
    const p = await ctx.db.insert("projects", { businessId: A, name: "Launch", client: "Harbor Coffee", clientId: harbor, createdAt: 0 });
    const vid = await ctx.db.insert("videos", { businessId: A, projectId: p, title: "Harbor 30s", createdAt: 0, updatedAt: 0 });
    const ver = await ctx.db.insert("versions", { businessId: A, videoId: vid, number: 2, status: "ready", bunnyGuid: "g", fileName: "x.mp4", startTimecode: "01:00:00:00", createdAt: 0 } as never);
    return { A, B, harbor, bClient, maya, bob, p, vid, ver, hestonSub: await sess(heston), bossSub: await sess(boss), mayaSub: await sess(maya), bobSub: await sess(bob) };
  });
  return { t, ...w, heston: t.withIdentity({ subject: w.hestonSub }), boss: t.withIdentity({ subject: w.bossSub }), mayaC: t.withIdentity({ subject: w.mayaSub }), bobC: t.withIdentity({ subject: w.bobSub }) };
}

describe("owner notes", () => {
  test("a note goes only to people with portal access, once; read status is per person; the Sent list counts it", async () => {
    const w = await world();
    const who = await w.heston.query(api.inbox.noteRecipients, { clientId: w.harbor });
    expect(who.map((p: { email: string; access: boolean }) => [p.email, p.access])).toEqual([["maya@harbor.example", true], ["jordan@harbor.example", true], ["sam@harbor.example", false]]);
    const noteId = await w.heston.mutation(api.inbox.saveNote, { clientId: w.harbor, title: "Shoot moved to Friday", text: "Same time, same place." });
    // A draft reaches nobody.
    expect((await w.mayaC.query(api.inbox.mine, {})).items).toEqual([]);
    expect(await w.heston.mutation(api.inbox.sendNote, { noteId })).toEqual({ sent: 2 });
    await expect(w.heston.mutation(api.inbox.sendNote, { noteId })).rejects.toThrow(/already sent/);
    const mine = await w.mayaC.query(api.inbox.mine, {});
    expect(mine.unread).toBe(1);
    expect(mine.items[0]).toMatchObject({ kind: "note", title: "Shoot moved to Friday", read: false });
    await w.mayaC.mutation(api.inbox.markRead, { itemId: mine.items[0]._id });
    expect(await w.mayaC.query(api.inbox.unreadCount, {})).toBe(0);
    const sent = await w.heston.query(api.inbox.notes, {});
    expect(sent[0]).toMatchObject({ status: "sent", recipients: 2, readBy: 1 });
    const theirs = await w.heston.query(api.inbox.forClient, { clientId: w.harbor });
    expect(theirs[0]).toMatchObject({ sentTo: 2, readBy: 1 });
    const detail = await w.heston.query(api.inbox.noteDetail, { noteId });
    expect(detail.people.map((p: { email: string; readAt: number | null }) => [p.email, !!p.readAt])).toEqual([["jordan@harbor.example", false], ["maya@harbor.example", true]]);
    expect(await w.boss.query(api.inbox.noteDetail, { noteId })).toBeNull();
    // Sam (not invited) has nothing.
    const sam = await w.t.run(async (ctx) => (await ctx.db.query("inboxItems").collect()).filter((i) => i.email === "sam@harbor.example").length);
    expect(sam).toBe(0);
  });

  test("a client can't read or mark another person's item; B sees none of A's Inbox", async () => {
    const w = await world();
    const noteId = await w.heston.mutation(api.inbox.saveNote, { clientId: w.harbor, title: "Hi", text: "" });
    await w.heston.mutation(api.inbox.sendNote, { noteId });
    const item = (await w.mayaC.query(api.inbox.mine, {})).items[0];
    await expect(w.bobC.mutation(api.inbox.markRead, { itemId: item._id })).rejects.toThrow(/Not allowed/);
    expect((await w.bobC.query(api.inbox.mine, {})).items).toEqual([]);
    expect(await w.boss.query(api.inbox.forClient, { clientId: w.harbor })).toEqual([]);
    expect(await w.boss.query(api.inbox.notes, {})).toEqual([]);
    await expect(w.boss.mutation(api.inbox.sendNote, { noteId })).rejects.toThrow();
    await expect(w.boss.mutation(api.inbox.saveNote, { clientId: w.harbor, title: "x", text: "" })).rejects.toThrow();
  });

  test("a link must be a portal page or https; a client with no one invited can't be sent a note", async () => {
    const w = await world();
    await expect(w.heston.mutation(api.inbox.saveNote, { clientId: w.harbor, title: "x", text: "", link: "javascript:alert(1)" })).rejects.toThrow(/link/);
    await expect(w.heston.mutation(api.inbox.saveNote, { clientId: w.harbor, title: "x", text: "", link: "//evil.example" })).rejects.toThrow(/link/);
    const solo = await w.t.run(async (ctx) => ctx.db.insert("clients", { businessId: w.A, name: "Nobody Co", createdAt: 0 }));
    const n = await w.heston.mutation(api.inbox.saveNote, { clientId: solo, title: "x", text: "" });
    await expect(w.heston.mutation(api.inbox.sendNote, { noteId: n })).rejects.toThrow(/portal access/);
  });

  test("T1.7: a note Claude drafts does nothing until the owner sends it", async () => {
    const w = await world();
    const found = await w.t.query(internal.inbox.findClient, { name: "harbor coffee", asBusiness: w.A });
    expect(found).toMatchObject({ clientId: w.harbor });
    const { noteId } = await w.t.mutation(internal.inbox.draftNoteAs, { clientId: w.harbor, title: "Cut is up", text: "v2 is ready.", said: "tell Harbor the cut is up", asBusiness: w.A });
    expect((await w.mayaC.query(api.inbox.mine, {})).items).toEqual([]);
    const sent = await w.heston.query(api.inbox.notes, {});
    expect(sent[0]).toMatchObject({ status: "draft", draftedBy: "claude", said: "tell Harbor the cut is up" });
    await w.heston.mutation(api.inbox.sendNote, { noteId });
    expect((await w.mayaC.query(api.inbox.mine, {})).items).toHaveLength(1);
    // The connector acting for B can't find or draft for A's client.
    expect(await w.t.query(internal.inbox.findClient, { name: "Harbor Coffee", asBusiness: w.B })).toMatchObject({ error: expect.any(String) });
    await expect(w.t.mutation(internal.inbox.draftNoteAs, { clientId: w.harbor, title: "x", text: "", said: "x", asBusiness: w.B })).rejects.toThrow();
  });
});

describe("hooks", () => {
  test("T1.1/T1.2: a new cut posts once to invited share members; a link-only share posts nothing", async () => {
    const w = await world();
    const inv = await w.heston.mutation(api.shares.create, { target: { kind: "client", client: "Harbor Coffee" }, access: "comment", who: "invited", allVersions: true, downloads: false, emailNewVersions: false, emails: [] });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "x" }), { status: 200 })));
    await w.heston.mutation(api.shares.addMember, { shareId: inv.shareId, email: "maya@harbor.example" });
    await w.heston.mutation(api.shares.create, { target: { kind: "video", videoId: w.vid }, access: "view", who: "link", allVersions: true, downloads: false, emailNewVersions: false });
    expect(await w.t.mutation(internal.inbox.onVersionReady, { versionId: w.ver })).toBe(1);
    expect(await w.t.mutation(internal.inbox.onVersionReady, { versionId: w.ver })).toBe(0); // twice: still once
    const items = await w.t.run(async (ctx) => ctx.db.query("inboxItems").collect());
    expect(items.map((i) => [i.email, i.kind, i.businessId === w.A, i.clientId === w.harbor])).toEqual([["maya@harbor.example", "cut_ready", true, true]]);
    expect(items[0].link).toMatch(new RegExp(`^/s/${inv.token}/v/${w.vid}\\?version=2$`));
  });

  test("Sign: to sign, cancelled and signed post to an invited signer; an uninvited signer gets none", async () => {
    const w = await world();
    const ids = await w.t.run(async (ctx) => {
      const doc = await ctx.db.insert("wsDocuments", { businessId: w.A, number: 7, title: "Service Agreement", status: "sent", currentVersion: 1, sentVersion: 1, sentAt: 10, createdAt: 0, updatedAt: 0 });
      const mk = (email: string, key: string) => ctx.db.insert("wsSignings", { businessId: w.A, documentId: doc, versionNumber: 1, signerKey: key, name: email, email, order: 1, token: `tok-${key}`, status: "sent" } as never);
      return { doc, maya: await mk("maya@harbor.example", "client"), stranger: await mk("someone@else.example", "client2") };
    });
    expect(await w.t.mutation(internal.inbox.onSignInvite, { signingId: ids.maya, kind: "invite" })).toBe(1);
    expect(await w.t.mutation(internal.inbox.onSignInvite, { signingId: ids.maya, kind: "reminder" })).toBe(0);
    expect(await w.t.mutation(internal.inbox.onSignInvite, { signingId: ids.stranger, kind: "invite" })).toBe(0);
    const toSign = (await w.mayaC.query(api.inbox.mine, {})).items[0];
    expect(toSign).toMatchObject({ kind: "to_sign", title: "Please sign: Service Agreement" });
    expect(toSign.link).toMatch(/\/tok-client$/);
    // Documents: it's in To sign, with the signing link.
    const docs = await w.mayaC.query(api.documents.mine, {});
    expect(docs.toSign.map((d: { label: string; signUrl: string | null }) => [d.label, !!d.signUrl])).toEqual([["WS-00007", true]]);
    // Signed by everyone: "signed" posts, and Documents moves it.
    await w.t.run(async (ctx) => {
      const f = await ctx.storage.store(new Blob(["%PDF"], { type: "application/pdf" }));
      await ctx.db.patch(ids.doc, { status: "completed", completedAt: 20, final: { fileId: f, sha256: "0", bytes: 4, fileName: "s.pdf", at: 20 } });
      await ctx.db.patch(ids.maya, { status: "signed", signedAt: 19 } as never);
    });
    expect(await w.t.mutation(internal.inbox.onSigned, { documentId: ids.doc })).toBe(1);
    const after = await w.mayaC.query(api.documents.mine, {});
    expect(after.signed).toHaveLength(1);
    expect(after.signed[0].hasCopy).toBe(true);
    expect((await w.mayaC.query(api.documents.signedCopy, { documentId: ids.doc })).fileName).toBe("s.pdf");
    await expect(w.bobC.query(api.documents.signedCopy, { documentId: ids.doc })).rejects.toThrow();
  });
});

describe("a client's people, the client page, settings", () => {
  test("people show access from their invite; inviting makes the invite; B can't touch A's client", async () => {
    const w = await world();
    const people = await w.heston.query(api.clients.people, { clientId: w.harbor });
    expect(people.map((p: { email: string; access: { state: string } }) => [p.email, p.access.state])).toEqual([["maya@harbor.example", "active"], ["jordan@harbor.example", "invited"], ["sam@harbor.example", "none"]]);
    const sam = people[2]._id;
    expect(await w.heston.mutation(api.clients.invitePerson, { personId: sam })).toMatchObject({ already: false });
    expect((await w.heston.query(api.clients.people, { clientId: w.harbor }))[2].access.state).toBe("invited");
    await expect(w.heston.mutation(api.clients.addPerson, { clientId: w.harbor, email: "maya@harbor.example", role: "contact" })).rejects.toThrow(/already/);
    expect(await w.boss.query(api.clients.people, { clientId: w.harbor })).toEqual([]);
    await expect(w.boss.mutation(api.clients.addPerson, { clientId: w.harbor, email: "x@y.example", role: "contact" })).rejects.toThrow();
    await expect(w.boss.mutation(api.clients.removePerson, { personId: sam })).resolves.toBeNull(); // invisible to B: nothing happens
    expect((await w.heston.query(api.clients.people, { clientId: w.harbor })).length).toBe(3);
    // "{n} to sign · {n} to review": Harbor's one cut hasn't been watched by anyone outside the business.
    const dir = await w.heston.query(api.clients.directory, {});
    expect(dir.find((c: { name: string }) => c.name === "Harbor Coffee")).toMatchObject({ toSign: 0, toReview: 1, people: 3, active: 1 });
    expect((await w.boss.query(api.clients.directory, {})).map((c: { name: string }) => c.name)).toEqual(["Juniper"]);
    const page = await w.heston.query(api.clients.page, { clientId: w.harbor });
    expect(page.projects).toHaveLength(1);
    expect(await w.boss.query(api.clients.page, { clientId: w.harbor })).toBeNull();
  });

  test("Business settings change only the owner's own business, and the client side gets its look", async () => {
    const w = await world();
    await w.boss.mutation(api.business.updateSettings, { name: "Juniper & Ash", accent: "#7a9e7e", emailFromName: "Juniper & Ash" });
    const a = await w.heston.query(api.business.settings, {});
    expect(a.name).toBe("Wrangler Productions");
    expect(a.accent).toBeNull();
    expect((await w.boss.query(api.business.settings, {})).accent).toBe("#7A9E7E");
    await expect(w.boss.mutation(api.business.updateSettings, { accent: "red" })).rejects.toThrow(/#A1B2C3/);
    await expect(w.boss.mutation(api.business.updateSettings, { name: "  " })).rejects.toThrow(/empty/);
    expect((await w.bobC.query(api.business.brand, {})).map((b: { name: string }) => b.name)).toEqual(["Juniper & Ash"]);
    expect((await w.mayaC.query(api.business.brand, {})).map((b: { name: string }) => b.name)).toEqual(["Wrangler Productions"]);
  });

  test("The dark and light logos are kept apart, and clearing one deletes only its file", async () => {
    const w = await world();
    // convex-test's storage has no content type, so the files are attached directly; setLogo's type check is the live one.
    const [dark, light] = await w.t.run(async (ctx) => {
      const d = await ctx.storage.store(new Blob([new Uint8Array([1])], { type: "image/png" }));
      const l = await ctx.storage.store(new Blob([new Uint8Array([2])], { type: "image/png" }));
      await ctx.db.patch(w.A, { logoFileId: d, logoLightFileId: l });
      return [d, l];
    });
    let s = await w.heston.query(api.business.settings, {});
    expect(s.logoUrl).toBeTruthy(); expect(s.logoLightUrl).toBeTruthy();
    await w.heston.mutation(api.business.setLogo, { storageId: null, which: "light" });
    s = await w.heston.query(api.business.settings, {});
    expect(s.logoUrl).toBeTruthy(); expect(s.logoLightUrl).toBeNull();
    expect(await w.t.run(async (ctx) => [await ctx.storage.getUrl(dark), await ctx.storage.getUrl(light)])).toEqual([expect.any(String), null]);
  });
});
