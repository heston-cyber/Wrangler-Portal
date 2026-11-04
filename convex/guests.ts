// Phase 5b step 4 (Nov 3) · call-sheet guests (D127; S5 · Phase 5b: Sign in · Before code 768:6282, Code sent 768:6309
// and 768:6342, Call sheet 769:6274 and 769:6466, Access ended 768:6374 and 768:6403, email 41 768:6458).
//
// How a guest gets in (the rules are in lib/guests.ts):
//   1. Email 41 links to /guest/<token>: one long random token per guest per sheet (guestPasses).
//   2. `intro` (anyone with the link) says whose sheet it is, with their email masked; "Email me a code" (`sendCode`)
//      emails a 6-digit code to the guest's own address. The page never sees the address or the code.
//   3. Convex Auth's "guest" provider (auth.ts) takes the token and the code; `redeem` checks both, with 5 tries per code,
//      then signs in the guest login for that email (a users row with role "guest", made the first time).
//   Both steps refuse an email that has a login of its own, and a sheet that isn't active for that guest.
// Once in, `home`, `sheet` and `opened` are the only functions a guest login passes; each re-checks the sheet.
import { focusBusiness, internalMutation, mutation, query } from "./lib/functions";
import { action, internalMutation as trustedMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { defaultBusiness } from "./lib/business";
import { mailBrandOf, type MailBrand } from "./lib/mail";
import { signInCodeMail } from "./lib/mails";
import { sendEmail, sixDigits } from "./lib/email";
import { sha256Hex } from "./lib/hash";
import { bump } from "./lib/rate";
import { callFor, locationOf, sheetDay, sheetDayLong } from "./lib/callSheet";
import { nodesOf, pageOf } from "./lib/wsBuilder";
import { CODE_MINUTES, MAX_TRIES, MAX_WRONG_A_DAY, TOKEN_RE, addPass, hasOwnLogin, masked, requireGuest, sheetState, type Pass } from "./lib/guests";
import { todayCentral } from "./lib/bookings";
import { markOpened, readerView, shootOf } from "./callSheets";

type Ctx = QueryCtx | MutationCtx;
const OWN_LOGIN = "This email has its own WranglerPortal login. Sign in with your password instead.";
const NO_LINK = "This link doesn't work. Open the newest email about the call sheet.";
const GONE = "This call sheet is no longer available.";
const BAD_CODE = "That code didn't match, or it's older than 10 minutes. Ask for a new one.";
const LOCKED = "Too many wrong codes. Reply to the email about the call sheet and ask for it to be sent to you again.";

const passByToken = async (ctx: Ctx, token: string) =>
  TOKEN_RE.test(token) ? await ctx.db.query("guestPasses").withIndex("by_token", (q) => q.eq("token", token)).unique() : null;
const defaultBiz = async (ctx: Ctx) => (await defaultBusiness(ctx))?._id ?? null;

/** "Product shoot · Harbor Coffee" and "Tue Nov 3", for pages that show which sheet a link was for: as sent (review L6). */
async function heading(ctx: Ctx, cs: Doc<"callSheets"> | null, shoot: Doc<"shoots"> | null) {
  if (cs?.sent?.heading) return { title: cs.sent.heading, date: cs.sent.date ?? shoot?.date ?? null };
  const sh = cs ? await shootOf(ctx, cs.shootId) : null;
  return { title: sh?.title ?? "Call sheet", date: shoot?.date ?? sh?.s.date ?? null };
}

// ---------- signed out: the link, and the code ----------

/** /guest/<token> before sign-in (768:6282) and Access ended (768:6374). Anyone with the link sees only this. */
export const intro = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const pass = await passByToken(ctx, token);
    if (!pass) return { state: "missing" as const };
    focusBusiness(ctx, pass.businessId); // the rest of this call sees only the pass's business
    const st = await sheetState(ctx.db, pass, await defaultBiz(ctx));
    if (!st.ok && (st.why === "gone" || st.why === "notSent")) return { state: "missing" as const };
    const h = await heading(ctx, st.cs, st.shoot);
    const b = await ctx.db.get(pass.businessId);
    const business = { name: b?.name ?? "Wrangler Productions", legalName: b?.legalName ?? null, owner: b?.ownerName?.trim() || null };
    if (!st.ok) return { state: "ended" as const, ...h, business };
    return { state: "active" as const, ...h, dayLong: sheetDayLong(h.date ?? st.shoot.date), name: st.r.name, email: masked(pass.email), business };
  },
});

/** "Email me a code" / "Send another code" (768:6309): a 6-digit code to the guest's own email, never shown here. */
export const sendCode = action({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<{ to: string; minutes: number }> => {
    if (!TOKEN_RE.test(token)) throw new ConvexError(NO_LINK);
    const r: { error: string } | { email: string; code: string; masked: string; brand: MailBrand } = await ctx.runMutation(internal.guests.issueCode, { token });
    if ("error" in r) throw new ConvexError(r.error);
    const m = signInCodeMail(r.brand, { code: r.code, minutes: CODE_MINUTES });
    try { await sendEmail({ from: m.from, to: r.email, subject: m.subject, text: m.text, html: m.html, tag: "guest-code", replyTo: null }); }
    catch { await ctx.runMutation(internal.guests.dropCode, { token }); throw new ConvexError("The code email couldn't be sent. Try again in a minute."); }
    return { to: r.masked, minutes: CODE_MINUTES };
  },
});

// Trusted server code, keyed by the link's own token: it reads only that pass, its sheet, shoot and project, and the
// sheet must belong to the pass's business. It runs unguarded so a browser that's signed in as someone else can still
// ask for a guest code (its own scope would hide the sheet), and it answers errors as values so a wrong try is kept.
export const issueCode = trustedMutation({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<{ error: string } | { email: string; code: string; masked: string; brand: MailBrand }> => {
    const pass = await passByToken(ctx, token);
    if (!pass) return { error: NO_LINK };
    if (await hasOwnLogin(ctx.db, pass.email)) return { error: OWN_LOGIN }; // first: never a guest login for them
    const st = await sheetState(ctx.db, pass, await defaultBiz(ctx));
    if (!st.ok) return { error: st.why === "gone" || st.why === "notSent" ? NO_LINK : GONE };
    if (pass.lockedAt) return { error: LOCKED };
    const now = Date.now();
    if (pass.codeSentAt && now - pass.codeSentAt < 30_000) return { error: "A code is on its way. Wait half a minute before asking for another." };
    await bump(ctx, "guestCode", pass.email); // 6 an hour per email
    const code = sixDigits();
    await ctx.db.patch(pass._id, { codeHash: await sha256Hex(`${pass._id}:${code}`), codeExpiresAt: now + CODE_MINUTES * 60_000, codeTries: 0, codeSentAt: now });
    return { email: pass.email, code, masked: masked(pass.email), brand: await mailBrandOf(ctx, pass.businessId) };
  },
});

export const dropCode = trustedMutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const pass = await passByToken(ctx, token);
    if (pass) await ctx.db.patch(pass._id, { codeHash: undefined, codeExpiresAt: undefined, codeTries: undefined, codeSentAt: undefined });
    return null;
  },
});

/** The "guest" sign-in provider's check (auth.ts): the token's code, then the guest login for that email. */
export const redeem = trustedMutation({
  args: { token: v.string(), code: v.string() },
  handler: async (ctx, { token, code }): Promise<{ userId: Id<"users"> } | { error: string }> => {
    const pass = await passByToken(ctx, token);
    if (!pass) return { error: NO_LINK };
    if (await hasOwnLogin(ctx.db, pass.email)) return { error: OWN_LOGIN }; // first: never a guest login for them
    const st = await sheetState(ctx.db, pass, await defaultBiz(ctx));
    if (!st.ok) return { error: st.why === "gone" || st.why === "notSent" ? NO_LINK : GONE };
    if (pass.lockedAt) return { error: LOCKED };
    const now = Date.now();
    const tries = pass.codeTries ?? 0;
    if (!pass.codeHash || !pass.codeExpiresAt || pass.codeExpiresAt < now || tries >= MAX_TRIES || !/^\d{6}$/.test(code)) return { error: BAD_CODE };
    if ((await sha256Hex(`${pass._id}:${code}`)) !== pass.codeHash) {
      // A wrong try counts; the fifth wipes the code. Review L5: and 15 in a day lock the pass until the owner sends the
      // sheet to them again (Send an update or Remind opens it; passesSent in callSheets.ts).
      const today = todayCentral();
      const wrong = (pass.wrongDay === today ? pass.wrongCount ?? 0 : 0) + 1;
      const locked = wrong >= MAX_WRONG_A_DAY;
      await ctx.db.patch(pass._id, {
        ...(tries + 1 >= MAX_TRIES || locked ? { codeHash: undefined, codeExpiresAt: undefined, codeTries: undefined } : { codeTries: tries + 1 }),
        wrongDay: today, wrongCount: wrong, ...(locked ? { lockedAt: now } : {}),
      });
      return { error: locked ? LOCKED : BAD_CODE };
    }
    await ctx.db.patch(pass._id, { codeHash: undefined, codeExpiresAt: undefined, codeTries: undefined });
    const rows = await ctx.db.query("users").withIndex("email", (q) => q.eq("email", pass.email)).collect();
    if (rows.some((u) => u.role !== "guest")) return { error: OWN_LOGIN }; // (hasOwnLogin already said no; kept as a backstop)
    const mine = rows[0];
    if (mine) { await ctx.db.patch(mine._id, { lastSignInAt: now, emailVerificationTime: now }); return { userId: mine._id }; }
    const userId = await ctx.db.insert("users", { email: pass.email, name: st.r.name, role: "guest", emailVerificationTime: now, lastSignInAt: now });
    return { userId };
  },
});

// ---------- signed in: the guest's pages ----------

/** A guest's pass for this link: theirs, and its business is the one the rest of the call sees. */
async function myPass(ctx: Ctx, token: string, email: string): Promise<Pass | null> {
  const pass = await passByToken(ctx, token);
  if (!pass || pass.email !== email) return null;
  focusBusiness(ctx, pass.businessId);
  return pass;
}

/** An ended sheet's last day of access (Q88: "access ended Oct 21"), when the reason has a day: ended by hand, the shoot's
 *  day passed, or the project closed. Cancelled or taken off the sheet: no day. */
async function endedOn(ctx: Ctx, cs: Doc<"callSheets">, r: Doc<"callSheets">["recipients"][number] | undefined, shoot: Doc<"shoots"> | null, why: string) {
  if (r?.endedAt) return todayCentral(r.endedAt);
  if (why === "over" && shoot) { const t = new Date(`${shoot.date}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); }
  if (why === "closed") { const p = await ctx.db.get(cs.projectId); return p?.deliveryUnlockedAt ? todayCentral(p.deliveryUnlockedAt) : null; }
  return null;
}

type ListRow = { token: string; title: string; date: string; call: string; place: string; state: "today" | "upcoming" | "ended"; endedOn: string | null; updatedToday: boolean; isNew: boolean };

/** /guest (858:94294, phone 859:9381): the guest's call sheets from one business, in Today, Upcoming and Ended (Q88: an
 *  ended sheet stays, dimmed; opening it shows Access ended). The "Sheets from" switcher (859:9250) lists the businesses
 *  that have sent them something, each with how many sheets they haven't opened yet. */
export const home = query({
  args: { businessId: v.optional(v.id("businesses")) },
  handler: async (ctx, a) => {
    const me = await requireGuest(ctx);
    // Review L2: only businesses that have sent this guest something (a pass with sentAt), soonest shoot first, so the
    // default is one with sheets coming up. Passes are a hint for the list only: every sheet shown below is checked live
    // (sheetState), and a business never appears just because it added them to a draft.
    const today = todayCentral();
    const rank = (p: Pass) => `${(p.date ?? "") >= today ? 0 : 1}:${(p.date ?? "") >= today ? p.date : String(9e15 - (p.sentAt ?? 0))}`;
    const all = await ctx.db.query("guestPasses").withIndex("by_email", (q) => q.eq("email", me.email)).collect();
    const passes = all.filter((p) => p.sentAt).sort((x, y) => rank(x).localeCompare(rank(y)));
    const ids = [...new Set(passes.map((p) => p.businessId))];
    // "N new": sheets sent and not opened yet, shoot still to come (the passes' hint; the business shown is counted live below).
    const businesses: Array<{ businessId: Id<"businesses">; name: string; fresh: number }> = [];
    for (const id of ids) {
      const b = await ctx.db.get(id);
      businesses.push({ businessId: id, name: b?.name ?? "A business", fresh: passes.filter((p) => p.businessId === id && !p.openedAt && (p.date ?? "") >= today).length });
    }
    const biz = a.businessId && ids.includes(a.businessId) ? a.businessId : ids[0] ?? null;
    const sheets: ListRow[] = [];
    if (biz) {
      focusBusiness(ctx, biz);
      const dflt = await defaultBiz(ctx);
      for (const p of all.filter((x) => x.businessId === biz)) {
        const st = await sheetState(ctx.db, p, dflt);
        if (st.ok) {
          const page = pageOf(st.cs.sent!.page);
          const sh = await shootOf(ctx, st.cs.shootId);
          const date = st.cs.sent!.date ?? st.shoot.date;
          sheets.push({
            token: p.token, title: st.cs.sent!.heading ?? sh?.title ?? "Call sheet", date, call: callFor(page, st.r), place: locationOf(nodesOf(page, "location")[0]).name || st.shoot.location,
            state: st.shoot.date === today ? "today" : "upcoming", endedOn: null,
            updatedToday: st.cs.sent!.round > 0 && todayCentral(st.cs.sent!.at) === today, isNew: !st.r.openedAt,
          });
          continue;
        }
        if (st.why === "gone" || st.why === "notSent" || !st.cs) continue;
        // Ended (by hand, the day after the shoot, cancelled, closed): only a sheet that actually went to them.
        const r = st.cs.recipients.find((x) => x.id === p.personId && x.kind === "guest" && x.email === p.email);
        if (!r?.sentAt || st.cs.status !== "sent" || !st.cs.sent) continue;
        const h = await heading(ctx, st.cs, st.shoot);
        sheets.push({ token: p.token, title: h.title, date: h.date ?? "", call: "", place: "", state: "ended", endedOn: await endedOn(ctx, st.cs, r, st.shoot, st.why), updatedToday: false, isNew: false });
      }
      const here = businesses.find((b) => b.businessId === biz);
      if (here) here.fresh = sheets.filter((x) => x.state !== "ended" && x.isNew).length;
    }
    const live = sheets.filter((x) => x.state !== "ended").sort((x, y) => x.date.localeCompare(y.date));
    const ended = sheets.filter((x) => x.state === "ended").sort((x, y) => y.date.localeCompare(x.date));
    return { name: me.name, email: me.email, businesses, businessId: biz, sheets: [...live, ...ended] };
  },
});

/** /guest/<token> signed in (769:6274, 769:6466): the whole sheet as sent, or Access ended (768:6374) once it's over. */
export const sheet = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const me = await requireGuest(ctx);
    const pass = await myPass(ctx, token, me.email);
    if (!pass) return null;
    const st = await sheetState(ctx.db, pass, await defaultBiz(ctx));
    if (!st.ok) {
      if (st.why === "gone" || st.why === "notSent") return null;
      const b = await ctx.db.get(pass.businessId);
      return { ended: true as const, ...(await heading(ctx, st.cs, st.shoot)), business: { name: b?.name ?? "Wrangler Productions", legalName: b?.legalName ?? null } };
    }
    const view = await readerView(ctx as QueryCtx, st.cs, st.r);
    if (!view) return null;
    const { project: _project, ...rest } = view; // a guest never gets a link into the project
    return { ended: false as const, ...rest, day: sheetDay(view.date) };
  },
});

/** Opening it records "opened" for the guest (the owner's Detail page shows who has). */
export const opened = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const me = await requireGuest(ctx);
    const pass = await myPass(ctx, token, me.email);
    const st = pass ? await sheetState(ctx.db, pass, await defaultBiz(ctx)) : null;
    if (!st?.ok) throw new ConvexError("This call sheet isn't here.");
    await markOpened(ctx, st.cs, st.r.id, st.r.name);
    if (!pass!.openedAt) await ctx.db.patch(pass!._id, { openedAt: Date.now() }); // the switcher's "N new" hint
    return null;
  },
});

// ---------- passes for guests added before this step ----------

/** Once, for guests added in step 3 before passes existed (run from the dashboard; safe to run again). */
export const backfillPasses = internalMutation({
  args: {},
  handler: async (ctx) => {
    let added = 0;
    for (const cs of await ctx.db.query("callSheets").collect()) {
      const have = new Set((await ctx.db.query("guestPasses").withIndex("by_sheet", (q) => q.eq("callSheetId", cs._id)).collect()).map((p) => p.personId));
      for (const r of cs.recipients) if (r.kind === "guest" && !have.has(r.id)) { await addPass(ctx, cs, r.id, r.email); added++; }
      // Review L2: passes of guests it already went to get the "sent" hint the /guest list uses.
      const shoot = await ctx.db.get(cs.shootId);
      for (const p of await ctx.db.query("guestPasses").withIndex("by_sheet", (q) => q.eq("callSheetId", cs._id)).collect()) {
        const r = cs.recipients.find((x) => x.id === p.personId);
        // Q88: ended sheets stay in the list now, so a pass whose access was ended by hand gets its hint back too.
        if (r?.sentAt && !p.sentAt) await ctx.db.patch(p._id, { sentAt: r.sentAt, date: cs.sent?.date ?? shoot?.date });
        if (r?.openedAt && !p.openedAt) await ctx.db.patch(p._id, { openedAt: r.openedAt });
      }
    }
    return { added };
  },
});
