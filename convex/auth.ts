import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import { ConvexError } from "convex/values";

// Only the emails in ALLOWED_EMAILS (comma-separated Convex env var) can sign up or sign in.
export function allowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

const WranglerPassword = Password({
  profile(params) {
    const email = String(params.email ?? "").trim().toLowerCase();
    if (!email || !allowedEmails().includes(email)) {
      throw new ConvexError("This email isn't allowed to use Wrangler Review.");
    }
    const profile: Record<string, string> & { email: string } = { email };
    if (typeof params.name === "string" && params.name.trim()) profile.name = params.name.trim();
    return profile;
  },
  validatePasswordRequirements(password: string) {
    if (password.length < 10) throw new ConvexError("Use at least 10 characters.");
  },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [WranglerPassword],
});
