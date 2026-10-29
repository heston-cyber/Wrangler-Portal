// The client's Review (P1 / Client / Review / Shared with you): every cut shared with them, grouped by client, with
// where they are on each (Approved, Notes sent, Not watched).
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Card, Divider, EmptyState, ListRow, PageHeader, SectionHead, SkeletonRows, StatusChip } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { TopBar } from "../../shell/Shell";
import { linkProps } from "../../lib/router";
import { ago } from "../../lib/format";

type Share = NonNullable<ReturnType<typeof useQuery<typeof api.shares.mine>>>[number];
type Video = Share["videos"][number];

function chip(v: Video) {
  if (v.state === "approved") return <StatusChip tone="success">Approved</StatusChip>;
  if (v.state === "notes") return <StatusChip tone="accent">Notes sent</StatusChip>;
  if (v.state === "not_watched") return <StatusChip tone="neutral">Not watched</StatusChip>;
  return undefined;
}

export default function ClientReview({ me }: { me: { name: string | null; email: string } }) {
  const mine = useQuery(api.shares.mine, {});
  const brands = useQuery(api.business.brand);
  const business = brands?.[0]?.name ?? "Wrangler Productions";
  const first = me.name?.trim().split(/\s+/)[0];
  const groups = new Map<string, Share[]>();
  for (const s of mine ?? []) { const k = s.client ?? business; groups.set(k, [...(groups.get(k) ?? []), s]); }
  const comment = (mine ?? []).some((s) => s.access === "comment");
  return (
    <>
      <TopBar><span className="here">Review</span></TopBar>
      <div className="wp-page crv">
        {mine === undefined ? <Card label="Shared with you"><SkeletonRows n={3} /></Card>
          : mine.length === 0 ? (
            <>
              <PageHeader eyebrow="Shared with you" title="Nothing here yet." sub={`When ${business} shares a video with ${me.email}, it shows up on this page and you'll get an email.`} />
              <EmptyState icon="review" title="No cuts shared yet." />
            </>
          ) : (
            <>
              <PageHeader eyebrow="Shared with you" title={first ? `Hi ${first}.` : "Hello."} sub={`Open a video to watch it${comment ? " (and leave notes on exact frames)" : ""}.`} />
              {[...groups.entries()].map(([client, shares]) => {
                const seen = new Set<string>();
                const rows: Array<{ s: Share; v: Video }> = [];
                for (const s of shares) for (const v of s.videos) if (!seen.has(v._id)) { seen.add(v._id); rows.push({ s, v }); }
                const subs = shares.filter((s) => s.kind !== "video" && s.label !== client);
                return (
                  <Card key={client} label={client} head={<SectionHead label={client} />}>
                    {subs.map((s) => (
                      <div key={s.token} className="crv-sub">
                        <span>{s.label}{s.videos.length === 0 ? " · nothing to watch yet" : ""}</span>
                        {s.videos.length > 0 && <a {...linkProps(`/s/${s.token}`)}>Open all</a>}
                      </div>
                    ))}
                    {rows.map(({ s, v }, i) => (
                      <div key={v._id} className="wp-rowwrap">{(i > 0 || subs.length > 0) && <Divider />}
                        <ListRow to={`/s/${s.token}/v/${v._id}`} lead={{ thumb: v.thumbUrl, size: 96 }} title={v.title}
                          meta={`${v.project ? `${v.project.replace(/^\d{5} /, "")} · ` : ""}v${v.latest}${v.versions > 1 ? ` of ${v.versions}` : ""} · updated ${ago(v.updatedAt)}`}
                          chip={chip(v)} action={<Icon name="arrow-right" size={16} className="go" />} />
                      </div>
                    ))}
                  </Card>
                );
              })}
            </>
          )}
      </div>
    </>
  );
}
