// What a client sees after signing in (C1, Oct 23): their account, and the place "Shared with me" lands in C3.
import { useState } from "react";
import { useMutation } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../convex/_generated/api";
import { BrandImg } from "../ui/BrandImg";
import { useToast } from "../ui/kit";

export default function ClientHome({ me }: { me: { name: string | null; email: string } }) {
  const { signOut, signIn } = useAuthActions();
  const setName = useMutation(api.users.setName);
  const [name, setN] = useState(me.name ?? "");
  const [toast, show] = useToast();
  const [resetSent, setResetSent] = useState(false);
  const changed = name.trim() !== (me.name ?? "") && name.trim().length > 0;
  return (
    <div className="signin" style={{ alignItems: "start", paddingTop: 48 }}>
      <BrandImg name="watermark" className="watermark" hidden />
      <div style={{ width: "min(560px, 100%)", display: "grid", gap: 22, position: "relative" }}>
        <BrandImg name="wordmark" className="logo" alt="Wrangler Productions" />
        <div style={{ display: "grid", gap: 8 }}>
          <span className="eyebrow">Shared with you</span>
          <h1 className="headline">Nothing here yet. <span className="rest">When Wrangler Productions shares a video with {me.email}, it shows up on this page and you'll get an email.</span></h1>
        </div>
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
