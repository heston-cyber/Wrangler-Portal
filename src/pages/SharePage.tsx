// The share link page (client side C3, Oct 23): review.wranglerportal.com/s/<token>, and /s/<token>/v/<videoId>.
// Works signed out. Shows what the share covers (a list of videos, or the one video straight away), asks for a
// passcode or a sign-in when the share needs one, and says plainly when a link is off, expired or not theirs.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useAuthActions, useAuthToken } from "@convex-dev/auth/react";
import { ArrowRight, Lock } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { BrandImg } from "../ui/BrandImg";
import { Thumb } from "../ui/kit";
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
        {groups.map((g) => (
          <section className="group" key={g.p._id}>
            {ok.kind === "client" && <div className="ghead"><span className="gtitle">{g.p.jobNumber ? `${g.p.jobNumber} ${g.p.name}` : g.p.name}</span><span className="n">{g.videos.length}</span></div>}
            {g.videos.map((v) => (
              <a key={v._id} className="vrow" {...linkProps(`/s/${token}/v/${v._id}`)}>
                <Thumb src={v.versions[v.versions.length - 1]?.thumbUrl ?? null} />
                <span className="t">
                  {v.number ? <span className="chip num mono">{String(v.number).padStart(5, "0")}</span> : null}
                  <b>{v.title}</b>
                  <span className="chip">v{v.versions[v.versions.length - 1]?.number}{v.versions.length > 1 && ok.access === "comment" ? ` of ${v.versions.length}` : ""}</span>
                </span>
                <span className="details" />
                <span className="meta">Updated <em>{ago(v.updatedAt)}</em> <ArrowRight size={14} style={{ verticalAlign: -2 }} /></span>
              </a>
            ))}
          </section>
        ))}
      </div>
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
