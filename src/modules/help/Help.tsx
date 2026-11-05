// Phase 5d step 4 (Nov 4, Q59, Q83, Q84, Q85): Help, a small wiki. A search box and the guides; a guide opens as a page.
// The owner's is the last item in Settings (/settings/help) with Edit guides, an Edited chip and Reset to Wrangler's
// version; the client's is /help and the vendor's /vendor/help, reached from their Account page.
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button, Card, Divider, EmptyState, ListRow, PageHeader, SectionHead, SkeletonRows, StatusChip } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { useConfirm, useToast } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps, navigate } from "../../lib/router";
import { errText } from "../docs/pages/common";

type PNode = { type: string; text?: string; marks?: Array<{ type: string; attrs?: { href?: string } }>; content?: PNode[]; attrs?: Record<string, unknown> };

/** A guide's page as plain, readable text: headings, paragraphs and lists. Anything else in it is skipped. */
function Rich({ nodes }: { nodes: PNode[] }) {
  const inline = (n: PNode, i: number): React.ReactNode => {
    if (n.type === "hardBreak") return <br key={i} />;
    let el: React.ReactNode = n.text ?? (n.content ?? []).map(inline);
    for (const m of n.marks ?? []) {
      if (m.type === "bold") el = <strong>{el}</strong>;
      else if (m.type === "italic") el = <em>{el}</em>;
      else if (m.type === "link" && m.attrs?.href && /^(https?:\/\/|mailto:)/i.test(m.attrs.href)) el = <a href={m.attrs.href} target="_blank" rel="noopener noreferrer">{el}</a>;
    }
    return <span key={i}>{el}</span>;
  };
  const block = (n: PNode, i: number): React.ReactNode => {
    const kids = (n.content ?? []).map(inline);
    if (n.type === "paragraph") {
      const size = n.attrs?.size;
      if (!kids.length) return null;
      if (size === "title") return <h2 key={i} className="wp-h3">{kids}</h2>;
      if (size === "subtitle" || size === "heading" || size === "strong") return <h3 key={i} className="help-h">{kids}</h3>;
      return <p key={i}>{kids}</p>;
    }
    if (n.type === "bulletList" || n.type === "orderedList") {
      const items = (n.content ?? []).map((li, j) => <li key={j}>{(li.content ?? []).map((c, k) => (c.type === "paragraph" ? <span key={k}>{(c.content ?? []).map(inline)}</span> : block(c, k)))}</li>);
      return n.type === "orderedList" ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
    }
    if (n.type === "section") return <div key={i}>{(n.content ?? []).map(block)}</div>;
    return null;
  };
  return <div className="help-body">{nodes.map(block)}</div>;
}

type Who = { base: string; biz?: Id<"businesses"> | null; owner?: boolean };

/** The list: a search box and the guides. `bare` leaves out the page heading (Settings has its own). */
export function HelpIndex({ base, biz, owner, bare }: Who & { bare?: boolean }) {
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(false);
  const rows = useQuery(api.help.list, biz === null ? "skip" : { ...(biz ? { businessId: biz } : {}), ...(q.trim() ? { q: q.trim() } : {}) });
  const edit = useMutation(api.help.edit);
  const [toast, show] = useToast();
  const open = async (slug: string) => { try { const id = await edit({ slug }); navigate(`/settings/help/edit/${id}?guide=${slug}`); } catch (e) { show(errText(e)); } };
  return (
    <>
      {!bare && <PageHeader eyebrow="Help" title="How can we help?" sub="Short guides for the things people ask about most." />}
      <div className="help-bar">
        <label className="ws-search help-search">
          <Icon name="search" size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the guides" aria-label="Search the guides" />
        </label>
        {owner && <Button variant={editing ? "primary" : "secondary"} onClick={() => setEditing(!editing)}>{editing ? "Done editing" : "Edit guides"}</Button>}
      </div>
      {owner && editing && <p className="secondary help-note">Pick a guide to change it in the page editor. What you write is what your clients and vendors read.</p>}
      {rows === undefined ? <Card label="Loading"><SkeletonRows n={5} /></Card>
        : rows.length === 0 ? <EmptyState icon="search" title={q.trim() ? "No guides match." : "No guides yet."} body={q.trim() ? `Nothing about “${q.trim()}”. Try fewer or different words.` : undefined} />
        : <Card label="Guides">{rows.map((g, i) => (
            <div key={g.slug} className="wp-rowwrap">{i > 0 && <Divider />}
              <ListRow className="ilead" lead={{ icon: "document" }} to={editing ? undefined : `${base}/${g.slug}`} onClick={editing ? () => void open(g.slug) : undefined} chevron
                title={g.title} meta={g.summary || undefined}
                chip={owner && g.edited ? <StatusChip tone="accent">Edited</StatusChip> : owner && g.audience !== "both" ? <StatusChip tone="neutral">{g.audience === "client" ? "Clients" : "Vendors"}</StatusChip> : undefined}
                action={editing ? <span className="btn sm" aria-hidden>Edit</span> : undefined} />
            </div>))}</Card>}
      {toast}
    </>
  );
}

/** One guide. The owner also gets Edit, an Edited chip and Reset to Wrangler's version. */
export function HelpGuide({ base, slug, biz, owner, bare }: Who & { slug: string; bare?: boolean }) {
  const g = useQuery(api.help.guide, biz === null ? "skip" : { slug, ...(biz ? { businessId: biz } : {}) });
  const edit = useMutation(api.help.edit), reset = useMutation(api.help.reset);
  const [ask, askDialog] = useConfirm();
  const [toast, show] = useToast();
  const back = <a {...linkProps(base)} className="help-back"><Icon name="arrow-left" size={16} />All guides</a>;
  if (g === undefined) return <>{back}<Card label="Loading"><SkeletonRows n={5} /></Card></>;
  if (g === null) return <>{back}<EmptyState icon="document" title="That guide isn't here." body="It may have been renamed. Look for it in the list." actions={<a {...linkProps(base)} className="btn">All guides</a>} /></>;
  const doEdit = async () => { try { const id = await edit({ slug }); navigate(`/settings/help/edit/${id}?guide=${slug}`); } catch (e) { show(errText(e)); } };
  const doReset = async () => {
    if (!(await ask({ title: "Go back to Wrangler's version?", body: "Your changes to this guide are removed, and everyone reads Wrangler's wording again.", yes: "Reset it", no: "Keep mine" }))) return;
    try { await reset({ slug }); show("Back to Wrangler's version."); } catch (e) { show(errText(e)); }
  };
  return (
    <>
      {back}
      <article className="help-guide">
        <header className="help-head">
          <h1 className="wp-h2">{g.title}</h1>
          {g.summary && <p className="wp-body secondary">{g.summary}</p>}
          {owner && <div className="help-owner">
            {g.edited && <StatusChip tone="accent">Edited</StatusChip>}
            <Button size="sm" onClick={() => void doEdit()}>Edit this guide</Button>
            {g.edited && <Button size="sm" variant="ghost" onClick={() => void doReset()}>Reset to Wrangler's version</Button>}
          </div>}
        </header>
        <Rich nodes={g.page.content as PNode[]} />
      </article>
      {g.related.length > 0 && <Card label="More guides" head={<SectionHead label="More guides" />}>{g.related.map((r, i) => (
        <div key={r.slug} className="wp-rowwrap">{i > 0 && <Divider />}<ListRow className="ilead" lead={{ icon: "document" }} to={`${base}/${r.slug}`} chevron title={r.title} /></div>))}</Card>}
      {toast}{askDialog}
      {bare && null}
    </>
  );
}

/** The client's and the vendor's Help, as their own pages. */
export function HelpScreen({ base, slug, biz }: { base: string; slug?: string; biz?: Id<"businesses"> | null }) {
  return (
    <>
      <TopBar>{slug ? <><a {...linkProps(base)} className="secondary">Help</a><Sep /><span className="here">Guide</span></> : <span className="here">Help</span>}</TopBar>
      <div className="wp-page help">{slug ? <HelpGuide base={base} slug={slug} biz={biz} /> : <HelpIndex base={base} biz={biz} />}</div>
    </>
  );
}

/** Owner: Settings › Help, in the settings frame. The path says whether it's the list or one guide. */
export function HelpSection({ path }: { path: string }) {
  const slug = /^\/settings\/help\/([a-z0-9-]+)\/?$/.exec(path)?.[1];
  return <div className="help">{slug ? <HelpGuide base="/settings/help" slug={slug} owner /> : <HelpIndex base="/settings/help" owner bare />}</div>;
}

/** The small "?" beside a screen's heading: the guide for what's on it. */
export function HelpMark({ to, label }: { to: string; label?: string }) {
  return <a {...linkProps(to)} className="help-mark" aria-label={label ?? "Help for this page"} title={label ?? "Help for this page"}>?</a>;
}
