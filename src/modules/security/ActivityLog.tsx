// Phase 5e step 3 (Nov 5): Settings › Activity (frames 820:13940 default, 820:14662 no match, 820:15123 loading,
// 820:15603 long list, 820:16517 details, 821:18278 phone). Owner only; kept 1 year (D146).
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button, Card, DialogHeader, EmptyState, ListRow, SectionHead, SkeletonRows, StatusChip, type Tone } from "../../ui/wp";
import { Modal } from "../../ui/kit";
import { navigate } from "../../lib/router";
import { SetHead } from "../settings/Frame";
import type { IconName } from "../../ui/Icon";

type Kind = "sent" | "signed" | "paid" | "deleted" | "settings" | "team" | "export" | "signin";
const KINDS: Array<{ key: Kind; label: string; icon: IconName; tone: Tone }> = [
  { key: "sent", label: "Sent", icon: "send", tone: "neutral" }, { key: "signed", label: "Signed", icon: "edit", tone: "success" },
  { key: "paid", label: "Paid", icon: "invoice", tone: "success" }, { key: "deleted", label: "Deleted", icon: "close", tone: "danger" },
  { key: "settings", label: "Settings", icon: "settings", tone: "warning" }, { key: "team", label: "Team", icon: "users", tone: "neutral" },
  { key: "export", label: "Exports", icon: "download", tone: "neutral" }, { key: "signin", label: "Sign-ins", icon: "lock", tone: "accent" },
];
const kindOf = (k: string) => KINDS.find((x) => x.key === k) ?? KINDS[0];
const time = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
function dayHead(ms: number) {
  const d = new Date(ms), t = new Date();
  const key = (x: Date) => x.toDateString();
  const y = new Date(t); y.setDate(t.getDate() - 1);
  const md = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return key(d) === key(t) ? `Today · ${md}` : key(d) === key(y) ? `Yesterday · ${md}` : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: d.getFullYear() === t.getFullYear() ? undefined : "numeric" });
}
type Row = { _id: string; at: number; kind: string; who: string; role: string; text: string; where: string | null; link: string | null; device: string | null };

export function ActivityLog() {
  const [kind, setKind] = useState<Kind | null>(null);
  const [who, setWho] = useState<string | null>(null);
  const [limit, setLimit] = useState(50);
  const [open, setOpen] = useState<Row | null>(null);
  const d = useQuery(api.auditLog.list, { ...(kind ? { kind } : {}), ...(who ? { who } : {}), limit });
  const days: Array<{ head: string; rows: Row[] }> = [];
  for (const r of (d?.rows ?? []) as Row[]) {
    const h = dayHead(r.at);
    if (days[days.length - 1]?.head !== h) days.push({ head: h, rows: [] });
    days[days.length - 1].rows.push(r);
  }
  return (
    <>
      <SetHead eyebrow="Settings" title="Activity." sub="Who changed what, and when. Kept for 1 year. Only the owner sees this." />
      <span className="wp-label">Kind</span>
      <div className="qz-chips act-pills" role="group" aria-label="Kind">
        <button type="button" className={`qz-chip${!kind ? " on" : ""}`} aria-pressed={!kind} onClick={() => { setKind(null); setLimit(50); }}>All {d?.counts.all ?? ""}</button>
        {KINDS.map((k) => <button key={k.key} type="button" className={`qz-chip${kind === k.key ? " on" : ""}`} aria-pressed={kind === k.key} onClick={() => { setKind(k.key); setLimit(50); }}>{k.label} {d?.counts[k.key] ?? 0}</button>)}
      </div>
      {!!d?.people.length && <>
        <span className="wp-label">Person</span>
        <div className="qz-chips act-pills" role="group" aria-label="Person">
          <button type="button" className={`qz-chip${!who ? " on" : ""}`} aria-pressed={!who} onClick={() => setWho(null)}>Everyone</button>
          {d.people.map((p) => <button key={p} type="button" className={`qz-chip${who === p ? " on" : ""}`} aria-pressed={who === p} onClick={() => setWho(p)}>{p}</button>)}
        </div>
      </>}
      {d === undefined ? <Card label="Activity"><SkeletonRows n={5} label="Loading activity" /></Card>
        : !days.length ? <EmptyState icon="activity" title={kind || who ? "Nothing matches." : "Nothing yet."} body={kind || who ? "Try another kind or person." : "What you and your team send, sign, pay, delete and change shows here."} />
        : days.map((g) => (
          <Card key={g.head} label={g.head} head={<SectionHead label={g.head} count={g.rows.length} />}>
            {g.rows.map((r) => {
              const k = kindOf(r.kind);
              return <ListRow key={r._id} lead={{ icon: k.icon }} title={`${r.who} ${r.text}`} meta={[time(r.at), r.where, r.device].filter(Boolean).join(" · ")}
                chip={<StatusChip tone={k.tone}>{k.label === "Sign-ins" ? "Sign-in" : k.label === "Exports" ? "Export" : k.label}</StatusChip>} onClick={() => setOpen(r)} chevron />;
            })}
          </Card>
        ))}
      {d?.more && <div className="team-acts"><Button onClick={() => setLimit((n) => n + 50)}>Load earlier</Button></div>}
      {open && (
        <Modal onClose={() => setOpen(null)} label="Activity" width={560}>
          <div className="crm-dialog team-dialog">
            <DialogHeader eyebrow="Activity" title={`${open.who} ${open.text}`} onClose={() => setOpen(null)} />
            <dl className="bc-dl act-dl">
              <dt>Who</dt><dd>{open.who}{open.role ? ` (${open.role})` : ""}</dd>
              <dt>When</dt><dd>{new Date(open.at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</dd>
              {open.device && <><dt>From</dt><dd>{open.device}</dd></>}
              {open.where && <><dt>Where</dt><dd>{open.where}</dd></>}
            </dl>
            <div className="dfoot">
              <button className="btn ghost" type="button" onClick={() => setOpen(null)}>Close</button>
              {open.link && <Button variant="primary" onClick={() => { const l = open.link!; setOpen(null); navigate(l); }}>Open it</Button>}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
