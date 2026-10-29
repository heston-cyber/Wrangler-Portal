// Home: drop a render anywhere on the page to upload it; recent videos and activity underneath.
import { useState } from "react";
import { useQuery } from "convex/react";
import { Link2 } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { TopBar, useShell } from "../../shell/Shell";
import { useUpload } from "../../shell/UploadDialog";
import { isVideoFile, useUploads } from "../../lib/uploads";
import { linkProps } from "../../lib/router";
import { Avatar, Thumb } from "../../ui/kit";
import { ago, uploadText } from "../../lib/format";
import { VideoRow, openedMeta } from "./VideoRows";
import { useLibrarySettings } from "../../lib/details";
import { Icon } from "../../ui/Icon";
import { Button, IconButton } from "../../ui/wp";

export default function Home() {
  const overview = useQuery(api.library.overview);
  const { openUpload } = useUpload();
  const { openSearch } = useShell();
  const uploads = useUploads().filter((u) => u.status !== "done");
  const [over, setOver] = useState(false);
  const [tab, setTab] = useState<"opened" | "videos" | "activity">("opened");
  const videos = overview?.videos ?? [];
  const pmap = new Map((overview?.projects ?? []).map((p) => [p._id as string, p.name]));
  const projects = new Map((overview?.projects ?? []).map((p) => [p._id as string, p]));
  const lib = useLibrarySettings();
  const opened = videos.filter((x) => x.lastOpenedAt).sort((a, b) => b.lastOpenedAt! - a.lastOpenedAt!).slice(0, 8);
  const latest = [...videos].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8);
  const shownTab = tab === "opened" && opened.length === 0 && overview ? "videos" : tab;

  const rows = shownTab === "opened" ? opened : latest;
  return (
    <>
      <TopBar><span className="here">Review</span></TopBar>
      <div className="wp-page"
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(false); }}
        onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f && isVideoFile(f)) openUpload({ file: f }); }}>
        <section className={`rv-hero glass${over ? " over" : ""}`} aria-label="Upload">
          <div className="txt">
            <span className="wp-eyebrow">Review</span>
            <h1 className="wp-h1">Drop a render here.</h1>
            <p className="wp-body">Any format. Bunny converts it, and every note you leave lands frame-exact in Resolve.</p>
          </div>
          <Button variant="primary" icon="plus" onClick={() => openUpload()}>Upload</Button>
        </section>

        {uploads.length > 0 && (
          <section className="wp-card glass" aria-label="Uploads">
            <div className="wp-rows">
              {uploads.map((u, i) => (
                <div key={u.key} style={{ display: "contents" }}>
                  {i > 0 && <hr className="wp-divider" />}
                  <div className="rv-upload">
                    <div className="line"><Icon name="upload" size={16} /><b>{u.fileName}</b><span>{uploadText(u.status, u.sent, u.total, u.error)}</span></div>
                    <div className="progress"><i style={{ width: `${u.total ? (100 * u.sent) / u.total : 0}%` }} /></div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="wp-card glass" aria-label="Recent">
          <div className="wp-rows">
            <div className="rv-recenthead">
              <div className="wp-utabs" role="tablist" aria-label="Recent">
                <button role="tab" type="button" className="wp-utab" aria-selected={shownTab === "opened"} onClick={() => setTab("opened")}>Last opened</button>
                <button role="tab" type="button" className="wp-utab" aria-selected={shownTab === "videos"} onClick={() => setTab("videos")}>Videos</button>
                <button role="tab" type="button" className="wp-utab" aria-selected={shownTab === "activity"} onClick={() => setTab("activity")}>Activity</button>
              </div>
              <span style={{ flex: 1 }} />
              <IconButton icon="search" label="Search" iconSize={18} className="sm" onClick={openSearch} />
            </div>
            <hr className="wp-divider" />
            {overview === undefined ? <p className="wp-small rv-pad">Loading…</p>
              : shownTab === "activity" ? <RecentActivity />
              : rows.length === 0 ? <p className="wp-small rv-pad">No videos yet. Upload your first render above.</p>
              : rows.map((x, i) => (
                <div key={x._id} style={{ display: "contents" }}>
                  {i > 0 && <hr className="wp-divider" />}
                  <VideoRow x={x} project={projects.get(x.projectId)} fields={lib.fields} projectName={lib.fields.includes("project") ? undefined : pmap.get(x.projectId)} meta={shownTab === "opened" ? openedMeta(x) : undefined} />
                </div>
              ))}
          </div>
        </section>
      </div>
    </>
  );
}

function RecentActivity() {
  const feed = useQuery(api.activity.feed, { limit: 8 });
  if (feed === undefined) return <p className="wp-small rv-pad">Loading…</p>;
  if (feed.length === 0) return <p className="wp-small rv-pad">Nothing yet.</p>;
  return (
    <>
      {feed.map((e, i) => e.type === "share" ? (
        <a key={i} className="vrow" style={{ gridTemplateColumns: "52px minmax(0,1fr) auto" }} {...linkProps("/settings/shares")}>
          <span className="thumb ph" aria-hidden><Link2 size={14} /></span>
          <span className="t" style={{ gap: 6 }}>
            <Avatar name={e.actor} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <span className="secondary">{e.actor} {e.kind === "opened" ? "opened the link for " : `watched ${e.videoTitle ?? "a video"} through the link for `}</span>
              {e.share.label}
            </span>
          </span>
          <span className="meta">{ago(e.at)}</span>
        </a>
      ) : (
        <a key={i} className="vrow" style={{ gridTemplateColumns: "52px minmax(0,1fr) auto" }} {...linkProps(`/v/${e.version.videoId}?version=${e.version.number}`)}>
          <Thumb src={e.version.thumbUrl} />
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
