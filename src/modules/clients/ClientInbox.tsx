// The client's Inbox (P1 / Client / Inbox): everything new, newest first. Unread · All (opens on All), Mark all read.
// A note opens in place (on a phone, on its own); everything else goes where it points. Replies go by email.
import { useEffect, useState } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button, ButtonLink, Card, Divider, EmptyState, InboxItem, PageHeader, PillTabs, SkeletonRows } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { useToast } from "../../ui/kit";
import { linkProps, navigate } from "../../lib/router";
import { INBOX_ICON, Day, timeOfDay, type InboxKind } from "../inbox/common";

type Item = NonNullable<ReturnType<typeof useQuery<typeof api.inbox.mine>>>["items"][number];

/** Download a signed copy: its signed link, fetched when asked for. */
export function useSignedCopy(show: (m: string) => void) {
  const convex = useConvex();
  return async (documentId: string) => {
    try {
      const r = await convex.query(api.documents.signedCopy, { documentId: documentId as Id<"wsDocuments"> });
      if (r.url) window.location.href = r.url;
      else show("The signed copy isn't ready yet.");
    } catch { show("The signed copy isn't ready yet."); }
  };
}

function NoteBody({ it, business }: { it: Item; business: string }) {
  return (
    <div className="ci-note">
      <p className="from">A note from {it.from ?? business} · {Day(it.createdAt)}, {timeOfDay(it.createdAt)}</p>
      {it.text && it.text.split(/\n+/).map((p, i) => <p key={i} className="txt">{p}</p>)}
      {it.link && (/^https:\/\//.test(it.link) ? <a className="btn sm" href={it.link}>{it.linkLabel ?? "Open"}</a> : <ButtonLink size="sm" to={it.link}>{it.linkLabel ?? "Open in the portal"}</ButtonLink>)}
    </div>
  );
}

export default function ClientInbox({ itemId }: { itemId: string | null }) {
  const data = useQuery(api.inbox.mine, { limit: 200 });
  const brands = useQuery(api.business.brand);
  const markRead = useMutation(api.inbox.markRead);
  const markAll = useMutation(api.inbox.markAllRead);
  const [tab, setTab] = useState<"unread" | "all">("all");
  const [toast, show] = useToast();
  const download = useSignedCopy(show);
  const business = brands?.[0]?.name ?? "Wrangler Productions";
  const items = data?.items ?? [];
  const list = tab === "unread" ? items.filter((i) => !i.read) : items;
  const open = itemId ? items.find((i) => i._id === itemId) ?? null : null;
  const read = (it: Item) => { if (!it.read) void markRead({ itemId: it._id }); };
  const go = (it: Item) => {
    read(it);
    if (it.kind === "note") { navigate(itemId === it._id ? "/inbox" : `/inbox?item=${it._id}`); return; }
    if (it.link) { if (/^https:\/\//.test(it.link)) window.location.href = it.link; else navigate(it.link); }
  };
  const action = (it: Item) => {
    if (it.kind === "cut_ready" && it.link) return <ButtonLink size="sm" to={it.link}>Review</ButtonLink>;
    if (it.kind === "to_sign" && it.link) return <a className="btn sm" href={it.link} onClick={(e) => { e.stopPropagation(); read(it); }}>Sign</a>;
    if (it.kind === "signed" && it.documentId) return <Button size="sm" onClick={(e) => { e.stopPropagation(); read(it); void download(it.documentId!); }}>Download</Button>;
    return undefined;
  };
  const foot = <p className="cp-foot ci-foot"><Icon name="mail" size={16} />Replies go by email.</p>;

  // Opening a note (from Home, or here) marks it read.
  const openId = open && !open.read ? open._id : null;
  useEffect(() => { if (openId) void markRead({ itemId: openId }); }, [openId, markRead]);
  return (
    <div className={`wp-page notop ci${open?.kind === "note" ? " opened" : ""}`}>
      {open?.kind === "note" && (
        <div className="ci-phonenote">
          <a className="wp-setback" {...linkProps("/inbox")}><Icon name="arrow-left" size={20} />Inbox</a>
          <section className="wp-card glass ci-notecard">
            <span className="wp-eyebrow"><Icon name="mail" size={16} />A note from {open.from ?? business}</span>
            <h1 className="wp-h4">{open.title}</h1>
            <p className="when">{Day(open.createdAt)}, {timeOfDay(open.createdAt)}</p>
            {open.text && open.text.split(/\n+/).map((p, i) => <p key={i} className="txt">{p}</p>)}
            {open.link && (/^https:\/\//.test(open.link) ? <a className="btn" href={open.link}>{open.linkLabel ?? "Open"}</a> : <ButtonLink to={open.link}>{open.linkLabel ?? "Open in the portal"}</ButtonLink>)}
          </section>
          {foot}
        </div>
      )}
      <div className="ci-main">
        <PageHeader title="Inbox." sub="Everything new, newest first." />
        <div className="ci-bar">
          <PillTabs label="Show" value={tab} onChange={setTab} items={[{ key: "unread", label: "Unread", count: data?.unread ?? 0 }, { key: "all", label: "All" }]} />
          <span className="sp" />
          {(data?.unread ?? 0) > 0 && <Button size="sm" variant="ghost" onClick={async () => { const n = await markAll({}); show(`Marked ${n} as read.`); }}>Mark all read</Button>}
        </div>
        {data === undefined ? <Card label="Inbox"><SkeletonRows n={5} /></Card>
          : list.length === 0 ? <EmptyState icon="inbox" title={tab === "unread" && items.length ? "Nothing unread." : "Nothing new yet."} body={tab === "unread" && items.length ? "You've read everything here." : "Cuts, documents and notes will show up here."} />
          : (
            <Card label="Inbox">
              {list.map((it, i) => (
                <div key={it._id} className={`wp-rowwrap${open?._id === it._id ? " open" : ""}`}>{i > 0 && <Divider />}
                  <div className="ci-row" role="button" tabIndex={0} onClick={() => go(it)} onKeyDown={(e) => { if (e.key === "Enter") go(it); }} aria-expanded={it.kind === "note" ? open?._id === it._id : undefined}>
                    <InboxItem icon={INBOX_ICON[it.kind as InboxKind]} title={it.title} detail={it.text || undefined} action={action(it)} time={Day(it.createdAt)} unread={!it.read} selected={open?._id === it._id} />
                  </div>
                  {open?._id === it._id && it.kind === "note" && <NoteBody it={it} business={business} />}
                </div>
              ))}
            </Card>
          )}
        {foot}
      </div>
      {toast}
    </div>
  );
}
