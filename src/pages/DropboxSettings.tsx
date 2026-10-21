// Settings › Dropbox drop folder: connect, see recent drops, and how to render into it.
import { useEffect, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { ArrowUpRight, FolderInput, RotateCw } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { ago } from "../lib/format";
import { linkProps } from "../lib/router";
import { Modal, Spinner } from "../ui/kit";

const STATUS: Record<string, string> = {
  waiting: "Waiting for it to finish",
  importing: "Importing",
  imported: "Imported",
  skipped: "Not imported",
  failed: "Failed",
};

export function DropboxSettings({ show }: { show: (m: string) => void }) {
  const s = useQuery(api.dropbox.status, {});
  const authUrl = useAction(api.dropbox.authUrl);
  const disconnect = useAction(api.dropbox.disconnect);
  const syncNow = useAction(api.dropbox.syncNow);
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);

  // Back from Dropbox's approval page.
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const r = q.get("dropbox");
    if (!r) return;
    show(r === "connected" ? "Dropbox connected" : `Dropbox didn't connect: ${q.get("reason") ?? "unknown reason"}`);
    history.replaceState(null, "", "/settings#dropbox");
    document.getElementById("dropbox")?.scrollIntoView({ block: "start" });
  }, [show]);

  const connect = async () => {
    setBusy(true);
    try { location.href = await authUrl({}); }
    catch (e) { setBusy(false); show((e as Error).message.replace(/^.*ConvexError: /, "").split("\n")[0]); }
  };

  return (
    <>
      <div style={{ display: "grid", gap: 8 }} id="dropbox">
        <span className="eyebrow">Dropbox drop folder</span>
        <h1 className="headline">Render straight to review. <span className="rest">Anything saved in a video's folder in Dropbox becomes that video's next version.</span></h1>
      </div>

      <div className="panel">
        <div className="prow">
          <span className="pl">Dropbox
            <span className="secondary" style={{ display: "block", fontSize: 12.5 }}>
              {s === undefined ? "…" : !s.configured ? "Waiting on the Dropbox app key and secret in Convex." : s.connected ? `Connected${s.email ? ` as ${s.email}` : ""}${s.connectedAt ? ` · ${ago(s.connectedAt)}` : ""}` : "Not connected yet."}
            </span>
          </span>
          <span className="pr">
            {s?.connected ? (
              <>
                <button className="btn sm" onClick={async () => { await syncNow({}); show("Checking Dropbox now"); }}><RotateCw size={14} />Check now</button>
                <button className="btn sm" onClick={() => setConfirmOff(true)}>Disconnect</button>
              </>
            ) : (
              <button className="btn primary sm" disabled={busy || !s?.configured} onClick={() => void connect()}><FolderInput size={15} />{busy ? "Opening Dropbox…" : "Connect Dropbox"}</button>
            )}
          </span>
        </div>
        {s?.connected && (
          <div className="prow">
            <span className="pl">Drop folder <span className="secondary" style={{ display: "block", fontSize: 12.5 }}>Checked every minute{s.lastSyncAt ? ` · last ${ago(s.lastSyncAt)}` : ""}.</span></span>
            <span className="pr"><code className="mono addr">Dropbox › Apps › Wrangler Review</code></span>
          </div>
        )}
        {s?.lastError && <div className="prow"><span className="pl error" style={{ fontSize: 13 }}>Last check failed: {s.lastError}</span></div>}
        <div className="prow">
          <span className="pl">Transcripts <span className="secondary" style={{ display: "block", fontSize: 12.5 }}>{s?.transcripts ? "Every new version is transcribed by ElevenLabs, word by word." : "Off until the ElevenLabs key is in Convex."}</span></span>
          <span className="pr"><span className="rtag">{s?.transcripts ? "On" : "Off"}</span></span>
        </div>
      </div>

      {s?.connected && (
        <div className="panel">
          <div className="prow"><span className="pl"><b>Recent drops</b></span></div>
          {s.recent.length === 0 ? (
            <div className="prow"><span className="pl secondary">Nothing dropped yet.</span></div>
          ) : s.recent.map((f) => (
            <div className="prow droprow" key={f._id}>
              <span className="pl">
                <code className="mono">{f.path.split("/").filter(Boolean).join(" › ")}</code>
                <span className={`secondary busyline${f.status === "failed" ? " error" : ""}`} style={{ fontSize: 12.5 }}>
                  {(f.status === "waiting" || f.status === "importing") && <Spinner />}{STATUS[f.status] ?? f.status}{f.status === "imported" ? (f.versionNumber ? ` as v${f.versionNumber}` : " · its version was deleted on the site") : ""}
                  {f.reason && (f.status === "skipped" || f.status === "failed") ? ` · ${f.reason}` : ""} · {ago(f.at)}
                </span>
              </span>
              {f.videoId && <span className="pr"><a className="btn sm" {...linkProps(`/v/${f.videoId}?version=${f.versionNumber}`)}><ArrowUpRight size={14} />Open</a></span>}
            </div>
          ))}
        </div>
      )}

      <div className="panel setup">
        <div className="prow"><span className="pl"><b>How to render into it</b> <span className="secondary" style={{ display: "block", fontSize: 12.5 }}>One folder per video. The file name doesn't matter.</span></span></div>
        <ol className="steps">
          <li>In Dropbox, open <b>Apps › Wrangler Review</b>. Make a folder for the project, then one inside it for the video, e.g. <code className="mono">26122 Spirit Days › Spirit Intro</code>.</li>
          <li>In Resolve's Deliver page, set <b>Location</b> to that video folder and render.</li>
          <li>About a minute after Dropbox finishes uploading, it shows up as the video's next version. Your original stays in Dropbox.</li>
          <li>Starting the folder name with the job number matches an existing project by number. A new folder makes a new project or video.</li>
        </ol>
      </div>

      {confirmOff && (
        <Modal onClose={() => setConfirmOff(false)} label="Disconnect Dropbox" width={460}>
          <div style={{ display: "grid", gap: 18 }}>
            <div className="dhead">
              <h2 className="headline">Disconnect Dropbox? <span className="rest">New renders stop showing up. Versions already imported stay, and nothing in Dropbox is touched.</span></h2>
            </div>
            <div className="dfoot">
              <button className="btn" onClick={() => setConfirmOff(false)}>Cancel</button>
              <button className="btn primary" onClick={async () => { await disconnect({}); setConfirmOff(false); show("Dropbox disconnected"); }}>Disconnect</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
