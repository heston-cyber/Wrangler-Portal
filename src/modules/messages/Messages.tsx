// Phase 5d step 2 (Nov 4): Messages. Frames S5 · Phase 5d "Messages (side menu)": owner 847:17075, lead thread with a
// booked call 847:17720, empty 847:18391, loading 847:18928, client 848:15820; phones 849:16286 (owner list),
// 849:16543 (client list), 849:16743 (owner lead thread), 849:16919 (client thread). A lead's own page (/m/<token>)
// uses the public page's look (like the quote and booking pages).
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Avatar, Button, ButtonLink, Card, DialogHeader, EmptyState, PageHeader, PillTabs, SectionHead, SkeletonRows, initials } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { Modal, useToast } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps, navigate, useLocation } from "../../lib/router";
import { errText } from "../docs/pages/common";
import { Frame } from "../payments/ClientInvoice";
import { whenLabel } from "../calls/Calls";

type Mode = { kind: "owner"; threadId: string } | { kind: "client"; threadId: string } | { kind: "lead"; token: string };
type Msg = { _id: string; side: "owner" | "client" | "lead" | "system"; mine: boolean; name: string; text: string; createdAt: number; files: Array<{ name: string; size: number; type: string; url: string | null }>; call: { what: "booked" | "moved" | "cancelled"; start: number; end: number; meet: boolean } | null };
type Page = { messages: Msg[]; more: boolean; readBy: { messageId: string; names: Array<{ name: string; at: number }> } | null };

const MAX_FILES = 10, MAX_BYTES = 25 * 1024 * 1024;
const hm = (t: number) => new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const dayOf = (t: number) => new Date(t).toDateString();
function dayWord(t: number) {
  const d = new Date(t), now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}
function listTime(t: number) {
  const d = new Date(t), now = new Date();
  if (d.toDateString() === now.toDateString()) return hm(t);
  const days = (now.getTime() - t) / 86_400_000;
  if (days < 2) return "Yesterday";
  if (days < 7) return d.toLocaleDateString("en-US", { weekday: "short" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
const mb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function usePage(mode: Mode, before?: number): Page | null | undefined {
  const o = useQuery(api.messages.thread, mode.kind === "owner" ? { threadId: mode.threadId, ...(before ? { before } : {}) } : "skip");
  const c = useQuery(api.messages.clientThreadPage, mode.kind === "client" ? { threadId: mode.threadId, ...(before ? { before } : {}) } : "skip");
  const l = useQuery(api.messages.leadPage, mode.kind === "lead" ? { token: mode.token, ...(before ? { before } : {}) } : "skip");
  return (mode.kind === "owner" ? o : mode.kind === "client" ? c : l) as Page | null | undefined;
}

function CallLine({ m, owner, dealId }: { m: Msg; owner: boolean; dealId?: string | null }) {
  const c = m.call!;
  const title = c.what === "booked" ? "Call booked" : c.what === "moved" ? "Call moved" : "Call cancelled";
  return (
    <div className={`msg-call${c.what === "cancelled" ? " off" : ""}`}>
      <Icon name="calendar" size={18} />
      <span className="txt"><b>{title}</b><small>{whenLabel(c.start, c.end, Intl.DateTimeFormat().resolvedOptions().timeZone).split(" (")[0]}{c.meet && c.what !== "cancelled" ? " · Google Meet" : ""}</small></span>
      {owner && dealId && <a className="btn sm" {...linkProps(`/clients/deals/${dealId}`)}>Open call</a>}
    </div>
  );
}

function Bubbles({ msgs, page, owner, dealId }: { msgs: Msg[]; page: Page; owner: boolean; dealId?: string | null }) {
  return (
    <>
      {msgs.map((m, i) => {
        const newDay = i === 0 || dayOf(msgs[i - 1].createdAt) !== dayOf(m.createdAt);
        return (
          <Fragment key={m._id}>
            {newDay && <div className="msg-day">{dayWord(m.createdAt)}</div>}
            {m.side === "system" ? <CallLine m={m} owner={owner} dealId={dealId} /> : (
              <div className={`msg${m.mine ? " mine" : ""}`}>
                <div className="msg-who"><b>{m.name}</b><span>{hm(m.createdAt)}</span></div>
                <div className="msg-bubble">
                  {m.text && <p>{m.text}</p>}
                  {m.files.length > 0 && <div className="msg-files">{m.files.map((f, j) => (
                    <a key={j} className="msg-file" href={f.url ?? undefined} target="_blank" rel="noopener noreferrer" download={f.name}><Icon name="document" size={16} /><span>{f.name} · {mb(f.size)}</span></a>
                  ))}</div>}
                </div>
                {page.readBy?.messageId === m._id && page.readBy.names.length > 0 && (
                  <div className="msg-read">Read by {page.readBy.names.map((n) => n.name).join(", ")} · {hm(Math.max(...page.readBy.names.map((n) => n.at)))}</div>
                )}
              </div>
            )}
          </Fragment>
        );
      })}
    </>
  );
}

/** Older pages, each with its own "Show earlier messages" above it. */
function Older({ mode, before, owner, dealId }: { mode: Mode; before: number; owner: boolean; dealId?: string | null }) {
  const p = usePage(mode, before);
  const [more, setMore] = useState(false);
  if (p === undefined) return <SkeletonRows n={2} label="Loading earlier messages" />;
  if (!p) return null;
  return (
    <>
      {p.more && (more ? <Older mode={mode} before={p.messages[0].createdAt} owner={owner} dealId={dealId} /> : <button type="button" className="msg-earlier" onClick={() => setMore(true)}>Show earlier messages</button>)}
      <Bubbles msgs={p.messages} page={{ ...p, readBy: null }} owner={owner} dealId={dealId} />
    </>
  );
}

function Composer({ mode, onSent }: { mode: Mode; onSent?: () => void }) {
  const send = useMutation(api.messages.send);
  const clientSend = useMutation(api.messages.clientSend);
  const leadSend = useMutation(api.messages.leadSend);
  const upUrl = useMutation(api.messages.uploadUrl);
  const leadUp = useMutation(api.messages.leadUploadUrl);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const pick = useRef<HTMLInputElement>(null);
  const add = (list: FileList | null) => {
    if (!list) return;
    const next = [...files, ...Array.from(list)];
    const big = next.find((f) => f.size > MAX_BYTES);
    if (big) { setErr(`${big.name} is over 25 MB. Share a link to big files instead.`); return; }
    if (next.length > MAX_FILES) { setErr(`Up to ${MAX_FILES} files a message.`); return; }
    setErr(null); setFiles(next);
  };
  const go = async () => {
    if (!text.trim() && !files.length) return;
    setBusy(true); setErr(null);
    try {
      const up = [];
      for (const f of files) {
        const url = mode.kind === "lead" ? await leadUp({ token: mode.token }) : await upUrl({});
        const r = await fetch(url, { method: "POST", headers: { "Content-Type": f.type || "application/octet-stream" }, body: f });
        if (!r.ok) throw new Error("A file didn't upload. Try again.");
        up.push({ storageId: ((await r.json()) as { storageId: Id<"_storage"> }).storageId, name: f.name });
      }
      const r = mode.kind === "owner" ? await send({ threadId: mode.threadId as Id<"msgThreads">, text, files: up })
        : mode.kind === "client" ? await clientSend({ threadId: mode.threadId as Id<"msgThreads">, text, files: up })
        : await leadSend({ token: mode.token, text, files: up });
      if (r.error) { setErr(r.error); return; }
      setText(""); setFiles([]); onSent?.();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="msg-compose">
      {files.length > 0 && <div className="msg-files pending">{files.map((f, i) => (
        <span key={i} className="msg-file"><Icon name="document" size={16} /><span>{f.name} · {mb(f.size)}</span><button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}><Icon name="close" size={14} /></button></span>
      ))}</div>}
      {err && <p className="error" role="alert">{err}</p>}
      <div className="msg-row">
        <input ref={pick} type="file" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
        <button type="button" className="msg-attach" aria-label="Attach files" title="Attach files (25 MB each, up to 10)" onClick={() => pick.current?.click()}><Icon name="upload" size={20} /></button>
        <textarea className="input msg-input" rows={1} placeholder="Write a message" aria-label="Write a message" value={text} maxLength={5000}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void go(); } }} />
        <Button variant="primary" loading={busy} disabled={!text.trim() && !files.length} onClick={() => void go()}>Send</Button>
      </div>
    </div>
  );
}

/** The thread: header, messages (newest at the bottom), composer. Opening it marks it read. */
export function Thread({ mode, head, empty, closed }: { mode: Mode; head: React.ReactNode; empty?: string; closed?: string }) {
  const p = usePage(mode);
  const read = useMutation(api.messages.read);
  const leadRead = useMutation(api.messages.leadRead);
  const [older, setOlder] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const last = p?.messages.at(-1)?._id;
  const owner = mode.kind === "owner";
  const dealId = owner && p && "dealId" in p ? (p as { dealId: string | null }).dealId : null;
  useEffect(() => {
    if (!p) return;
    if (mode.kind === "lead") void leadRead({ token: mode.token }).catch(() => undefined);
    else void read({ threadId: mode.threadId as Id<"msgThreads"> }).catch(() => undefined);
    end.current?.scrollIntoView({ block: "end" });
  }, [last]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="msg-thread glass" aria-label="Conversation">
      {head}
      <div className="msg-scroll">
        {p === undefined ? <SkeletonRows n={4} label="Loading messages" />
          : p === null ? <EmptyState icon="lock" title="This conversation isn't here." />
          : <>
            {p.more && (older ? <Older mode={mode} before={p.messages[0].createdAt} owner={owner} dealId={dealId} /> : <button type="button" className="msg-earlier" onClick={() => setOlder(true)}>Show earlier messages</button>)}
            {p.messages.length === 0 && <div className="msg-empty"><b>No messages yet</b><span>{empty ?? "Write the first one below."}</span></div>}
            <Bubbles msgs={p.messages} page={p} owner={owner} dealId={dealId} />
          </>}
        <div ref={end} />
      </div>
      {p && (closed ? <p className="msg-closed wp-small secondary">{closed}</p> : <Composer mode={mode} />)}
    </section>
  );
}

function ThreadHead({ title, sub, action, back }: { title: string; sub?: string; action?: React.ReactNode; back?: string }) {
  return (
    <header className="msg-head">
      {back && <a className="msg-back" {...linkProps(back)} aria-label="All conversations"><Icon name="arrow-left" size={20} /></a>}
      <span className="msg-av" aria-hidden>{initials(title, true)}</span>
      <span className="txt"><b>{title}</b>{sub && <small>{sub}</small>}</span>
      {action}
    </header>
  );
}

// ---------- the owner: /messages ----------

type Filter = "all" | "unread" | "leads";
export function OwnerMessages() {
  const { search } = useLocation();
  const sel = new URLSearchParams(search).get("thread");
  const [q, setQ] = useState("");
  const [f, setF] = useState<Filter>("all");
  const [starting, setStarting] = useState(false);
  const rows = useQuery(api.messages.threads, q.trim() ? { q: q.trim() } : {});
  const t = useQuery(api.messages.thread, sel ? { threadId: sel } : "skip");
  const shown = !rows ? [] : rows.filter((r) => f === "all" || (f === "unread" ? r.unread : r.kind === "lead"));
  const list = (
    <Card className="msg-list" label="Conversations" head={<SectionHead label="Threads" count={rows?.length ?? undefined} />}>
      <label className="ws-search msg-search"><Icon name="search" size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search messages" aria-label="Search messages" /></label>
      {rows && rows.length > 0 && <div className="msg-pills"><PillTabs label="Which threads" value={f} onChange={setF} items={[{ key: "all", label: "All", count: rows.length }, { key: "unread", label: "Unread", count: rows.filter((r) => r.unread).length }, { key: "leads", label: "Leads", count: rows.filter((r) => r.kind === "lead").length }]} /></div>}
      {rows === undefined ? <SkeletonRows n={5} />
        : shown.length === 0 ? <div className="msg-none">{q.trim() ? `Nothing matches “${q.trim()}”.` : f === "unread" ? "Everything's read." : f === "leads" ? "No lead conversations yet." : "No conversations yet."}</div>
        : shown.map((r) => (
          <a key={r._id} className={`msg-item${sel === r._id ? " on" : ""}`} {...linkProps(`/messages?thread=${r._id}`)} aria-current={sel === r._id ? "page" : undefined}>
            <Avatar name={r.title} size={36} two />
            <span className="txt"><b>{r.title}</b><small>{r.sub}</small><span className="last">{r.lastText || "No messages yet"}</span></span>
            <span className="meta"><small>{listTime(r.lastAt)}</small>{r.unread && <i className="dot" aria-label="Unread" />}</span>
          </a>
        ))}
    </Card>
  );
  const head = t ? <ThreadHead back="/messages" title={t.title} sub={t.sub} action={t.kind === "lead" ? <span className="msg-acts"><LeadLinkButton threadId={t._id} off={t.linkOff} />{t.dealId && <ButtonLink size="sm" to={`/clients/deals/${t.dealId}`} iconEnd={false}>Open lead</ButtonLink>}</span> : t.projectId ? <ButtonLink size="sm" to={`/projects/${t.projectId}`} iconEnd={false}>Open project</ButtonLink> : undefined} /> : null;
  return (
    <>
      <TopBar><a {...linkProps("/")} className="secondary">Dashboard</a><Sep /><span className="here">Messages</span></TopBar>
      <div className={`wp-page msg-page${sel ? " has-thread" : ""}`}>
        <PageHeader title="Messages" sub="Conversations with your clients and leads." actions={<Button variant="primary" onClick={() => setStarting(true)}>New message</Button>} />
        <div className="msg-cols">
          {list}
          {sel ? (t === null ? <section className="msg-thread glass"><EmptyState icon="mail" title="This conversation isn't here." actions={<ButtonLink to="/messages">All conversations</ButtonLink>} /></section>
            : <Thread key={sel} mode={{ kind: "owner", threadId: sel }} head={head ?? <ThreadHead title="…" />}
                empty={t?.kind === "lead" ? `${t.title} reads it from a link in their email. No login needed.` : t && t.people === 0 ? "Nobody at the client can open this project in the portal yet, so nobody will be told." : "Everyone at the client who can open this project sees it."} />)
            : <section className="msg-thread glass msg-pick"><EmptyState icon="mail" title={rows?.length ? "Pick a conversation." : "No messages yet"} body={rows?.length ? undefined : "Start one with a client about a project, or with a lead."} actions={<Button variant="primary" onClick={() => setStarting(true)}>Write a message</Button>} /></section>}
        </div>
      </div>
      {starting && <NewMessage onClose={() => setStarting(false)} />}
    </>
  );
}

/** Review M3: the lead's link can be turned off (they can still read it, not write), and back on. */
function LeadLinkButton({ threadId, off }: { threadId: string; off: boolean }) {
  const set = useMutation(api.messages.setLeadLink);
  const [toast, show] = useToast();
  return <><Button size="sm" variant="ghost" onClick={async () => { try { await set({ threadId: threadId as Id<"msgThreads">, off: !off }); show(off ? "Their link works again." : "Link turned off. They can read the conversation but can't write."); } catch (e) { show(errText(e)); } }}>{off ? "Turn link on" : "Turn link off"}</Button>{toast}</>;
}

function NewMessage({ onClose }: { onClose: () => void }) {
  const o = useQuery(api.messages.startOptions, {});
  const start = useMutation(api.messages.start);
  const [toast, show] = useToast();
  const go = async (a: { projectId?: Id<"projects">; dealId?: Id<"deals"> }) => { try { const id = await start(a); onClose(); navigate(`/messages?thread=${id}`); } catch (e) { show(errText(e)); } };
  return (
    <Modal onClose={onClose} label="New message" width={520}>
      <div className="crm-dialog">
        <DialogHeader eyebrow="Messages" title="New message." body="One conversation per project, with everyone at the client who can open it; or one with a lead." onClose={onClose} />
        {o === undefined ? <SkeletonRows n={4} /> : <div className="msg-start">
          <span className="wp-label">Projects</span>
          {o.projects.length === 0 ? <p className="wp-small secondary">No project has client people in the portal yet.</p>
            : o.projects.map((p) => <button key={p._id} type="button" className="msg-opt" onClick={() => void go({ projectId: p._id })}><Icon name="folder" size={18} /><span>{p.title}</span><small>{p.people} {p.people === 1 ? "person" : "people"}</small></button>)}
          <span className="wp-label">Leads</span>
          {o.leads.length === 0 ? <p className="wp-small secondary">No open leads with an email address.</p>
            : o.leads.map((d) => <button key={d._id} type="button" className="msg-opt" onClick={() => void go({ dealId: d._id })}><Icon name="user" size={18} /><span>{d.title}</span><small>{d.sub}</small></button>)}
        </div>}
        {toast}
      </div>
    </Modal>
  );
}

/** The lead page's "Message" button. */
export function MessageLeadButton({ dealId }: { dealId: string }) {
  const start = useMutation(api.messages.start);
  const [toast, show] = useToast();
  return <><Button onClick={async () => { try { const id = await start({ dealId: dealId as Id<"deals"> }); navigate(`/messages?thread=${id}`); } catch (e) { show(errText(e)); } }}>Message</Button>{toast}</>;
}

// ---------- a client: /messages ----------

export function ClientMessages() {
  const { search } = useLocation();
  const sel = new URLSearchParams(search).get("thread");
  const d = useQuery(api.messages.mine, {});
  const t = useQuery(api.messages.clientThreadPage, sel ? { threadId: sel } : "skip");
  const clientSend = useMutation(api.messages.clientSend);
  const brand = useQuery(api.business.brand);
  const biz = brand?.[0]?.name ?? "the business";
  const [startFor, setStartFor] = useState<string | null>(null);
  const list = (
    <Card className="msg-list" label="Conversations" head={<SectionHead label="Threads" count={d?.threads.length || undefined} />}>
      {d === undefined ? <SkeletonRows n={3} />
        : d.threads.length === 0 && d.projects.length === 0 ? <div className="msg-none">No conversations yet. When {biz} writes to you about a project, it shows up here.</div>
        : <>
          {d.threads.map((r) => (
            <a key={r._id} className={`msg-item${sel === r._id ? " on" : ""}`} {...linkProps(`/messages?thread=${r._id}`)} aria-current={sel === r._id ? "page" : undefined}>
              <span className="msg-av" aria-hidden>{initials(r.sub || biz, true)}</span>
              <span className="txt"><b>{r.title}</b><small>{r.sub}</small><span className="last">{r.lastText || "No messages yet"}</span></span>
              <span className="meta"><small>{listTime(r.lastAt)}</small>{r.unread && <i className="dot" aria-label="Unread" />}</span>
            </a>
          ))}
          {d.projects.map((p) => (
            <button key={p._id} type="button" className={`msg-item${startFor === p._id ? " on" : ""}`} onClick={() => setStartFor(p._id)}>
              <span className="msg-av" aria-hidden><Icon name="plus" size={16} /></span>
              <span className="txt"><b>{p.title}</b><small>Write to {biz}</small></span>
            </button>
          ))}
        </>}
    </Card>
  );
  const startProject = d?.projects.find((p) => p._id === startFor) ?? null;
  return (
    <>
      <TopBar><a {...linkProps("/")} className="secondary">Home</a><Sep /><span className="here">Messages</span></TopBar>
      <div className={`wp-page msg-page${sel || startProject ? " has-thread" : ""}`}>
        <PageHeader title="Messages" sub={`Conversations with ${biz} about your projects.`} />
        <div className="msg-cols">
          {list}
          {sel ? <Thread key={sel} mode={{ kind: "client", threadId: sel }} head={<ThreadHead back="/messages" title={t?.title ?? "…"} sub={t?.sub} action={t?.projectId ? <ButtonLink size="sm" to={`/projects/${t.projectId}`} iconEnd={false}>Open project</ButtonLink> : undefined} />} />
            : startProject ? <StartThread title={startProject.title} biz={biz} onSend={async (text) => { const r = await clientSend({ projectId: startProject._id, text }); if (r.error) throw new Error(r.error); navigate(`/messages?thread=${r.threadId}`); }} onBack={() => setStartFor(null)} />
            : <section className="msg-thread glass msg-pick"><EmptyState icon="mail" title={d?.threads.length ? "Pick a conversation." : "No messages yet"} body={d?.threads.length ? undefined : `Write to ${biz} about one of your projects.`} /></section>}
        </div>
      </div>
    </>
  );
}

function StartThread({ title, biz, onSend, onBack }: { title: string; biz: string; onSend: (text: string) => Promise<void>; onBack: () => void }) {
  const [text, setText] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  return (
    <section className="msg-thread glass">
      <header className="msg-head"><button type="button" className="msg-back" onClick={onBack} aria-label="Back"><Icon name="arrow-left" size={20} /></button><span className="msg-av" aria-hidden>{initials(biz, true)}</span><span className="txt"><b>{title}</b><small>With {biz}</small></span></header>
      <div className="msg-scroll"><div className="msg-empty"><b>No messages yet</b><span>Write to {biz} about {title}.</span></div></div>
      <div className="msg-compose">{err && <p className="error" role="alert">{err}</p>}
        <div className="msg-row"><textarea className="input msg-input" rows={1} placeholder="Write a message" aria-label="Write a message" value={text} onChange={(e) => setText(e.target.value)} />
          <Button variant="primary" loading={busy} disabled={!text.trim()} onClick={async () => { setBusy(true); setErr(null); try { await onSend(text); } catch (e) { setErr(errText(e)); setBusy(false); } }}>Send</Button></div></div>
    </section>
  );
}

// ---------- a lead: /m/<token> ----------

export function LeadMessages({ token }: { token: string }) {
  const p = useQuery(api.messages.leadPage, { token });
  const brand = p ? { name: p.business.name, logoUrl: p.business.logoUrl } : null;
  const legal = useMemo(() => (p ? (!p.business.legalName ? p.business.name : p.business.legalName.includes(p.business.name) ? p.business.legalName : `${p.business.name}, ${p.business.legalName}`) : ""), [p]);
  if (p === undefined) return <Frame inShell={false} bar={null} brand={null}><Card label="Loading"><SkeletonRows n={4} /></Card></Frame>;
  if (p === null) return <Frame inShell={false} bar={null} brand={null}><EmptyState icon="lock" title="This link doesn't work." body="It may have been mistyped. Open it again from your email." /></Frame>;
  const who = p.business.owner ? `${p.business.owner}, ${p.business.name}` : p.business.name;
  return (
    <Frame inShell={false} bar={null} brand={brand}>
      <div className="msg-lead">
        <Thread mode={{ kind: "lead", token }} head={<ThreadHead title={p.business.name} sub={`With ${who}`} />} empty={`Write to ${p.business.name}. They'll reply here and by email.`}
          closed={p.open ? undefined : `This conversation is closed. To get in touch, reply to the email from ${p.business.name}.`} />
        <p className="wp-small secondary bc-legal">{legal} · No login needed: this link is your conversation. Keep it to yourself.</p>
      </div>
    </Frame>
  );
}
