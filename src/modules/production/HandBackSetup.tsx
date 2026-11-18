// The hand-back PIN and Face ID setup (Q2, Nov 17), shared by a release's Hand over screen and Settings › Security
// (Nov 18, Heston: "Do it in settings"). Same mutations as before: handBack.setPin and passkeys.register (owner only).
import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button, Card, SectionHead } from "../../ui/wp";
import { usePerms } from "../../lib/teamAccess";
import { errLine } from "../../ui/hold";

export const deviceName = () => {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  return /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android phone" : /Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "PC" : "phone";
};

export const canPasskey = () => typeof window !== "undefined" && "PublicKeyCredential" in window;

/** Q2: before the first hand-over, a 4-digit PIN (always) and Face ID or the phone's passcode (where the phone has it). */
export function UnlockSetup({ pin, passkeys }: { pin: boolean; passkeys: number }) {
  const setPin = useMutation(api.handBack.setPin);
  const regOptions = useAction(api.passkeys.registerOptions);
  const register = useAction(api.passkeys.register);
  const [a, setA] = useState(""), [b, setB] = useState("");
  const [open, setOpen] = useState(!pin);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const addKey = async () => {
    setBusy(true); setMsg(null);
    try {
      const { startRegistration } = await import("@simplewebauthn/browser");
      const opts = await regOptions({ origin: location.origin });
      const res = await startRegistration(opts);
      await register({ origin: location.origin, response: res, device: deviceName() });
      setMsg("Face ID or your passcode will hand it back.");
    } catch (e) { setMsg((e as Error).name === "NotAllowedError" ? "Cancelled." : errLine(e)); }
    finally { setBusy(false); }
  };
  if (!open) return (
    <div className="rl-unlockset">
      <span className="secondary wp-small">You'll hand it back with {passkeys ? "Face ID, your passcode or " : ""}your PIN.</span>
      <span className="rl-links"><button type="button" className="btn ghost sm" onClick={() => setOpen(true)}>Change PIN</button>{canPasskey() && !passkeys && <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void addKey()}>Use Face ID too</button>}</span>
      {msg && <span className="wp-small secondary" role="status">{msg}</span>}
    </div>
  );
  return (
    <form className="rl-unlockset" onSubmit={(e) => { e.preventDefault(); if (a !== b) { setMsg("The two PINs don't match."); return; } setBusy(true); void setPin({ pin: a }).then(() => { setOpen(false); setMsg("PIN saved."); setA(""); setB(""); }, (er) => setMsg(errLine(er))).finally(() => setBusy(false)); }}>
      <b>{pin ? "Change your hand-back PIN" : "Choose a hand-back PIN"}</b>
      <span className="secondary wp-small">4 digits, so only you can take the phone back after they sign.</span>
      <span className="rl-pins">
        <input className="input" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} autoComplete="off" type="password" value={a} onChange={(e) => setA(e.target.value.replace(/\D/g, ""))} placeholder="PIN" aria-label="PIN" />
        <input className="input" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} autoComplete="off" type="password" value={b} onChange={(e) => setB(e.target.value.replace(/\D/g, ""))} placeholder="Again" aria-label="PIN again" />
      </span>
      {msg && <span className="wp-small rl-err" role="alert">{msg}</span>}
      <Button type="submit" loading={busy} disabled={a.length !== 4 || b.length !== 4}>Save PIN</Button>
      {canPasskey() && <button type="button" className="btn ghost sm" disabled={busy || !pin} onClick={() => void addKey()}>Use Face ID too</button>}
    </form>
  );
}

/** Settings › Security: the owner's hand-back PIN and Face ID, set here or on a release before the first hand-over. */
export function HandBackCard() {
  const { team } = usePerms();
  const setup = useQuery(api.handBack.mine, team ? "skip" : {});
  if (team || !setup) return null;
  return (
    <Card label="Hand-back PIN" head={<SectionHead label="Hand-back PIN" />}>
      <div className="hb-set">
        <p className="secondary wp-small">When you hand your phone to someone to sign a release, this is how only you take it back.</p>
        <UnlockSetup pin={setup.pin} passkeys={setup.passkeys.length} />
      </div>
    </Card>
  );
}
