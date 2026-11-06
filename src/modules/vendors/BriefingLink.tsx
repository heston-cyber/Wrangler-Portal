// D147 · the no-login briefing page, /b/<token> (S5 · Phase 3c 863:17436 open, 863:17592 marked read, 863:17684 phone,
// 863:17805 withdrawn). Read-only, in the business's look, like the quote and proposal pages. The brief is the PDF that
// was shared (drawn page by page); "I've read it" beside it; Download PDF top right (not on Withdrawn). A person's own
// link records their name; a copied link counts opens only. Withdrawn = the owner turned the link off (Q91 a).
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button, Card, EmptyState, SkeletonRows } from "../../ui/wp";
import { CONVEX_SITE } from "../docs/lib/client";
import { Banner, Frame } from "../payments/ClientInvoice";
import { PdfPages } from "../proposals/ClientProposal";
import { errText } from "../docs/pages/common";

const longMs = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
export const briefingPdfUrl = (token: string, download = false) => `${CONVEX_SITE}/b-pdf/${encodeURIComponent(token)}${download ? "?download" : ""}`;

export default function BriefingLink({ token }: { token: string }) {
  const p = useQuery(api.briefings.page, { token });
  const opened = useMutation(api.briefings.opened);
  const markRead = useMutation(api.briefings.markRead);
  const once = useRef(false);
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null), [done, setDone] = useState(false);
  useEffect(() => { if (p && !p.withdrawn && !once.current) { once.current = true; void opened({ token }).catch(() => undefined); } }, [p, token, opened]);
  if (p === undefined) return <Frame inShell={false} bar={null}><Card label="Loading"><SkeletonRows n={5} /></Card></Frame>;
  if (p === null) return <Frame inShell={false} bar={null}><EmptyState icon="lock" title="This link doesn't work." body="It may have been mistyped. Open the link in the email again, or ask whoever sent it." /></Frame>;
  const biz = p.business.name || "the business";
  const brand = { name: p.business.name, logoUrl: p.business.logoUrl };
  if (p.withdrawn) return (
    <Frame inShell={false} bar={null} brand={brand}>
      <div className="q-public-top"><span className="wp-small">Briefing from {biz}</span></div>
      <EmptyState icon="lock" title="This briefing was withdrawn." body={`${biz} turned off the link to “${p.title}”. If you still need it, ask them for a new one.`} />
    </Frame>
  );
  const sender = p.business.owner?.split(" ")[0] || biz;
  const read = done || !!p.readAt;
  const go = async () => {
    setBusy(true); setErr(null);
    try { await markRead({ token }); setDone(true); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Frame inShell={false} bar={null} brand={brand}>
      <div className="q-public-top"><span className="wp-small">Briefing from {biz}</span><span className="sp" />
        <a className="btn sm" href={briefingPdfUrl(token, true)} download>Download PDF</a></div>
      <header className="wp-pagehead inv-head">
        <div className="txt"><span className="wp-eyebrow">Briefing{p.project ? ` · ${p.project}` : ""}</span><h1 className="wp-h2">{p.kind}.</h1>
          <p className="wp-body">{[p.title, p.dates, p.business.owner ? `from ${p.business.owner}` : null].filter(Boolean).join(" · ")}</p>
          {p.updatedAt && <p className="wp-small secondary">Updated {longMs(p.updatedAt)}, {new Date(p.updatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</p>}</div>
      </header>
      <div className="q-cols">
        <div className="col"><PdfPages url={briefingPdfUrl(token)} title={p.title} /></div>
        <div className="col right">
          <section className="inv-pay" aria-label={read ? "Marked read" : "Read it?"}>
            <span className="wp-eyebrow">{read ? "Marked read" : "Read it?"}</span>
            {read ? <Banner tone="success" icon="check-circle" title={p.readAt ? `You marked it read · ${longMs(p.readAt)}` : "Thanks. You marked it read."} text={`${sender} can see you've read it.`} />
              : <>
                <p className="wp-small">Let {sender} know you’ve read the brief. Questions? Reply to the email.</p>
                {err && <p className="error" role="alert">{err}</p>}
                <Button variant="primary" className="q-big" loading={busy} onClick={() => void go()}>I’ve read it</Button>
              </>}
            {!p.named && <p className="wp-small secondary">No login needed. This link was shared, so your name isn't recorded.</p>}
          </section>
        </div>
      </div>
    </Frame>
  );
}
