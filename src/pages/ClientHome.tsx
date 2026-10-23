// What a client sees after signing in (C1, Oct 23): their account, and the place "Shared with me" lands in C3.
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../convex/_generated/api";
import { BrandImg } from "../ui/BrandImg";
import { Thumb, useToast } from "../ui/kit";
import { linkProps } from "../lib/router";
import { ago } from "../lib/format";
import { ArrowRight } from "lucide-react";

export default function ClientHome({ me }: { me: { name: string | null; email: string } }) {
  const { signOut, signIn } = useAuthActions();
  const setName = useMutation(api.users.setName);
  const [name, setN] = useState(me.name ?? "");
  const [toast, show] = useToast();
  const [resetSent, setResetSent] = useState(false);
  const changed = name.trim() !== (me.name ?? "") && name.trim().length > 0;
  const mine = useQuery(api.shares.mine, {});
  const clients = [...new Set((mine ?? []).map((s) => s.client ?? "Wrangler Productions"))];
  return (
    <div className="signin" style={{ alignItems: "start", paddingTop: 48 }}>
      <BrandImg name="watermark" className="watermark" hidden />
      <div style={{ width: "min(560px, 100%)", display: "grid", gap: 22, position: "relative" }}>
        <BrandImg name="wordmark" className="logo" alt="Wrangler Productions" />
        <div style={{ display: "grid", gap: 8 }}>
          <span className="eyebrow">Shared with you</span>
          {mine === undefined ? <h1 className="headline">Loading…</h1>
            : mine.length === 0 ? <h1 className="headline">Nothing here yet. <span className="rest">When Wrangler Productions shares a video with {me.email}, it shows up on this page and you'll get an email.</span></h1>
            : <h1 className="headline">{name.trim() ? `Hi ${name.trim().split(" ")[0]}.` : "Hello."} <span className="rest">Open a video to watch it{mine.some((s) => s.access === "comment") ? " and leave notes on exact frames" : ""}.</span></h1>}
        </div>
        {mine && mine.length > 0 && clients.map((c) => (
          <div key={c} className="panel sharedpanel">
            <div className="prow"><span className="pl"><b>{c}</b></span></div>
            {mine.filter((s) => (s.client ?? "Wrangler Productions") === c).map((s) => (
              <div key={s.token} style={{ display: "contents" }}>
                {s.kind !== "video" && s.label !== c && <div className="prow sub"><span className="pl secondary">{s.label}{s.videos.length === 0 ? " · nothing to watch yet" : ""}</span><span className="pr"><a className="linkbtn secondary" {...linkProps(`/s/${s.token}`)} style={{ fontSize: 12.5 }}>Open all</a></span></div>}
                {s.videos.map((v) => (
                  <a key={v._id} className="prow vlink" {...linkProps(`/s/${s.token}/v/${v._id}`)}>
                    <Thumb src={v.thumbUrl} />
                    <span className="pl" style={{ minWidth: 0 }}><b style={{ fontWeight: 500 }}>{v.title}</b><span className="secondary" style={{ display: "block", fontSize: 12.5 }}>{v.project ? `${v.project} · ` : ""}v{v.latest}{v.versions > 1 ? ` of ${v.versions}` : ""} · updated {ago(v.updatedAt)}</span></span>
                    <span className="pr"><ArrowRight size={15} /></span>
                  </a>
                ))}
              </div>
            ))}
          </div>
        ))}
        <div className="panel">
          <div className="prow">
            <span className="pl">Your name <span className="secondary" style={{ display: "block", fontSize: 12.5 }}>Shown on the notes you leave.</span></span>
            <span className="pr">
              <input className="input sm" value={name} onChange={(e) => setN(e.target.value)} placeholder="Your name" aria-label="Name" />
              {changed && <button className="btn primary sm" onClick={async () => { await setName({ name }); show("Name saved"); }}>Save</button>}
            </span>
          </div>
          <div className="prow"><span className="pl">Email</span><span className="pr secondary">{me.email}</span></div>
          <div className="prow">
            <span className="pl">Password <span className="secondary" style={{ display: "block", fontSize: 12.5 }}>{resetSent ? "A code is on its way. Sign out, then use Forgot your password to finish." : "Change it with a code sent to your email."}</span></span>
            <span className="pr"><button className="btn sm" disabled={resetSent} onClick={async () => { try { await signIn("password", { flow: "reset", email: me.email }); setResetSent(true); } catch { show("Couldn't send the code. Try again in a minute."); } }}>Email me a code</button></span>
          </div>
          <div className="prow">
            <span className="pl">Sign out</span>
            <span className="pr"><button className="btn sm" onClick={() => void signOut()}>Sign out</button></span>
          </div>
        </div>
      </div>
      {toast}
    </div>
  );
}
