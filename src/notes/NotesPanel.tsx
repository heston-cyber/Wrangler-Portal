// The Notes tab of the review page's side panel.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useMutation } from "convex/react";
import { Check, Copy, Ellipsis, Pencil, Reply, Trash2 } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import type { FrameClock } from "../player/useFramePlayer";
import { Menu, MenuItem, MenuSep } from "../ui/kit";
import { ago } from "../lib/format";

export type NoteRow = Doc<"notes"> & { replies: Doc<"replies">[] };
export type NoteFilter = { status: "open" | "done" | "all"; kinds: { frame: boolean; range: boolean; general: boolean }; sort: "timecode" | "newest" };
export const defaultFilter: NoteFilter = { status: "all", kinds: { frame: true, range: true, general: true }, sort: "timecode" };

export const kindName = (k: NoteRow["kind"]) => (k === "frame" ? "Frame" : k === "range" ? "Range" : "Whole video");
export const kindColor = (k: NoteRow["kind"]) => (k === "frame" ? "var(--mk-frame)" : k === "range" ? "var(--mk-range)" : "var(--mk-video)");

// Re-render only when the set of notes under the playhead changes, not on every frame.
function useHereIds(clock: FrameClock, notes: NoteRow[]) {
  const key = () => {
    const f = clock.get();
    return notes.filter((n) => n.kind !== "general" && n.inFrame !== undefined && f >= n.inFrame && f <= (n.outFrame ?? n.inFrame)).map((n) => n._id).join(",");
  };
  return useSyncExternalStore(clock.subscribe, key);
}

export function NotesList({ notes, clock, tc, filter, onJump, focusId, focusTick, onCopied }: {
  notes: NoteRow[] | undefined;
  clock: FrameClock;
  tc: (f: number) => string;
  filter: NoteFilter;
  onJump: (n: NoteRow) => void;
  focusId: string | null;
  focusTick: number;
  onCopied: (what: string) => void;
}) {
  const list = notes ?? [];
  const here = useHereIds(clock, list);
  const hereSet = useMemo(() => new Set(here.split(",")), [here]);
  const shown = list
    .filter((n) => (filter.status === "all" || n.status === filter.status) && filter.kinds[n.kind])
    .sort((a, b) => filter.sort === "newest" ? b.createdAt - a.createdAt : (a.inFrame ?? -1) - (b.inFrame ?? -1) || a.createdAt - b.createdAt);

  if (notes === undefined) return <p className="caption" style={{ padding: 12 }}>Loading notes…</p>;
  if (shown.length === 0) {
    return (
      <div className="empty" style={{ padding: "40px 16px" }}>
        <img src="/brand/spark-cream.png" alt="" />
        <span>{list.length === 0 ? <>No notes yet. <br />Pause on a frame and write below, press D to draw, or I and O to mark a range.</> : "No notes match this filter."}</span>
      </div>
    );
  }
  return <>{shown.map((n) => <NoteCard key={n._id} n={n} here={hereSet.has(n._id)} focused={focusId === n._id} focusTick={focusTick} tc={tc} onJump={onJump} onCopied={onCopied} />)}</>;
}

function NoteCard({ n, here, focused, focusTick, tc, onJump, onCopied }: { n: NoteRow; here: boolean; focused: boolean; focusTick: number; tc: (f: number) => string; onJump: (n: NoteRow) => void; onCopied: (what: string) => void }) {
  const setStatus = useMutation(api.notes.setStatus);
  const reply = useMutation(api.notes.reply);
  const remove = useMutation(api.notes.remove);
  const editText = useMutation(api.notes.editText);
  const [replying, setReplying] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(n.text);
  const ref = useRef<HTMLElement>(null);
  // Picked from the bar, a link or a jump: bring it into view (again on every pick).
  useEffect(() => {
    if (!focused) return;
    const el = ref.current;
    if (!el) return;
    // Phones pin the player at the top: scroll the page so the note lands just below it.
    const pinned = document.querySelector(".stagecol");
    const scroller = el.closest(".main") as HTMLElement | null;
    if (pinned && scroller && getComputedStyle(pinned).position === "sticky") {
      const top = pinned.getBoundingClientRect().bottom + 8;
      const r = el.getBoundingClientRect();
      if (r.top < top || r.bottom > window.innerHeight) scroller.scrollBy({ top: r.top - top, behavior: "smooth" });
    } else {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [focused, focusTick]);

  const when = n.kind === "general" ? "Whole video" : n.kind === "range" ? `${tc(n.inFrame!)} → ${tc(n.outFrame!)}` : tc(n.inFrame!);
  const len = n.kind === "range" ? n.outFrame! - n.inFrame! + 1 : 0;
  const copy = (text: string, what: string) => { void navigator.clipboard?.writeText(text).then(() => onCopied(what), () => onCopied("Couldn't copy")); };

  return (
    <article ref={ref} className={`note${focused ? " focus" : here ? " here" : ""}${n.status === "done" ? " done" : ""}`}
      onClick={(e) => { if (n.kind !== "general" && !(e.target as HTMLElement).closest("button, a, textarea, input, form")) onJump(n); }}>
      {/* Altar II card pattern: red label, bold value, grey outlined detail boxes */}
      <div className="rlabel">
        <span className="dot" style={{ background: kindColor(n.kind) }} />
        {n.kind === "general" ? "Note" : kindName(n.kind)} · {n.authorName} · {ago(n.createdAt)}
      </div>
      {n.kind === "general"
        ? <div className="rbold">Whole video</div>
        : (
          <button className="rbold jump" onClick={() => onJump(n)} title="Jump here">
            {tc(n.inFrame!)}
            {n.kind === "range" && <span className="out">→ {tc(n.outFrame!)}</span>}
          </button>
        )}
      <div className="rtags">
        {n.kind === "frame" && <span className="rtag">1 frame</span>}
        {n.kind === "range" && <span className="rtag">{len} frames</span>}
        {n.drawing ? <span className="rtag">Drawing</span> : null}
        {n.replies.length > 0 && <span className="rtag">{n.replies.length} {n.replies.length === 1 ? "reply" : "replies"}</span>}
        {n.status === "done" && <span className="rtag">Done</span>}
      </div>

      {editing ? (
        <div className="edit">
          <textarea className="input" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void editText({ noteId: n._id, text: draft }).then(() => setEditing(false)); } if (e.key === "Escape") { setDraft(n.text); setEditing(false); } }} />
          <div className="row">
            <button className="btn primary sm" onClick={async () => { await editText({ noteId: n._id, text: draft }); setEditing(false); }}>Save</button>
            <button className="btn sm" onClick={() => { setDraft(n.text); setEditing(false); }}>Cancel</button>
          </div>
        </div>
      ) : n.text ? <div className="ntext">{n.text}</div> : null}

      {(n.still || n.stillIn || n.stillOut) && (
        <div className="nstill">
          {n.still && <a href={n.still} target="_blank" rel="noreferrer"><img src={n.still} alt="Frame with drawing" loading="lazy" /></a>}
          {n.kind === "range" && n.stillIn && n.stillIn !== n.still && <a href={n.stillIn} target="_blank" rel="noreferrer"><img src={n.stillIn} alt="First frame" loading="lazy" /></a>}
          {n.kind === "range" && n.stillOut && <a href={n.stillOut} target="_blank" rel="noreferrer"><img src={n.stillOut} alt="Last frame" loading="lazy" /></a>}
        </div>
      )}

      {n.replies.map((r) => (
        <div key={r._id} className="reply"><span className="rh">{r.authorName} · {ago(r.createdAt)}</span><div className="ntext">{r.text}</div></div>
      ))}
      {replying && (
        <form className="edit" onSubmit={async (e) => { e.preventDefault(); if (!replyText.trim()) return; await reply({ noteId: n._id, text: replyText }); setReplyText(""); setReplying(false); }}>
          <textarea className="input" value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Reply…" autoFocus
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } if (e.key === "Escape") setReplying(false); }} />
          <div className="row">
            <button className="btn primary sm" type="submit">Reply</button>
            <button className="btn sm" type="button" onClick={() => setReplying(false)}>Cancel</button>
          </div>
        </form>
      )}

      {confirming ? (
        <div className="nfoot">
          <span style={{ fontSize: 12.5 }}>Delete this note?</span>
          <span className="right">
            <button className="btn danger sm" onClick={() => void remove({ noteId: n._id })}>Delete</button>
            <button className="btn sm" onClick={() => setConfirming(false)}>Keep</button>
          </span>
        </div>
      ) : (
        <div className="nfoot">
          <button className={`donepill${n.status === "done" ? " is" : ""}`} onClick={() => void setStatus({ noteId: n._id, status: n.status === "done" ? "open" : "done" })}
            aria-pressed={n.status === "done"}>
            <Check size={13} />{n.status === "done" ? "Done" : "Mark done"}
          </button>
          <span className="right">
            {!replying && <button className="icon-btn" onClick={() => setReplying(true)} aria-label="Reply" title="Reply"><Reply size={15} /></button>}
            <Menu align="end" label="Note options" trigger={(p) => <button {...p} className="icon-btn" aria-label="Note options"><Ellipsis size={15} /></button>}>
              {n.kind !== "general" && <MenuItem icon={<Copy size={16} />} onSelect={() => copy(when, "Timecode copied")}>Copy timecode</MenuItem>}
              <MenuItem icon={<Copy size={16} />} onSelect={() => copy(`${when} — ${n.text}`, "Note copied")}>Copy note</MenuItem>
              <MenuItem icon={<Pencil size={16} />} onSelect={() => { setDraft(n.text); setEditing(true); }}>Edit</MenuItem>
              <MenuSep />
              <MenuItem icon={<Trash2 size={16} />} danger onSelect={() => setConfirming(true)}>Delete</MenuItem>
            </Menu>
          </span>
        </div>
      )}
    </article>
  );
}
