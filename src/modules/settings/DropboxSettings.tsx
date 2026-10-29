// Settings › Dropbox drop folder: connect, see recent drops, and how to render into it.
import { useEffect, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { ArrowUpRight, FolderInput, RotateCw } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { ago } from "../../lib/format";
import { linkProps } from "../../lib/router";
import { Modal, Spinner } from "../../ui/kit";

const STATUS: Record<string, string> = {
  waiting: "Waiting for it to finish",
  importing: "Importing",
  imported: "Imported",
  skipped: "Not imported",
  failed: "Failed",
  flagged: "Needs a new name",
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
        <h1 className="headline">Render straight to review. <span className="rest">A render saved in Dropbox with its register name becomes that video's next version.</span></h1>
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
                <span className={`secondary busyline${f.status === "failed" || f.status === "flagged" ? " error" : ""}`} style={{ fontSize: 12.5 }}>
                  {(f.status === "waiting" || f.status === "importing") && <Spinner />}{STATUS[f.status] ?? f.status}{f.status === "imported" ? (f.versionNumber ? ` as v${f.versionNumber}` : " · its version was deleted on the site") : ""}
                  {f.reason && f.status !== "waiting" && f.status !== "importing" ? ` · ${f.reason}` : ""} · {ago(f.at)}
                </span>
              </span>
              {f.videoId && <span className="pr"><a className="btn sm" {...linkProps(`/v/${f.videoId}?version=${f.versionNumber}`)}><ArrowUpRight size={14} />Open</a></span>}
            </div>
          ))}
        </div>
      )}

      <div className="panel setup">
        <div className="prow"><span className="pl"><b>How to render into it</b> <span className="secondary" style={{ display: "block", fontSize: 12.5 }}>The file name decides the video. Folders make projects: <code className="mono">Clients/‹Client›/‹Project›/</code> or <code className="mono">Projects/‹Project›/</code>.</span></span></div>
        <ol className="steps">
          <li>Get the name from the <b>Register</b>: <b>New video</b> for a new one (it gets the next number), or <b>Copy next render name</b> on a video, e.g. <code className="mono">00002_SpiritIntro_v1</code>. Name the Resolve timeline the same.</li>
          <li>In Resolve's Deliver page, pick the <b>Wrangler Review</b> preset that fits (16x9, Scope or Vertical), set <b>Location</b> to <b>Apps › Wrangler Review</b> (any folder in it) and use that name for the file.</li>
          <li>A render made with a Wrangler Review preset plays on the site about a minute after Dropbox finishes, exactly as rendered. Anything else (ProRes, a .mov, an MP4 with the index at the end) is converted by Bunny first, which takes longer.</li>
          <li>A name that isn't in the register, or a version that's already on the site, is flagged on the Register page with what to rename it. Nothing is guessed. Your original stays in Dropbox. A flagged render sitting in a project folder can be registered and imported from there in one go.</li>
          <li>New folders make projects: <code className="mono">Clients › Floor Trader › Backrooms</code> makes the client and the project the minute the folder appears (even empty); <code className="mono">Projects › 26122 Spirit Days</code> makes a project with job 26122 and no client. Renaming a folder renames the project; deleting one never deletes anything here. Anything else at the top level is left alone.</li>
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
