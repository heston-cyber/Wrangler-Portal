// Phase 3c step 3 · briefings, the owner's side (D97): Vendors › Briefings (S5 · Phase 3c 730:4522) with the Shoot
// brief and Edit brief templates, New briefing (who it's for, what to start from: no frame, built from the existing
// dialog pattern, in NewBriefing.tsx), and a briefing in the builder (731:3904).
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button, ButtonLink, Card, Divider, EmptyState, ListRow, PageHeader, PillTabs, SectionHead, SkeletonRows } from "../../ui/wp";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps, navigate } from "../../lib/router";
import Builder from "../docs/builder/Builder";
import { NewBriefing } from "./NewBriefing";
import { BriefChip, where } from "./VendorBriefings";

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
      <TopBar><a {...linkProps("/vendors")}>Vendors</a><Sep /><span className="here">Briefings</span></TopBar>
      <div className="wp-page">
        <PageHeader eyebrow="Vendors" title="Briefings." sub="Shoot and edit briefs, made in the builder. Send them to a booked vendor; see when they’ve read it." actions={<Button variant="primary" onClick={() => setNew({})}>New briefing</Button>} />
        {rows === undefined ? <Card label="Loading"><SkeletonRows n={4} /></Card> : (
          <>
            {rows.length > 0 && <PillTabs label="Show" value={pill} onChange={setPill} items={[{ key: "all", label: "All", count: count("all") }, { key: "draft", label: "Draft", count: count("draft") }, { key: "sent", label: "Sent", count: count("sent") }, { key: "read", label: "Read", count: count("read") }]} />}
            <Card label="Briefings" head={<SectionHead label="Briefings" count={shown.length} />}>
              {rows.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "note" }} title="No briefings yet." meta="Start one from a template below, or from a booking." />
                : shown.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "note" }} title="None here." />
                : shown.map((x, i) => <div key={x._id} className="wp-rowwrap">{i > 0 && <Divider />}
                  <ListRow className="ilead" lead={{ icon: "note" }} to={`/vendors/briefings/${x._id}`} title={x.title} meta={[x.vendor ?? "No one picked", where(x)].join(" · ")} chip={<BriefChip state={x.state} />} chevron /></div>)}
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
  if (b === undefined) return <><TopBar><a {...linkProps("/vendors/briefings")}>Briefings</a></TopBar><div className="wp-page"><Card label="Loading"><SkeletonRows n={4} /></Card></div></>;
  if (b === null) return <><TopBar><a {...linkProps("/vendors/briefings")}>Briefings</a></TopBar><div className="wp-page"><EmptyState icon="note" title="This briefing isn't here." body="It may have been a draft that was deleted." actions={<ButtonLink to="/vendors/briefings">All briefings</ButtonLink>} /></div></>;
  return <Builder key={b.buildId} mode={{ kind: "build", buildId: b.buildId, briefing: b }} />;
}
export function BriefingTemplateBuilder({ templateId }: { templateId: string }) {
  return <Builder key={templateId} mode={{ kind: "template", templateId: templateId as Id<"wsTemplates">, briefing: true }} />;
}

