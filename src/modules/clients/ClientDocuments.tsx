// The client's Documents (P1 / Client / Documents): everything sent to their email through Sign. To sign · Signed ·
// Cancelled. "Sign" opens today's signing page (same emailed code, consent and steps, rule 9); the portal only lists.
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button, Card, Divider, EmptyState, ListRow, PageHeader, SkeletonRows, StatusChip, Tabs } from "../../ui/wp";
import { useToast } from "../../ui/kit";
import { navigate } from "../../lib/router";
import { monthDay } from "../inbox/common";
import { useSignedCopy } from "./ClientInbox";

export type DocTab = "to_sign" | "signed" | "cancelled";
const andList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const pages = (n: number | null) => (n ? ` · ${n} page${n === 1 ? "" : "s"}` : "");

export default function ClientDocuments({ tab }: { tab: DocTab }) {
  const docs = useQuery(api.documents.mine);
  const brands = useQuery(api.business.brand);
  const [toast, show] = useToast();
  const download = useSignedCopy(show);
  const business = brands?.[0]?.name ?? "Wrangler Productions";
  const setTab = (k: DocTab) => navigate(k === "to_sign" ? "/docs" : `/docs?tab=${k}`);
  const counts = { to_sign: docs?.toSign.length ?? 0, signed: docs?.signed.length ?? 0, cancelled: docs?.cancelled.length ?? 0 };
  return (
    <div className="wp-page notop cdocs">
      <PageHeader title="Documents." sub={<span className="pc-only">Everything {business} has sent you to sign.</span>} />
      <div className="cdocs-tabs">
        <Tabs label="Documents" value={tab} onChange={setTab} items={[
          { key: "to_sign", label: "To sign", count: counts.to_sign || undefined }, { key: "signed", label: "Signed", count: counts.signed || undefined },
          { key: "cancelled", label: "Cancelled", count: counts.cancelled || undefined },
        ]} />
      </div>
      {docs === undefined ? <Card label="Documents"><SkeletonRows n={2} /></Card>
        : tab === "to_sign" ? (docs.toSign.length === 0
          ? <EmptyState icon="sign" title="Nothing to sign." body={`When ${business} sends you something to sign, it shows up here and in your Inbox.`} />
          : <Card label="To sign">{docs.toSign.map((d, i) => (
            <div key={d.documentId} className="wp-rowwrap">{i > 0 && <Divider />}
              <ListRow className="ilead" lead={{ icon: "sign" }}
                title={<><span className="pc-only">{d.label} · {d.title}</span><span className="ph-only">{d.title}</span></>}
                meta={d.expired ? "The signing link has expired. Ask for a new one by replying to the email."
                  : d.waiting ? `Sent ${d.sentAt ? monthDay(d.sentAt) : ""} · waiting for someone else to sign first`
                  : <><span className="pc-only">Sent {d.sentAt ? monthDay(d.sentAt) : ""}{pages(d.pages)}</span><span className="ph-only">{d.label} · sent {d.sentAt ? monthDay(d.sentAt) : ""}{pages(d.pages)}</span></>}
                chip={<span className="pc-only"><StatusChip tone="warning">To sign</StatusChip></span>}
                action={d.signUrl ? <a className="btn primary sm" href={d.signUrl}>Sign</a> : undefined} />
            </div>
          ))}</Card>)
        : tab === "signed" ? (docs.signed.length === 0
          ? <EmptyState icon="check-circle" title="Signed documents will be kept here." body="Each one comes with a signed copy you can download any time." />
          : <Card label="Signed">{docs.signed.map((d, i) => (
            <div key={d.documentId} className="wp-rowwrap">{i > 0 && <Divider />}
              <ListRow className="ilead" lead={{ icon: "check-circle" }}
                title={<><span className="pc-only">{d.label} · {d.title}</span><span className="ph-only">{d.title}</span></>}
                meta={d.completedAt ? `Signed ${monthDay(d.completedAt)} by ${andList(d.signers)}` : `You signed ${d.signedAt ? monthDay(d.signedAt) : ""} · waiting on the others`}
                chip={<span className="pc-only">{d.completedAt ? <StatusChip tone="success">Signed</StatusChip> : <StatusChip tone="neutral">Waiting</StatusChip>}</span>}
                action={d.hasCopy ? <Button size="sm" onClick={() => void download(d.documentId)}><span className="pc-only">Download signed copy</span><span className="ph-only">Download</span></Button> : undefined} />
            </div>
          ))}</Card>)
        : (docs.cancelled.length === 0
          ? <EmptyState icon="close" title="Nothing cancelled." />
          : <Card label="Cancelled">{docs.cancelled.map((d, i) => (
            <div key={d.documentId} className="wp-rowwrap">{i > 0 && <Divider />}
              <ListRow className="ilead" lead={{ icon: "close" }}
                title={<><span className="pc-only">{d.label} · {d.title}</span><span className="ph-only">{d.title}</span></>}
                meta={`Cancelled ${d.cancelledAt ? monthDay(d.cancelledAt) : ""} by ${business} · nothing to sign`}
                chip={<StatusChip tone="neutral">Cancelled</StatusChip>} />
            </div>
          ))}</Card>)}
      {tab === "to_sign" && docs && docs.toSign.length > 0 && <p className="cp-foot ph-only">Signed copies stay under Signed.</p>}
      {toast}
    </div>
  );
}
