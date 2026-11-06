// Phase 5e step 4 (Nov 5): the See all page (823:19778, empty 823:20609, loading 823:21145, phone 824:21520) and
// Settings › Notifications' bell and phone switches (823:21703, not set up 823:22215, blocked 823:22725) with the
// Install (823:23252 iPhone, 823:23312 Android) and Allow alerts (823:23375) dialogs.
import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { BELL_KINDS, BELL_NAMES, type BellKind } from "../../../convex/lib/bell";
import { Button, Card, DialogHeader, EmptyState, ListRow, PageHeader, SectionHead, SkeletonRows, StatusChip, Toggle } from "../../ui/wp";
import { Modal } from "../../ui/kit";
import { linkProps } from "../../lib/router";
import { TopBar, Sep } from "../../shell/Shell";
import { SetHead } from "../settings/Frame";
import { errText } from "../docs/pages/common";
import { currentEndpoint, isAndroid, isIOS, phoneState, turnOff, turnOn, type PhoneState } from "../../lib/push";
import { ICON, NEW, TONE, dayHead, time, useOpenRow, type Row } from "./common";

// ---------- the See all page ----------

export function NotificationsPage() {
  const [kind, setKind] = useState<BellKind | null>(null);
  const [limit, setLimit] = useState(50);
  const d = useQuery(api.bell.feed, { ...(kind ? { kinds: [kind] } : {}), limit });
  const markAll = useMutation(api.bell.markAllRead);
  const openRow = useOpenRow();
  const prefs = useQuery(api.bell.prefs);
  const kinds = prefs ? prefs.kinds.map((k) => k.kind as BellKind) : [...BELL_KINDS];
  const days: Array<{ head: string; rows: Row[] }> = [];
  for (const r of (d?.rows ?? []) as Row[]) {
    const h = dayHead(r.at);
    if (days[days.length - 1]?.head !== h) days.push({ head: h, rows: [] });
    days[days.length - 1].rows.push(r);
  }
  const markAllBtn = <Button disabled={!d?.unread} onClick={() => void markAll({})}>Mark all read</Button>;
  return (
    <>
      <TopBar><a {...linkProps("/")}>Dashboard</a><Sep /><span className="here">Notifications</span></TopBar>
      <div className="wp-page bell-page">
        <PageHeader eyebrow="Your feed" title="Notifications" sub="What happened across your business." actions={markAllBtn} />
        <div className="qz-chips act-pills" role="group" aria-label="Kind">
          <button type="button" className={`qz-chip${!kind ? " on" : ""}`} aria-pressed={!kind} onClick={() => { setKind(null); setLimit(50); }}>All <span className="n">{d?.counts.all ?? ""}</span></button>
          {kinds.map((k) => <button key={k} type="button" className={`qz-chip${kind === k ? " on" : ""}`} aria-pressed={kind === k} onClick={() => { setKind(k); setLimit(50); }}>{BELL_NAMES[k].label} <span className="n">{d?.counts[k] ?? 0}</span></button>)}
        </div>
        {d === undefined ? <Card label="Notifications"><SkeletonRows n={5} label="Loading notifications" /></Card>
          : !days.length ? <EmptyState icon="bell" title="You are all caught up" body="New activity shows up here." />
          : days.map((g) => (
            <Card key={g.head} label={g.head} head={<SectionHead label={g.head} count={g.rows.length} />}>
              {g.rows.map((r) => (
                <ListRow key={r._id} lead={{ icon: ICON[r.kind] }} title={r.title} meta={time(r.at)}
                  chip={r.unread ? NEW : <StatusChip tone={TONE[r.kind]}>{BELL_NAMES[r.kind].label}</StatusChip>} onClick={() => openRow(r)} chevron={!!r.link} />
              ))}
            </Card>
          ))}
        {d?.more && <div className="team-acts"><Button onClick={() => setLimit((n) => n + 50)}>Load earlier</Button></div>}
      </div>
    </>
  );
}

// ---------- Settings › Notifications: the phone card and the bell and phone switches ----------

const added = (t: number) => `added ${new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

export function BellSettings({ show, emails }: { show: (m: string) => void; emails?: React.ReactNode }) {
  const p = useQuery(api.bell.prefs);
  const setPref = useMutation(api.bell.setPref);
  const allOff = useMutation(api.bell.phoneAllOff);
  const subscribe = useMutation(api.bell.subscribe);
  const unsubscribe = useMutation(api.bell.unsubscribe);
  const ensureKey = useAction(api.push.ensureKey);
  const [state, setState] = useState<PhoneState | null>(null);
  const [mine, setMine] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | "install" | "allow">(null);
  const [busy, setBusy] = useState(false);
  const refresh = async () => { setState(await phoneState()); setMine(await currentEndpoint()); };
  useEffect(() => { void refresh(); }, []);
  const devices = p?.devices ?? [];
  const here = devices.find((x) => x.endpoint === mine);
  const others = devices.filter((x) => x.endpoint !== mine);
  const anyPhone = devices.length > 0;

  const allow = async () => {
    setBusy(true);
    try {
      const sub = await turnOn(await ensureKey({}));
      if (!sub) { show("Alerts weren't allowed on this phone."); await refresh(); return; }
      await subscribe(sub);
      show("Alerts are on for this phone.");
      setDialog(null);
      await refresh();
    } catch (e) { show(errText(e)); } finally { setBusy(false); }
  };
  const stop = async () => {
    setBusy(true);
    try { const ep = (await turnOff()) ?? mine; if (ep) await unsubscribe({ endpoint: ep }); show("Alerts are off for this phone."); await refresh(); }
    catch (e) { show(errText(e)); } finally { setBusy(false); }
  };

  let phone: React.ReactNode;
  if (state === null) phone = <SkeletonRows n={1} label="Checking this phone" />;
  else if (state === "on" && here) phone = <ListRow lead={{ icon: "phone" }} title="Alerts on this phone" meta={`${here.label} · ${added(here.createdAt)}`} chip={<StatusChip tone="success">On</StatusChip>} action={<Button size="sm" loading={busy} onClick={() => void stop()}>Turn off</Button>} />;
  else if (state === "blocked") phone = <ListRow lead={{ icon: "phone" }} title="Alerts are blocked on this phone" meta="Allow them in your phone or browser settings." />;
  else if (state === "install") phone = <ListRow lead={{ icon: "phone" }} title="Get alerts on your phone" meta="Add the portal to your home screen first, then turn alerts on." action={<Button size="sm" onClick={() => setDialog("install")}>How to install</Button>} />;
  else if (state === "unsupported") phone = <ListRow lead={{ icon: "phone" }} title="Get alerts on your phone" meta="This browser can't show alerts. Open the portal on your phone to turn them on." action={<Button size="sm" onClick={() => setDialog("install")}>How to install</Button>} />;
  else phone = <ListRow lead={{ icon: "phone" }} title={isIOS() || isAndroid() ? "Get alerts on this phone" : "Get alerts on this computer"} meta="You choose which kinds below." action={<Button size="sm" variant="primary" onClick={() => setDialog("allow")}>Turn on alerts</Button>} />;

  return (
    <>
      <SetHead title="Notifications." sub={emails ? "Choose what reaches your bell and your phone. The email switches are below." : "Choose what reaches your bell and your phone."} />
      <Card label="Phone alerts" head={<SectionHead label="Phone alerts" />}>
        {phone}
        {others.map((x) => <ListRow key={x.endpoint} lead={{ icon: "phone" }} title={x.label} meta={`Alerts on · ${added(x.createdAt)}`} action={<Button size="sm" variant="ghost" onClick={() => void unsubscribe({ endpoint: x.endpoint }).then(() => show("Alerts are off for that device."), (e) => show(errText(e)))}>Remove</Button>} />)}
      </Card>
      <Card label="What you get" head={<SectionHead label="What you get" action={<button type="button" className="bell-link" disabled={!p?.kinds.some((k) => k.phone)} onClick={() => void allOff({}).then(() => show("Phone alerts are off. The bell still shows everything."))}>Turn all off</button>} />}>
        <div className="bell-table" role="table" aria-label="What you get">
          <div className="bell-trow head" role="row"><span role="columnheader">Kind</span><span role="columnheader">In the bell</span><span role="columnheader">On your phone</span></div>
          {!p ? <SkeletonRows n={4} /> : p.kinds.map((k) => (
            <div key={k.kind} className="bell-trow" role="row">
              <span role="cell">{BELL_NAMES[k.kind as BellKind].row}</span>
              <span role="cell"><Toggle label={`${BELL_NAMES[k.kind as BellKind].row} in the bell`} checked={k.bell} onChange={(on) => void setPref({ kind: k.kind as BellKind, bell: on }).catch((e) => show(errText(e)))} /></span>
              <span role="cell"><Toggle label={`${BELL_NAMES[k.kind as BellKind].row} on your phone`} checked={anyPhone && k.phone} disabled={!anyPhone} onChange={(on) => void setPref({ kind: k.kind as BellKind, phone: on }).catch((e) => show(errText(e)))} /></span>
            </div>
          ))}
        </div>
      </Card>
      {emails}
      {dialog === "install" && <InstallDialog onClose={() => setDialog(null)} />}
      {dialog === "allow" && <AllowDialog busy={busy} onAllow={() => void allow()} onClose={() => setDialog(null)} />}
    </>
  );
}

function InstallDialog({ onClose }: { onClose: () => void }) {
  const android = isAndroid();
  const host = typeof location === "undefined" ? "app.wranglerportal.com" : location.host;
  const steps = android
    ? [`Open ${host} in Chrome.`, "Tap the menu (three dots).", "Choose Install app, then Install.", "Open the portal from its icon and come back here to turn alerts on."]
    : [`Open ${host} in Safari.`, "Tap the Share button.", "Choose Add to Home Screen, then Add.", "Open the portal from its icon and come back here to turn alerts on."];
  return (
    <Modal onClose={onClose} label="Add the portal to your home screen" width={680}>
      <div className="crm-dialog team-dialog">
        <DialogHeader eyebrow="Phone alerts" title="Add the portal to your home screen" body="Alerts only work from the app icon, not from a browser tab." onClose={onClose} />
        <ol className="bell-steps">{steps.map((s, i) => <li key={i}><span className="n">{i + 1}</span><span>{s}</span></li>)}</ol>
        <div className="dfoot"><span /><Button variant="primary" onClick={onClose}>Got it</Button></div>
      </div>
    </Modal>
  );
}

function AllowDialog({ busy, onAllow, onClose }: { busy: boolean; onAllow: () => void; onClose: () => void }) {
  return (
    <Modal onClose={onClose} label="Allow alerts on this phone?" width={640}>
      <div className="crm-dialog team-dialog">
        <DialogHeader eyebrow="Phone alerts" title="Allow alerts on this phone?" body="Your phone will ask next. You choose which kinds in Settings › Notifications, and you can turn them off any time." onClose={onClose} />
        <div className="dfoot"><button className="btn ghost" type="button" onClick={onClose}>Not now</button><Button variant="primary" loading={busy} onClick={onAllow}>Allow alerts</Button></div>
      </div>
    </Modal>
  );
}
