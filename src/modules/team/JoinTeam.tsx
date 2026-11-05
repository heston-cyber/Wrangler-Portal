// Phase 5e step 1 (Nov 5): Join the team (/team/join/<token>, email 46; frames 816:12241 desktop, 816:12300 expired,
// 816:12336 phone). The signer pages' dark curtain (a unique background, Design Log Nov 5). The invitee gives a name and
// sets a password (10+ characters), then confirms the email with the 6-digit code; after that they sign in as everyone does.
import { useState } from "react";
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../../convex/_generated/api";
import { Button, ButtonLink } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { CodeBoxes } from "../../shell/SignIn";
import { navigate } from "../../lib/router";
import { BrandImg } from "../../ui/BrandImg";
import smear from "../../assets/portal/light-smear.jpg";

function Curtain({ legal, children }: { legal: string; children: React.ReactNode }) {
  return (
    <div className="wsx gst">
      <div className="wp-light signing" aria-hidden><i style={{ backgroundImage: `url(${smear})` }} /></div>
      <header className="wsx-top"><BrandImg name="wordmark" alt="WranglerPortal" /><span className="wsx-secure"><Icon name="lock" size={14} />Secure sign-in</span></header>
      <main className="wsx-main">{children}</main>
      <footer className="wsx-foot">{legal ? `${legal} · ` : ""}Questions? Reply to the email that brought you here.</footer>
    </div>
  );
}

export default function JoinTeam({ token }: { token: string }) {
  const p = useQuery(api.team.joinPage, { token });
  const { signIn } = useAuthActions();
  const [step, setStep] = useState<"form" | "code">("form");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  if (p === undefined) return <Curtain legal=""><div className="wsx-card glass"><p className="caption">Loading…</p></div></Curtain>;
  if (p.state === "missing") return (
    <Curtain legal=""><div className="wsx-card glass"><span className="gst-ico"><Icon name="alert" size={24} /></span><h1 className="headline">This invite link doesn't work.</h1>
      <p className="caption">It may have been cancelled, or a newer link was sent. Use the newest email, or ask for a new invite.</p></div></Curtain>
  );
  const legal = p.legalName || p.business;
  if (p.state === "expired") return (
    <Curtain legal={legal}><div className="wsx-card glass"><span className="gst-ico"><Icon name="clock" size={24} /></span><span className="wp-eyebrow">Team invite · {p.business}</span>
      <h1 className="headline">This invite has expired</h1><p className="caption">Invites work for 14 days. Ask {p.invitedBy} to send it again.</p></div></Curtain>
  );
  if (p.state === "joined") return (
    <Curtain legal={legal}><div className="wsx-card glass"><span className="gst-ico"><Icon name="check" size={24} /></span><span className="wp-eyebrow">Team invite · {p.business}</span>
      <h1 className="headline">You've joined the team</h1><p className="caption">Sign in with your email and password.</p>
      <ButtonLink variant="primary" to="/" iconEnd={false}>Sign in</ButtonLink></div></Curtain>
  );
  const explain = (m: string) => /10 characters/.test(m) ? "Use at least 10 characters for the password."
    : /Invalid code|Could not verify|expired/i.test(m) ? "That code didn't match, or it's older than 10 minutes. Ask for a new one."
    : /invited/i.test(m) ? "This invite can't be used any more. Ask for a new one."
    : "Couldn't create your account. If you already made one, sign in instead.";
  const start = async () => {
    setBusy(true); setErr(null); setNote(null);
    try {
      const r = await signIn("password", { flow: "signUp", email: p.email, password, name: name.trim() || p.name });
      if (r.signingIn) navigate("/"); else { setCode(""); setStep("code"); }
    } catch (e) { setErr(explain((e as Error).message || "")); } finally { setBusy(false); }
  };
  const verify = async () => {
    setBusy(true); setErr(null);
    try { await signIn("password", { flow: "email-verification", email: p.email, code }); navigate("/"); }
    catch (e) { setErr(explain((e as Error).message || "")); } finally { setBusy(false); }
  };
  const resend = async () => {
    setBusy(true); setErr(null);
    try { await signIn("password", { flow: "signIn", email: p.email, password }); setNote("A new code is on its way."); }
    catch (e) { setErr(explain((e as Error).message || "")); } finally { setBusy(false); }
  };
  return (
    <Curtain legal={legal}>
      <form className="wsx-card glass team-join" onSubmit={(e) => { e.preventDefault(); void (step === "form" ? start() : verify()); }}>
        <span className="wp-eyebrow">Team invite · {p.business}</span>
        <h1 className="headline">Join {p.business} as {/^[AEIOU]/.test(p.role) ? "an" : "a"} {p.role}</h1>
        {step === "form" ? <>
          <p className="caption">{p.invitedBy} invited you. Set a password for this email. We email a 6-digit code once, to confirm it.</p>
          <label className="wp-field"><span className="wp-field-label">Email</span><input className="input" value={p.email} readOnly /></label>
          <label className="wp-field"><span className="wp-field-label">Your name</span><input className="input" autoComplete="name" maxLength={60} value={name} placeholder={p.name || "Your name"} onChange={(e) => setName(e.target.value)} /></label>
          <label className="wp-field"><span className="wp-field-label">Password</span><input className="input" type="password" autoComplete="new-password" minLength={10} required placeholder="At least 10 characters" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          {err && <p className="error" role="alert">{err}</p>}
          <Button variant="primary" type="submit" loading={busy} disabled={password.length < 10 || !(name.trim() || p.name)}>Send me a code</Button>
        </> : <>
          <p className="caption">Enter the 6-digit code we emailed to {p.email}.</p>
          <CodeBoxes value={code} onChange={setCode} />
          {note && <p className="wp-small" role="status">{note}</p>}
          {err && <p className="error" role="alert">{err}</p>}
          <Button variant="primary" type="submit" loading={busy} disabled={code.length !== 6}>Join the team</Button>
          <button type="button" className="linkbtn wp-small secondary" onClick={() => void resend()} disabled={busy}>Send a new code</button>
        </>}
      </form>
    </Curtain>
  );
}
