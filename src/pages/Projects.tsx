// Projects (Flask's Assets page): every video, grouped and sorted, as a list or a grid.
// /projects shows everything; /projects/:id shows one project.
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ChevronDown, ChevronRight, Clapperboard, Ellipsis, FolderPlus, LayoutGrid, List, Pencil, Plus, SlidersHorizontal, Upload, X } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Sep, TopBar } from "../shell/Shell";
import { useUpload } from "../shell/UploadDialog";
import { linkProps } from "../lib/router";
import { isVideoFile } from "../lib/uploads";
import { Menu, MenuItem, MenuLabel, MenuSep, Modal } from "../ui/kit";
import { dayBucket, projectLabel } from "../lib/format";
import { VideoCard, VideoRow, openedMeta, updatedMeta, type Overview, type VideoItem } from "./VideoRows";

type GroupBy = "project" | "activity" | "opened" | "status";
type SortBy = "activity" | "created" | "az";
type View = "list" | "grid";

function usePref<T extends string>(key: string, fallback: T): [T, (v: T) => void] {
  let initial = fallback;
  try { initial = (localStorage.getItem(key) as T) || fallback; } catch { /* private mode */ }
  const [v, setV] = useState<T>(initial);
  return [v, (n: T) => { setV(n); try { localStorage.setItem(key, n); } catch { /* ignore */ } }];
}

export default function Projects({ projectId }: { projectId?: Id<"projects"> }) {
  const overview = useQuery(api.library.overview);
  const { openUpload } = useUpload();
  const [groupPref, setGroup] = usePref<GroupBy>("wr.groupBy", "project");
  const [sort, setSort] = usePref<SortBy>("wr.sortBy", "activity");
  const [view, setView] = usePref<View>("wr.view", "list");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<Overview["projects"][number] | null>(null);
  const project = projectId ? overview?.projects.find((p) => p._id === projectId) : undefined;
  const group: GroupBy = projectId && groupPref === "project" ? "activity" : groupPref;

  const pmap = new Map((overview?.projects ?? []).map((p) => [p._id as string, p]));
  const vids = (overview?.videos ?? []).filter((x) => !projectId || x.projectId === projectId);
  const sorter = (a: VideoItem, b: VideoItem) =>
    sort === "az" ? a.title.localeCompare(b.title) : sort === "created" ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt;

  type Group = { key: string; title: React.ReactNode; meta?: string; items: VideoItem[]; project?: Overview["projects"][number] };
  let groups: Group[] = [];
  if (group === "project") {
    groups = [...(overview?.projects ?? [])].sort((a, b) => b.updatedAt - a.updatedAt).map((p) => ({
      key: p._id, title: projectLabel(p), meta: p.client ?? undefined, project: p, items: vids.filter((x) => x.projectId === p._id).sort(sorter),
    }));
  } else if (group === "status") {
    const order = ["Open notes", "Ready", "Converting", "No versions"];
    const st = (x: VideoItem) => !x.latest ? "No versions" : x.latest.status !== "ready" ? "Converting" : x.openNotes ? "Open notes" : "Ready";
    groups = order.map((k) => ({ key: k, title: k, items: vids.filter((x) => st(x) === k).sort(sorter) })).filter((g) => g.items.length);
  } else {
    const time = (x: VideoItem) => (group === "opened" ? x.lastOpenedAt : x.updatedAt);
    const order = ["Today", "Yesterday", "This week", "This month", "Earlier", "Not opened yet"];
    const bucket = (x: VideoItem) => (time(x) ? dayBucket(time(x)!) : "Not opened yet");
    groups = order.map((k) => ({
      key: k, title: k, items: vids.filter((x) => bucket(x) === k).sort((a, b) => sort === "activity" ? (time(b) ?? 0) - (time(a) ?? 0) : sorter(a, b)),
    })).filter((g) => g.items.length);
  }
  const meta = (x: VideoItem) => (group === "opened" ? openedMeta(x) : updatedMeta(x));
  const toggle = (k: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <>
      <TopBar right={
        <>
          <Menu align="end" label="View options" trigger={(p) => <button {...p} className="icon-btn md" aria-label="View options" title="View options"><SlidersHorizontal size={16} /></button>}>
            <div style={{ display: "flex", gap: 4, padding: 4 }}>
              <button className={`btn sm${view === "grid" ? " on" : ""}`} style={{ flex: 1 }} onClick={() => setView("grid")}><LayoutGrid size={14} />Grid</button>
              <button className={`btn sm${view === "list" ? " on" : ""}`} style={{ flex: 1 }} onClick={() => setView("list")}><List size={14} />List</button>
            </div>
            <MenuSep />
            <MenuLabel>Sort inside groups</MenuLabel>
            <MenuItem checked={sort === "activity"} onSelect={() => setSort("activity")}>Latest activity</MenuItem>
            <MenuItem checked={sort === "created"} onSelect={() => setSort("created")}>Last created</MenuItem>
            <MenuItem checked={sort === "az"} onSelect={() => setSort("az")}>A → Z</MenuItem>
          </Menu>
          <Menu align="end" label="Add" trigger={(p) => <button {...p} className="btn primary sm"><Plus size={15} />Add</button>}>
            <MenuItem icon={<Upload size={16} />} onSelect={() => openUpload({ projectId })}>Upload a video</MenuItem>
            <MenuSep />
            <MenuItem icon={<FolderPlus size={16} />} onSelect={() => openUpload({ newProject: true })}>New project</MenuItem>
          </Menu>
        </>
      }>
        <Clapperboard size={15} />
        {projectId ? <><a {...linkProps("/projects")}>Projects</a><Sep /><span className="here">{project ? projectLabel(project) : "…"}</span></> : <span className="here">Projects</span>}
      </TopBar>

      <div className="content"
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && isVideoFile(f)) openUpload({ file: f, projectId }); }}>
        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label="Group by">
            {!projectId && <button role="tab" className="tab" aria-selected={group === "project"} onClick={() => setGroup("project")}>Project</button>}
            <button role="tab" className="tab" aria-selected={group === "activity"} onClick={() => setGroup("activity")}>Latest activity</button>
            <button role="tab" className="tab" aria-selected={group === "opened"} onClick={() => setGroup("opened")}>Last opened</button>
            <button role="tab" className="tab" aria-selected={group === "status"} onClick={() => setGroup("status")}>Status</button>
          </div>
        </div>

        {overview === undefined ? <p className="caption" style={{ padding: "8px 24px" }}>Loading…</p>
          : projectId && !project ? <div className="empty">This project doesn't exist any more. <a className="btn" {...linkProps("/projects")}>All projects</a></div>
          : vids.length === 0 && group !== "project" ? (
            <div className="empty">
              <img src="/brand/spark-cream.png" alt="" />
              <span>{projectId ? "No videos in this project yet." : "No videos yet."} Drop a render anywhere on this page.</span>
              <button className="btn primary" onClick={() => openUpload({ projectId })}><Upload size={16} />Upload</button>
            </div>
          ) : groups.length === 0 ? (
            <div className="empty">
              <img src="/brand/spark-cream.png" alt="" />
              <span>No projects yet.</span>
              <button className="btn primary" onClick={() => openUpload({ newProject: true })}><FolderPlus size={16} />New project</button>
            </div>
          ) : groups.map((g) => (
            <section className="group" key={g.key}>
              <div className="ghead">
                <button className="collapse" onClick={() => toggle(g.key)} aria-label={collapsed.has(g.key) ? "Expand" : "Collapse"}>{collapsed.has(g.key) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button>
                {g.project ? <a className="gtitle" {...linkProps(`/projects/${g.project._id}`)}>{g.title}</a> : <span className="gtitle">{g.title}</span>}
                <span className="n">{g.items.length}</span>
                {g.meta && <span className="gmeta">· {g.meta}</span>}
                {g.project && (
                  <span className="right">
                    <button className="icon-btn" title="Upload to this project" aria-label="Upload to this project" onClick={() => openUpload({ projectId: g.project!._id })}><Plus size={15} /></button>
                    <Menu align="end" label="Project options" trigger={(p) => <button {...p} className="icon-btn" aria-label="Project options"><Ellipsis size={15} /></button>}>
                      <MenuItem icon={<Pencil size={16} />} onSelect={() => setRenaming(g.project!)}>Rename project</MenuItem>
                      <MenuItem icon={<Upload size={16} />} onSelect={() => openUpload({ projectId: g.project!._id })}>Upload a video</MenuItem>
                    </Menu>
                  </span>
                )}
              </div>
              {!collapsed.has(g.key) && (
                g.items.length === 0 ? <p className="caption" style={{ padding: "8px 28px" }}>No videos yet.</p>
                  : view === "grid" ? <div className="grid">{g.items.map((x) => <VideoCard key={x._id} x={x} meta={meta(x)} />)}</div>
                  : <div style={{ paddingTop: 4 }}>{g.items.map((x) => <VideoRow key={x._id} x={x} meta={meta(x)} projectName={group !== "project" && !projectId ? pmap.get(x.projectId)?.name : undefined} />)}</div>
              )}
            </section>
          ))}
        {projectId && project && (
          <div style={{ display: "flex", gap: 8, padding: "6px 24px 24px" }}>
            <button className="btn sm" onClick={() => setRenaming(project)}><Pencil size={14} />Rename project</button>
          </div>
        )}
      </div>
      {renaming && <RenameProject p={renaming} onClose={() => setRenaming(null)} />}
    </>
  );
}

function RenameProject({ p, onClose }: { p: Overview["projects"][number]; onClose: () => void }) {
  const rename = useMutation(api.library.renameProject);
  const [name, setName] = useState(p.name);
  const [job, setJob] = useState(p.jobNumber ?? "");
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal onClose={onClose} label="Rename project">
      <form style={{ display: "grid", gap: 18 }} onSubmit={async (e) => {
        e.preventDefault();
        try { await rename({ projectId: p._id, name, jobNumber: job }); onClose(); }
        catch (err) { setError((err as Error).message.replace(/^.*ConvexError: /, "").split("\n")[0]); }
      }}>
        <div className="dhead">
          <h2 className="headline">Rename project.</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="row2">
          <label className="field"><span className="label">Project name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
          <label className="field"><span className="label">Job number</span><input className="input" value={job} onChange={(e) => setJob(e.target.value)} /></label>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="dfoot"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" type="submit">Save</button></div>
      </form>
    </Modal>
  );
}
