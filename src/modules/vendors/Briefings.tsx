// Phase 3c step 3 · briefings, the owner's side (D97): Vendors › Briefings with the Shoot brief and Edit brief
// templates, New briefing (NewBriefing.tsx), and a briefing in the builder (731:3904).
// D147 (Nov 4): the list is 870:17016 (Sent to and Opened columns; tabs All, Draft, Sent, Read; Q95: Read once
// everyone emailed has read it). A shared briefing opens its own page (BriefingShare.tsx), a draft the builder.
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button, ButtonLink, Card, Divider, EmptyState, ListRow, PageHeader, PillTabs, SectionHead, SkeletonRows } from "../../ui/wp";
import { useToast } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { dateShort } from "../payments/common";
import { BriefingPage } from "./BriefingShare";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps, navigate } from "../../lib/router";
import Builder from "../docs/builder/Builder";
import { NewBriefing } from "./NewBriefing";
import { BriefChip } from "./VendorBriefings";

type Row = NonNullable<ReturnType<typeof useQuery<typeof api.briefings.list>>>[number];
const day = (t: number) => (new Date(t).toDateString() === new Date().toDateString() ? "today" : dateShort(t));
/** The Briefing column's second line: "Sent Nov 1", "Link copied Nov 3", "Draft". */
const sentLine = (x: Row) => (x.state === "draft" ? "Draft" : x.people.length ? `Sent ${x.sentAt ? day(x.sentAt) : ""}` : `Link copied ${x.sentAt ? day(x.sentAt) : ""}`);
/** Sent to: a name ("and 1 more") and how they got it. */
function sentTo(x: Row): [string, string] {
  if (x.state === "draft") return ["Not sent yet", ""];
  if (!x.people.length) return ["Anyone with the link", "Link copied, not emailed"];
  const first = x.people[0];
  const name = x.people.length > 1 ? `${first.label} and ${x.people.length - 1} more` : first.label;
  const many = x.people.length > 1;
  const kind = x.people.every((p) => p.booked) ? (many ? "Booked vendors" : "Booked vendor") : x.people.every((p) => !p.booked && p.vendor) ? (many ? "Not booked vendors" : "Not booked vendor")
    : x.people.some((p) => p.vendor) ? "Vendors and others" : "";
  return [name, [kind || null, many ? "emailed links" : "emailed link", x.link.copied ? "a copied link" : null].filter(Boolean).join(" · ")];
}
/** Opened: who and when, or the copied link's count. */
function opened(x: Row): [string, string] {
  if (x.state === "draft") return ["—", ""];
  if (!x.people.length) return [x.link.opens ? `${x.link.opens} ${x.link.opens === 1 ? "open" : "opens"}` : "Not opened yet", "Names aren’t known for a copied link"];
  const seen = x.people.filter((p) => p.openedAt).sort((a, b) => (a.openedAt ?? 0) - (b.openedAt ?? 0));
  const read = x.people.filter((p) => p.readAt).length;
  if (!seen.length) return ["Not opened yet", ""];
  const head = `${seen[0].label} · ${day(seen[0].openedAt!)}`;
  if (x.people.length === 1) return [head, read ? "Marked as read" : "Opened"];
  return [head, read ? `${read} of ${x.people.length} have read it` : `${seen.length} of ${x.people.length} have opened it`];
}

// ---------- Vendors › Briefings (730:4522) ----------

type Pill = "all" | "draft" | "sent" | "read";
export default function BriefingsPage() {
  const rows = useQuery(api.briefings.list, {});
  const tpls = useQuery(api.briefings.templates, {});
  const [pill, setPill] = useState<Pill>("all");
  const asked = new URLSearchParams(window.location.search).get("template");
  const [newOpen, setNew] = useState<null | { templateId?: string; starter?: "shoot" | "edit" }>(asked ? { templateId: asked } : null);
  const count = (p: Pill) => (rows ?? []).filter((x) => p === "all" || x.state === p).length;
  const shown = (rows ?? []).filter((x) => pill === "all" || x.state === pill);
  return (
    <>
      <TopBar><a {...linkProps("/production")}>Production</a><Sep /><span className="here">Briefings</span></TopBar>
      <div className="wp-page">
        <PageHeader eyebrow="Production · Pre-pro" title="Briefings." sub="Shoot and edit briefs, made in the builder. Email one to a booked vendor or to anyone else, or copy a link; see who has opened it." actions={<Button variant="primary" onClick={() => setNew({})}>New briefing</Button>} />
        {rows === undefined ? <Card label="Loading"><SkeletonRows n={4} /></Card> : (
          <>
            {rows.length > 0 && <PillTabs label="Show" value={pill} onChange={setPill} items={[{ key: "all", label: "All", count: count("all") }, { key: "draft", label: "Draft", count: count("draft") }, { key: "sent", label: "Sent", count: count("sent") }, { key: "read", label: "Read", count: count("read") }]} />}
            <Card label="Briefings" head={<SectionHead label="Briefings" count={shown.length} />}>
              {rows.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "note" }} title="No briefings yet." meta="Start one from a template below." />
                : shown.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "note" }} title="None here." />
                : <>
                  <div className="bf-thead" aria-hidden><span /><span>Briefing</span><span>Sent to</span><span>Opened</span><span /></div>
                  {shown.map((x, i) => { const [t1, t2] = sentTo(x), [o1, o2] = opened(x); return (
                    <div key={x._id} className="wp-rowwrap">{i > 0 && <Divider />}
                      <a className="wp-row ilead bf-trow" {...linkProps(`/vendors/briefings/${x._id}`)}>
                        <Icon name="note" size={20} className="lead-icon" />
                        <span className="txt"><span className="ttl">{x.title}</span><span className="meta">{sentLine(x)}</span></span>
                        <span className="txt bf-col"><span className="ttl">{t1}</span>{t2 && <span className="meta">{t2}</span>}</span>
                        <span className="txt bf-col"><span className="ttl">{o1}</span>{o2 && <span className="meta">{o2}</span>}</span>
                        <span className="bf-end"><BriefChip state={x.state} /><Icon name="chevron-right" size={16} className="chev" /></span>
                      </a></div>); })}
                </>}
            </Card>
          </>
        )}
        <Card label="Briefing templates" head={<SectionHead label="Briefing templates" count={tpls ? tpls.starters.length + tpls.saved.length : undefined} />}>
          {tpls === undefined ? <SkeletonRows n={2} /> : <>
            {tpls.starters.map((t, i) => <div key={t.key} className="wp-rowwrap">{i > 0 && <Divider />}
              <ListRow className="ilead" lead={{ icon: "folder" }} title={t.name} meta={t.summary} action={<Button size="sm" onClick={() => setNew({ starter: t.key })}>Use</Button>} /></div>)}
            {tpls.saved.map((t) => <div key={t._id} className="wp-rowwrap"><Divider />
              <ListRow className="ilead" lead={{ icon: "folder" }} to={`/vendors/briefings/templates/${t._id}`} title={t.name} meta={t.description || "Your template"} action={<Button size="sm" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setNew({ templateId: t._id }); }}>Use</Button>} /></div>)}
          </>}
        </Card>
        {tpls && tpls.saved.length === 0 && <p className="wp-small secondary">Save your own from any briefing: Save as briefing template, in the builder.</p>}
      </div>
      {newOpen && <NewBriefing templateId={newOpen.templateId} starter={newOpen.starter} onClose={() => { setNew(null); if (asked) navigate("/vendors/briefings"); }} />}
    </>
  );
}

// ---------- a briefing in the builder (731:3904), and a briefing template ----------

export function BriefingBuilder({ briefingId }: { briefingId: string }) {
  const b = useQuery(api.briefings.get, { briefingId });
  const [toast, show] = useToast();
  if (b === undefined) return <><TopBar><a {...linkProps("/vendors/briefings")}>Briefings</a></TopBar><div className="wp-page"><Card label="Loading"><SkeletonRows n={4} /></Card></div></>;
  if (b === null) return <><TopBar><a {...linkProps("/vendors/briefings")}>Briefings</a></TopBar><div className="wp-page"><EmptyState icon="note" title="This briefing isn't here." body="It may have been a draft that was deleted." actions={<ButtonLink to="/vendors/briefings">All briefings</ButtonLink>} /></div></>;
  if (b.state !== "draft") return <BriefingPage b={b} show={show} toast={toast} />; // shared: its own page (863:16685)
  return <Builder key={b.buildId} mode={{ kind: "build", buildId: b.buildId, briefing: b }} />;
}
export function BriefingTemplateBuilder({ templateId }: { templateId: string }) {
  return <Builder key={templateId} mode={{ kind: "template", templateId: templateId as Id<"wsTemplates">, briefing: true }} />;
}

