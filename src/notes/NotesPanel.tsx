import { useMemo, useState, useSyncExternalStore } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { FrameClock } from "../player/useFramePlayer";

export type NoteRow = Doc<"notes"> & { replies: Doc<"replies">[] };

// Re-render only when the set of notes under the playhead changes, not on every frame.
function useHereIds(clock: FrameClock, notes: NoteRow[]) {
  const key = () => {
    const f = clock.get();
    return notes.filter((n) => n.kind !== "general" && n.inFrame !== undefined && f >= n.inFrame && f <= (n.outFrame ?? n.inFrame)).map((n) => n._id).join(",");
  };
  return useSyncExternalStore(clock.subscribe, key);
}

const ago = (t: number) => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
};

export function NotesPanel({ notes, clock, tc, onJump, onDownloadEdl }: {
  notes: NoteRow[] | undefined;
  clock: FrameClock;
  tc: (f: number) => string;
  onJump: (n: NoteRow) => void;
  onDownloadEdl: () => void;
}) {
  const [filter, setFilter] = useState<"open" | "done" | "all">("open");
  const list = notes ?? [];
  const here = useHereIds(clock, list);
  const hereSet = useMemo(() => new Set(here.split(",")), [here]);
  const shown = list.filter((n) => filter === "all" || n.status === filter);
  const counts = { open: list.filter((n) => n.status === "open").length, done: list.filter((n) => n.status === "done").length };

  return (
    <section className="notes" aria-label="Notes">
      <div className="notes-head">
        <div className="tabs" role="tablist">
          {(["open", "done", "all"] as const).map((k) => (
            <button key={k} role="tab" aria-selected={filter === k} className={`btn small${filter === k ? " on" : ""}`} onClick={() => setFilter(k)}>
              {k === "open" ? `Open ${counts.open}` : k === "done" ? `Done ${counts.done}` : `All ${list.length}`}
            </button>
          ))}
        </div>
        <button className="btn small" onClick={onDownloadEdl} disabled={!list.length} title="Import in Resolve: right-click the timeline in the Media Pool › Timelines › Import › Timeline Markers from EDL">Resolve markers (EDL)</button>
      </div>
      <div className="notes-list">
        {notes === undefined && <p className="empty" style={{ padding: 12 }}>Loading notes…</p>}
        {notes !== undefined && shown.length === 0 && (
          <p className="empty" style={{ padding: 12 }}>
            {filter === "open" ? "No open notes. Pause on a frame, or drag across the bar to mark a range, then write a note." : "Nothing here."}
          </p>
        )}
        {shown.map((n) => <NoteItem key={n._id} n={n} here={hereSet.has(n._id)} tc={tc} onJump={onJump} />)}
      </div>
    </section>
  );
}

function NoteItem({ n, here, tc, onJump }: { n: NoteRow; here: boolean; tc: (f: number) => string; onJump: (n: NoteRow) => void }) {
  const setStatus = useMutation(api.notes.setStatus);
  const reply = useMutation(api.notes.reply);
  const remove = useMutation(api.notes.remove);
  const editText = useMutation(api.notes.editText);
  const [replying, setReplying] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(n.text);
  const when = n.kind === "general" ? "Whole video" : n.kind === "range" ? `${tc(n.inFrame!)} → ${tc(n.outFrame!)}` : tc(n.inFrame!);
  const len = n.kind === "range" ? n.outFrame! - n.inFrame! + 1 : 0;

  return (
    <article className={`note${here ? " here" : ""}${n.status === "done" ? " done" : ""}`}>
      <div className="nhead">
        <span className={`kind ${n.kind}`}>{n.kind === "frame" ? "FRAME" : n.kind === "range" ? "RANGE" : "VIDEO"}</span>
        {n.kind === "general" ? <span className="mono muted" style={{ fontSize: 12 }}>{when}</span> : <button className="ntc" onClick={() => onJump(n)} title="Jump here">{when}</button>}
        {len > 0 && <span className="mono faint" style={{ fontSize: 11 }}>{len} fr</span>}
      </div>
      {editing ? (
        <div style={{ display: "grid", gap: 6 }}>
          <textarea className="input" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn small solid" onClick={async () => { await editText({ noteId: n._id, text: draft }); setEditing(false); }}>Save</button>
            <button className="btn small" onClick={() => { setDraft(n.text); setEditing(false); }}>Cancel</button>
          </div>
        </div>
      ) : (
        n.text && <div className="ntext">{n.text}</div>
      )}
      {(n.still || n.stillIn || n.stillOut) && (
        <div className="nstill">
          {n.still && <a href={n.still} target="_blank" rel="noreferrer"><img src={n.still} alt="Frame with drawing" loading="lazy" /></a>}
          {n.kind === "range" && n.stillIn && n.stillIn !== n.still && <a href={n.stillIn} target="_blank" rel="noreferrer"><img src={n.stillIn} alt="First frame" loading="lazy" /></a>}
          {n.kind === "range" && n.stillOut && <a href={n.stillOut} target="_blank" rel="noreferrer"><img src={n.stillOut} alt="Last frame" loading="lazy" /></a>}
        </div>
      )}
      {n.replies.map((r) => (
        <div key={r._id} className="reply"><span className="muted" style={{ fontSize: 12 }}>{r.authorName} · {ago(r.createdAt)}</span><div className="ntext">{r.text}</div></div>
      ))}
      {replying && (
        <form style={{ display: "grid", gap: 6 }} onSubmit={async (e) => { e.preventDefault(); if (!replyText.trim()) return; await reply({ noteId: n._id, text: replyText }); setReplyText(""); setReplying(false); }}>
          <textarea className="input" value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Reply" autoFocus />
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn small solid" type="submit">Reply</button>
            <button className="btn small" type="button" onClick={() => setReplying(false)}>Cancel</button>
          </div>
        </form>
      )}
      <div className="nfoot">
        <label className="check">
          <input type="checkbox" checked={n.status === "done"} onChange={(e) => void setStatus({ noteId: n._id as Id<"notes">, status: e.target.checked ? "done" : "open" })} />
          Done
        </label>
        <span>·</span>
        <span>{n.authorName} · {ago(n.createdAt)}</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {!replying && <button className="btn small" onClick={() => setReplying(true)}>Reply</button>}
          {!editing && <button className="btn small" onClick={() => setEditing(true)}>Edit</button>}
          {confirming ? (
            <>
              <button className="btn small danger" onClick={() => void remove({ noteId: n._id })}>Delete note</button>
              <button className="btn small" onClick={() => setConfirming(false)}>Keep</button>
            </>
          ) : (
            <button className="btn small" onClick={() => setConfirming(true)} aria-label="Delete">✕</button>
          )}
        </span>
      </div>
    </article>
  );
}
