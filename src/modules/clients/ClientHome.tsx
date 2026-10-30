// The client's Home (P1 / Client / Home): what's waiting on them (new cuts to review, documents to sign) and the
// newest of their Inbox.
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { linkProps } from "../../lib/router";
import { ButtonLink, Card, Divider, InboxItem, ListRow, PageHeader, SectionHead, SkeletonRows, StatusChip } from "../../ui/wp";
import { INBOX_ICON, Day, dayWord, monthDay, type InboxKind } from "../inbox/common";
import { clockText } from "../../lib/format";
import { StageBar, STAGES, stageName } from "../projects/common";

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
function headline(n: number) {
  if (n === 0) return "You're all caught up.";
  const w = n < WORDS.length ? WORDS[n] : String(n);
  return n === 1 ? `${w} thing needs you.` : `${w} things need you.`;
}

export default function ClientHome() {
  const waiting = useQuery(api.portal.waiting);
  const inbox = useQuery(api.inbox.mine, { limit: 3 });
  const projects = useQuery(api.projects.mine, {});
  const project = projects?.[0];
  const n = waiting ? waiting.cuts.length + waiting.docs.length : 0;
  return (
    <div className="wp-page notop ch">
      <PageHeader title={waiting === undefined ? " " : headline(n)} sub={waiting === undefined ? " " : n ? "Everything else is up to date." : "New cuts and documents will show up here."} />
      <Card label="Waiting for you" head={<SectionHead label="Waiting for you" count={n || undefined} />}>
        {waiting === undefined ? <SkeletonRows n={2} />
          : n === 0 ? <ListRow className="ilead quiet" lead={{ icon: "check-circle" }} title="Nothing waiting on you right now." />
          : <>
            {waiting.cuts.map((c, i) => (
              <div key={c.videoId} className="wp-rowwrap">{i > 0 && <Divider />}
                <ListRow lead={{ thumb: c.thumbUrl, size: 96 }}
                  title={<><span className="pc-only">{c.title} · v{c.number}</span><span className="ph-only">{c.title}</span></>}
                  meta={<><span className="pc-only">New cut{c.lengthSec ? ` · ${clockText(c.lengthSec)}` : ""} · shared {dayWord(c.sharedAt)}</span><span className="ph-only">v{c.number} · shared {dayWord(c.sharedAt)}</span></>}
                  chip={<span className="pc-only"><StatusChip tone="accent">Ready to review</StatusChip></span>}
                  action={<ButtonLink size="sm" to={c.link}>Review</ButtonLink>} />
              </div>
            ))}
            {waiting.docs.map((d, i) => (
              <div key={d.documentId} className="wp-rowwrap">{(i > 0 || waiting.cuts.length > 0) && <Divider />}
                <ListRow className="ilead ch-doc" lead={{ icon: "sign" }}
                  title={<><span className="pc-only">{d.title} · {d.label}</span><span className="ph-only">{d.title}</span></>}
                  meta={<><span className="pc-only">Sent {d.sentAt ? monthDay(d.sentAt) : ""}{d.pages ? ` · ${d.pages} page${d.pages === 1 ? "" : "s"}` : ""}</span><span className="ph-only">{d.label} · sent {d.sentAt ? monthDay(d.sentAt) : ""}</span></>}
                  chip={<span className="pc-only"><StatusChip tone="warning">To sign</StatusChip></span>}
                  action={<a className="btn primary sm" href={d.signUrl}>Sign</a>} />
              </div>
            ))}
          </>}
      </Card>
      {project && (
        <Card className="ch-project" label="Your project" head={<SectionHead label={projects!.length > 1 ? "Your projects" : "Your project"} count={projects!.length > 1 ? projects!.length : undefined} action={<ButtonLink size="sm" variant="ghost" to={`/projects/${project._id}`}><span className="pc-only">Open project</span><span className="ph-only">Open</span></ButtonLink>} />}>
          <div className="pj-stagebody">
            <a className="ch-projname" {...linkProps(`/projects/${project._id}`)}>{project.label}</a>
            <StageBar stage={project.stage} />
            <span className="pj-stageph">{stageName(project.stage)} · stage {STAGES.indexOf(project.stage) + 1} of 5</span>
            {project.delivery ? <p className="cpj-next">Your final files are ready to download.</p> : project.nextStep && <p className="cpj-next">Next step: {project.nextStep}</p>}
          </div>
          {projects!.length > 1 && projects!.slice(1, 4).map((p) => (
            <div key={p._id} className="wp-rowwrap"><Divider /><ListRow to={`/projects/${p._id}`} title={p.label} meta={p.stage[0].toUpperCase() + p.stage.slice(1)} chevron /></div>
          ))}
        </Card>
      )}
      <Card label="Inbox" head={<SectionHead label="Inbox" count={inbox?.items.length || undefined} action={<ButtonLink size="sm" variant="ghost" to="/inbox"><span className="pc-only">Open Inbox</span><span className="ph-only">Open</span></ButtonLink>} />}>
        {inbox === undefined ? <SkeletonRows n={3} />
          : inbox.items.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "inbox" }} title="Nothing new yet. Cuts, documents and notes will show up here." />
          : inbox.items.slice(0, 3).map((it, i) => (
            <div key={it._id} className="wp-rowwrap">{i > 0 && <Divider />}
              <InboxItem icon={INBOX_ICON[it.kind as InboxKind]} title={it.title} detail={it.text || undefined} time={Day(it.createdAt)} unread={!it.read} to={`/inbox?item=${it._id}`} />
            </div>
          ))}
      </Card>
    </div>
  );
}
