// Projects (Flask's Assets page): every video, grouped and sorted, as a list or a grid.
// /projects shows everything; /projects/:id shows one project.
import { useState } from "react";
import { BrandImg } from "../ui/BrandImg";
import { useMutation, useQuery } from "convex/react";
import { Building2, ChevronDown, ChevronRight, Clapperboard, Ellipsis, FolderPlus, LayoutGrid, List, ListOrdered, Pencil, Plus, Rows3, SlidersHorizontal, Trash2, Upload, X } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Sep, TopBar } from "../shell/Shell";
import { useUpload } from "../shell/UploadDialog";
import { linkProps, navigate } from "../lib/router";
import { isVideoFile } from "../lib/uploads";
import { Menu, MenuItem, MenuLabel, MenuSep, Modal, useToast } from "../ui/kit";
import { NewVideo } from "./Register";
import { dayBucket, projectLabel } from "../lib/format";
import { VideoCard, VideoRow, openedMeta, type Overview, type VideoItem } from "./VideoRows";
import { FILTERS, SORTS, passes, sorter as sortBy, useLibrarySettings, type FilterKey, type SortKey } from "../lib/details";
import { ShowDetails } from "./ShowDetails";
import { ApproveFinal } from "./ApproveFinal";

type GroupBy = "client" | "project" | "activity" | "opened" | "status";
type SortBy = SortKey;
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
  const [filter, setFilter] = usePref<FilterKey>("wr.filter", "all");
  const lib = useLibrarySettings();
  const [showDetails, setShowDetails] = useState(false);
  const [approving, setApproving] = useState<VideoItem | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<Overview["projects"][number] | null>(null);
  const collapsedHas = (k: string) => collapsed.has(k);
  const [deletingProject, setDeletingProject] = useState<Overview["projects"][number] | null>(null);
  const [deletingClient, setDeletingClient] = useState<string | null>(null);
  const [clientPref, setClient] = usePref<string>("wr.client", "");
  const project = projectId ? overview?.projects.find((p) => p._id === projectId) : undefined;
  const group: GroupBy = projectId && (groupPref === "project" || groupPref === "client") ? "activity" : groupPref;

  const NO_CLIENT = "No client";
  const clientOf = (p: { client: string | null } | undefined) => p?.client?.trim() || NO_CLIENT;
  const made = new Set(overview?.clients ?? []); // clients made with "New client", shown even with no projects
  const clients = [...new Set([...(overview?.projects ?? []).map(clientOf), ...made])].sort((a, b) => (a === NO_CLIENT ? 1 : b === NO_CLIENT ? -1 : a.localeCompare(b)));
  const [newClient, setNewClient] = useState(false);
  const [newVideo, setNewVideo] = useState(false);
  const [toast, showToast] = useToast();
  const client = !projectId && clientPref && clients.includes(clientPref) ? clientPref : ""; // "" = all clients
  const pmap = new Map((overview?.projects ?? []).map((p) => [p._id as string, p]));
  const vids = (overview?.videos ?? []).filter((x) => (!projectId || x.projectId === projectId) && (!client || clientOf(pmap.get(x.projectId)) === client) && passes(filter, x));
  const shownProjects = [...(overview?.projects ?? [])].filter((p) => !client || clientOf(p) === client).sort((a, b) => b.updatedAt - a.updatedAt);
  const sorter = sortBy(SORTS.some((x) => x.key === sort) ? sort : "activity");

  type Group = { key: string; title: React.ReactNode; meta?: string; items: VideoItem[]; project?: Overview["projects"][number]; clientHead?: { count: number }; emptyClient?: string };
  let groups: Group[] = [];
  const projectGroup = (p: Overview["projects"][number], withClient: boolean): Group => ({
    key: p._id, title: projectLabel(p), meta: withClient ? p.client ?? undefined : undefined, project: p, items: vids.filter((x) => x.projectId === p._id).sort(sorter),
  });
  if (group === "client") {
    // Client headers, each followed by its projects (newest activity first).
    for (const c of clients) {
      const ps = shownProjects.filter((p) => clientOf(p) === c);
      if (!ps.length && !(made.has(c) && (!client || client === c))) continue;
      groups.push({ key: `client:${c}`, title: c, items: [], clientHead: { count: ps.length } });
      if (!collapsedHas(`client:${c}`)) groups.push(...(ps.length ? ps.map((p) => projectGroup(p, false)) : [{ key: `empty:${c}`, title: c, items: [], emptyClient: c }]));
    }
  } else if (group === "project") {
    groups = shownProjects.map((p) => projectGroup(p, true));
  } else if (group === "status") {
    const order = ["Open notes", "Ready", "Final", "Converting", "No versions"];
    const st = (x: VideoItem) => !x.latest ? "No versions" : x.latest.status !== "ready" ? "Converting" : x.openNotes ? "Open notes" : x.final ? "Final" : "Ready";
    groups = order.map((k) => ({ key: k, title: k, items: vids.filter((x) => st(x) === k).sort(sorter) })).filter((g) => g.items.length);
  } else {
    const time = (x: VideoItem) => (group === "opened" ? x.lastOpenedAt : x.updatedAt);
    const order = ["Today", "Yesterday", "This week", "This month", "Earlier", "Not opened yet"];
    const bucket = (x: VideoItem) => (time(x) ? dayBucket(time(x)!) : "Not opened yet");
    groups = order.map((k) => ({
      key: k, title: k, items: vids.filter((x) => bucket(x) === k).sort((a, b) => sort === "activity" ? (time(b) ?? 0) - (time(a) ?? 0) : sorter(a, b)),
    })).filter((g) => g.items.length);
  }
  const meta = (x: VideoItem) => (group === "opened" ? openedMeta(x) : undefined);
  const rowProps = (x: VideoItem) => ({
    x, meta: meta(x), project: pmap.get(x.projectId), fields: lib.fields,
    projectName: group !== "project" && !projectId && !lib.fields.includes("project") ? pmap.get(x.projectId)?.name : undefined,
    onApprove: lib.approveFinal ? setApproving : undefined,
  });
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
            <MenuLabel>Show</MenuLabel>
            {FILTERS.map((f) => <MenuItem key={f.key} keepOpen checked={filter === f.key} onSelect={() => setFilter(f.key)}>{f.label}</MenuItem>)}
            <MenuSep />
            <MenuLabel>Sort inside groups</MenuLabel>
            {SORTS.map((o) => <MenuItem key={o.key} keepOpen checked={sort === o.key} onSelect={() => setSort(o.key)}>{o.label}</MenuItem>)}
            <MenuSep />
            <MenuItem icon={<Rows3 size={16} />} onSelect={() => setShowDetails(true)}>Show details…</MenuItem>
            <MenuItem keepOpen checked={lib.approveFinal} onSelect={() => lib.setApproveFinal(!lib.approveFinal)}>Approve final buttons</MenuItem>
          </Menu>
          <Menu align="end" label="Add" trigger={(p) => <button {...p} className="btn primary sm"><Plus size={15} />Add</button>}>
            <MenuItem icon={<ListOrdered size={16} />} onSelect={() => setNewVideo(true)}>New video (gets a number)</MenuItem>
            <MenuItem icon={<Upload size={16} />} onSelect={() => openUpload({ projectId })}>Upload a video</MenuItem>
            <MenuSep />
            <MenuItem icon={<FolderPlus size={16} />} onSelect={() => openUpload({ newProject: true, client: client && client !== NO_CLIENT ? client : undefined })}>New project</MenuItem>
            {!projectId && <MenuItem icon={<Building2 size={16} />} onSelect={() => setNewClient(true)}>New client</MenuItem>}
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
            {!projectId && <button role="tab" className="tab" aria-selected={group === "client"} onClick={() => setGroup("client")}>Client</button>}
            {!projectId && <button role="tab" className="tab" aria-selected={group === "project"} onClick={() => setGroup("project")}>Project</button>}
            <button role="tab" className="tab" aria-selected={group === "activity"} onClick={() => setGroup("activity")}>Latest activity</button>
            <button role="tab" className="tab" aria-selected={group === "opened"} onClick={() => setGroup("opened")}>Last opened</button>
            <button role="tab" className="tab" aria-selected={group === "status"} onClick={() => setGroup("status")}>Status</button>
          </div>
          {!projectId && clients.length > 1 && (
            <span className="right">
              <Menu align="end" label="Client" trigger={(p) => <button {...p} className={`btn sm${client ? " on" : ""}`}><Building2 size={14} />{client || "All clients"}<ChevronDown size={14} /></button>}>
                <MenuLabel>Show</MenuLabel>
                <MenuItem checked={!client} onSelect={() => setClient("")}>All clients</MenuItem>
                <MenuSep />
                {clients.map((c) => <MenuItem key={c} checked={client === c} onSelect={() => setClient(c)}>{c}</MenuItem>)}
              </Menu>
            </span>
          )}
        </div>

        {overview === undefined ? <p className="caption" style={{ padding: "8px 24px" }}>Loading…</p>
          : projectId && !project ? <div className="empty">This project doesn't exist any more. <a className="btn" {...linkProps("/projects")}>All projects</a></div>
          : vids.length === 0 && group !== "project" && group !== "client" ? (
            <div className="empty">
              <BrandImg name="spark" />
              <span>{projectId ? "No videos in this project yet." : "No videos yet."} Drop a render anywhere on this page.</span>
              <button className="btn primary" onClick={() => openUpload({ projectId })}><Upload size={16} />Upload</button>
            </div>
          ) : groups.length === 0 ? (
            <div className="empty">
              <BrandImg name="spark" />
              <span>No projects yet.</span>
              <button className="btn primary" onClick={() => openUpload({ newProject: true })}><FolderPlus size={16} />New project</button>
            </div>
          ) : groups.map((g) => g.emptyClient ? (
            <div className="cempty" key={g.key}>
              <span className="caption">No projects for {g.emptyClient} yet.</span>
              <button className="btn sm" onClick={() => openUpload({ newProject: true, client: g.emptyClient })}><FolderPlus size={14} />New project</button>
            </div>
          ) : g.clientHead ? (
            <div className="chead" key={g.key}>
              <button className="collapse" onClick={() => toggle(g.key)} aria-label={collapsed.has(g.key) ? "Expand" : "Collapse"}>{collapsed.has(g.key) ? <ChevronRight size={15} /> : <ChevronDown size={15} />}</button>
              <Building2 size={15} />
              <span className="ctitle">{g.title}</span>
              <span className="n">{g.clientHead.count} {g.clientHead.count === 1 ? "project" : "projects"}</span>
              {g.title !== NO_CLIENT && (
                <span className="right">
                  <button className="icon-btn" title={`New project for ${g.title}`} aria-label={`New project for ${g.title}`} onClick={() => openUpload({ newProject: true, client: String(g.title) })}><Plus size={15} /></button>
                  <Menu align="end" label="Client options" trigger={(p) => <button {...p} className="icon-btn" aria-label={`${g.title} options`}><Ellipsis size={15} /></button>}>
                    <MenuItem icon={<Trash2 size={16} />} danger onSelect={() => setDeletingClient(String(g.title))}>Delete client</MenuItem>
                  </Menu>
                </span>
              )}
            </div>
          ) : (
            <section className={`group${group === "client" ? " nested" : ""}`} key={g.key}>
              <div className="ghead">
                <button className="collapse" onClick={() => toggle(g.key)} aria-label={collapsed.has(g.key) ? "Expand" : "Collapse"}>{collapsed.has(g.key) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button>
                {g.project ? <a className="gtitle" {...linkProps(`/projects/${g.project._id}`)}>{g.title}</a> : <span className="gtitle">{g.title}</span>}
                <span className="n">{g.items.length}</span>
                {g.meta && <span className="gmeta">· {g.meta}</span>}
                {g.project && (
                  <span className="right">
                    <button className="icon-btn" title="Upload to this project" aria-label="Upload to this project" onClick={() => openUpload({ projectId: g.project!._id })}><Plus size={15} /></button>
                    <Menu align="end" label="Project options" trigger={(p) => <button {...p} className="icon-btn" aria-label="Project options"><Ellipsis size={15} /></button>}>
                      <MenuItem icon={<Pencil size={16} />} onSelect={() => setRenaming(g.project!)}>Rename or set client</MenuItem>
                      <MenuItem icon={<Upload size={16} />} onSelect={() => openUpload({ projectId: g.project!._id })}>Upload a video</MenuItem>
                      <MenuSep />
                      <MenuItem icon={<Trash2 size={16} />} danger onSelect={() => setDeletingProject(g.project!)}>Delete project</MenuItem>
                    </Menu>
                  </span>
                )}
              </div>
              {!collapsed.has(g.key) && (
                g.items.length === 0 ? <p className="caption" style={{ padding: "8px 28px" }}>No videos yet.</p>
                  : view === "grid" ? <div className="grid">{g.items.map((x) => <VideoCard key={x._id} {...rowProps(x)} />)}</div>
                  : <div style={{ paddingTop: 4 }}>{g.items.map((x) => <VideoRow key={x._id} {...rowProps(x)} />)}</div>
              )}
            </section>
          ))}
        {projectId && project && (
          <div style={{ display: "flex", gap: 8, padding: "6px 24px 24px" }}>
            <button className="btn sm" onClick={() => setRenaming(project)}><Pencil size={14} />Rename or set client</button>
            <button className="btn sm" onClick={() => setDeletingProject(project)}><Trash2 size={14} />Delete project</button>
          </div>
        )}
      </div>
      {renaming && <RenameProject p={renaming} onClose={() => setRenaming(null)} />}
      {showDetails && <ShowDetails fields={lib.fields} onChange={lib.setFields} onClose={() => setShowDetails(false)} />}
      {approving && <ApproveFinal videoId={approving._id} title={approving.title} onClose={() => setApproving(null)} onDone={showToast} />}
      {newVideo && <NewVideo onClose={() => setNewVideo(false)} show={showToast} projectId={projectId} />}
      {toast}
      {newClient && <NewClient onClose={() => setNewClient(false)} onDone={() => { setNewClient(false); setGroup("client"); setClient(""); }} />}
      {deletingProject && (
        <DeleteProject p={deletingProject} vids={(overview?.videos ?? []).filter((x) => x.projectId === deletingProject._id)}
          onClose={() => setDeletingProject(null)} onDone={() => { const here = projectId === deletingProject._id; setDeletingProject(null); if (here) navigate("/projects"); }} />
      )}
      {deletingClient && (
        <DeleteClient client={deletingClient} projects={(overview?.projects ?? []).filter((p) => clientOf(p) === deletingClient)} vids={overview?.videos ?? []}
          onClose={() => setDeletingClient(null)} onDone={() => { setDeletingClient(null); setClient(""); }} />
      )}
    </>
  );
}

function RenameProject({ p, onClose }: { p: Overview["projects"][number]; onClose: () => void }) {
  const rename = useMutation(api.library.renameProject);
  const [name, setName] = useState(p.name);
  const [job, setJob] = useState(p.jobNumber ?? "");
  const [client, setClient] = useState(p.client ?? "");
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal onClose={onClose} label="Rename project">
      <form style={{ display: "grid", gap: 18 }} onSubmit={async (e) => {
        e.preventDefault();
        try { await rename({ projectId: p._id, name, jobNumber: job, client }); onClose(); }
        catch (err) { setError((err as Error).message.replace(/^.*ConvexError: /, "").split("\n")[0]); }
      }}>
        <div className="dhead">
          <h2 className="headline">Project details.</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="row2">
          <label className="field"><span className="label">Project name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
          <label className="field"><span className="label">Job number</span><input className="input" value={job} onChange={(e) => setJob(e.target.value)} /></label>
        </div>
        <label className="field"><span className="label">Client</span><input className="input" value={client} onChange={(e) => setClient(e.target.value)} placeholder="ICG" /></label>
        {error && <p className="error">{error}</p>}
        <div className="dfoot"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" type="submit">Save</button></div>
      </form>
    </Modal>
  );
}

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
function counts(vids: VideoItem[]) {
  const versions = vids.reduce((a, x) => a + x.versionCount, 0), notes = vids.reduce((a, x) => a + x.noteCount, 0);
  return `${plural(vids.length, "video")}, ${plural(versions, "version")} and ${plural(notes, "note")}`;
}

function DeleteProject({ p, vids, onClose, onDone }: { p: Overview["projects"][number]; vids: VideoItem[]; onClose: () => void; onDone: () => void }) {
  const del = useMutation(api.library.deleteProject);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal onClose={onClose} label="Delete project" width={500}>
      <div style={{ display: "grid", gap: 18 }}>
        <div className="dhead">
          <h2 className="headline">Delete {projectLabel(p)}? <span className="rest">This can't be undone.</span></h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <p className="caption" style={{ margin: 0, lineHeight: 1.5 }}>Its {counts(vids)} are deleted, with their drawings, recordings and transcripts. Files in Dropbox aren't touched.</p>
        {error && <p className="error">{error}</p>}
        <div className="dfoot">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy} onClick={async () => {
            setBusy(true);
            try { await del({ projectId: p._id }); onDone(); } catch (e) { setError((e as Error).message.replace(/^.*ConvexError: /, "").split("\n")[0]); setBusy(false); }
          }}><Trash2 size={15} />{busy ? "Deleting…" : "Delete project"}</button>
        </div>
      </div>
    </Modal>
  );
}

// Deleting a client takes every project filed under it, so its name has to be typed first.
function DeleteClient({ client, projects, vids, onClose, onDone }: { client: string; projects: Overview["projects"]; vids: VideoItem[]; onClose: () => void; onDone: () => void }) {
  const del = useMutation(api.library.deleteClient);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = new Set(projects.map((p) => p._id as string));
  const theirs = vids.filter((x) => ids.has(x.projectId));
  const ok = typed.trim() === client.trim();
  return (
    <Modal onClose={onClose} label="Delete client" width={520}>
      <form style={{ display: "grid", gap: 18 }} onSubmit={async (e) => {
        e.preventDefault();
        if (!ok || busy) return;
        setBusy(true);
        try { await del({ client, typed }); onDone(); } catch (err) { setError((err as Error).message.replace(/^.*ConvexError: /, "").split("\n")[0]); setBusy(false); }
      }}>
        <div className="dhead">
          <h2 className="headline">Delete {client}? <span className="rest">This can't be undone.</span></h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <p className="caption" style={{ margin: 0, lineHeight: 1.5 }}>
          {projects.length
            ? <>Its {plural(projects.length, "project")} ({projects.map((p) => projectLabel(p)).join(", ")}) and their {counts(theirs)} are deleted, with their drawings, recordings and transcripts. Files in Dropbox aren't touched.</>
            : <>It has no projects, so only the client is removed.</>}
        </p>
        <label className="field">
          <span className="label">Type <b style={{ color: "var(--text-primary)" }}>{client}</b> to confirm</span>
          <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" spellCheck={false} aria-label={`Type ${client} to confirm`} />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="dfoot">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!ok || busy}><Trash2 size={15} />{busy ? "Deleting…" : "Delete client"}</button>
        </div>
      </form>
    </Modal>
  );
}

// "New client": just a name. It shows on the Projects page (grouped by client) with a + to add its first project.
function NewClient({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const create = useMutation(api.library.createClient);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal onClose={onClose} label="New client" width={460}>
      <form style={{ display: "grid", gap: 18 }} onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) { setError("Give the client a name."); return; }
        setBusy(true); setError(null);
        try { await create({ name }); onDone(); } catch (err) { setError((err as Error).message.replace(/^.*ConvexError: /, "").split("\n")[0]); setBusy(false); }
      }}>
        <div className="dhead">
          <div style={{ display: "grid", gap: 6 }}>
            <span className="eyebrow">Client</span>
            <h2 className="headline">New client. <span className="rest">Add its projects next.</span></h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <label className="field"><span className="label">Client name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Floor Trader" autoFocus /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="dfoot">
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
          <button className="btn primary" type="submit" disabled={busy}><Building2 size={15} />{busy ? "Adding…" : "Add client"}</button>
        </div>
      </form>
    </Modal>
  );
}
