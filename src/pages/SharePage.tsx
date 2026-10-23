// The share link page (client side C3, Oct 23): review.wranglerportal.com/s/<token>, and /s/<token>/v/<videoId>.
// Works signed out. Shows what the share covers (a list of videos, or the one video straight away), asks for a
// passcode or a sign-in when the share needs one, and says plainly when a link is off, expired or not theirs.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useAuthActions, useAuthToken } from "@convex-dev/auth/react";
import { ArrowRight, Download, Ellipsis, FolderDown, Lock, Play } from "lucide-react";
import { bytesText, downloadOne, downloadZip, type Progress } from "../lib/download";
import { navigate } from "../lib/router";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { BrandImg } from "../ui/BrandImg";
import { Menu, MenuItem, Thumb, useToast } from "../ui/kit";
import { ago } from "../lib/format";
import { linkProps } from "../lib/router";
import { guestKey, readGuestName, readPasscode, ViewerCtx, writeGuestName, writePasscode, type Viewer } from "../lib/viewer";
import SignIn from "./SignIn";
import VideoPage from "./VideoPage";

type OpenResult = NonNullable<ReturnType<typeof useQuery<typeof api.shares.open>>>;

export default function SharePage({ token, videoId, versionNumber, noteId }: { token: string; videoId: Id<"videos"> | null; versionNumber: number | null; noteId: string | null }) {
  const [passcode, setPasscode] = useState<string | undefined>(() => readPasscode(token));
  const [typed, setTyped] = useState("");
  const [guestName, setGuestNameState] = useState(() => readGuestName());
  const key = useMemo(() => guestKey(), []);
  const res = useQuery(api.shares.open, { token, passcode });
  const touch = useMutation(api.shares.touch);
  const { signOut } = useAuthActions();
  const signedIn = !!useAuthToken();
  const [toast, show] = useToast();
  const [busy, setBusy] = useState<Progress | null>(null);
  const pct = (p: Progress) => (p.total ? `${Math.round((100 * p.done) / p.total)}%` : bytesText(p.done));
  async function saveOne(f: { url: string; name: string; bytes: number | null }) {
    if (busy) return;
    try { const ok = await downloadOne(f.url, f.name, f.bytes, setBusy); if (ok) show("Downloaded"); }
    catch (e) { show("Download didn't work: " + ((e as Error).message || "")); }
    finally { setBusy(null); }
  }
  async function saveAll(files: Array<{ url: string; name: string; bytes: number | null }>, zipName: string) {
    if (busy || !files.length) return;
    try { const ok = await downloadZip(files, zipName, setBusy); if (ok) show("Downloaded"); }
    catch (e) { show("Download didn't work: " + ((e as Error).message || "")); }
    finally { setBusy(null); }
  }
  const state = res?.state;
  useEffect(() => {
    if (state === "ok") void touch({ token, passcode, kind: "opened", guestName }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, token]);
  useEffect(() => { if (state === "ok" && passcode) writePasscode(token, passcode); }, [state, passcode, token]);

  if (res === undefined) return <Frame><p className="caption">Opening…</p></Frame>;
  if (res.state === "missing") return <Frame eyebrow="Wrangler Review" title="This link doesn't go anywhere." text="Check it was copied whole, or ask for a new one." />;
  if (res.state === "off") return <Frame eyebrow={res.label ?? "Wrangler Review"} title="This link has been switched off." text="Ask Wrangler Productions for a new one if you still need it." />;
  if (res.state === "expired") return <Frame eyebrow={res.label ?? "Wrangler Review"} title="This link has expired." text="Ask Wrangler Productions for a new one if you still need it." />;
  if (res.state === "signin") {
    return (
      <div style={{ display: "grid" }}>
        <p className="caption sharenote">{res.label ? <>“{res.label}” was shared with specific people. </> : null}Sign in with the email it was shared with, or create your account with that email.</p>
        <SignIn invitedEmail={null} />
      </div>
    );
  }
  if (res.state === "notInvited") return <Frame eyebrow={res.label ?? "Wrangler Review"} title="This link isn't shared with your account." text="It was shared with a particular email. If that's a different address of yours, sign out and sign in with that one." action={<button className="btn" onClick={() => void signOut()}>Sign out</button>} />;
  if (res.state === "passcode" || res.state === "wrongPasscode") {
    return (
      <Frame eyebrow={res.label ?? "Wrangler Review"} title="This link has a passcode." text={res.state === "wrongPasscode" ? "That one didn't match. Try again." : "Type the passcode you were given."}>
        <form style={{ display: "grid", gap: 12, width: "min(380px, 100%)" }} onSubmit={(e) => { e.preventDefault(); setPasscode(typed.trim()); }}>
          <label className="field"><span className="label">Passcode</span><input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" aria-label="Passcode" /></label>
          <button className="btn primary lg" type="submit" disabled={!typed.trim()}><Lock size={15} />Open</button>
        </form>
      </Frame>
    );
  }

  const ok = res as Extract<OpenResult, { state: "ok" }>;
  const kind = ok.viewer?.kind ?? "guest";
  const isClient = kind === "client" && signedIn;
  const viewer: Viewer = {
    share: { token, passcode, guestKey: key, guestName: guestName || undefined },
    can: ok.access, kind, name: ok.viewer?.name ?? (guestName || null), downloads: ok.downloads,
    home: isClient && ok.who === "invited" ? "/" : `/s/${token}`,
    needsName: kind === "guest" && ok.access === "comment" && !guestName,
    setGuestName: (n) => { writeGuestName(n); setGuestNameState(n); },
  };
  const single = ok.kind === "video" ? ok.videos[0] ?? null : null;
  const openId = videoId ?? single?._id ?? null;
  if (openId) {
    return (
      <ViewerCtx.Provider value={viewer}>
        <div className="sharewrap"><VideoPage key={openId} videoId={openId} versionNumber={versionNumber} noteId={noteId} /></div>
      </ViewerCtx.Provider>
    );
  }
  // A project or a client: the videos, grouped by project.
  const groups = ok.projects.map((p) => ({ p, videos: ok.videos.filter((v) => v.projectId === p._id) })).filter((g) => g.videos.length);
  const latestOf = (v: typeof ok.videos[number]) => v.versions[v.versions.length - 1];
  // Everything downloadable in a project: the latest version of each video (file name as rendered).
  const filesOf = (vs: typeof ok.videos) => vs.map((v) => latestOf(v)?.download).filter((d): d is { url: string; name: string; bytes: number | null } => !!d);
  const sizeOf = (fs: Array<{ bytes: number | null }>) => (fs.every((f) => f.bytes) ? bytesText(fs.reduce((a, f) => a + (f.bytes ?? 0), 0)) : null);
  return (
    <div className="sharelist">
      <BrandImg name="watermark" className="watermark" hidden />
      <div className="inner">
        <div className="shead">
          <a {...linkProps(viewer.home)} aria-label="Home" style={{ display: "flex" }}><BrandImg name="wordmark" className="logo" alt="Wrangler Productions" /></a>
          {isClient && <a className="btn sm" {...linkProps("/")}>Shared with me</a>}
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          <span className="eyebrow">{ok.kind === "client" ? "Shared with you" : ok.client ?? "Shared with you"}</span>
          <h1 className="headline">{ok.label}. <span className="rest">{ok.videos.length === 0 ? "Nothing to watch yet; check back when Wrangler Productions tells you a cut is ready." : ok.access === "comment" ? "Open a video to watch it and leave notes on exact frames." : "Open a video to watch it."}</span></h1>
        </div>
        {busy && <div className="dlbar rect" role="status"><span className="rlabel">Downloading</span><span className="rbold">{pct(busy)}</span><span className="secondary">{busy.ofFiles > 1 ? `${busy.files} of ${busy.ofFiles} · ` : ""}{busy.file}</span></div>}
        {groups.map((g) => {
          const files = filesOf(g.videos);
          const size = sizeOf(files);
          const pname = g.p.jobNumber ? `${g.p.jobNumber} ${g.p.name}` : g.p.name;
          return (
            <section className="group" key={g.p._id}>
              <div className="ghead">
                <span className="gtitle">{pname}</span><span className="n">{g.videos.length}</span>
                {ok.downloads && files.length > 0 && (
                  <span className="right">
                    <button className="btn sm" disabled={!!busy} onClick={() => void saveAll(files, `${pname}.zip`)} title={`One zip with the latest version of each video${size ? ` (about ${size})` : ""}`}>
                      <FolderDown size={14} />Download all{size ? <span className="secondary hide-sm"> · {size}</span> : null}
                    </button>
                  </span>
                )}
              </div>
              {g.videos.map((v) => {
                const d = latestOf(v)?.download ?? null;
                return (
                  <div className="vline" key={v._id}>
                    <a className="vrow" {...linkProps(`/s/${token}/v/${v._id}`)}>
                      <Thumb src={latestOf(v)?.thumbUrl ?? null} />
                      <span className="t">
                        {v.number ? <span className="chip num mono">{String(v.number).padStart(5, "0")}</span> : null}
                        <b>{v.title}</b>
                        <span className="chip">v{latestOf(v)?.number}{v.versions.length > 1 && ok.access === "comment" ? ` of ${v.versions.length}` : ""}</span>
                      </span>
                      <span className="details" />
                      <span className="meta">Updated <em>{ago(v.updatedAt)}</em> <ArrowRight size={14} style={{ verticalAlign: -2 }} /></span>
                    </a>
                    <Menu align="end" label="Video options" trigger={(p) => <button {...p} className="icon-btn vmenu" aria-label={`${v.title} options`}><Ellipsis size={15} /></button>}>
                      <MenuItem icon={<Play size={16} />} onSelect={() => navigate(`/s/${token}/v/${v._id}`)}>Open</MenuItem>
                      {ok.downloads && d && <MenuItem icon={<Download size={16} />} onSelect={() => void saveOne(d)}>Download{d.bytes ? ` · ${bytesText(d.bytes)}` : ""}</MenuItem>}
                    </Menu>
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
      {toast}
    </div>
  );
}

function Frame({ eyebrow, title, text, action, children }: { eyebrow?: string; title?: string; text?: string; action?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="signin">
      <BrandImg name="watermark" className="watermark" hidden />
      <div style={{ width: "min(440px, 100%)", display: "grid", gap: 16, position: "relative" }}>
        <BrandImg name="wordmark" className="logo" alt="Wrangler Productions" />
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        {title && <h1 className="title" style={{ margin: 0 }}>{title}</h1>}
        {text && <p className="caption" style={{ margin: 0 }}>{text}</p>}
        {children}
        {action}
      </div>
    </div>
  );
}
