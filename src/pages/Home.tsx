// Home: drop a render anywhere on the page to upload it; recent videos and activity underneath.
import { useState } from "react";
import { asset } from "../config";
import { useQuery } from "convex/react";
import { Plus, Search } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { TopBar, useShell } from "../shell/Shell";
import { useUpload } from "../shell/UploadDialog";
import { isVideoFile, useUploads } from "../lib/uploads";
import { linkProps } from "../lib/router";
import { Avatar, Thumb } from "../ui/kit";
import { ago, uploadText } from "../lib/format";
import { VideoRow, openedMeta, updatedMeta } from "./VideoRows";
import { House } from "lucide-react";

export default function Home() {
  const overview = useQuery(api.library.overview);
  const { openUpload } = useUpload();
  const { openSearch } = useShell();
  const uploads = useUploads().filter((u) => u.status !== "done");
  const [over, setOver] = useState(false);
  const [tab, setTab] = useState<"opened" | "videos" | "activity">("opened");
  const videos = overview?.videos ?? [];
  const pmap = new Map((overview?.projects ?? []).map((p) => [p._id as string, p.name]));
  const opened = videos.filter((x) => x.lastOpenedAt).sort((a, b) => b.lastOpenedAt! - a.lastOpenedAt!).slice(0, 8);
  const latest = [...videos].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8);
  const shownTab = tab === "opened" && opened.length === 0 && overview ? "videos" : tab;

  return (
    <>
      <TopBar><House size={15} /><span className="here">Home</span></TopBar>
      <div className="content"
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(false); }}
        onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f && isVideoFile(f)) openUpload({ file: f }); }}>
        <div className="home">
          <img className="watermark" src={asset("/brand/spark-watermark.png")} alt="" aria-hidden />
          <div className={`hero${over ? " over" : ""}`}>
            <div className="stack">
              <span className="eyebrow">Review</span>
              <h1 className="title">Drop a render here.</h1>
              <p className="caption" style={{ maxWidth: 420 }}><b>Any format.</b> Bunny converts it, and every note you leave lands frame-exact in Resolve.</p>
              <button className="btn primary lg" onClick={() => openUpload()}><Plus size={18} />Upload</button>
              {uploads.map((u) => (
                <div key={u.key} style={{ width: "min(420px, 80vw)", display: "grid", gap: 6, textAlign: "left" }}>
                  <span style={{ fontSize: 12.5 }}><b style={{ fontWeight: 500 }}>{u.fileName}</b> <span className="secondary">· {uploadText(u.status, u.sent, u.total, u.error)}</span></span>
                  <div className="progress"><i style={{ width: `${u.total ? (100 * u.sent) / u.total : 0}%` }} /></div>
                </div>
              ))}
            </div>
          </div>

          <div className="recent">
            <div className="tabs" role="tablist">
              <button role="tab" className="tab" aria-selected={shownTab === "opened"} onClick={() => setTab("opened")}>Last opened</button>
              <button role="tab" className="tab" aria-selected={shownTab === "videos"} onClick={() => setTab("videos")}>Videos</button>
              <button role="tab" className="tab" aria-selected={shownTab === "activity"} onClick={() => setTab("activity")}>Activity</button>
              <button className="icon-btn" onClick={openSearch} aria-label="Search"><Search size={15} /></button>
            </div>
            {overview === undefined ? <p className="caption" style={{ padding: "8px 18px" }}>Loading…</p>
              : shownTab === "activity" ? <RecentActivity />
              : (shownTab === "opened" ? opened : latest).length === 0 ? <p className="caption" style={{ padding: "8px 18px" }}>No videos yet. Upload your first render above.</p>
              : (shownTab === "opened" ? opened : latest).map((x) => (
                <VideoRow key={x._id} x={x} projectName={pmap.get(x.projectId)} meta={shownTab === "opened" ? openedMeta(x) : updatedMeta(x)} />
              ))}
          </div>
        </div>
      </div>
    </>
  );
}

function RecentActivity() {
  const feed = useQuery(api.activity.feed, { limit: 8 });
  if (feed === undefined) return <p className="caption" style={{ padding: "8px 18px" }}>Loading…</p>;
  if (feed.length === 0) return <p className="caption" style={{ padding: "8px 18px" }}>Nothing yet.</p>;
  return (
    <>
      {feed.map((e, i) => (
        <a key={i} className="vrow" style={{ gridTemplateColumns: "52px minmax(0,1fr) auto" }} {...linkProps(`/v/${e.version.videoId}?version=${e.version.number}`)}>
          <Thumb guid={e.version.bunnyGuid} />
          <span className="t" style={{ gap: 6 }}>
            <Avatar name={e.actor ?? "?"} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <span className="secondary">{e.type === "notes" ? `${e.actor} left ${e.notes.length} note${e.notes.length === 1 ? "" : "s"} on ` : e.version.number > 1 ? `${e.actor ?? "Someone"} added v${e.version.number} of ` : `${e.actor ?? "Someone"} added `}</span>
              {e.version.videoTitle}
            </span>
          </span>
          <span className="meta">{ago(e.at)}</span>
        </a>
      ))}
    </>
  );
}
