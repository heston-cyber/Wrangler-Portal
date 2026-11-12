// Phase 3b · the client's quote page, /q/<token> (722:7998 open, 722:8207 accepting, 722:8420 accepted, 722:8622 declined,
// 722:8819 expired, 722:9015 void, 722:9209 Juniper & Ash, 723:8343 decline dialog). No account needed (D81). Accept
// with your typed name, or Decline (D80); the portal records the name, time, IP and device through its own endpoint,
// the same way signing does. The line under the button is D83's. D149: a person's own link or the copied link; Accept
// and Decline live in OfferAnswer.tsx.
import { useEffect, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Card, EmptyState, SkeletonRows, StatusChip } from "../../ui/wp";
import { money } from "./common";
import { OfferAnswer } from "./OfferAnswer";
import { Banner, Frame } from "./ClientInvoice";
import { downloadPdf } from "./pdfDownload";
import { QuotePaper, depositLabel, longIso, longMs, quotePdf, type QuoteDoc } from "./QuotePaper";

export default function ClientQuote({ token }: { token: string }) {
  const q = useQuery(api.quotes.page, { token });
  const viewed = useMutation(api.quotes.markViewed);
  const once = useRef(false);
  useEffect(() => { if (q && !once.current) { once.current = true; void viewed({ token }).catch(() => undefined); } }, [q, token, viewed]);
  if (q === undefined) return <Frame inShell={false} bar={null}><Card label="Loading"><SkeletonRows n={5} /></Card></Frame>;
  if (q === null) return <Frame inShell={false} bar={null}><EmptyState icon="invoice" title="This quote link doesn't work." body="It may have been mistyped. Open the link in the email again, or reply to that email." /></Frame>;
  const biz = q.business.name || "the business";
  // D149: who it's for, as this viewer sees it: their own name, or "Anyone with the link" (never anyone else).
  const forName = q.for.anyone ? "Anyone with the link" : q.for.name ?? "You";
  const doc: QuoteDoc = { business: q.business, number: q.number, issued: longMs(q.issued), validUntil: longIso(q.validUntil), contact: { name: forName, ...(q.for.company ? { company: q.for.company } : {}) }, project: q.project, lines: q.lines, totals: q.totals, taxPercent: q.taxPercent, deposit: q.deposit, terms: q.terms, acceptUrl: null };
  const s = q.status;
  const chip = s === "sent" ? <StatusChip tone="accent">Open</StatusChip> : s === "accepted" ? <StatusChip tone="success">Accepted</StatusChip> : s === "declined" ? <StatusChip tone="danger">Declined</StatusChip> : s === "void" ? <StatusChip tone="neutral">Withdrawn</StatusChip> : <StatusChip tone="neutral">Expired</StatusChip>;
  return (
    <Frame inShell={false} bar={null} brand={{ name: q.business.name, logoUrl: q.business.logoUrl }}>
      <div className="q-public-top"><span className="wp-small">Quote from {biz}</span><span className="sp" /><button type="button" className="btn sm" onClick={() => void downloadPdf(quotePdf(doc))}>Download PDF</button></div>
      <header className="wp-pagehead inv-head">
        <div className="txt"><span className="wp-eyebrow">Quote · {q.number}</span><h1 className="wp-h2">{q.title.replace(/\.$/, "")}.</h1>
          <p className="wp-body">For {[forName, q.for.company].filter(Boolean).join(", ")} · valid until {longIso(q.validUntil)}</p></div>
        {chip}
      </header>
      <div className="q-cols">
        <div className="col"><QuotePaper q={doc} showAccept={false} /></div>
        <div className="col right">
          <section className="inv-pay glass" aria-label="Accept this quote">
            <span className="wp-eyebrow">{s === "sent" ? "Accept this quote" : "This quote"}</span>
            <dl className="crm-dl q-sum">
              <dt className="big">Total</dt><dd className="big">{money(q.totals.total)}</dd>
              <dt>{depositLabel(q.deposit)}</dt><dd>{money(q.totals.deposit)}</dd>
            </dl>
            <OfferAnswer kind="quote" token={token} via={q.via} answer={q.answer} open={s === "sent"} biz={biz} number={q.number}
              closedNote={<>
                {s === "expired" && <Banner tone="neutral" icon="clock" title={`This quote expired on ${longIso(q.validUntil)}.`} text={`Ask ${biz} for a new one.`} />}
                {s === "void" && <Banner tone="neutral" icon="info" title="This quote was withdrawn." text={`${biz} may send you a new one.`} />}
              </>} />
          </section>
        </div>
      </div>
    </Frame>
  );
}
