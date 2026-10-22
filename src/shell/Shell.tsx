// The app frame, laid out like Flask: a left sidebar, and an inset main panel with a breadcrumb bar.
// The review page hides the sidebar and opens it over the page instead.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { BrandImg } from "../ui/BrandImg";
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Activity, ChevronDown, Clapperboard, House, ListOrdered, LogOut, Menu as MenuIcon, Search, Settings, X } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { linkProps, navigate, useLocation } from "../lib/router";
import { useUploads } from "../lib/uploads";
import { Avatar, Menu, MenuItem, MenuSep, Modal, Thumb } from "../ui/kit";
import { projectLabel } from "../lib/format";

type ShellCtx = { openSidebar: () => void; openSearch: () => void; overlay: boolean };
const Ctx = createContext<ShellCtx>({ openSidebar: () => {}, openSearch: () => {}, overlay: false });
export const useShell = () => useContext(Ctx);

export function Shell({ me, overlay, children }: { me: { name: string | null; email: string }; overlay: boolean; children: React.ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const [search, setSearch] = useState(false);
  const { path } = useLocation();
  useEffect(() => setDrawer(false), [path]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSearch((s) => !s); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const ctx = useMemo(() => ({ openSidebar: () => setDrawer(true), openSearch: () => setSearch(true), overlay }), [overlay]);
  const showSidebar = !overlay || drawer;
  return (
    <Ctx.Provider value={ctx}>
      <div className="app">
        {showSidebar && <Sidebar me={me} className={`${drawer ? "open" : ""}${overlay ? " overlay" : ""}`} onClose={() => setDrawer(false)} onSearch={() => setSearch(true)} />}
        {drawer && <div className="scrim" onClick={() => setDrawer(false)} style={overlay ? { position: "fixed", inset: 0, zIndex: 79, background: "rgba(3,1,4,.55)" } : undefined} />}
        <div className="main" style={overlay ? { margin: 0, height: "100%", borderRadius: 0, boxShadow: "none" } : undefined}>{children}</div>
      </div>
      {search && <SearchPalette onClose={() => setSearch(false)} />}
    </Ctx.Provider>
  );
}

function Sidebar({ me, className, onClose, onSearch }: { me: { name: string | null; email: string }; className: string; onClose: () => void; onSearch: () => void }) {
  const { path } = useLocation();
  const overview = useQuery(api.library.overview);
  const uploads = useUploads().filter((u) => u.status === "starting" || u.status === "uploading");
  const { signOut } = useAuthActions();
  const recent = (overview?.videos ?? []).filter((x) => x.lastOpenedAt).sort((a, b) => b.lastOpenedAt! - a.lastOpenedAt!).slice(0, 4);
  const cur = (p: string) => (p === "/" ? path === "/" : path === p || path.startsWith(p + "/")) ? "page" as const : undefined;
  return (
    <nav className={`sidebar ${className}`} aria-label="Main">
      <div className="brandrow">
        <a {...linkProps("/")} aria-label="Wrangler Review home"><BrandImg name="wordmark" alt="Wrangler Productions" /></a>
        <span style={{ display: "flex", gap: 2 }}>
          <button className="icon-btn" onClick={onSearch} aria-label="Search (⌘K)" title="Search (⌘K)"><Search size={16} /></button>
          {className.includes("open") && <button className="icon-btn" onClick={onClose} aria-label="Close menu"><X size={16} /></button>}
        </span>
      </div>
      <a className="navitem" aria-current={cur("/")} {...linkProps("/")}><House size={16} />Home</a>
      <a className="navitem" aria-current={cur("/projects")} {...linkProps("/projects")}><Clapperboard size={16} />Projects</a>
      <a className="navitem" aria-current={cur("/register")} {...linkProps("/register")}><ListOrdered size={16} />Register</a>
      <a className="navitem" aria-current={cur("/activity")} {...linkProps("/activity")}><Activity size={16} />Activity</a>

      {recent.length > 0 && <div className="navgroup">Last opened</div>}
      {recent.map((x) => (
        <a key={x._id} className="navitem" aria-current={path === `/v/${x._id}` ? "page" : undefined} {...linkProps(`/v/${x._id}`)} title={x.title}>
          <Thumb src={x.latest?.thumbUrl ?? null} className="thumb-xs" /><span className="t">{x.title}</span>
        </a>
      ))}

      <div className="spacer" />
      {uploads.length > 0 && (
        <div style={{ display: "grid", gap: 8, padding: "10px 10px 12px" }}>
          <span className="label">Uploading</span>
          {uploads.map((u) => (
            <div key={u.key} style={{ display: "grid", gap: 5 }}>
              <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.fileName}</span>
              <div className="progress"><i style={{ width: `${u.total ? (100 * u.sent) / u.total : 0}%` }} /></div>
            </div>
          ))}
        </div>
      )}
      <Menu side="top" label="Account" trigger={(p) => (
        <button {...p} className="navitem acct"><Avatar name={me.name || me.email} /><span className="t">{me.name || me.email}</span><ChevronDown size={14} style={{ marginLeft: "auto" }} /></button>
      )}>
        <div className="mlabel">{me.email}</div>
        <MenuItem icon={<Settings size={16} />} onSelect={() => navigate("/settings")}>Settings</MenuItem>
        <MenuSep />
        <MenuItem icon={<LogOut size={16} />} onSelect={() => void signOut()}>Sign out</MenuItem>
      </Menu>
    </nav>
  );
}

// The bar at the top of the main panel: breadcrumb on the left, actions on the right.
export function TopBar({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  const { openSidebar, overlay } = useShell();
  return (
    <header className="topbar">
      <button className={`icon-btn${overlay ? "" : " mobile-only"}`} onClick={openSidebar} aria-label="Open menu"><MenuIcon size={18} /></button>
      <div className="crumbs">{children}</div>
      {right && <div className="right">{right}</div>}
    </header>
  );
}
export const Sep = () => <span className="sep" aria-hidden>›</span>;

// ⌘K: find a video or a project.
function SearchPalette({ onClose }: { onClose: () => void }) {
  const overview = useQuery(api.library.overview);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"all" | "videos" | "projects">("all");
  const [i, setI] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  const projects = overview?.projects ?? [];
  const pmap = new Map(projects.map((p) => [p._id as string, p]));
  const needle = q.trim().toLowerCase();
  type Row = { key: string; to: string; kind: "video" | "project"; title: string; sub: string; thumb?: string | null };
  const vids: Row[] = (overview?.videos ?? [])
    .filter((x) => !needle || `${x.title} ${projectLabel(pmap.get(x.projectId))}`.toLowerCase().includes(needle))
    .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) || b.updatedAt - a.updatedAt)
    .map((x) => ({ key: x._id, to: `/v/${x._id}`, kind: "video", title: x.title, sub: projectLabel(pmap.get(x.projectId)), thumb: x.latest?.thumbUrl ?? null }));
  const projs: Row[] = projects
    .filter((p) => !needle || projectLabel(p).toLowerCase().includes(needle) || (p.client ?? "").toLowerCase().includes(needle))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((p) => ({ key: p._id, to: `/projects/${p._id}`, kind: "project", title: projectLabel(p), sub: `${p.videoCount} video${p.videoCount === 1 ? "" : "s"}` }));
  const rows = (tab === "videos" ? vids : tab === "projects" ? projs : [...vids.slice(0, needle ? 8 : 5), ...projs.slice(0, needle ? 6 : 4)]).slice(0, 14);
  const go = (r: Row | undefined) => { if (!r) return; onClose(); navigate(r.to); };

  return (
    <Modal onClose={onClose} label="Search" width={560}>
      <div style={{ display: "grid", gap: 12, margin: -8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 6px" }}>
          <Search size={18} />
          <input ref={inputRef} className="input" style={{ background: "transparent", boxShadow: "none", padding: 0, height: 40, fontSize: 16 }}
            placeholder="Search videos and projects…" value={q}
            onChange={(e) => { setQ(e.target.value); setI(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(rows.length - 1, x + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
              else if (e.key === "Enter") { e.preventDefault(); go(rows[i]); }
            }} />
          <span className="kbd">esc</span>
        </div>
        <div className="tabs" role="tablist">
          {(["all", "videos", "projects"] as const).map((k) => (
            <button key={k} role="tab" className="tab" aria-selected={tab === k} onClick={() => { setTab(k); setI(0); }}>{k === "all" ? "All" : k === "videos" ? "Videos" : "Projects"}</button>
          ))}
        </div>
        <div style={{ display: "grid", gap: 2, maxHeight: "50vh", overflowY: "auto" }}>
          {!needle && tab === "all" && vids.length > 0 && <div className="mlabel">Recent</div>}
          {rows.length === 0 && <p className="caption" style={{ padding: "8px 10px" }}>{overview === undefined ? "Loading…" : "Nothing matches."}</p>}
          {rows.map((r, n) => (<span key={r.key} style={{ display: "contents" }}>
            {tab === "all" && r.kind === "project" && rows[n - 1]?.kind !== "project" && <div className="mlabel" style={{ marginTop: 6 }}>Projects</div>}
            <button className="mitem" style={{ background: n === i ? "var(--surface-block-hover)" : undefined }} onMouseEnter={() => setI(n)} onClick={() => go(r)}>
              {r.kind === "video" ? <Thumb src={r.thumb ?? null} className="thumb" /> : <span className="thumb ph" style={{ display: "grid" }}><Clapperboard size={14} /></span>}
              <span style={{ display: "grid", minWidth: 0 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</span>
                <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{r.sub}</span>
              </span>
            </button>
          </span>))}
        </div>
      </div>
    </Modal>
  );
}
