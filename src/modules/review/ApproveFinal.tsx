// Approve final (R2b, Oct 22): pick the version to keep; the second press deletes every other version of the video
// for good (Bunny files, notes, drawings, replies, stills, transcripts, voice notes). Dropbox originals stay.
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { CircleCheckBig, X } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Modal } from "../../ui/kit";
import { sizeText } from "../../lib/format";

const day = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function ApproveFinal({ videoId, title, onClose, onDone }: { videoId: Id<"videos">; title: string; onClose: () => void; onDone: (msg: string) => void }) {
  const data = useQuery(api.library.video, { videoId });
  const approve = useMutation(api.library.approveFinal);
  const clearFinal = useMutation(api.library.clearFinal);
  const versions = data?.versions ?? [];
  const ready = versions.filter((x) => x.status === "ready");
  const [keep, setKeep] = useState<number | null>(null);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (keep === null && ready.length) setKeep(data?.final?.version && ready.some((x) => x.number === data.final!.version) ? data.final.version : ready[ready.length - 1].number);
  }, [ready.length, keep, data?.final]);

  const others = versions.filter((x) => x.number !== keep);
  const freed = others.reduce((s, x) => s + (x.storageBytes ?? 0), 0);
  const unknownSize = others.some((x) => x.storageBytes === null);
  const browserOnly = others.filter((x) => !x.dropboxPath);
  const list = (ns: number[]) => ns.map((n) => `v${n}`).join(", ");
  const label = !others.length
    ? `Mark v${keep} final`
    : armed
      ? `Press again: keep v${keep}, delete ${list(others.map((x) => x.number))}${freed ? ` (frees ${sizeText(freed)}${unknownSize ? "+" : ""})` : ""}`
      : `Keep v${keep}, delete ${others.length === 1 ? "the other version" : `the other ${others.length}`}`;

  async function go() {
    if (keep === null) return;
    if (others.length && !armed) { setArmed(true); return; }
    setBusy(true); setError(null);
    try {
      const r = await approve({ videoId, keep });
      onDone(r.deleted.length ? `Final v${r.kept}. Deleted ${list(r.deleted)}${r.freedBytes ? `, freed ${sizeText(r.freedBytes)}` : ""}.` : `v${r.kept} marked final.`);
      onClose();
    } catch (e) {
      setError((e as Error).message.replace(/^.*ConvexError: /, "").split("\n")[0]);
      setBusy(false); setArmed(false);
    }
  }

  return (
    <Modal onClose={onClose} label="Approve final" width={540}>
      <div style={{ display: "grid", gap: 16 }}>
        <div className="dhead">
          <div style={{ display: "grid", gap: 6 }}>
            <span className="eyebrow">Approve final</span>
            <h2 className="headline">{title}. <span className="rest">Pick the version to keep.</span></h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        {data?.final && (
          <p className="caption" style={{ margin: 0 }}>
            <CircleCheckBig size={13} style={{ verticalAlign: -2 }} /> Final since {day(data.final.at)}: v{data.final.version}.{" "}
            <button className="linkbtn" onClick={async () => { await clearFinal({ videoId }); onDone("Final badge removed. Nothing was deleted."); onClose(); }}>Remove the Final badge</button>
          </p>
        )}

        {data === undefined ? <p className="caption">Loading…</p> : versions.length === 0 ? <p className="caption">This video has no versions yet.</p> : (
          <div className="vpick" role="radiogroup" aria-label="Version to keep">
            {[...versions].reverse().map((x) => {
              const ok = x.status === "ready";
              return (
                <label key={x._id} className={`vpickrow${keep === x.number ? " on" : ""}${ok ? "" : " off"}`}>
                  <input type="radio" name="keep" checked={keep === x.number} disabled={!ok} onChange={() => { setKeep(x.number); setArmed(false); }} />
                  <b>v{x.number}</b>
                  <span className="secondary">{day(x.createdAt)}</span>
                  <span className="secondary">{x.storageBytes ? sizeText(x.storageBytes) : "size unknown"}</span>
                  <span className="secondary">{x.noteCount ? `${x.noteCount} note${x.noteCount === 1 ? "" : "s"}` : "no notes"}</span>
                  <span className="secondary">{x.dropboxPath ? "Dropbox" : "Browser"}</span>
                  {!ok && <span className="chip warn">{x.status === "failed" ? "Failed" : "Not ready"}</span>}
                </label>
              );
            })}
          </div>
        )}

        {others.length > 0 && keep !== null && (
          <div className="warnbox">
            <p style={{ margin: 0 }}><b>{list(others.map((x) => x.number))} {others.length === 1 ? "is" : "are"} deleted right away, for good:</b> their video files on Bunny, and their notes, drawings, replies, stills, transcripts and voice notes. There's no undo.</p>
            <p style={{ margin: 0 }} className="secondary">Your Dropbox originals aren't touched.{browserOnly.length > 0 && <> <b style={{ color: "var(--text-primary)" }}>{list(browserOnly.map((x) => x.number))} {browserOnly.length === 1 ? "was" : "were"} uploaded in the browser, so {browserOnly.length === 1 ? "its" : "their"} only original is on your computer.</b></>}</p>
          </div>
        )}

        {error && <p className="error" role="alert">{error}</p>}
        <div className="dfoot">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className={`btn primary${armed ? " armed" : ""}`} disabled={busy || keep === null} onClick={() => void go()}>
            <CircleCheckBig size={15} />{busy ? "Deleting…" : label}
          </button>
        </div>
      </div>
    </Modal>
  );
}
