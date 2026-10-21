import { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";

export default function SignIn() {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn("password", new FormData(e.currentTarget));
    } catch (err) {
      const msg = (err as Error).message || "";
      setError(
        /allowed/i.test(msg) ? "This email isn't allowed to use Wrangler Review." :
        /10 characters/.test(msg) ? "Use at least 10 characters for the password." :
        flow === "signIn" ? "That email and password don't match. First time here? Choose Create your password." :
        "Couldn't create the account. If you already made one, sign in instead.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="signin">
      <img className="watermark" src="/brand/spark-watermark.png" alt="" aria-hidden />
      <form onSubmit={onSubmit}>
        <img className="logo" src="/brand/wordmark-cream.png" alt="Wrangler Productions" />
        <span className="eyebrow">Wrangler Review</span>
        <h1 className="title" style={{ marginBottom: 6 }}>{flow === "signIn" ? "Sign in." : "Set a password."}</h1>
        <label className="field">
          <span className="label">Email</span>
          <input className="input" id="email" name="email" type="email" autoComplete="email" required />
        </label>
        <label className="field">
          <span className="label">Password</span>
          <input className="input" id="password" name="password" type="password" autoComplete={flow === "signIn" ? "current-password" : "new-password"} minLength={10} required />
        </label>
        <input name="flow" type="hidden" value={flow} />
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary lg" type="submit" disabled={busy}>{busy ? "One moment…" : flow === "signIn" ? "Sign in" : "Create password"}</button>
        <button className="btn ghost" type="button" onClick={() => { setFlow(flow === "signIn" ? "signUp" : "signIn"); setError(null); }}>
          {flow === "signIn" ? "Create your password" : "I already have one"}
        </button>
      </form>
    </div>
  );
}
