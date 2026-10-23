// Outgoing email through Resend (client side, Oct 23). From review@wranglerportal.com (verified domain); replies
// go to Heston. RESEND_API_KEY is in the Convex dashboard. Returns the Resend id or throws.
export const FROM = () => process.env.EMAIL_FROM || "Wrangler Review <review@wranglerportal.com>";
export const REPLY_TO = () => process.env.EMAIL_REPLY_TO || "heston@wranglerproductions.com";
export const SITE = () => (process.env.SITE_URL || "https://review.wranglerportal.com").replace(/\/$/, "");

export async function sendEmail(msg: { to: string; subject: string; text: string; html?: string; replyTo?: string | null; tag?: string }): Promise<string> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("Email isn't set up (no Resend key).");
  const body: Record<string, unknown> = { from: FROM(), to: [msg.to], subject: msg.subject, text: msg.text };
  if (msg.html) body.html = msg.html;
  if (msg.replyTo !== null) body.reply_to = msg.replyTo ?? REPLY_TO();
  if (msg.tag) body.tags = [{ name: "kind", value: msg.tag }];
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({})) as { id?: string; message?: string };
  if (!r.ok) throw new Error(`Resend ${r.status}: ${(j.message || "").slice(0, 160)}`);
  return j.id ?? "";
}

export const sixDigits = () => String(Math.floor(100000 + Math.random() * 900000));
