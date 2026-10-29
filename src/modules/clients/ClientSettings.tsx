// The client's Settings (P1 / Client / Settings): their name, email, password, the one email switch, and Sign out.
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../../convex/_generated/api";
import { Button, Toggle } from "../../ui/wp";
import { useToast } from "../../ui/kit";
import { TopBar } from "../../shell/Shell";

export default function ClientSettings({ me }: { me: { name: string | null; email: string } }) {
  const { signOut, signIn } = useAuthActions();
  const setName = useMutation(api.users.setName);
  const prefs = useQuery(api.emails.myPrefs, {});
  const brands = useQuery(api.business.brand);
  const business = brands?.[0]?.name ?? "Wrangler Productions";
  const setPrefs = useMutation(api.emails.setMine);
  const [name, setN] = useState(me.name ?? "");
  const [resetSent, setResetSent] = useState(false);
  const [toast, show] = useToast();
  const changed = name.trim() !== (me.name ?? "") && name.trim().length > 0;
  return (
    <>
      <TopBar><span className="here">Settings</span></TopBar>
      <div className="wp-page cset">
        <header className="wp-sethead"><span className="wp-eyebrow">Settings</span><h1 className="wp-h3">Your account.</h1></header>
        <section className="wp-card glass cset-rows" aria-label="Your account">
          <div className="r">
            <span className="l"><b>Your name</b><span>Shown on the notes you leave.</span></span>
            <span className="v">
              <input className="input" value={name} onChange={(e) => setN(e.target.value)} placeholder="Your name" aria-label="Your name" maxLength={60} />
              <Button size="sm" disabled={!changed} onClick={async () => { await setName({ name }); show("Name saved."); }}>Save</Button>
            </span>
          </div>
          <div className="r"><span className="l"><b>Email</b></span><span className="v secondary">{me.email}</span></div>
          <div className="r">
            <span className="l"><b>Password</b><span>{resetSent ? "A code is on its way. Sign out, then use Forgot your password to finish." : "Change it with a code sent to your email."}</span></span>
            <span className="v"><Button size="sm" disabled={resetSent} onClick={async () => { try { await signIn("password", { flow: "reset", email: me.email }); setResetSent(true); } catch { show("Couldn't send the code. Try again in a minute."); } }}>Email me a code</Button></span>
          </div>
          <div className="r">
            <span className="l"><b>Email me when something new arrives</b><span>{`New cuts, replies to your notes and notes from ${business}. Documents to sign always arrive by email.`}</span></span>
            <span className="v"><Toggle label="Email me when something new arrives" checked={prefs?.on ?? true} disabled={prefs === undefined} onChange={async (on) => { await setPrefs({ on }); show(on ? "Emails on." : "Emails off."); }} /></span>
          </div>
          <div className="r"><span className="l"><b>Sign out</b></span><span className="v"><Button size="sm" onClick={() => void signOut()}>Sign out</Button></span></div>
        </section>
      </div>
      {toast}
    </>
  );
}
