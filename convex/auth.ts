import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import { Email } from "@convex-dev/auth/providers/Email";
import { ConvexError } from "convex/values";
import { brandFrom } from "./lib/mail";
import { resetMail, signInCodeMail } from "./lib/mails";
import { sendEmail, sixDigits } from "./lib/email";
import type { MutationCtx } from "./_generated/server";
import { SITE_HOST } from "./lib/site";
import { allowedEmails } from "./lib/owners";
import { ensureDefaultBusiness, ensureMembership, syncClientMemberships } from "./lib/business";

// Owners: the emails in ALLOWED_EMAILS (comma-separated Convex env var). Everyone else needs an invite (C1, Oct 23).
/** Names a client may not use: the owners' names and email local parts ("heston"), lower-case. Security review, Oct 23. */
export const ownerNames = () => new Set([...allowedEmails().map((e) => e.split("@")[0]), ...(process.env.OWNER_NAMES || "Heston,Heston Hill,Wrangler,Wrangler Productions,Claude").split(",")].map((s) => s.trim().toLowerCase()).filter(Boolean));

export { allowedEmails };

const CODE_MINUTES = 10;

// A six-digit code by email, for proving an address at sign-up and for password resets.
function codeByEmail(id: string, kind: "verify" | "reset") {
  return Email({
    id,
    maxAge: CODE_MINUTES * 60,
    // Sent through Resend ourselves; Auth.js's own sender isn't used.
    apiKey: "unused",
    async generateVerificationToken() { return sixDigits(); },
    async sendVerificationRequest({ identifier: email, token }) {
      // Sign-in happens before we know whose client this is, so these come from the portal's default business.
      const b = brandFrom({ name: "Wrangler Productions", legalName: "Hill Creative LLC", ownerName: "Heston Hill" }, { ownerEmail: "heston@wranglerproductions.com", logoUrl: null, isDefault: true });
      const m = kind === "verify" ? signInCodeMail(b, { code: token, minutes: CODE_MINUTES }) : resetMail(b, { code: token, minutes: CODE_MINUTES });
      await sendEmail({ from: m.from, to: email, tag: kind === "verify" ? "code" : "reset", replyTo: null, subject: m.subject, text: m.text, html: m.html });
    },
  });
}

const WranglerPassword = Password({
  profile(params) {
    const email = String(params.email ?? "").trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ConvexError("Enter a valid email.");
    const profile: Record<string, string> & { email: string } = { email };
    if (typeof params.name === "string" && params.name.trim()) profile.name = params.name.trim().slice(0, 60);
    return profile;
  },
  validatePasswordRequirements(password: string) {
    if (password.length < 10) throw new ConvexError("Use at least 10 characters.");
  },
  verify: codeByEmail("resend-verify", "verify"),
  reset: codeByEmail("resend-reset", "reset"),
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [WranglerPassword],
  callbacks: {
    // Who may have an account: owners (the allow list) and invited clients. Decided here, on the server, for every
    // sign-up; the page can't get around it.
    async createOrUpdateUser(genericCtx, args) {
      const ctx = genericCtx as unknown as MutationCtx;
      const email = String(args.profile.email ?? "").toLowerCase();
      const verified = args.type === "verification" || args.profile.emailVerified === true;
      if (args.existingUserId) {
        const patch: Record<string, unknown> = { lastSignInAt: Date.now() };
        if (verified) patch.emailVerificationTime = Date.now();
        if (typeof args.profile.name === "string" && args.profile.name && !(args.existingUserId && !allowedEmails().includes(email) && ownerNames().has(args.profile.name.trim().toLowerCase()))) patch.name = args.profile.name;
        await ctx.db.patch(args.existingUserId, patch);
        if (!allowedEmails().includes(email)) await syncClientMemberships(ctx, email, args.existingUserId);
        return args.existingUserId;
      }
      const owner = allowedEmails().includes(email);
      const invite = owner ? null : (await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", email)).collect()).find((i) => !i.revokedAt) ?? null;
      if (!owner && !invite) throw new ConvexError("This email hasn't been invited to Wrangler Review.");
      const userId = await ctx.db.insert("users", {
        email, role: owner ? "owner" : "client",
        name: (typeof args.profile.name === "string" && args.profile.name && !(!owner && ownerNames().has(args.profile.name.trim().toLowerCase())) ? args.profile.name : undefined) || invite?.name || undefined,
        emailVerificationTime: verified ? Date.now() : undefined, lastSignInAt: Date.now(),
      });
      if (invite) await ctx.db.patch(invite._id, { acceptedAt: Date.now(), userId });
      // Step 6: an owner (ALLOWED_EMAILS) belongs to the default business; a client to each business that invited them.
      if (owner) await ensureMembership(ctx, (await ensureDefaultBusiness(ctx)).businessId, email, "owner", userId);
      else await syncClientMemberships(ctx, email, userId);
      return userId;
    },
  },
});
