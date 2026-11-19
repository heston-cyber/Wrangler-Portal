// Phase 8a (Heston, Nov 18, D209): the page a connector request opens on (/confirm/<id>). Claude asked Heston in chat
// first; nothing has happened yet. It happens only when the owner presses Confirm here, signed in. Built in the
// existing look (no frame yet; noted for the design chat in the Design Direction).
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button, Card, EmptyState, ListRow, PageHeader, SkeletonRows, StatusChip } from "../../ui/wp";
import { linkProps } from "../../lib/router";
import { TopBar, Sep } from "../../shell/Shell";
import { errText } from "../docs/pages/common";
import { ago } from "../../lib/format";

const STATUS: Record<string, { label: string; tone: "warning" | "success" | "neutral" | "danger" }> = {
  waiting: { label: "Waiting for you", tone: "warning" }, done: { label: "Done", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" }, replaced: { label: "Replaced by a newer ask", tone: "neutral" }, failed: { label: "Didn't go", tone: "danger" }, expired: { label: "Ran out", tone: "neutral" },
};

export function ConfirmPage({ id }: { id: string }) {
  const r = useQuery(api.confirm.get, { id });
  const confirm = useMutation(api.confirm.confirm);
  const cancel = useMutation(api.confirm.cancel);
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null), [doneNow, setDoneNow] = useState(false);
  const go = async (f: () => Promise<unknown>, after?: () => void) => {
    setBusy(true); setErr(null);
    try { await f(); after?.(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <>
      <TopBar><a {...linkProps("/")}>Dashboard</a><Sep /><span className="here">Claude's request</span></TopBar>
      <div className="wp-page">
        <PageHeader eyebrow="Claude connector" title="Claude is asking." sub="Nothing has happened yet. It happens only when you press Confirm." />
        {r === undefined ? <Card label="The request"><SkeletonRows n={2} label="Loading the request" /></Card>
          : r === null ? <EmptyState icon="alert" title="This request isn't here" body="It may belong to another business, or the link is wrong." />
          : (
            <Card label="The request">
              <div className="prow"><span className="pl"><b>{r.preview?.title ?? r.summary}</b></span><span className="pr"><StatusChip tone={STATUS[r.status]?.tone ?? "neutral"}>{STATUS[r.status]?.label ?? r.status}</StatusChip></span></div>
              {r.preview && <>
                <p className="caption secondary" style={{ margin: "4px 0 0" }}>Exactly what goes out:</p>
                {r.preview.lines.map((l, i) => (
                  <div className="prow" key={`${i}:${l.label}`}><span className="pl secondary">{l.label}</span><span className="pr" style={{ whiteSpace: "pre-wrap", textAlign: "left", maxWidth: "70%" }}>{l.value}</span></div>
                ))}
                {r.preview.open && <div className="prow"><span className="pl secondary">Check it on the site</span><span className="pr"><a {...linkProps(r.preview.open)}>Open it</a></span></div>}
              </>}
              {r.changed && <p className="error" role="alert">This changed since Claude asked. Check it, then ask Claude again or do it yourself. It can't be confirmed as it is.</p>}
              {r.problem && <p className="error" role="alert">{r.problem}</p>}
              <div className="prow"><span className="pl secondary">Claude says you told it</span><span className="pr">“{r.said}”</span></div>
              <div className="prow"><span className="pl secondary">Asked</span><span className="pr">{ago(r.requestedAt)}{r.status === "waiting" ? ` · works for ${Math.max(1, Math.round((r.expiresAt - Date.now()) / 3_600_000))} more hours` : ""}</span></div>
              {r.status === "waiting" && (
                <div className="dfoot">
                  <Button disabled={busy} onClick={() => void go(() => cancel({ id }))}>Don't do it</Button>
                  <Button variant="primary" loading={busy} disabled={r.changed || !!r.problem || !r.preview} onClick={() => void go(() => confirm({ id, hash: r.hash ?? "" }), () => setDoneNow(true))}>Confirm</Button>
                </div>
              )}
              {doneNow && <p className="caption" role="status">Done. Tell Claude in your chat, or it can check for itself.</p>}
              {err && <p className="error" role="alert">{err}</p>}
            </Card>
          )}
      </div>
    </>
  );
}

/** The Dashboard's rows: one per request still waiting. Nothing shows when there are none. */
export function ClaudeWaiting() {
  const rows = useQuery(api.confirm.waiting, {});
  if (!rows || !rows.length) return null;
  return (
    <Card label="Claude is waiting for your OK">
      {rows.map((r) => (
        <a key={r._id} {...linkProps(`/confirm/${r._id}`)} className="plain">
          <ListRow lead={{ icon: "globe" }} title={r.summary} meta={`Asked ${ago(r.requestedAt)}`} chip={<StatusChip tone="warning">Confirm</StatusChip>} chevron />
        </a>
      ))}
    </Card>
  );
}
