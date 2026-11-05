// Client side C1 (Oct 23): the access matrix. Every public function the site has is called as nobody, as a
// stranger with an account, and as an invited client. All of them must be refused, except the few that are meant
// to answer (listed in OPEN / SIGNED_IN below). The list of functions is read from the generated API, so a new
// function can't slip through without being classified here.
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const modules = import.meta.glob("../convex/**/*.ts");

beforeAll(async () => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.DROPBOX_APP_KEY = "test-key";
  process.env.DROPBOX_APP_SECRET = "test-secret";
  process.env.BUNNY_STREAM_LIBRARY_ID = "785477";
  process.env.BUNNY_STREAM_API_KEY = "bunny-test";
  process.env.RESEND_API_KEY = "re_test";
  process.env.SITE_URL = "https://review.wranglerportal.com";
  process.env.CONVEX_SITE_URL = "https://handsome-hummingbird-11.convex.site";
  // Convex Auth mints a JWT once a code is accepted; a throwaway RSA pair made here, never a real key.
  const { generateKeyPairSync } = await import("node:crypto");
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.JWT_PRIVATE_KEY = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const jwk = pair.publicKey.export({ format: "jwk" });
  process.env.JWKS = JSON.stringify({ keys: [{ use: "sig", alg: "RS256", ...jwk }] });
});
afterEach(() => vi.unstubAllGlobals());

// Functions anyone may call, and why.
const OPEN: Record<string, string> = {
  "users.me": "returns the caller's own identity, or null",
  "phase0.saveRun": "lab test log: append-only, capped, holds no client data",
  "shares.open": "a share link: answers by the share's own gate (off/expired/passcode/invited), tested in shares.test.ts",
  "shares.touch": "records an open on a share link: same gate; a missing token records nothing",
  "shares.unlock": "the passcode box on a share link: rate-limited; a missing token answers 'missing'",
  "clients.canSignUp": "the sign-up page's pre-check: says only whether an email is invited",
  "prefs.mine": "the owner's display settings: the video page asks whoever is looking; anyone but the owner gets {}",
  // Phase 2 Part B step 3: the invoice link (/i/<token>) from email 08 works without an account, like a share link.
  "invoicePay.page": "an invoice link: answers only for a sent invoice's own long random token (tested in invoicePay.test.ts)",
  "invoicePay.markViewed": "the same link: records the first view of that invoice only; a missing token does nothing",
  "quotes.page": "a quote link (Phase 3b, D81): answers only for a sent quote's own long random token (tested in crm.test.ts)",
  "quotes.markViewed": "the same link: records the first view of that quote only; a missing token does nothing",
  "proposals.page": "a proposal link (Phase 3b, D73): answers only for a sent proposal's own long random token (tested in proposals.test.ts)",
  "proposals.markViewed": "the same link: records the first view of that proposal only; a missing token does nothing",
  "invoicePay.start": "Pay on the same link: returns Stripe's payment secret for that invoice only; a missing token is refused",
  "invoicePay.refresh": "the same link: re-reads that invoice from Stripe; a missing token does nothing",
  "invoicePay.mine": "a client's invoices, found by their own email; anyone else gets []",
  // Phase 2b: the subscription link (/sub/<token>) from email 13 works without an account, like the invoice link.
  "subscriptions.page": "a subscription link: answers only for that subscription's own long random token (tested in subscriptions.test.ts)",
  "subscriptions.setupStart": "the same link: a SetupIntent for that subscription's customer only; a missing token is refused",
  "subscriptions.setupDone": "the same link: checks the SetupIntent is that subscription's own before using it; a missing token is refused",
  "subscriptions.mine": "a client's subscriptions, found by their own email; anyone else gets []",
  // Phase 5d step 2: Messages. A lead's conversation answers only for that thread's own long random token (/m/<token>).
  "messages.leadPage": "a lead's message link: that conversation only (tested in messages.test.ts)",
  "messages.leadSend": "the same link: writes in that conversation only; rate-limited",
  "messages.leadRead": "the same link: marks that conversation read; a missing token does nothing",
  "messages.leadUploadUrl": "the same link: an upload address for a file to attach there; rate-limited",
  "messages.unread": "the caller's own unread count (owner or client); 0 for anyone else",
  // Phase 5d step 1: booking calls. The page answers by the business's slug (closed unless Google Calendar is connected
  // and the settings are saved); the private link (/call/<token>) only for that call's own long random token. Booking,
  // moving and cancelling are rate-limited. Tested in calls.test.ts.
  "calls.page": "the booking page /book/<slug>: the business's name and open times only, or closed",
  "calls.refresh": "the same page: asks for busy times to be read again; at most once a minute, rate-limited",
  "calls.book": "the same page: books an open time; checked again with Google; rate-limited, with a hidden field for robots",
  "calls.manage": "a call's own private link: that call only",
  "calls.cancel": "the same link: cancels that call only; rate-limited",
  "calls.reschedule": "the same link: moves that call to an open time only; rate-limited",
  "calls.verify": "the same link: the 6-digit code emailed to the lead; five wrong tries and the pick is let go; rate-limited",
  "calls.resendCode": "the same link: a new code to the email given; three an hour, shared with the lead's pick limit",
  "calls.release": "the same link: lets go of that pick while it waits for its code; rate-limited",
  // D147 (Nov 4): a briefing's no-login link (/b/<token>, email 58). Tested in briefingsShare.test.ts.
  "briefings.page": "a briefing link: answers only for a shared briefing's own long random token (a person's own, or the copied link); a turned-off link answers Withdrawn with the business and title only",
  "briefings.opened": "the same link: counts an open of that briefing only; a missing token, a draft or a turned-off link does nothing; rate-limited",
  "briefings.markRead": "the same link: records \"I've read it\" for that briefing only (named only on a person's own link); a missing token is refused; rate-limited",
  "siteWatch.summary": "Phase 5c: open and urgent counts for the portal's admins (ALLOWED_EMAILS); null for anyone else, tested in siteWatch.test.ts",
  // Phase 5b step 4 (D127): a call-sheet guest's link (/guest/<token>, email 41), signed out.
  "guests.intro": "a guest's link: answers only for that pass's own long random token, with the sheet's title, day, the guest's first name and a masked email; tested in callSheetGuests.test.ts",
  "guests.sendCode": "the same link's \"Email me a code\": emails a code to the pass's own address only (never shown), rate-limited; a missing token is refused",
  // Phase 5e step 1: the Join page (/team/join/<token>, email 46).
  "team.joinPage": "a team invite's link: answers only for that invite's own long random token (its hash is stored), with the business, role, inviter and the invited email; tested in team.test.ts",
};
// Functions with their own gate (a key in the arguments): refused with the wrong key, whoever calls.
const KEYED = new Set(["r1results.report"]);
// Phase 5b step 4 (D127): the only functions a call-sheet guest's login may call, and why. Each finds the guest's own pass
// by its token and re-checks the sheet on every call (lib/guests.ts); tested in callSheetGuests.test.ts.
const GUEST: Record<string, string> = {
  "guests.home": "the guest's own call sheets (passes found by their own email), one business at a time: active ones, and ended ones that went to them (title and day only); the switcher's businesses and their unopened counts from their own passes",
  "guests.sheet": "one of the guest's own sheets by its link token: the sent copy while active, else Access ended (title and day only)",
  "guests.opened": "records the guest opening their own sheet, only while it's active",
};
// Functions any signed-in account may call (owner or client), never a stranger.
const SIGNED_IN = new Set(["help.list", "help.guide", "messages.mine", "messages.clientThreadPage", "messages.clientSend", "messages.read", /* messages.uploadUrl: only a client who can open a project (the matrix client can't; messages.test.ts) */ "users.setName", "users.switchSide", "clients.account", "shares.mine",
  // Phase 1: a client's own Inbox, Documents and their businesses' look
  "inbox.mine", "inbox.unreadCount", "inbox.markRead", "inbox.markAllRead", "documents.mine", "business.brand",
  "portal.waiting", "emails.myPrefs", "emails.setMine",
  // Nov 2: a client's Settings › Notifications (their own address only)
  "notifications.client", "notifications.setClient",
  // Phase 4: a client's shoots (only on projects they can open)
  "shoots.forClientProject", "shoots.page", "shoots.confirm",
  "fileRequests.forClientProject", "fileRequests.page", "fileRequests.start", "fileRequests.finishDirect",
  "briefs.forClientProject", "briefs.page", "briefs.save", "briefs.submit",
  // Phase 2 Part A: a client's projects (only those their share invites cover) and the final files' links (only once open)
  "projects.mine", "projects.forClient", "projects.deliveryLink",
  // Phase 5: a client's raw footage offer (only on projects they can open) and the testimonial form (only from a request they got)
  "footage.forClientProject", "footage.keep", "footage.decline", "testimonials.ask", "testimonials.send",
  // Phase 5b step 3: a call sheet sent to them (only one sent to them, on a project they can open; tested in callSheets.test.ts)
  "callSheets.forClient", "callSheets.forClientProject", "callSheets.opened"]);
// D133 (Phase 5): functions a vendor login may call: their own side of the portal (each checks the vendor's own records,
// tested in vendorPortal.test.ts and vendorPayouts.test.ts), their own identity, and nothing of the owner's or a client's.
const VENDOR = new Set(["help.list", "help.guide", "users.switchSide",
  "vendorPortal.businesses", "vendorPortal.counts", "vendorPortal.home", "vendorPortal.bookings", "vendorPortal.booking", "vendorPortal.accept", "vendorPortal.decline",
  "vendorPortal.briefings", "vendorPortal.briefing", "vendorPortal.markRead", "vendorPortal.reviews", "vendorPortal.invoices", "vendorPortal.invoiceForm", "vendorPortal.invoice",
  "vendorPortal.saveInvoice", "vendorPortal.deleteInvoice", "vendorPortal.settings", "vendorPortal.notifications", "vendorPortal.setNotification", "vendorPortal.saveDetails",
  "vendorPortal.w9UploadUrl", "vendorPortal.setW9", "vendorPayouts.mine", "vendorPayouts.setupLink", "vendorPayouts.refreshMine",
  // Phase 5b step 3: call sheets sent to them (only while booked on the project; tested in callSheets.test.ts)
  "vendorPortal.callSheet", "vendorPortal.callSheets", "vendorPortal.openCallSheet"]);

// Phase 5e step 1: what each team role may call with its suggested switches (lib/perms.ts SUGGESTED), and why. A
// function names the switch that opens it (requireMe(ctx, "review")); one that names none stays the owner's. The matrix
// Editor is assigned to no project, so the project functions refuse them too. Tested further in team.test.ts.
const TEAM: Record<"producer" | "editor" | "bookkeeper", Record<string, string>> = {
  producer: {
    "team.projectPeople": "Projects: who is assigned to a project (names and roles only; the owner alone assigns)",
  },
  editor: {},
  bookkeeper: {},
};

import { argsFor, call, publicFunctions, setup } from "./matrix";
const denied = (e: unknown) => /Sign in first|Not allowed/.test(String((e as Error).message ?? e));

describe("access matrix", () => {
  test("every public function is classified", async () => {
    const { ids } = await setup();
    const table = argsFor(ids);
    const missing = publicFunctions().map((f) => f.key).filter((k) => !(k in table));
    expect(missing).toEqual([]);
  });

  for (const who of ["nobody", "stranger", "client", "vendor", "guest", "guestInvited", "producer", "editor", "bookkeeper"] as const) {
    test(`${who}: every function refuses, except the ones meant to answer`, async () => {
      const { t, ids } = await setup();
      vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 })); // nothing external may be reached
      const subs: Record<string, string> = { stranger: ids.strangerSub, vendor: ids.vendorSub, guest: ids.guestSub, guestInvited: ids.guestInvitedSub, client: ids.clientSub, producer: ids.producerSub, editor: ids.editorSub, bookkeeper: ids.bookkeeperSub };
      const as = who === "nobody" ? t : t.withIdentity({ subject: subs[who] });
      const table = argsFor(ids);
      const results: Record<string, string> = {};
      for (const f of publicFunctions()) {
        const allowed = f.key in OPEN || (who === "client" && SIGNED_IN.has(f.key)) || (who === "vendor" && VENDOR.has(f.key)) || ((who === "guest" || who === "guestInvited") && f.key in GUEST)
          || ((who === "producer" || who === "editor" || who === "bookkeeper") && f.key in TEAM[who]);
        if (KEYED.has(f.key)) { await expect(call(as, f.ref, table[f.key], "")).rejects.toThrow(/Not allowed/); results[f.key] = "denied (own key)"; continue; }
        try {
          await call(as, f.ref, table[f.key], "");
          results[f.key] = allowed ? "answered (expected)" : "ANSWERED";
        } catch (e) {
          if (denied(e)) results[f.key] = allowed ? `DENIED: ${(e as Error).message}` : "denied";
          else results[f.key] = allowed ? "answered (expected, other error)" : `OTHER: ${String((e as Error).message).slice(0, 80)}`;
        }
      }
      const bad = Object.entries(results).filter(([, r]) => /^(ANSWERED|DENIED|OTHER)/.test(r));
      expect(bad).toEqual([]);
      // r1results.report with a wrong key is refused by its own check, with a different message.
      expect(results["users.me"]).toMatch(/answered/);
    });
  }

  test("the owner is not refused", async () => {
    const { t, ids } = await setup();
    const me = t.withIdentity({ subject: ids.ownerSub });
    expect(await me.query(api.library.overview, {})).toBeTruthy();
    expect((await me.query(api.users.me, {}))?.role).toBe("owner");
    expect(await me.query(api.clients.listInvites, {})).toHaveLength(2); // the client's, and the invited guest's (step 4 review)
  });

  test("a client sees their own identity and account, and nothing else", async () => {
    const { t, ids } = await setup();
    const c = t.withIdentity({ subject: ids.clientSub });
    expect((await c.query(api.users.me, {}))).toMatchObject({ role: "client", allowed: false });
    expect(await c.query(api.clients.account, {})).toMatchObject({ kind: "client", email: "client@example.com" });
    await c.mutation(api.users.setName, { name: "Casey" });
    expect((await c.query(api.clients.account, {})).name).toBe("Casey");
    await expect(c.query(api.library.overview, {})).rejects.toThrow(/Not allowed/);
    // The video page asks for the owner's display settings whoever is looking: a client (or a guest) gets {} back.
    expect(await c.query(api.prefs.mine, {})).toEqual({});
    expect(await t.query(api.prefs.mine, {})).toEqual({});
    await expect(c.mutation(api.prefs.set, { key: "details", value: [] })).rejects.toThrow(/Not allowed/);
  });
});

describe("who may make an account", () => {
  const signUp = (t: ReturnType<typeof convexTest>, email: string) =>
    t.action(api.auth.signIn, { provider: "password", params: { flow: "signUp", email, password: "longenoughpassword" } });

  test("an owner email and an invited email can; anyone else is refused; a code email goes out through Resend", async () => {
    const { t, ids } = await setup();
    const sent: string[] = [];
    const mails: Array<{ to: string; subject: string; text: string; from: string; html: string }> = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://api.resend.com/emails") { const b = JSON.parse(String(init?.body)); sent.push(b.to[0]); mails.push({ to: b.to[0], subject: b.subject, text: b.text, from: b.from, html: b.html }); return new Response(JSON.stringify({ id: "em_1" }), { status: 200 }); }
      return new Response("{}", { status: 500 });
    });
    const lastCode = () => /\b(\d{6})\b/.exec(mails[mails.length - 1].text)![1];
    await expect(signUp(t, "intruder@example.com")).rejects.toThrow(/hasn't been invited/);
    await t.withIdentity({ subject: ids.ownerSub }).mutation(api.clients.invite, { email: "New.Client@Example.com", name: "New Client" });
    const r = await signUp(t, "new.client@example.com") as { tokens?: unknown; started?: boolean };
    expect(r.tokens ?? null).toBeNull(); // no session yet: a code is needed first
    expect(sent).toEqual(["new.client@example.com"]);
    const user = await t.run(async (ctx) => (await ctx.db.query("users").withIndex("email", (q) => q.eq("email", "new.client@example.com")).unique()));
    expect(user).toMatchObject({ role: "client", name: "New Client" });
    const inv = await t.run(async (ctx) => (await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", "new.client@example.com")).unique()));
    expect(inv?.acceptedAt).toBeTypeOf("number");
    expect(mails[0]).toMatchObject({ from: "Wrangler Productions <review@wranglerportal.com>" });
    expect(mails[0].html).toContain('<meta name="color-scheme" content="dark">');
    expect(mails[0].subject).toMatch(/^\d{6} is your WranglerPortal code$/);
    // A wrong code is refused; the emailed one signs them in.
    await expect(t.action(api.auth.signIn, { provider: "password", params: { flow: "email-verification", email: "new.client@example.com", code: "000000" } })).rejects.toThrow();
    const done = await t.action(api.auth.signIn, { provider: "password", params: { flow: "email-verification", email: "new.client@example.com", code: lastCode() } }) as { tokens?: unknown };
    expect(done.tokens).toBeTruthy();
    // Password reset: a code by email, then a new password that signs in; the old one no longer does.
    await t.action(api.auth.signIn, { provider: "password", params: { flow: "reset", email: "new.client@example.com" } });
    expect(mails[mails.length - 1].subject).toBe("Reset your WranglerPortal password");
    const reset = await t.action(api.auth.signIn, { provider: "password", params: { flow: "reset-verification", email: "new.client@example.com", code: lastCode(), newPassword: "anotherlongpassword" } }) as { tokens?: unknown };
    expect(reset.tokens).toBeTruthy();
    await expect(t.action(api.auth.signIn, { provider: "password", params: { flow: "signIn", email: "new.client@example.com", password: "longenoughpassword" } })).rejects.toThrow();
    const back = await t.action(api.auth.signIn, { provider: "password", params: { flow: "signIn", email: "new.client@example.com", password: "anotherlongpassword" } }) as { tokens?: unknown };
    expect(back.tokens).toBeTruthy();
    // A revoked invite can't be used.
    await t.withIdentity({ subject: ids.ownerSub }).mutation(api.clients.revokeInvite, { inviteId: ids.inviteId });
    await t.run(async (ctx) => { for (const u of await ctx.db.query("users").collect()) if (u.email === "client@example.com") await ctx.db.delete(u._id); });
    await expect(signUp(t, "client@example.com")).rejects.toThrow(/hasn't been invited/);
    // An owner's email is fine, and the owner can't be "invited".
    const o = await signUp(t, "heston@wranglerproductions.com").catch((e: Error) => e);
    expect(o instanceof Error ? o.message : "ok").not.toMatch(/hasn't been invited/);
    await expect(t.withIdentity({ subject: ids.ownerSub }).mutation(api.clients.invite, { email: "heston@wranglerproductions.com" })).rejects.toThrow(/owner/);
  }, 30_000);
});
