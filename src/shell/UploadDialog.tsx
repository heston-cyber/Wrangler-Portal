// "Upload a video": pick or name a project, title it, drop the file. Opens from Home, Projects and drops.
import { createContext, useContext, useRef, useState } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { X } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { navigate } from "../lib/router";
import { isVideoFile, startUpload } from "../lib/uploads";
import { Modal } from "../ui/kit";
import { projectLabel, sizeText } from "../lib/format";

type Init = { file?: File; projectId?: string; newProject?: boolean; client?: string };
type Open = (o?: Init) => void;
const Ctx = createContext<{ openUpload: Open }>({ openUpload: () => {} });
export const useUpload = () => useContext(Ctx);

export function UploadProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Init | null>(null);
  return (
    <Ctx.Provider value={{ openUpload: (o) => setState(o ?? {}) }}>
      {children}
      {state && <UploadDialog initial={state} onClose={() => setState(null)} />}
    </Ctx.Provider>
  );
}

const titleFrom = (name: string) => name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();

function UploadDialog({ initial, onClose }: { initial: Init; onClose: () => void }) {
  const convex = useConvex();
  const overview = useQuery(api.library.overview);
  const createProject = useMutation(api.library.createProject);
  const createVideo = useMutation(api.library.createVideo);
  const projects = [...(overview?.projects ?? [])].sort((a, b) => b.updatedAt - a.updatedAt);
  const [projectId, setProjectId] = useState<string>(initial.newProject ? "__new" : initial.projectId ?? "");
  const [newName, setNewName] = useState("");
  const [jobNumber, setJobNumber] = useState("");
  const [client, setClient] = useState(initial.client ?? "");
  const clientNames = [...new Set([...(overview?.clients ?? []), ...(overview?.projects ?? []).map((p) => p.client?.trim() ?? "").filter(Boolean)])].sort((a, b) => a.localeCompare(b));
  const [file, setFile] = useState<File | null>(initial.file ?? null);
  const [title, setTitle] = useState(initial.file ? titleFrom(initial.file.name) : "");
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // Default to the most recent project once the list arrives.
  const chosen = projectId || (projects[0]?._id ?? "__new");
  const isNew = chosen === "__new";
  const projectOnly = initial.newProject && !file;

  function pick(f: File | undefined | null) {
    if (!f) return;
    if (!isVideoFile(f)) { setError("That doesn't look like a video file."); return; }
    setError(null); setFile(f);
    if (!title) setTitle(titleFrom(f.name));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (isNew && !newName.trim()) { setError("Name the new project."); return; }
    if (!projectOnly && !file) { setError("Drop in a video file first."); return; }
    if (!projectOnly && !title.trim()) { setError("Give the video a title."); return; }
    setBusy(true);
    try {
      const pid = isNew ? await createProject({ name: newName, jobNumber: jobNumber || undefined, client: client.trim() || undefined }) : (chosen as Id<"projects">);
      if (projectOnly) { onClose(); navigate(`/projects/${pid}`); return; }
      const videoId = await createVideo({ projectId: pid, title });
      void startUpload(convex, videoId, file!);
      onClose();
      navigate(`/v/${videoId}`);
    } catch (err) {
      setError((err as Error).message.replace(/^.*ConvexError: /, "").split("\n")[0]);
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} label={projectOnly ? "New project" : "Upload a video"}>
      <form onSubmit={submit} style={{ display: "grid", gap: 18 }}>
        <div className="dhead">
          <div style={{ display: "grid", gap: 6 }}>
            <span className="eyebrow">{projectOnly ? "Project" : "Upload"}</span>
            <h2 className="headline">{projectOnly ? "New project." : "Add a video."} <span className="rest">{projectOnly ? "Name it and add the job number." : "Any format. Bunny converts it."}</span></h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        {!projectOnly && (
          <div className={`drop${over ? " over" : ""}`} role="button" tabIndex={0}
            onClick={() => input.current?.click()}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.current?.click(); } }}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0]); }}>
            {file ? <span><b style={{ color: "var(--text-primary)", fontWeight: 500 }}>{file.name}</b> · {sizeText(file.size)}</span> : "Drop a render here, or click to choose one. MP4, MOV, ProRes, H.265."}
            <input ref={input} type="file" hidden accept="video/*,.mov,.mp4,.m4v,.mxf,.mkv" onChange={(e) => pick(e.target.files?.[0])} />
          </div>
        )}

        {!initial.newProject && (
          <label className="field">
            <span className="label">Project</span>
            <select className="input" value={chosen} onChange={(e) => setProjectId(e.target.value)}>
              {projects.map((p) => <option key={p._id} value={p._id}>{projectLabel(p)}</option>)}
              <option value="__new">New project…</option>
            </select>
          </label>
        )}
        {isNew && (
          <div className="row2">
            <label className="field">
              <span className="label">Project name</span>
              <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Floor Trader Backrooms" autoFocus={projectOnly} />
            </label>
            <label className="field">
              <span className="label">Job number</span>
              <input className="input" value={jobNumber} onChange={(e) => setJobNumber(e.target.value)} placeholder="26127" />
            </label>
          </div>
        )}
        {isNew && (
          <label className="field">
            <span className="label">Client (optional)</span>
            <input className="input" value={client} onChange={(e) => setClient(e.target.value)} placeholder="Floor Trader" list="wr-clients" />
            <datalist id="wr-clients">{clientNames.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
        )}
        {!projectOnly && (
          <label className="field">
            <span className="label">Video title</span>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Spirit Days Intro" />
          </label>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="dfoot">
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
          <button className="btn primary" type="submit" disabled={busy}>{busy ? "Starting…" : projectOnly ? "Create project" : "Upload"}</button>
        </div>
      </form>
    </Modal>
  );
}
