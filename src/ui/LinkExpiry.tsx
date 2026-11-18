// Nov 18 (Heston, approved 09:06): link expiry, the same choices everywhere: 1 day, 2 days, 3 days, 1 week, 30 days.
//   ExpiryTick: proposals and briefings, before sending ("Make this link expire", then how long; unticked: never).
//   ExpiryRow:  proposals and briefings once sent (when the links stop working, and Change: Never or a choice).
//   ExpiryPick: Review shares (Never or a choice; editing a share can keep the date it has).
import { useState } from "react";
import { Button, Checkbox, Segmented } from "./wp";
import { errLine } from "./hold";

export const EXPIRY_CHOICES = [1, 2, 3, 7, 30] as const;
export type ExpiryDays = (typeof EXPIRY_CHOICES)[number];
const DAY = 86_400_000;
const nameOf = (d: number) => (d === 1 ? "1 day" : d === 7 ? "1 week" : `${d} days`);
const CHOICES = EXPIRY_CHOICES.map((d) => ({ key: String(d), label: nameOf(d) }));
const isDays = (k: string): k is `${ExpiryDays}` => (EXPIRY_CHOICES as readonly number[]).includes(Number(k));
export const untilText = (t: number) => new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Before sending: "Make this link expire" and, ticked, how long (1 week to start). null: the links never expire. */
export function ExpiryTick({ value, onChange, disabled }: { value: ExpiryDays | null; onChange: (d: ExpiryDays | null) => void; disabled?: boolean }) {
  const [last, setLast] = useState<ExpiryDays>(7);
  return (
    <div className="lx-tick">
      <Checkbox checked={value !== null} disabled={disabled} onChange={(on) => onChange(on ? last : null)} label="Make this link expire"
        hint={value === null ? "Unticked, the links keep working until you turn them off." : `Every link stops working ${untilText(Date.now() + value * DAY)}. You can change it later.`} />
      {value !== null && <div className="lx-seg"><Segmented label="How long the link works" value={String(value)} items={CHOICES} onChange={(k) => { if (!isDays(k)) return; const d = Number(k) as ExpiryDays; setLast(d); onChange(d); }} /></div>}
    </div>
  );
}

/** Once sent: when the links stop working, and Change (Never, or a choice from now). */
export function ExpiryRow({ expiresAt: at, onSet, show }: { expiresAt?: number | null; onSet: (d: ExpiryDays | null) => Promise<unknown>; show: (m: string) => void }) {
  const expiresAt = at ?? null;
  const [editing, setEditing] = useState(false);
  const [pick, setPick] = useState("never");
  const [busy, setBusy] = useState(false);
  const expired = expiresAt !== null && expiresAt <= Date.now();
  const text = expiresAt === null ? "The links never expire." : expired ? `The links expired ${untilText(expiresAt)}.` : `The links work until ${untilText(expiresAt)}.`;
  const save = async () => {
    setBusy(true);
    try { await onSet(isDays(pick) ? (Number(pick) as ExpiryDays) : null); show(isDays(pick) ? `The links work for ${nameOf(Number(pick))} from now.` : "The links never expire now."); setEditing(false); }
    catch (e) { show(errLine(e)); } finally { setBusy(false); }
  };
  return (
    <div className={`lx-row${expired ? " expired" : ""}`}>
      <span className="wp-small">{text}</span>
      {!editing ? <button type="button" className="linkbtn" onClick={() => { setPick(expiresAt === null ? "7" : "never"); setEditing(true); }}>{expired ? "Make them work again" : "Change"}</button> : (
        <div className="lx-edit">
          <div className="lx-seg"><Segmented label="Links expire" value={pick} onChange={setPick} items={[{ key: "never", label: "Never" }, ...CHOICES]} /></div>
          <span className="lx-btns">
            <Button size="sm" variant="primary" loading={busy} onClick={() => void save()}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </span>
        </div>
      )}
    </div>
  );
}

/** Review shares: "Link expires" Never or a choice; editing a share with a date can keep it. */
export function ExpiryPick({ value, onChange, keepAt }: { value: string; onChange: (k: string) => void; keepAt?: number | null }) {
  const keep = keepAt ? [{ key: "keep", label: `${keepAt <= Date.now() ? "Expired" : "Keep"} · ${new Date(keepAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` }] : [];
  return (
    <div className="lx-pick">
      <span>Link expires</span>
      <div className="lx-seg"><Segmented label="Link expires" value={value} onChange={onChange} items={[...keep, { key: "never", label: "Never" }, ...CHOICES]} /></div>
    </div>
  );
}
/** What ExpiryPick's choice means: a time, or null for never. */
export const expiryOf = (k: string, keepAt: number | null = null, now = Date.now()) => (k === "keep" ? keepAt : isDays(k) ? now + Number(k) * DAY : null);
