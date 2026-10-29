// Sign in, create an account (owners and invited clients), prove the email with a code, reset a password (C1, Oct 23).
import { useState } from "react";
import { LIGHTS } from "./lights";
import { BrandImg } from "../ui/BrandImg";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvex } from "convex/react";
import { api } from "../../convex/_generated/api";

type Flow = "signIn" | "signUp" | "code" | "reset" | "resetCode";

const TITLES: Record<Flow, string> = {
  signIn: "Sign in.", signUp: "Create your account.", code: "Check your email.", reset: "Reset your password.", resetCode: "Set a new password.",
};

export default function SignIn({ invitedEmail }: { invitedEmail?: string | null }) {
  const { signIn } = useAuthActions();
  const convex = useConvex();
  const [flow, setFlow] = useState<Flow>(invitedEmail ? "signUp" : "signIn");
  const [email, setEmail] = useState(invitedEmail ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

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
        const r = await signIn("password", fd);
        // Email verification turned on (sign-up, or a first sign-in since it was): a code went out.
        if (!r.signingIn) { setFlow("code"); setNote(`A six-digit code is on its way to ${mail}.`); }
      } else if (flow === "code") {
        await signIn("password", { flow: "email-verification", email: mail, code: String(fd.get("code") ?? "").trim() });
      } else if (flow === "reset") {
        await signIn("password", { flow: "reset", email: mail });
        setFlow("resetCode"); setNote(`A six-digit code is on its way to ${mail}.`);
      } else if (flow === "resetCode") {
        await signIn("password", { flow: "reset-verification", email: mail, code: String(fd.get("code") ?? "").trim(), newPassword: String(fd.get("newPassword") ?? "") });
      }
    } catch (err) {
      setError(explain((err as Error).message || "", flow));
    } finally {
      setBusy(false);
    }
  }

  const go = (f: Flow) => { setFlow(f); setError(null); setNote(null); };
  const askEmail = flow !== "code" && flow !== "resetCode";
  return (
    <div className="signin">
      <div className="d1-light l-cross" style={{ backgroundImage: `url(${LIGHTS.cross})` }} aria-hidden />
      <form onSubmit={onSubmit}>
        <BrandImg name="wordmark" className="logo" alt="Wrangler Productions" />
        <span className="eyebrow">Wrangler Review</span>
        <h1 className="title" style={{ marginBottom: 6 }}>{TITLES[flow]}</h1>
        {flow === "signUp" && invitedEmail && <p className="caption" style={{ margin: 0 }}>You've been invited. Set a password for this email to see what's been shared with you.</p>}
        {note && <p className="caption" style={{ margin: 0 }}>{note}</p>}

        {askEmail && (
          <label className="field">
            <span className="label">Email</span>
            <input className="input" id="email" name="email" type="email" autoComplete="email" required defaultValue={email} readOnly={flow === "signUp" && !!invitedEmail} />
          </label>
        )}
        {flow === "signUp" && (
          <label className="field">
            <span className="label">Your name <span className="secondary">(shown on your notes)</span></span>
            <input className="input" id="name" name="name" type="text" autoComplete="name" maxLength={60} />
          </label>
        )}
        {(flow === "signIn" || flow === "signUp") && (
          <label className="field">
            <span className="label">Password</span>
            <input className="input" id="password" name="password" type="password" autoComplete={flow === "signIn" ? "current-password" : "new-password"} minLength={10} required />
          </label>
        )}
        {(flow === "code" || flow === "resetCode") && (
          <label className="field">
            <span className="label">Six-digit code</span>
            <input className="input" id="code" name="code" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" maxLength={6} required autoFocus />
          </label>
        )}
        {flow === "resetCode" && (
          <label className="field">
            <span className="label">New password</span>
            <input className="input" id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={10} required />
          </label>
        )}

        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary lg" type="submit" disabled={busy}>
          {busy ? "One moment…" : flow === "signIn" ? "Sign in" : flow === "signUp" ? "Create account" : flow === "code" ? "Continue" : flow === "reset" ? "Email me a code" : "Set password"}
        </button>

        {flow === "signIn" && <>
          <button className="btn ghost" type="button" onClick={() => go("signUp")}>Create your account</button>
          <button className="linkbtn" type="button" onClick={() => go("reset")} style={{ justifySelf: "center" }}>Forgot your password?</button>
        </>}
        {flow === "signUp" && <button className="btn ghost" type="button" onClick={() => go("signIn")}>I already have one</button>}
        {(flow === "code" || flow === "resetCode") && <button className="btn ghost" type="button" onClick={() => go(flow === "code" ? "signIn" : "reset")}>Start over</button>}
        {flow === "reset" && <button className="btn ghost" type="button" onClick={() => go("signIn")}>Back to sign in</button>}
      </form>
    </div>
  );
}
