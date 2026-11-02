// Nov 2 · Settings › Notifications (Heston: "email notifications for everything, with a notifications settings menu so
// every business, vendor and client can configure their notifications"). One list, used on all three sides: each email
// the person can get, grouped, with a switch; the ones that are always sent show "Always" instead. No frame: built
// from the Settings rows (prow / Toggle). The list itself is convex/lib/notify.ts.
import { useState } from "react";
import { Toggle } from "../../ui/wp";
import { SkeletonRows } from "../../ui/wp";

export type NoticeItem = { key: string; group: string; label: string; hint: string | null; always: boolean; on: boolean };

export function NotificationList({ items, onToggle, className = "panel" }: { items: NoticeItem[] | undefined; onToggle: (key: string, on: boolean) => Promise<void>; className?: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [local, setLocal] = useState<Record<string, boolean>>({});
  if (!items) return <div className={className}><SkeletonRows n={4} /></div>;
  const groups = [...new Set(items.map((i) => i.group))];
  return (
    <>
      {groups.map((g) => (
        <div key={g} className={`${className} ntf-group`} role="group" aria-label={g}>
          <div className="ntf-head">{g}</div>
          {items.filter((i) => i.group === g).map((i) => {
            const on = local[i.key] ?? i.on;
            return (
              <div key={i.key} className="prow ntf-row">
                <span className="pl">{i.label}{i.hint && <span className="psub">{i.hint}</span>}</span>
                <span className="pr">{i.always ? <span className="ntf-always">Always sent</span>
                  : <Toggle label={i.label} checked={on} disabled={busy === i.key} onChange={async (v) => {
                    setBusy(i.key); setLocal({ ...local, [i.key]: v });
                    try { await onToggle(i.key, v); } catch { setLocal((l) => ({ ...l, [i.key]: !v })); } finally { setBusy(null); }
                  }} />}</span>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}
