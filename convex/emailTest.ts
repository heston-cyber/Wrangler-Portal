// Client side T-C0.2 (Oct 23): does an email from review@wranglerportal.com through Resend land in the inbox?
// Env: RESEND_API_KEY (pasted into the Convex dashboard by Heston), EMAIL_FROM (default below).
import { internalAction } from "./_generated/server";
import { v } from "convex/values";

export const send = internalAction({
  args: { to: v.array(v.string()), kind: v.union(v.literal("code"), v.literal("reset")) },
  handler: async (_ctx, { to, kind }) => {
    const key = process.env.RESEND_API_KEY;
    if (!key) return { configured: false };
    const from = process.env.EMAIL_FROM || "Wrangler Review <review@wranglerportal.com>";
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const subject = kind === "code" ? `${code} is your Wrangler Review code` : "Reset your Wrangler Review password";
    const text = kind === "code"
      ? `Your sign-in code is ${code}. It works for 10 minutes.\n\nIf you didn't ask for it, ignore this email.\n\nWrangler Review · review.wranglerportal.com`
      : `Someone asked to reset the password for this email on Wrangler Review. Your reset code is ${code}. It works for 10 minutes.\n\nIf that wasn't you, ignore this email and nothing changes.\n\nWrangler Review · review.wranglerportal.com`;
    const out: Array<{ to: string; status: number; id?: string; error?: string }> = [];
    for (const addr of to) {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to: [addr], subject, text, headers: { "X-Entity-Ref-ID": `test-${Date.now()}` } }),
      });
      const j = await r.json().catch(() => ({})) as { id?: string; message?: string };
      out.push({ to: addr.replace(/^(.).*@/, "$1…@"), status: r.status, id: j.id ? j.id.slice(0, 8) : undefined, error: r.ok ? undefined : (j.message || "").slice(0, 120) });
    }
    return { configured: true, from, kind, sent: out };
  },
});
