// Phase 5e step 2 (Nov 5): Settings › Security (owner and team, frame 818:14727) and the same rows on a client's and a
// vendor's account page (842:11010). Change password (842:10398) and Change email (842:10578 · Enter the code 842:10637).
import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button, Card, DialogHeader, ListRow, SectionHead, SkeletonRows, StatusChip } from "../../ui/wp";
import { Modal, useConfirm } from "../../ui/kit";
import { CodeBoxes } from "../../shell/SignIn";
import { errText } from "../docs/pages/common";
import { ago } from "../../lib/format";

const day = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** The two Sign-in rows: Password (Change password) and Email (Change email). `rows` draws them as the client page's rows. */
export function SignInRows({ show, rows }: { show: (m: string) => void; rows?: boolean }) {
  const st = useQuery(api.security.state);
  const [dialog, setDialog] = useState<null | "password" | "email">(null);
  if (st === undefined) return rows ? null : <SkeletonRows n={2} label="Loading" />;
  const pw = { title: "Password", sub: `Last changed ${day(st.passwordChangedAt)}. At least 10 characters.`, button: "Change password", open: () => setDialog("password") };
  const em = { title: "Email", sub: st.pending ? `${st.email} · waiting for the code sent to ${st.pending.newEmail}` : st.email, button: st.pending ? "Enter the code" : "Change email", open: () => setDialog("email") };
  return (
    <>
      {rows ? [pw, em].map((r) => (
        <div key={r.title} className="r"><span className="l"><b>{r.title}</b><span>{r.sub}</span></span><span className="v"><Button size="sm" onClick={r.open}>{r.button}</Button></span></div>
      )) : <>
        <ListRow lead={{ icon: "lock" }} title={pw.title} meta={pw.sub} action={<Button size="sm" onClick={pw.open}>{pw.button}</Button>} />
        <ListRow lead={{ icon: "mail" }} title={em.title} meta={em.sub} action={<Button size="sm" onClick={em.open}>{em.button}</Button>} />
      </>}
      {dialog === "password" && <PasswordDialog onClose={() => setDialog(null)} show={show} />}
      {dialog === "email" && <EmailDialog pending={st.pending?.newEmail ?? null} onClose={() => setDialog(null)} show={show} />}
    </>
  );
}

function PasswordDialog({ onClose, show }: { onClose: () => void; show: (m: string) => void }) {
  const change = useAction(api.security.changePassword);
  const [cur, setCur] = useState(""), [next, setNext] = useState(""), [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setErr(null);
    if (next !== again) { setErr("The new passwords don't match."); return; }
    setBusy(true);
    try {
      const r = await change({ current: cur, next });
      if ("ok" in r) { show("Password changed. Your other devices were signed out."); onClose(); return; }
      setErr(r.error === "wrong" ? "That isn't your current password." : r.error === "locked" ? "That was 5 wrong tries. Wait 15 minutes and try again." : r.error === "same" ? "Pick a password you haven't been using." : "Use at least 10 characters.");
      if (r.error === "wrong") setCur("");
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} label="Change your password" width={560}>
      <form className="crm-dialog team-dialog" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <DialogHeader eyebrow="Security" title="Change your password" body="Enter your current password, then a new one." onClose={onClose} />
        <label className="wp-field"><span className="wp-field-label">Current password</span><input className="input" type="password" autoComplete="current-password" autoFocus value={cur} onChange={(e) => setCur(e.target.value)} /></label>
        <label className="wp-field"><span className="wp-field-label">New password</span><input className="input" type="password" autoComplete="new-password" placeholder="At least 10 characters" value={next} onChange={(e) => setNext(e.target.value)} /></label>
        <label className="wp-field"><span className="wp-field-label">Confirm new password</span><input className="input" type="password" autoComplete="new-password" placeholder="Type it again" value={again} onChange={(e) => setAgain(e.target.value)} /></label>
        {err && <p className="error" role="alert">{err}</p>}
        <div className="dfoot">
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
          <Button variant="primary" type="submit" loading={busy} disabled={!cur || next.length < 10 || !again}>Save new password</Button>
        </div>
      </form>
    </Modal>
  );
}

function EmailDialog({ pending, onClose, show }: { pending: string | null; onClose: () => void; show: (m: string) => void }) {
  const start = useMutation(api.security.startEmailChange);
  const confirm = useMutation(api.security.confirmEmailChange);
  const cancel = useMutation(api.security.cancelEmailChange);
  const [step, setStep] = useState<"address" | "code">(pending ? "code" : "address");
  const [email, setEmail] = useState(pending ?? ""), [code, setCode] = useState("");
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const send = async () => {
    setBusy(true); setErr(null);
    try { await start({ newEmail: email }); setCode(""); setStep("code"); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const check = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await confirm({ code });
      if ("ok" in r) { show(`Your email is ${r.email} now. Sign in with it from now on.`); onClose(); return; }
      if (r.error === "wrong") { setErr("That code didn't match. Check the newest email and try again."); setCode(""); }
      else if (r.error === "tooMany") { setErr("That was 5 wrong codes, so the change was cancelled. Start again."); setStep("address"); }
      else if (r.error === "taken") { setErr("That email has a portal login now. Use another one."); setStep("address"); }
      else { setErr("That code is older than 10 minutes. Send a new one."); setStep("address"); }
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const close = () => { if (step === "code" && !pending) void cancel({}).catch(() => undefined); onClose(); };
  return (
    <Modal onClose={close} label="Change your email" width={560}>
      <form className="crm-dialog team-dialog" onSubmit={(e) => { e.preventDefault(); void (step === "address" ? send() : check()); }}>
        {step === "address" ? <>
          <DialogHeader eyebrow="Security" title="Change your email" body="Your email is your username. We send a 6-digit code to the new address to confirm it." onClose={close} />
          <label className="wp-field"><span className="wp-field-label">New email address</span><input className="input" type="email" autoFocus placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          {err && <p className="error" role="alert">{err}</p>}
          <div className="dfoot">
            <button className="btn ghost" type="button" onClick={close}>Cancel</button>
            <Button variant="primary" type="submit" loading={busy} disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())}>Send me a code</Button>
          </div>
        </> : <>
          <DialogHeader eyebrow="Security" title="Enter the code" body={`We sent a 6-digit code to ${email.trim().toLowerCase()}. It works for 10 minutes. Your email changes once you enter it.`} onClose={close} />
          <CodeBoxes value={code} onChange={setCode} />
          {err && <p className="error" role="alert">{err}</p>}
          <div className="dfoot">
            <button className="btn ghost" type="button" onClick={() => { setStep("address"); setErr(null); }}>Use another address</button>
            <Button variant="primary" type="submit" loading={busy} disabled={code.length !== 6}>Change my email</Button>
          </div>
        </>}
      </form>
    </Modal>
  );
}

/** Your signed-in devices, with Sign out for each one but this one. */
export function DevicesCard({ show }: { show: (m: string) => void }) {
  const st = useQuery(api.security.state);
  const out = useMutation(api.security.signOutDevice);
  const [ask, confirmNode] = useConfirm();
  if (!st) return null;
  const go = async (sessionId: Id<"authSessions">, label: string) => {
    if (!(await ask({ title: `Sign out ${label}?`, body: "It will need your email and password to come back in.", yes: "Sign out" }))) return;
    try { await out({ sessionId }); show(`${label} is signed out.`); } catch (e) { show(errText(e)); }
  };
  return (
    <Card label="Your signed-in devices" head={<SectionHead label="Your signed-in devices" count={st.devices.length || undefined} />}>
      {st.devices.length === 0 ? <p className="wp-small secondary team-pad">This list fills in as you sign in.</p>
        : st.devices.map((d) => (
          <ListRow key={d.sessionId} lead={{ icon: /iPhone|Android|iPad/.test(d.label) ? "phone" : "globe" }} title={d.label} meta={d.current ? "Now" : `Last seen ${ago(d.lastSeen)}`}
            chip={d.current ? <StatusChip tone="success">This device</StatusChip> : undefined}
            action={d.current ? undefined : <Button size="sm" onClick={() => void go(d.sessionId, d.label)}>Sign out</Button>} />
        ))}
      {confirmNode}
    </Card>
  );
}

/** Settings › Security for the owner and the team. */
export function SecuritySection({ show, head }: { show: (m: string) => void; head: React.ReactNode }) {
  return (
    <>
      {head}
      <Card label="Sign-in" head={<SectionHead label="Sign-in" />}><SignInRows show={show} /></Card>
      <DevicesCard show={show} />
    </>
  );
}

// ---------- which browser this is ----------

function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows PC" : /Linux/.test(ua) ? "Linux" : "A computer";
  const br = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${os} · ${br}`;
}
function deviceKey(): string {
  try {
    let k = localStorage.getItem("wr.device");
    if (!k || !/^[A-Za-z0-9_-]{16,64}$/.test(k)) {
      const b = new Uint8Array(18); crypto.getRandomValues(b);
      k = btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      localStorage.setItem("wr.device", k);
    }
    return k;
  } catch { return "nostorage00000000"; }
}

/** Once per page load, signed in: tells the server which browser this session is (Settings › Security's list, email 47). */
export function useDeviceCheckIn(signedIn: boolean) {
  const seen = useMutation(api.security.seenDevice);
  useEffect(() => {
    if (!signedIn) return;
    void seen({ deviceKey: deviceKey(), label: deviceLabel() }).catch(() => undefined);
  }, [signedIn, seen]);
}
