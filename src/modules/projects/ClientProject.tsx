// Phase 2 Part A (Oct 29): one project as its client sees it (frames 150:1611, 150:3252, phones 150:4471 / 245:876).
// Where it's at (the five stages and the next step), the videos with their rounds, key dates, documents, and the
// final files: locked until the business unlocks them, then a download for each (links last a set number of days).
// Invoices arrive with Part B.
import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button, ButtonLink, Card, Divider, EmptyState, ListRow, SectionHead, SkeletonRows, StatusChip, Tabs } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { useToast } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps, navigate } from "../../lib/router";
import { downloadOne, downloadZip } from "../../lib/download";
import { errText } from "../docs/pages/common";
import { useSignedCopy } from "../clients/ClientInbox";
import { StageBar, stageName, dateText, bytes, STAGES } from "./common";

type Data = NonNullable<ReturnType<typeof useQuery<typeof api.projects.forClient>>>;
export type ClientProjectTab = "overview" | "videos" | "documents";
const monthDay = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });

function videoChip(v: Data["videos"][number]) {
  if (v.final) return <StatusChip tone="success">Final</StatusChip>;
  if (v.approved) return <StatusChip tone="success">Approved</StatusChip>;
  return <StatusChip tone="accent">Ready to review</StatusChip>;
}

function Videos({ d, max }: { d: Data; max?: number }) {
  const list = max ? d.videos.slice(0, max) : d.videos;
  if (!list.length) return <ListRow className="ilead quiet" lead={{ icon: "video" }} title="No cuts to watch yet." />;
  return <>{list.map((v, i) => (
    <div key={v._id} className="wp-rowwrap">{i > 0 && <Divider />}
      <ListRow to={`/s/${v.token}/v/${v._id}`} lead={{ thumb: v.thumbUrl, size: 72 }} title={v.title}
        meta={<>{v.approved ? `Approved v${v.version}` : `v${v.version}`} · <span className={v.round.state === "last" ? "cpj-last" : undefined}>{v.round.label}</span></>}
        chip={<span className="pc-only">{videoChip(v)}</span>} action={<Icon name="arrow-right" size={16} className="go" />} />
    </div>
  ))}</>;
}

function Documents({ d, show, max }: { d: Data; show: (m: string) => void; max?: number }) {
  const download = useSignedCopy(show);
  const list = (max ? d.documents.slice(0, max) : d.documents).filter((x) => x.status !== "voided");
  if (!list.length) return <p className="pj-pad secondary">No documents yet.</p>;
  return <>{list.map((x, i) => (
    <div key={x._id} className="wp-rowwrap">{i > 0 && <Divider />}
      <ListRow className="ilead" lead={{ icon: "document" }} title={x.title}
        meta={x.status === "completed" ? `Signed ${x.completedAt ? monthDay(x.completedAt) : ""}` : `Sent ${x.sentAt ? monthDay(x.sentAt) : ""} · to sign`}
        action={x.status === "completed"
          ? <button type="button" className="icon-btn" onClick={() => void download(x._id)} aria-label={`Download ${x.title}`} title="Download the signed copy"><Icon name="download" size={18} /></button>
          : <ButtonLink size="sm" variant="primary" to="/docs">Sign</ButtonLink>} />
    </div>
  ))}</>;
}

function FinalFiles({ d, show, wide }: { d: Data; show: (m: string) => void; wide?: boolean }) {
  const link = useAction(api.projects.deliveryLink);
  const [busy, setBusy] = useState<string | null>(null);
  const business = d.business ?? "the studio";
  const one = async (f: Data["delivery"]["files"][number]) => {
    setBusy(f._id);
    let url: string | null = null;
    try {
      const r = await link({ fileId: f._id as Id<"deliveryFiles"> });
      url = r.url;
      const ok = await downloadOne(r.url, r.name, f.size ?? null, () => {});
      if (ok) show("Downloaded.");
    } catch (e) {
      if (url) { window.open(url, "_blank", "noopener"); show("Opened the file in a new tab; save it from there."); }
      else show(errText(e));
    }
    setBusy(null);
  };
  const all = async () => {
    setBusy("all");
    try {
      const files = [];
      for (const f of d.delivery.files) { const r = await link({ fileId: f._id as Id<"deliveryFiles"> }); files.push({ url: r.url, name: r.name, bytes: f.size ?? null }); }
      const ok = await downloadZip(files, `${d.label} final files.zip`, () => {});
      if (ok) show("Downloaded.");
    } catch (e) { show(`${errText(e)} Try the files one at a time.`); }
    setBusy(null);
  };
  if (!d.delivery.open) {
    return (
      <Card className="cpj-final" label="Final files" head={<SectionHead label="Final files" count={d.delivery.count || undefined} />}>
        <p className="pj-lockline static"><Icon name="lock" size={18} /><span>{d.delivery.expired
          ? `The download links expired. Ask ${business} for new ones any time.`
          : `Final files unlock here when ${business} sends them.`}</span></p>
      </Card>
    );
  }
  return (
    <div className={`cpj-finalwrap${wide ? " wide" : ""}`}>
      <Card className="cpj-final open" label="Final files" head={<SectionHead label="Final files" count={d.delivery.files.length} action={d.delivery.files.length > 1 ? <Button size="sm" variant="primary" onClick={() => void all()} disabled={!!busy}>{busy === "all" ? "Downloading…" : "Download all"}</Button> : undefined} />}>
        {d.delivery.files.map((f, i) => (
          <div key={f._id} className="wp-rowwrap">{i > 0 && <Divider />}
            <ListRow className="ilead" lead={{ icon: "video" }} title={f.name}
              meta={[f.size ? bytes(f.size) : null, f.kind === "dropbox" ? "Dropbox link" : null].filter(Boolean).join(" · ") || undefined}
              action={<Button size="sm" onClick={() => void one(f)} disabled={!!busy}>{busy === f._id ? "Downloading…" : "Download"}</Button>} />
          </div>
        ))}
      </Card>
      {d.delivery.expiresAt && <p className="cpj-expires secondary">Links expire {monthDay(d.delivery.expiresAt)}. Ask for new ones any time.</p>}
    </div>
  );
}

export default function ClientProject({ projectId, tab }: { projectId: string; tab: ClientProjectTab }) {
  const d = useQuery(api.projects.forClient, { projectId });
  const [toast, show] = useToast();
  const setTab = (k: ClientProjectTab) => navigate(`/projects/${projectId}${k === "overview" ? "" : `?tab=${k}`}`);
  if (d === undefined) return <><TopBar><a {...linkProps("/review")}>Review</a></TopBar><div className="wp-page"><Card label="Loading"><SkeletonRows n={4} /></Card></div></>;
  if (d === null) return <><TopBar><a {...linkProps("/review")}>Review</a></TopBar><div className="wp-page"><EmptyState icon="review" title="This project isn't here." body="It may not be shared with you any more." actions={<ButtonLink to="/review">Back to Review</ButtonLink>} /></div></>;
  const at = STAGES.indexOf(d.stage);
  const tags = d.delivery.open
    ? [stageName(d.stage)]
    : [`${d.videos.length} ${d.videos.length === 1 ? "video" : "videos"}`, `${d.rounds} ${d.rounds === 1 ? "round" : "rounds"} per video`];
  return (
    <>
      <TopBar><a {...linkProps("/review")}>Review</a><Sep /><span className="here">{d.label}</span></TopBar>
      <div className="wp-page cpj">
        <a className="wp-setback" {...linkProps("/review")}><Icon name="arrow-left" size={20} />Review</a>
        <header className="pj-head">
          {d.business && <span className="wp-eyebrow">{d.business}</span>}
          <h1 className="wp-h2" title={d.label}>{d.label}</h1>
          <div className="tags">{tags.map((t) => <span key={t} className="wp-tag">{t}</span>)}</div>
        </header>
        <div className="ws-tabs cp-tabs">
          <Tabs label="Project" value={tab} onChange={setTab} items={[
            { key: "overview", label: "Overview" }, { key: "videos", label: "Videos", count: d.videos.length }, { key: "documents", label: "Documents", count: d.documents.length },
          ]} />
        </div>
        {tab === "overview" && (
          <div className="cpj-overview">
            <Card className="cpj-where" label="Where it's at" head={<SectionHead label="Where it's at" />}>
              <div className="pj-stagebody">
                <StageBar stage={d.stage} />
                <span className="pj-stageph">{stageName(d.stage)} · stage {at + 1} of 5</span>
                {d.nextStep && <p className="cpj-next">Next step: {d.nextStep}</p>}
              </div>
            </Card>
            {d.delivery.open && <FinalFiles d={d} show={show} wide />}
            <div className="wp-homecols">
              <div className="col">
                <Card className="cpj-videos" label="Videos" head={<SectionHead label="Videos" count={d.videos.length} />}><Videos d={d} max={6} /></Card>
              </div>
              <div className="col right">
                {d.keyDates.length > 0 && (
                  <Card className="cpj-dates" label="Key dates" head={<SectionHead label="Key dates" />}>
                    <dl className="cp-see">{d.keyDates.map((k) => <div key={k.label + k.date} style={{ display: "contents" }}><dt>{k.label}</dt><dd>{dateText(k.date)}</dd></div>)}</dl>
                  </Card>
                )}
                <Card className="cpj-docs" label="Documents" head={<SectionHead label="Documents" count={d.documents.length || undefined} />}><Documents d={d} show={show} max={4} /></Card>
                {!d.delivery.open && <FinalFiles d={d} show={show} />}
              </div>
            </div>
          </div>
        )}
        {tab === "videos" && <Card label="Videos"><Videos d={d} /></Card>}
        {tab === "documents" && <Card label="Documents"><Documents d={d} show={show} /></Card>}
      </div>
      {toast}
    </>
  );
}
