// Sent (P1 / Owner / Sent): your notes and the automatic updates, newest first, with drafts on top; and one sent note
// opened, with each person's read status.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { ButtonLink, Card, Divider, EmptyState, ListRow, PageHeader, PillTabs, SectionHead, SkeletonRows, StatusChip } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { useToast } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps } from "../../lib/router";
import { INBOX_ICON, dayWord, monthDay, timeOfDay, type InboxKind } from "../inbox/common";

type Row = NonNullable<ReturnType<typeof useQuery<typeof api.inbox.sent>>>[number];
type Filter = "all" | "notes" | "auto";
const TYPE = { draft: "Draft", note: "Note", auto: "Automatic" } as const;

function status(r: Row) {
  if (r.type === "draft") return "Not sent";
  if (r.readBy === 0) return "Not opened";
  const read = r.sentTo === 1 ? "Read" : `Read by ${r.readBy}`;
  return r.emailed ? `${read} · emailed` : read;
}
const shortStatus = (r: Row) => (r.type === "draft" ? `saved ${dayWord(r.at)}` : r.readBy === 0 ? "not opened" : r.sentTo === 1 ? "read" : `read by ${r.readBy}`);
const title = (r: Row) => (r.type === "auto" && r.subject && r.kind !== "signed" ? `${r.title}: ${r.subject}` : r.title);

export default function SentPage() {
  const rows = useQuery(api.inbox.sent, {});
  const [filter, setFilter] = useState<Filter>("all");
  const list = (rows ?? []).filter((r) => filter === "all" || (filter === "notes" ? r.type !== "auto" : r.type === "auto"));
  const post = <ButtonLink variant="primary" icon="plus" to="/sent/new">Post a note</ButtonLink>;
  return (
    <div className="wp-page notop wp-sent">
      <PageHeader title="Sent." sub={<span className="pc-only">Notes and automatic updates, newest first.</span>} actions={post} />
      {rows === undefined ? <Card label="Sent"><SkeletonRows n={5} /></Card>
        : rows.length === 0 ? <EmptyState icon="send" title="Nothing sent yet." body="Notes and automatic updates you send show up here." actions={post} />
        : (
          <>
            <PillTabs label="Show" value={filter} onChange={setFilter} items={[{ key: "all", label: "All" }, { key: "notes", label: "Notes" }, { key: "auto", label: "Automatic" }]} />
            {list.length === 0 ? <EmptyState icon="send" title={filter === "notes" ? "No notes yet." : "No automatic updates yet."} />
              : (
                <Card label="Sent">
                  {list.map((r, i) => (
                    <div key={r.key} className="wp-rowwrap">{i > 0 && <Divider />}
                      <ListRow to={r.open} className="ilead" lead={{ icon: INBOX_ICON[r.kind as InboxKind] ?? "mail" }} title={title(r)}
                        titleChip={r.type === "draft" ? <StatusChip tone="accent">Draft</StatusChip> : undefined}
                        meta={<><span className="pc-only">{TYPE[r.type]} · to {r.to} · {r.type === "draft" ? `saved ${dayWord(r.at)}` : dayWord(r.at)}</span><span className="ph-only">{TYPE[r.type]} · {r.to} · {shortStatus(r)}</span></>}
                        trailing={<span className="pc-only">{status(r)}</span>} chevron />
                    </div>
                  ))}
                </Card>
              )}
          </>
        )}
    </div>
  );
}

export function SentNote({ noteId, sent }: { noteId: Id<"inboxNotes">; sent: number | null }) {
  const n = useQuery(api.inbox.noteDetail, { noteId });
  const biz = useQuery(api.business.settings, {});
  const [toast, show] = useToast();
  const told = useRef(false);
  useEffect(() => {
    if (!sent || told.current) return;
    told.current = true;
    show(`Note sent to ${sent} ${sent === 1 ? "person" : "people"}.`);
    history.replaceState(null, "", `/sent/${noteId}`);
  }, [sent, noteId, show]);
  const crumbs = (here: string) => <TopBar><a {...linkProps("/sent")}>Sent</a><Sep /><span className="here">{here}</span></TopBar>;
  if (n === undefined) return <>{crumbs("Note")}<div className="wp-page"><Card label="Loading"><SkeletonRows n={3} /></Card></div></>;
  if (n === null) return <>{crumbs("Note")}<div className="wp-page"><EmptyState icon="send" title="This note isn't here." body="It may have been discarded." actions={<ButtonLink to="/sent">Sent</ButtonLink>} /></div></>;
  const emailed = n.people.filter((p) => p.emailedAt);
  const replyTo = biz?.replyTo || biz?.ownerEmail || "";
  const a = n.attachment;
  return (
    <>
      {crumbs(n.title)}
      <div className="wp-page sn">
        <a className="wp-setback" {...linkProps("/sent")}><Icon name="arrow-left" size={20} />Sent</a>
        <PageHeader eyebrow={`Note · to ${n.client ?? "a client"}`} title={n.title}
          sub={n.sentAt ? `Sent ${monthDay(n.sentAt)}, ${timeOfDay(n.sentAt)}${emailed.length ? " · emailed" : ""}` : "Not sent yet"} />
        <div className="wp-homecols sn-cols">
          <div className="col">
            <Card label="Message" head={<SectionHead label="Message" />}>
              <div className="sn-msg">{n.text ? n.text.split(/\n+/).map((p, i) => <p key={i}>{p}</p>) : <p className="secondary">No message, just the title.</p>}</div>
              {a && n.link && (a.kind === "cut" ? (
                <ListRow to={`/v/${a.videoId}?version=${a.number}`} lead={{ thumb: a.thumbUrl, size: 64 }} title={`${a.title} · v${a.number}`} meta="Attached cut" chevron />
              ) : (
                <ListRow className="ilead" lead={{ icon: "document" }} title={n.linkLabel?.replace(/^Open /, "") ?? n.link} meta={a.kind === "doc" ? "Attached document" : "Attached link"} />
              ))}
            </Card>
          </div>
          <div className="col right">
            <Card label="Sent to" head={<SectionHead label="Sent to" count={n.people.length} />}>
              {n.people.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "users" }} title="No one yet." /> : n.people.map((p, i) => (
                <div key={p.email} className="wp-rowwrap">{i > 0 && <Divider />}
                  <ListRow lead={{ avatar: p.name ?? p.email, two: true }} title={p.name ?? p.email} meta={p.email}
                    trailing={p.readAt ? <><span className="pc-only">Read {monthDay(p.readAt)}, {timeOfDay(p.readAt)}</span><span className="ph-only">Read {monthDay(p.readAt)}</span></> : <span className="secondary">Not read yet</span>} />
                </div>
              ))}
            </Card>
            {emailed.length > 0 && (
              <p className="cp-foot pc-only"><Icon name="mail" size={16} />Emailed to {emailed.length === n.people.length ? (emailed.length === 2 ? "both" : "everyone") : emailed.map((p) => p.name ?? p.email).join(", ")} from updates@wranglerportal.com{replyTo ? ` · replies go to ${replyTo}` : ""}</p>
            )}
          </div>
        </div>
      </div>
      {toast}
    </>
  );
}
