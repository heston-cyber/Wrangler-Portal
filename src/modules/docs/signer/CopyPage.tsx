// D160 (Heston, Nov 6; built without frames, in the briefing and proposal pages' style): the view-only page for someone
// copied on a contract, /c/<token> on the sign host (/x/c/<token> on the portal). They read the document as sent, see
// who signs and who has, and get the signed copy once everyone has signed. Nothing to sign here.
import { useEffect, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Card, EmptyState, SkeletonRows } from "../../../ui/wp";
import { Icon } from "../../../ui/Icon";
import { Banner, Frame } from "../../payments/ClientInvoice";
import { PdfPages } from "../../proposals/ClientProposal";

const longMs = (ms: number) => new Date(ms).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric" });

export default function CopyPage({ token }: { token: string }) {
  const p = useQuery(api.signCopies.page, { token });
  const opened = useMutation(api.signCopies.opened);
  const once = useRef(false);
  useEffect(() => { if (p && (p.state === "sent" || p.state === "signed") && !once.current) { once.current = true; void opened({ token }).catch(() => undefined); } }, [p, token, opened]);
  if (p === undefined) return <Frame inShell={false} bar={null}><Card label="Loading"><SkeletonRows n={5} /></Card></Frame>;
  if (p === null) return <Frame inShell={false} bar={null}><EmptyState icon="lock" title="This link doesn't work." body="It may have been mistyped. Open the link in the email again, or ask whoever sent it." /></Frame>;
  const biz = p.business.name || "the business";
  const brand = { name: p.business.name, logoUrl: p.business.logoUrl };
  const top = <div className="q-public-top"><span className="wp-small">Copied on a document from {biz}</span><span className="sp" />
    {(p.state === "sent" || p.state === "signed") && p.fileUrl && <a className="btn sm" href={p.fileUrl} download={p.fileName} target="_blank" rel="noreferrer">{p.state === "signed" ? "Download the signed copy" : "Download PDF"}</a>}</div>;
  if (p.state === "cancelled" || p.state === "expired") return (
    <Frame inShell={false} bar={null} brand={brand}>{top}
      <EmptyState icon="lock" title={p.state === "cancelled" ? "This document was cancelled." : "These links have expired."} body={`${biz} ${p.state === "cancelled" ? "cancelled" : "let the links to"} “${p.title}” (${p.label})${p.state === "cancelled" ? "" : " expire"}. Questions? Reply to the email you got.`} />
    </Frame>
  );
  const signedCount = p.signers.filter((s) => s.signedAt).length;
  return (
    <Frame inShell={false} bar={null} brand={brand}>{top}
      <header className="wp-pagehead inv-head">
        <div className="txt"><span className="wp-eyebrow">{p.label}</span><h1 className="wp-h2">{p.title}.</h1>
          <p className="wp-body">{p.state === "signed" && p.completedAt ? `Signed by everyone · ${longMs(p.completedAt)}` : `Sent for signature by ${biz}`}</p></div>
      </header>
      <div className="q-cols">
        <div className="col">{p.fileUrl ? <PdfPages url={p.fileUrl} title={p.title} /> : <EmptyState icon="document" title="The document isn't available." />}</div>
        <div className="col right">
          <section className="inv-pay" aria-label="Who signs">
            <span className="wp-eyebrow">{p.state === "signed" ? "Signed" : `Signed ${signedCount} of ${p.signers.length}`}</span>
            <Banner tone="neutral" icon="info" title="You're copied." text="There's nothing for you to sign. You'll get the signed copy by email when everyone has signed." />
            <ul className="ws-copysigners">
              {p.signers.map((s, i) => (
                <li key={i}><Icon name={s.signedAt ? "check-circle" : "clock"} size={16} /><span><b>{s.name}</b>{s.title ? `, ${s.title}` : ""}<small>{s.signedAt ? `Signed ${longMs(s.signedAt)}` : "Not signed yet"}</small></span></li>
              ))}
              {p.ownerSigns && <li><Icon name="sign" size={16} /><span><b>{biz}</b><small>Signed when it was sent</small></span></li>}
            </ul>
            {p.state === "sent" && p.expiresAt && <p className="wp-small secondary">The signing links work until {longMs(p.expiresAt)}.</p>}
          </section>
        </div>
      </div>
    </Frame>
  );
}
