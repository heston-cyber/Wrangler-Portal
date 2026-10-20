import { useRef, useState } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { linkProps, navigate } from "../lib/router";
import { isVideoFile, startUpload, useUploads } from "../lib/uploads";

export default function Home() {
  const projects = useQuery(api.library.home);
  const [adding, setAdding] = useState(false);
  const uploads = useUploads();

  return (
    <main className="page">
      <div className="home-head">
        <div>
          <p className="label">[00] Projects</p>
          <h1>Review</h1>
        </div>
        {!adding && <button className="btn solid" onClick={() => setAdding(true)}>New video</button>}
      </div>

      {adding && <NewVideo onDone={() => setAdding(false)} />}

      {uploads.filter((u) => u.status !== "done").map((u) => (
        <div key={u.key} className="sheet" style={{ gap: 8 }}>
          <div className="nfoot"><b style={{ color: "var(--fg)" }}>{u.fileName}</b> · {statusText(u.status, u.sent, u.total, u.error)}</div>
          <div className="progress"><i style={{ width: `${u.total ? (100 * u.sent) / u.total : 0}%` }} /></div>
        </div>
      ))}

      {projects === undefined ? (
        <p className="muted">Loading…</p>
      ) : projects.length === 0 ? (
        <p className="empty">No videos yet. Press <b>New video</b>, pick or name a project, and drop in a render. Bunny converts it, and you'll get a Slack message when it's ready to review.</p>
      ) : (
        projects.map((p, i) => (
          <section className="project" key={p._id}>
            <h2><span className="idx">[{String(i + 1).padStart(2, "0")}]</span>{p.jobNumber ? `${p.jobNumber} ` : ""}{p.name}</h2>
            {p.videos.length === 0 && <p className="muted" style={{ margin: "4px 0 10px" }}>No videos in this project yet.</p>}
            {p.videos.map((vid) => (
              <a className="vrow" key={vid._id} {...linkProps(`/v/${vid._id}`)}>
                <span className="vtitle">{vid.title}</span>
                <span className="mono muted" style={{ fontSize: 12 }}>{vid.latest ? `v${vid.latest.number}` : "no versions"}</span>
                {vid.latest ? <span className={`chip ${vid.latest.status}`}>{chipText(vid.latest.status, vid.latest.encodeProgress)}</span> : <span />}
                <span className="mono" style={{ fontSize: 12, color: vid.openNotes ? "var(--range)" : "var(--faint)" }}>{vid.openNotes} open</span>
              </a>
            ))}
          </section>
        ))
      )}
    </main>
  );
}

export function chipText(status: string, progress: number) {
  if (status === "processing") return progress > 0 ? `Converting ${progress}%` : "Converting";
  if (status === "uploading") return "Uploading";
  if (status === "failed") return "Failed";
  return "Ready";
}

export function statusText(status: string, sent: number, total: number, error?: string) {
  if (status === "failed") return `Upload failed: ${error ?? ""}`;
  if (status === "starting") return "Starting upload…";
  if (status === "done") return "Uploaded. Bunny is converting it.";
  const pct = total ? Math.floor((100 * sent) / total) : 0;
  return `Uploading ${pct}% (${(sent / 1e6).toFixed(0)} of ${(total / 1e6).toFixed(0)} MB). Keep this tab open.`;
}

function NewVideo({ onDone }: { onDone: () => void }) {
  const convex = useConvex();
  const projects = useQuery(api.library.projectNames);
  const createProject = useMutation(api.library.createProject);
  const createVideo = useMutation(api.library.createVideo);
  const [projectId, setProjectId] = useState<string>("");
  const [newName, setNewName] = useState("");
  const [jobNumber, setJobNumber] = useState("");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const isNew = projectId === "" || projectId === "__new";

  function pick(f: File | undefined | null) {
    if (!f) return;
    if (!isVideoFile(f)) { setError("That doesn't look like a video file."); return; }
    setError(null);
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " "));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) { setError("Drop in a video file first."); return; }
    if (isNew && !newName.trim()) { setError("Name the new project."); return; }
    if (!title.trim()) { setError("Give the video a title."); return; }
    setBusy(true);
    try {
      const pid = isNew
        ? await createProject({ name: newName, jobNumber: jobNumber || undefined })
        : (projectId as Id<"projects">);
      const videoId = await createVideo({ projectId: pid, title });
      void startUpload(convex, videoId, file);
      onDone();
      navigate(`/v/${videoId}`);
    } catch (err) {
      setError((err as Error).message.replace(/^.*ConvexError: /, "").split("\n")[0]);
      setBusy(false);
    }
  }

  return (
    <form className="sheet" onSubmit={submit}>
      <p className="label">New video</p>
      <div className="row2">
        <label className="field">
          <span className="label">Project</span>
          <select className="input" id="project" value={projectId || "__new"} onChange={(e) => setProjectId(e.target.value)}>
            <option value="__new">New project…</option>
            {(projects ?? []).map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="label">Video title</span>
          <input className="input" id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Spirit Days Intro" />
        </label>
      </div>
      {isNew && (
        <div className="row2">
          <label className="field">
            <span className="label">New project name</span>
            <input className="input" id="newProject" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Floor Trader Backrooms" />
          </label>
          <label className="field">
            <span className="label">Job number (optional)</span>
            <input className="input" id="jobNumber" value={jobNumber} onChange={(e) => setJobNumber(e.target.value)} placeholder="26127" />
          </label>
        </div>
      )}
      <div
        className={`drop${over ? " over" : ""}`}
        onClick={() => fileInput.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0]); }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileInput.current?.click(); }}
      >
        {file ? <span><b style={{ color: "var(--fg)" }}>{file.name}</b> · {(file.size / 1e6).toFixed(0)} MB</span> : "Drop a render here, or click to choose one. Any format: MP4, MOV, ProRes, H.265."}
        <input ref={fileInput} type="file" accept="video/*,.mov,.mp4,.m4v,.mxf,.mkv" hidden onChange={(e) => pick(e.target.files?.[0])} />
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn solid" type="submit" disabled={busy}>{busy ? "Starting…" : "Upload"}</button>
        <button className="btn" type="button" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}
