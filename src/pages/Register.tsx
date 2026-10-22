// The register (Phase R2, Oct 22): every numbered video in one table, New video, and the file name to render next.
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Check, Copy, ListOrdered, Plus, Search, X } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { shortTitleError, shortTitleFrom } from "../../convex/lib/register";
import { TopBar } from "../shell/Shell";
import { linkProps, navigate } from "../lib/router";
import { Modal, useToast } from "../ui/kit";
import { ago, projectLabel } from "../lib/format";

export async function copyText(text: string, show: (m: string) => void, what = "Copied") {
  try { await navigator.clipboard.writeText(text); show(what); }
  catch { show("Couldn't copy. Select the text and copy it yourself."); }
}

export function FileName({ name, show, compact }: { name: string; show: (m: string) => void; compact?: boolean }) {
  return (
    <span className={`fname${compact ? " compact" : ""}`}>
      <code className="mono">{name}</code>
      <button className="icon-btn" onClick={(e) => { e.preventDefault(); e.stopPropagation(); void copyText(name, show, "File name copied"); }} aria-label={`Copy ${name}`} title="Copy the file name"><Copy size={14} /></button>
    </span>
  );
}

export default function Register() {
  const data = useQuery(api.register.list, {});
  const [toast, show] = useToast();
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.rows ?? []).filter((r) => !needle || `${r.numberText} ${r.title} ${r.shortTitle} ${r.client ?? ""} ${r.project} ${r.jobNumber ?? ""}`.toLowerCase().includes(needle));
  }, [data, q]);

  return (
    <>
      <TopBar right={<button className="btn primary sm" onClick={() => setAdding(true)}><Plus size={15} />New video</button>}>
        <ListOrdered size={15} /><span className="here">Register</span>
      </TopBar>
      <div className="content">
        <div className="register">
          <div className="reghead">
            <div style={{ display: "grid", gap: 6 }}>
              <span className="eyebrow">Every video, numbered</span>
              <h1 className="headline">The register. <span className="rest">Render each version with the name under Next render. It's also the Resolve timeline name.</span></h1>
            </div>
            <label className="regsearch">
              <Search size={15} />
              <input className="input sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a number, title or project" aria-label="Find in the register" />
            </label>
          </div>

          {data === undefined ? null : data.rows.length === 0 ? (
            <div className="empty">
              <span>No numbered videos yet. New video gives out 00001.</span>
              <button className="btn primary" onClick={() => setAdding(true)}><Plus size={15} />New video</button>
            </div>
          ) : (
            <div className="regwrap">
              <table className="regtable">
                <thead>
                  <tr>
                    <th scope="col">No.</th>
                    <th scope="col">Video</th>
                    <th scope="col" className="hide-sm">Client · Project</th>
                    <th scope="col">Latest</th>
                    <th scope="col" className="hide-sm">Next render</th>
                    <th scope="col" className="hide-sm">Activity</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.videoId} onClick={() => navigate(`/v/${r.videoId}`)}>
                      <td className="num mono">{r.numberText}</td>
                      <td className="vid">
                        <a {...linkProps(`/v/${r.videoId}`)} onClick={(e) => e.stopPropagation()}>{r.title}</a>
                        {r.nextFileName && <span className="mobile-only regnext"><FileName name={`${r.nextFileName}.mp4`} show={show} compact /></span>}
                      </td>
                      <td className="hide-sm secondary">{r.client ? `${r.client} · ` : ""}{projectLabel({ name: r.project, jobNumber: r.jobNumber })}</td>
                      <td>
                        <span className="regstat">
                          {r.latest ? <span className="chip">v{r.latest}</span> : null}
                          <span className={`chip${r.status === "Open notes" ? " warn" : r.status === "Failed" ? " red" : ""}`}>{r.status === "Open notes" ? `${r.openNotes} open` : r.status}</span>
                        </span>
                      </td>
                      <td className="hide-sm">{r.nextFileName ? <FileName name={`${r.nextFileName}.mp4`} show={show} compact /> : null}</td>
                      <td className="hide-sm secondary tnum">{ago(r.lastActivity)}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={6} className="secondary">Nothing matches “{q}”.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
          {data && data.unnumbered > 0 && (
            <p className="caption secondary regnote">{data.unnumbered === 1 ? "1 video from before numbering isn't in the register." : `${data.unnumbered} videos from before numbering aren't in the register.`} They're still on the <a {...linkProps("/projects")}>Projects</a> page.</p>
          )}
        </div>
      </div>
      {adding && <NewVideo onClose={() => setAdding(false)} show={show} />}
      {toast}
    </>
  );
}

type Made = { videoId: Id<"videos">; numberText: string; fileName: string; project: string; client: string | null };

export function NewVideo({ onClose, show, projectId: initialProject }: { onClose: () => void; show: (m: string) => void; projectId?: Id<"projects"> }) {
  const overview = useQuery(api.library.overview);
  const create = useMutation(api.register.newVideo);
  const projects = [...(overview?.projects ?? [])].sort((a, b) => b.updatedAt - a.updatedAt);
  const clientNames = [...new Set([...(overview?.clients ?? []), ...(overview?.projects ?? []).map((p) => p.client?.trim() ?? "").filter(Boolean)])].sort((a, b) => a.localeCompare(b));
  const [title, setTitle] = useState("");
  const [short, setShort] = useState("");
  const [shortEdited, setShortEdited] = useState(false);
  const [projectId, setProjectId] = useState<string>(initialProject ?? "");
  const [newName, setNewName] = useState("");
  const [job, setJob] = useState("");
  const [client, setClient] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<Made | null>(null);
  const chosen = projectId || (projects[0]?._id ?? "__new");
  const isNew = chosen === "__new";
  const shortTitle = shortEdited ? short : shortTitleFrom(title);
  const shortBad = title.trim() || shortEdited ? shortTitleError(shortTitle) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) { setError("Give the video a title."); return; }
    if (shortBad) { setError(shortBad); return; }
    if (isNew && !newName.trim()) { setError("Name the new project."); return; }
    setBusy(true);
    try {
      const r = await create(isNew
        ? { title, shortTitle, projectName: newName, jobNumber: job || undefined, client: client.trim() || undefined }
        : { title, shortTitle, projectId: chosen as Id<"projects"> });
      setMade({ videoId: r.videoId, numberText: r.numberText, fileName: r.fileName, project: r.project, client: r.client });
    } catch (err) {
      setError((err as Error).message.replace(/^.*ConvexError: /, "").split("\n")[0]);
    } finally { setBusy(false); }
  }

  if (made) {
    const folder = `Apps/Wrangler Review/${made.client ? made.client + "/" : ""}${made.project}/<video folder>/`;
    return (
      <Modal onClose={onClose} label="New video" width={560}>
        <div style={{ display: "grid", gap: 18 }}>
          <div className="dhead">
            <div style={{ display: "grid", gap: 6 }}>
              <span className="eyebrow">Registered</span>
              <h2 className="headline"><span className="mono">{made.numberText}</span>. <span className="rest">Render v1 with this name.</span></h2>
            </div>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
          </div>
          <div className="keyline rect">
            <span className="rlabel">File name (and Resolve timeline name)</span>
            <FileName name={`${made.fileName}.mp4`} show={show} />
          </div>
          <ul className="caption secondary madelist">
            <li>Name the Resolve timeline <code className="mono">{made.fileName}</code>.</li>
            <li>Render with the <b>Wrangler Review</b> preset that fits the timeline (16x9, Scope or Vertical).</li>
            <li>Save it in Dropbox › <code className="mono">{folder}</code>. The number puts it on this video whatever the video folder is called.</li>
          </ul>
          <div className="dfoot">
            <button className="btn" onClick={onClose}>Done</button>
            <button className="btn primary" onClick={() => { onClose(); navigate(`/v/${made.videoId}`); }}><Check size={15} />Open the video</button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} label="New video" width={560}>
      <form onSubmit={submit} style={{ display: "grid", gap: 18 }}>
        <div className="dhead">
          <div style={{ display: "grid", gap: 6 }}>
            <span className="eyebrow">Register</span>
            <h2 className="headline">New video. <span className="rest">It gets the next number and its file name.</span></h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="row2">
          <label className="field"><span className="label">Title</span><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="LC Arizona" autoFocus /></label>
          <label className="field">
            <span className="label">Short title (file names)</span>
            <input className="input mono" value={shortTitle} onChange={(e) => { setShort(e.target.value); setShortEdited(true); }} placeholder="LCArizona" spellCheck={false} aria-invalid={Boolean(shortBad)} />
          </label>
        </div>
        <p className="caption secondary" style={{ margin: "-8px 0 0" }}>First file: <code className="mono">NNNNN_{shortTitle || "ShortTitle"}_v1.mp4</code></p>
        <label className="field">
          <span className="label">Project</span>
          <select className="input" value={chosen} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => <option key={p._id} value={p._id}>{p.client ? `${p.client} · ` : ""}{projectLabel(p)}</option>)}
            <option value="__new">New project…</option>
          </select>
        </label>
        {isNew && (
          <>
            <div className="row2">
              <label className="field"><span className="label">Project name</span><input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Floor Trader Backrooms" /></label>
              <label className="field"><span className="label">Job number</span><input className="input" value={job} onChange={(e) => setJob(e.target.value)} placeholder="26127" /></label>
            </div>
            <label className="field">
              <span className="label">Client (optional)</span>
              <input className="input" value={client} onChange={(e) => setClient(e.target.value)} placeholder="Floor Trader" list="wr-reg-clients" />
              <datalist id="wr-reg-clients">{clientNames.map((c) => <option key={c} value={c} />)}</datalist>
            </label>
          </>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="dfoot">
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
          <button className="btn primary" type="submit" disabled={busy}><Plus size={15} />{busy ? "Registering…" : "Register video"}</button>
        </div>
      </form>
    </Modal>
  );
}
