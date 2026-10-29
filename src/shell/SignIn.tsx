// Sign in, set a password (invited clients), prove the email with a code, reset a password (C1, Oct 23).
// Look: the approved P1 sign-in (Figma "S5 · Client + Share › Sign in", Oct 29). The flow and its checks are
// unchanged: a code is only asked for when Convex Auth needs one (sign-up, or a first sign-in since verification).
import { useRef, useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvex } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Icon } from "../ui/Icon";
import { Button } from "../ui/wp";
import wpLogo from "../assets/d1/wp-logo.png";
import corona from "../assets/portal/light-corona.jpg";

type Flow = "signIn" | "signUp" | "code" | "reset" | "resetCode";

const TITLES: Record<Flow, string> = {
  signIn: "Sign in", signUp: "Set your password", code: "Sign in", reset: "Reset your password", resetCode: "Reset your password",
};

/** The sign-in light (12, Eclipse corona) and the glass card, shared by the sign-in and system pages. */
export function CenterCard({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="signin wp-center">
      <div className="wp-light corona" aria-hidden><i style={{ backgroundImage: `url(${corona})` }} /></div>
      <div className="wp-centercard glass" style={wide ? { width: "min(560px, 100%)" } : undefined}>{children}</div>
    </div>
  );
}
export const CardLogo = () => <span className="wp-logo"><span className="rec" aria-hidden /><img src={wpLogo} alt="Wrangler Productions" /></span>;

export default function SignIn({ invitedEmail, note: lead }: { invitedEmail?: string | null; note?: React.ReactNode }) {
  const { signIn } = useAuthActions();
  const convex = useConvex();
  const [flow, setFlow] = useState<Flow>(invitedEmail ? "signUp" : "signIn");
  const [email, setEmail] = useState(invitedEmail ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const pw = useRef(""); // kept only to resend a code; never stored

  const explain = (msg: string, f: Flow) => {
    if (/invited/i.test(msg)) return "This email hasn't been invited to Wrangler Review. Ask the person who shared with you to invite it.";
    if (/valid email/i.test(msg)) return "Enter a valid email.";
    if (/10 characters/.test(msg)) return "Use at least 10 characters for the password.";
    if (/Invalid code|Could not verify code|expired/i.test(msg)) return "That code didn't match, or it's older than 10 minutes. Ask for a new one.";
    if (/Resend|Email isn't set up/i.test(msg)) return "The code email couldn't be sent. Try again in a minute.";
    if (f === "signIn") return "That email and password don't match. First time here? Choose Create your account.";
    if (f === "signUp") return "Couldn't create the account. If you already made one, sign in instead.";
    if (f === "reset") return "Couldn't start the reset. Check the email and try again.";
    return "Something went wrong. Try again.";
  };

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null); setNote(null); setBusy(true);
    const fd = new FormData(e.currentTarget);
    const mail = String(fd.get("email") ?? email).trim().toLowerCase();
    setEmail(mail);
    try {
      if (flow === "signUp") {
        const can = await convex.query(api.clients.canSignUp, { email: mail });
        if (!can.ok) { setError(can.reason === "invalid" ? "Enter a valid email." : "This email hasn't been invited to Wrangler Review. Ask the person who shared with you to invite it."); return; }
      }
      if (flow === "signIn" || flow === "signUp") {
        fd.set("flow", flow);
        fd.set("email", mail);
        pw.current = String(fd.get("password") ?? "");
        const r = await signIn("password", fd);
        // Email verification turned on (sign-up, or a first sign-in since it was): a code went out.
        if (!r.signingIn) { setCode(""); setFlow("code"); }
      } else if (flow === "code") {
        await signIn("password", { flow: "email-verification", email: mail, code: code.trim() });
      } else if (flow === "reset") {
        await signIn("password", { flow: "reset", email: mail });
        setFlow("resetCode");
      } else if (flow === "resetCode") {
        await signIn("password", { flow: "reset-verification", email: mail, code: String(fd.get("code") ?? "").replace(/\D/g, ""), newPassword: String(fd.get("newPassword") ?? "") });
      }
    } catch (err) {
      setError(explain((err as Error).message || "", flow));
    } finally {
      setBusy(false);
    }
  }

  const go = (f: Flow) => { setFlow(f); setError(null); setNote(null); };
  async function resend() {
    setError(null); setNote(null); setBusy(true);
    try {
      await signIn("password", { flow: "signIn", email, password: pw.current });
      setNote("A new code is on its way.");
    } catch (err) { setError(explain((err as Error).message || "", "code")); }
    finally { setBusy(false); }
  }
  const askEmail = flow === "signIn" || flow === "signUp" || flow === "reset";
  const invited = flow === "signUp" && !!invitedEmail;
  return (
    <CenterCard>
      <form onSubmit={onSubmit} className="wp-form">
        <CardLogo />
        {lead && <p className="wp-cardnote">{lead}</p>}
        <h1 className="wp-h3">{TITLES[flow]}</h1>
        {flow === "signUp" && invitedEmail && <p className="wp-body">You've been invited. Set a password for this email to see what's been shared with you.</p>}
        {flow === "code" && <p className="wp-body">Enter the 6-digit code we emailed to {email}.</p>}
        {flow === "reset" && <p className="wp-body">We'll email you a code.</p>}
        {note && <p className="wp-small" role="status">{note}</p>}

        {askEmail && (
          <div className="wp-field">
            <label className="wp-field-label" htmlFor="email">Email</label>
            <div className="wp-lockwrap">
              <input className="input" id="email" name="email" type="email" autoComplete="email" required defaultValue={email} readOnly={invited} aria-readonly={invited || undefined} />
              {invited && <Icon name="lock" size={14} className="lock" label="Can't be changed" />}
            </div>
          </div>
        )}
        {flow === "signUp" && (
          <div className="wp-field">
            <label className="wp-field-label" htmlFor="name">Your name (shown on your notes)</label>
            <input className="input" id="name" name="name" type="text" autoComplete="name" maxLength={60} />
          </div>
        )}
        {(flow === "signIn" || flow === "signUp") && (
          <div className="wp-field">
            <label className="wp-field-label" htmlFor="password">Password</label>
            <input className="input" id="password" name="password" type="password" autoComplete={flow === "signIn" ? "current-password" : "new-password"} minLength={10} required placeholder={flow === "signUp" ? "At least 10 characters" : undefined} />
          </div>
        )}
        {flow === "code" && <CodeBoxes value={code} onChange={setCode} />}
        {flow === "resetCode" && (
          <>
            <div className="wp-field">
              <label className="wp-field-label" htmlFor="code">6-digit code</label>
              <input className="input" id="code" name="code" inputMode="numeric" pattern="[0-9 ]{6,7}" autoComplete="one-time-code" maxLength={7} required autoFocus onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            </div>
            <div className="wp-field">
              <label className="wp-field-label" htmlFor="newPassword">New password</label>
              <input className="input" id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={10} required placeholder="At least 10 characters" />
            </div>
          </>
        )}

        {error && <p className="error" role="alert" style={{ margin: 0 }}>{error}</p>}
        <Button variant="primary" type="submit" loading={busy} disabled={flow === "code" && code.length !== 6} style={{ width: "100%" }}>
          {flow === "signIn" ? "Sign in" : flow === "signUp" ? "Send me a code" : flow === "code" ? "Continue" : "Reset"}
        </Button>

        {flow === "signIn" && <>
          <button className="wp-link" type="button" onClick={() => go("reset")}>Forgot password?</button>
          <button className="wp-link quiet" type="button" onClick={() => go("signUp")}>First time here? Set your password</button>
        </>}
        {flow === "signUp" && <button className="wp-link" type="button" onClick={() => go("signIn")}>I already have one</button>}
        {flow === "code" && <button className="wp-link" type="button" disabled={busy || !pw.current} onClick={() => void resend()}>Resend code</button>}
        {flow === "resetCode" && <button className="wp-link" type="button" onClick={() => go("reset")}>Start over</button>}
        {flow === "reset" && <button className="wp-link" type="button" onClick={() => go("signIn")}>Back to sign in</button>}
      </form>
    </CenterCard>
  );
}

/** Six boxes over one real field, so paste, autofill and screen readers work as with any code input. */
function CodeBoxes({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [focus, setFocus] = useState(true);
  return (
    <div className="wp-code">
      <input aria-label="6-digit code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus required value={value}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))} />
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} className={`box${focus && i === Math.min(value.length, 5) ? " on" : ""}`} aria-hidden>{value[i] ?? ""}</span>
      ))}
    </div>
  );
}

/** A system page (P1 / Client / System): the sign-in light, a glass card, an icon, a line or two, buttons. */
export function SystemPage({ icon, eyebrow, title, body, children }: { icon?: "alert" | "lock"; eyebrow?: string; title: string; body?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <CenterCard>
      <div className="stack">
        <CardLogo />
        {icon && <Icon name={icon} size={28} />}
        {eyebrow && <span className="wp-eyebrow">{eyebrow}</span>}
        <h1 className="wp-h3">{title}</h1>
        {body && <p className="wp-body">{body}</p>}
        {children}
      </div>
    </CenterCard>
  );
}
