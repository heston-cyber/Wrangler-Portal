// The share link page (client side C3, Oct 23): review.wranglerportal.com/s/<token>, and /s/<token>/v/<videoId>.
// Works signed out. Shows what the share covers (a list of videos, or the one video straight away), asks for a
// passcode or a sign-in when the share needs one, and says plainly when a link is off, expired or not theirs.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useAuthActions, useAuthToken } from "@convex-dev/auth/react";
import { SelectBar, SelectBox, useSelection } from "./VideoRows";
import { bytesText, downloadOne, downloadZip, type Progress } from "../../lib/download";
import { navigate } from "../../lib/router";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { BrandImg } from "../../ui/BrandImg";
import { Menu, MenuItem, Thumb, useToast } from "../../ui/kit";
import { ago } from "../../lib/format";
import { linkProps } from "../../lib/router";
import { guestKey, readGuestName, readPasscode, ViewerCtx, writeGuestName, writePasscode, type Viewer } from "../../lib/viewer";
import SignIn, { SystemPage } from "../../shell/SignIn";
import { Button, ButtonLink, EmptyState } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import elbow from "../../assets/portal/light-elbow.jpg";
import VideoPage from "./VideoPage";

type OpenResult = NonNullable<ReturnType<typeof useQuery<typeof api.shares.open>>>;

export default function SharePage({ token, videoId, versionNumber, noteId }: { token: string; videoId: Id<"videos"> | null; versionNumber: number | null; noteId: string | null }) {
  // After a right passcode the page keeps a proof from `unlock` (never the passcode); `open` takes the proof.
  const [passcode, setPasscode] = useState<string | undefined>(() => readPasscode(token));
  const [typed, setTyped] = useState("");
  const [passMsg, setPassMsg] = useState<string | null>(null);
  const unlock = useMutation(api.shares.unlock);
  async function tryPasscode() {
    setPassMsg(null);
    const r = await unlock({ token, passcode: typed.trim() });
    if (r.state === "ok") { setPasscode(r.proof); setTyped(""); }
    else if (r.state === "locked") setPassMsg(`Too many wrong tries. Wait ${Math.ceil(r.seconds / 60)} minute${r.seconds > 60 ? "s" : ""} and try again.`);
    else if (r.state === "wrong") setPassMsg("That one didn't match. Try again.");
    else setPasscode(undefined);
  }
  const [guestName, setGuestNameState] = useState(() => readGuestName());
  const key = useMemo(() => guestKey(), []);
  const res = useQuery(api.shares.open, { token, passcode });
  const touch = useMutation(api.shares.touch);
  const { signOut } = useAuthActions();
  const signedIn = !!useAuthToken();
  const [toast, show] = useToast();
  const [busy, setBusy] = useState<Progress | null>(null);
  const sel = useSelection();
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
    if (state === "ok") void touch({ token, passcode, kind: "opened", guestName, guestKey: key }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, token]);
  useEffect(() => { if (state === "ok" && passcode) writePasscode(token, passcode); }, [state, passcode, token]);

  if (res === undefined) return <Frame title="Opening…" />;
  if (res.state === "missing") return <Frame eyebrow="Wrangler Review" title="This link doesn't go anywhere." text="Check it was copied whole, or ask for a new one." />;
  if (res.state === "off") return <Frame eyebrow={res.label ?? "Wrangler Review"} title="This link has been switched off." text="Ask Wrangler Productions for a new one if you still need it." />;
  if (res.state === "expired") return <Frame eyebrow={res.label ?? "Wrangler Review"} title="This link has expired." text="Ask Wrangler Productions for a new one if you still need it." />;
  if (res.state === "signin") {
    return (
      <SignIn invitedEmail={null} note={<>{res.label ? <>“{res.label}” was shared with specific people. </> : null}Sign in with the email it was shared with, or create your account with that email.</>} />
    );
  }
  if (res.state === "notInvited") return <Frame eyebrow={res.label ?? "Wrangler Review"} title="This link isn't shared with your account." text="It was shared with a particular email. If that's a different address of yours, sign out and sign in with that one." icon="lock" action={<Button onClick={() => void signOut()}>Sign out</Button>} />;
  if (res.state === "passcode" || res.state === "wrongPasscode") {
    return (
      <Frame icon="lock" eyebrow="Wrangler Review" title="This link has a passcode." text={passMsg ?? (res.state === "wrongPasscode" ? "That one didn't match. Try again." : "Type the passcode you were given.")} bad={!!passMsg || res.state === "wrongPasscode"}>
        <form className="wp-form" onSubmit={(e) => { e.preventDefault(); void tryPasscode(); }}>
          <label className="wp-field"><span className="wp-field-label">Passcode</span><input className="input" type="password" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" aria-label="Passcode" aria-invalid={res.state === "wrongPasscode" || undefined} /></label>
          <div><Button variant="primary" type="submit" disabled={!typed.trim()}>Open</Button></div>
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
    <div className="sharelist wp-sharelist">
      <div className="wp-light client" aria-hidden><i style={{ backgroundImage: `url(${elbow})` }} /></div>
      <div className="inner">
        <div className="shead">
          <a {...linkProps(viewer.home)} aria-label="Home" className="wp-homelink"><BrandImg name="wordmark" className="logo" alt="Wrangler Productions" /></a>
          {isClient && <ButtonLink size="sm" to="/">Shared with me</ButtonLink>}
        </div>
        <div className="wp-sharehead">
          <div className="txt">
            <span className="wp-eyebrow">{ok.kind === "client" ? "Shared with you" : ok.client ?? "Shared with you"}</span>
            <h1 className="wp-h2">{ok.label}.</h1>
            <p className="wp-body">{ok.videos.length === 0 ? "Nothing to watch yet; check back when Wrangler Productions tells you a cut is ready." : ok.access === "comment" ? "Open a video to watch it and leave notes on exact frames." : "Open a video to watch it."}</p>
          </div>
          {ok.downloads && filesOf(ok.videos).length > 0 && (
            <Menu align="end" label={`${ok.label} options`} trigger={(p) => <button {...p} className="icon-btn" aria-label={`${ok.label} options`}><Icon name="more" size={18} /></button>}>
              <MenuItem icon={<Icon name="check-circle" size={16} />} onSelect={() => sel.start()}>Select videos…</MenuItem>
              <MenuItem icon={<Icon name="download" size={16} />} onSelect={() => void saveAll(filesOf(ok.videos), `${ok.label}.zip`)}>Download all{sizeOf(filesOf(ok.videos)) ? ` · ${sizeOf(filesOf(ok.videos))}` : ""}</MenuItem>
            </Menu>
          )}
        </div>
        {busy && <div className="dlbar rect" role="status"><span className="rlabel">Downloading</span><span className="rbold">{pct(busy)}</span><span className="secondary">{busy.ofFiles > 1 ? `${busy.files} of ${busy.ofFiles} · ` : ""}{busy.file}</span></div>}
        {sel.on && (() => {
          const chosen = ok.videos.filter((v) => sel.has(v._id));
          const files = filesOf(chosen);
          return <SelectBar count={chosen.length} size={sizeOf(files)} allCount={ok.videos.length} onAll={() => sel.set(ok.videos.map((v) => v._id))}
            onDownload={ok.downloads ? () => void saveAll(files, `${ok.label}.zip`) : undefined} onCancel={sel.clear} busy={busy ? `${pct(busy)} · ${busy.files} of ${busy.ofFiles}` : null} />;
        })()}
        {ok.videos.length === 0 && <EmptyState icon="video" title="Nothing to watch yet." body="Check back when Wrangler Productions tells you a cut is ready." />}
        {groups.map((g) => {
          const files = filesOf(g.videos);
          const size = sizeOf(files);
          const pname = g.p.jobNumber ? `${g.p.jobNumber} ${g.p.name}` : g.p.name;
          return (
            <section className="pj-block wp-card glass" key={g.p._id}>
              <div className="wp-rows">
                <div className="ghead">
                  <Icon name="folder" size={18} /><span className="ctitle">{pname}</span><span className="wp-tag">{g.videos.length}</span>
                  {ok.downloads && files.length > 0 && (
                    <span className="right">
                      <Button size="sm" disabled={!!busy} onClick={() => void saveAll(files, `${pname}.zip`)} title={`One zip with the latest version of each video${size ? ` (about ${size})` : ""}`}>
                        Download all{size ? <span className="hide-sm"> · {size}</span> : null}
                      </Button>
                      <Menu align="end" label="Project options" trigger={(p) => <button {...p} className="icon-btn sm" aria-label={`${pname} options`}><Icon name="more" size={18} /></button>}>
                        <MenuItem icon={<Icon name="check-circle" size={16} />} onSelect={() => sel.start()}>Select videos…</MenuItem>
                        <MenuItem icon={<Icon name="download" size={16} />} onSelect={() => void saveAll(files, `${pname}.zip`)}>Download all{size ? ` · ${size}` : ""}</MenuItem>
                      </Menu>
                    </span>
                  )}
                </div>
                {g.videos.map((v) => {
                  const d = latestOf(v)?.download ?? null;
                  const picked = sel.on && sel.has(v._id);
                  const link = sel.on ? { href: `/s/${token}/v/${v._id}`, onClick: (e: React.MouseEvent) => { e.preventDefault(); sel.toggle(v._id); } } : linkProps(`/s/${token}/v/${v._id}`);
                  return (
                    <div className={`vline${picked ? " picked" : ""}`} key={v._id}>
                      {sel.on && <SelectBox on={picked} onClick={() => sel.toggle(v._id)} label={`Select ${v.title}`} />}
                      <a className="vrow" {...link} aria-selected={sel.on ? picked : undefined}>
                        <Thumb src={latestOf(v)?.thumbUrl ?? null} />
                        {v.number ? <span className="wp-tag">{String(v.number).padStart(5, "0")}</span> : null}
                        <span className="vtext">
                          <span className="t"><b>{v.title}</b><span className="wp-tag">v{latestOf(v)?.number}{v.versions.length > 1 && ok.access === "comment" ? ` of ${v.versions.length}` : ""}</span></span>
                          <span className="details"><span>Updated {ago(v.updatedAt)}</span></span>
                        </span>
                      </a>
                      {!sel.on && <Menu align="end" label="Video options" trigger={(p) => <button {...p} className="icon-btn bare sm vmenu" aria-label={`${v.title} options`}><Icon name="more" size={18} /></button>}>
                        <MenuItem icon={<Icon name="play" size={16} />} onSelect={() => navigate(`/s/${token}/v/${v._id}`)}>Open</MenuItem>
                        {ok.downloads && d && <MenuItem icon={<Icon name="download" size={16} />} onSelect={() => void saveOne(d)}>Download{d.bytes ? ` · ${bytesText(d.bytes)}` : ""}</MenuItem>}
                      </Menu>}
                      {!sel.on && <a className="go" {...linkProps(`/s/${token}/v/${v._id}`)} aria-hidden tabIndex={-1}><Icon name="arrow-right" size={16} /></a>}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      {toast}
    </div>
  );
}

// The gate screens: the centred glass card on the corona light, like sign-in (P1 / Client / Share gate).
function Frame({ icon, eyebrow, title, text, action, bad, children }: { icon?: "alert" | "lock"; eyebrow?: string; title: string; text?: string; action?: React.ReactNode; bad?: boolean; children?: React.ReactNode }) {
  return (
    <SystemPage icon={icon} eyebrow={eyebrow} title={title} body={text ? <span className={bad ? "wp-badtext" : undefined}>{text}</span> : undefined}>
      {children}
      {action && <div>{action}</div>}
    </SystemPage>
  );
}
