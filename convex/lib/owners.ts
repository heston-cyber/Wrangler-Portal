// Owners: the emails in ALLOWED_EMAILS (comma-separated Convex env var). In its own file so lib/business.ts and
// auth.ts can both use it without importing each other.
export function allowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
