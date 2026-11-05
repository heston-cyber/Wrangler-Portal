// D149 · Accept and Decline on the no-account quote and proposal pages (S5 · Phase 3b, "To anyone": 872:20490 copied
// link, 885:20807 / 885:20923 already accepted, 873:21316 proposal). An emailed link asks your full name (and company,
// only if you're signing for one); a copied link also asks your email. Once someone accepts, every other link says
// "Already accepted on {date}" and can't accept again; it never says who (Q99, Q103).
import { useState } from "react";
import { Button, DialogHeader, TextArea } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { Modal } from "../../ui/kit";
import { CONVEX_SITE } from "../docs/lib/client";
import { Banner } from "./ClientInvoice";

export type OfferAnswerState = { kind: "accepted_by_you" | "already_accepted" | "declined_by_you" | "declined"; at: number; name: string | null } | null;
const longMs = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

async function respond(path: "q-respond" | "p-respond", body: Record<string, string>): Promise<{ ok?: boolean; error?: string }> {
  try {
    const r = await fetch(`${CONVEX_SITE}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return (await r.json()) as { ok?: boolean; error?: string };
  } catch { return { error: "Couldn't reach the server. Check your connection and try again." }; }
}

export function OfferAnswer({ kind, token, via, answer, open, closedNote, biz, number, replyTo }: {
  kind: "quote" | "proposal"; token: string; via: "email" | "link"; answer: OfferAnswerState; open: boolean; closedNote?: React.ReactNode; biz: string; number: string; replyTo?: string | null;
}) {
  const [name, setName] = useState(""), [email, setEmail] = useState(""), [company, setCompany] = useState("");
  const [busy, setBusy] = useState<null | "accept" | "decline">(null);
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const path = kind === "quote" ? "q-respond" : "p-respond";
  const go = async (action: "accept" | "decline") => {
    setBusy(action); setError(null);
    const r = await respond(path, { token, action, name, ...(email.trim() ? { email: email.trim() } : {}), ...(company.trim() ? { company: company.trim() } : {}), ...(action === "decline" && reason.trim() ? { reason } : {}) });
    setBusy(null);
    if (r.error) setError(r.error); else setDeclining(false);
  };
  if (answer?.kind === "accepted_by_you") return <Banner tone="success" icon="check-circle" title={`Accepted by ${answer.name} · ${longMs(answer.at)}`} text={`Thank you. ${biz} will send the next steps.`} />;
  if (answer?.kind === "already_accepted") return <Banner tone="neutral" icon="info" title={`Already accepted on ${longMs(answer.at)}`} text={`This ${kind} can’t be accepted again. You can still read it and download the PDF.`} />;
  if (answer?.kind === "declined_by_you" || answer?.kind === "declined") return <Banner tone="neutral" icon="info" title={`Declined · ${longMs(answer.at)}`} text={`${biz} has been told. If you change your mind, reply to their email.`} />;
  if (!open) return <>{closedNote}</>;
  const thing = kind === "quote" ? "quote" : "proposal";
  const ready = name.trim().length >= 2 && (via === "email" || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()));
  return (
    <>
      <label className="wp-field"><span className="wp-field-label">Your full name</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Type your name" autoComplete="name" /></label>
      {via === "link" && <label className="wp-field"><span className="wp-field-label">Your email</span>
        <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" /></label>}
      <label className="wp-field"><span className="wp-field-label">Company (only if you’re signing for one)</span>
        <input className="input" value={company} onChange={(e) => setCompany(e.target.value)} autoComplete="organization" /></label>
      <p className="wp-small">By accepting, you agree to the scope and price above. This isn't a contract; {biz} will send one to sign.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <Button variant="primary" className="q-big" loading={busy === "accept"} disabled={!!busy || !ready} onClick={() => void go("accept")}>Accept {thing}</Button>
      <button type="button" className="btn ghost q-big" disabled={!!busy} onClick={() => setDeclining(true)}>Decline</button>
      <p className="wp-small">{replyTo ? `Questions? Write to ${replyTo}. ` : ""}No account needed. {biz} sends the next steps to {via === "link" ? "the email you give" : "your email"}. Your name, the time and your device are recorded.</p>
      {declining && (
        <Modal onClose={() => setDeclining(false)} label={`Decline this ${thing}`} width={480}>
          <div className="crm-dialog">
            <DialogHeader eyebrow={number} title={`Decline this ${thing}?`} body={`${biz} will be told. You can add a reason if you like.`} onClose={() => setDeclining(false)} />
            <TextArea label="Reason (optional)" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. We've gone another way for now." />
            {error && <p className="error" role="alert">{error}</p>}
            <div className="dfoot">
              <button className="btn ghost" type="button" onClick={() => setDeclining(false)}>Keep it open</button>
              <Button variant="primary" loading={busy === "decline"} onClick={() => void go("decline")}><Icon name="close" size={14} />Decline {thing}</Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
