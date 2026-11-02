// Phase 4 (Nov 2): Settings › Calendar (frame 741:1953). Each business connects its own Google account, picks the
// calendar shoots go on, and whether booked vendors and the client are invited (D32). Google's own sign-in page does
// the connecting; the portal keeps only the tokens, in the backend.
import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button, Checkbox, SkeletonRows, StatusChip } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { useLocation } from "../../lib/router";
import { errText } from "../docs/pages/common";
import { SetHead } from "./Frame";

type Cal = { id: string; name: string; primary: boolean };

export function CalendarSettings({ show }: { show: (m: string) => void }) {
  const s = useQuery(api.calendar.settings, {});
  const authUrl = useAction(api.calendar.authUrl);
  const list = useAction(api.calendar.calendars);
  const save = useMutation(api.calendar.save);
  const disconnect = useAction(api.calendar.disconnect);
  const { search } = useLocation();
  const [cals, setCals] = useState<Cal[] | null>(null);
  const [pick, setPick] = useState<string>("");
  const [vendors, setVendors] = useState(true), [client, setClient] = useState(false);
  const [busy, setBusy] = useState<null | "connect" | "save" | "off">(null);
  const [err, setErr] = useState<string | null>(null);
  const said = useRef(false);
  const conn = s?.connection ?? null;
  // Back from Google's page.
  useEffect(() => {
    if (said.current) return;
    const q = new URLSearchParams(search);
    const r = q.get("calendar");
    if (!r) return;
    said.current = true;
    show(r === "connected" ? "Google Calendar is connected. Pick the calendar shoots go on." : `Google Calendar didn't connect: ${q.get("reason") ?? "try again"}`);
    history.replaceState(null, "", "/settings/calendar");
  }, [search, show]);
  useEffect(() => {
    if (!conn) { setCals(null); return; }
    setVendors(conn.inviteVendors); setClient(conn.inviteClient); setPick(conn.calendarId ?? "");
    let live = true;
    list({}).then((c) => { if (!live) return; setCals(c); if (!conn.calendarId) setPick(c.find((x) => x.primary)?.id ?? c[0]?.id ?? ""); }, (e) => live && setErr(errText(e)));
    return () => { live = false; };
  }, [conn?.email, conn?.calendarId, conn?.inviteVendors, conn?.inviteClient, list]); // eslint-disable-line react-hooks/exhaustive-deps

  const head = <SetHead eyebrow="Calendar" title="Shoots on your calendar." sub="Each business picks its own calendar. Shoots you schedule go on it, and move when you move them." />;
  if (s === undefined) return <>{head}<div className="panel"><SkeletonRows n={3} /></div></>;
  if (s === null) return null;
  const connect = async () => { setBusy("connect"); setErr(null); try { window.location.assign(await authUrl({})); } catch (e) { setErr(errText(e)); setBusy(null); } };
  if (!conn) return (
    <>
      {head}
      <div className="panel pay-card">
        <span className="wp-eyebrow">Google Calendar</span>
        <dl className="pay-rows"><dt>Status</dt><dd><StatusChip tone="neutral">Not connected</StatusChip></dd></dl>
        {s.keys ? <p className="secondary pay-note">Sign in with the Google account whose calendar you use. Shoots you tick "Add to your calendar" go on it, and booked vendors can get the invite.</p>
          : <p className="secondary pay-note">Waiting on the portal's Google sign-in keys in Convex. Until then, shoots save without a calendar event.</p>}
        {err && <p className="error" role="alert">{err}</p>}
        <Button variant="primary" loading={busy === "connect"} disabled={!s.keys} onClick={() => void connect()}>Connect Google Calendar</Button>
      </div>
    </>
  );
  const changed = pick !== (conn.calendarId ?? "") || vendors !== conn.inviteVendors || client !== conn.inviteClient;
  const onSave = async () => {
    setBusy("save"); setErr(null);
    try { await save({ calendarId: pick, calendarName: cals?.find((c) => c.id === pick)?.name ?? pick, inviteVendors: vendors, inviteClient: client }); show("Saved."); } catch (e) { setErr(errText(e)); } finally { setBusy(null); }
  };
  return (
    <>
      {head}
      <div className="panel pay-card cal-card">
        <span className="wp-eyebrow">Google Calendar</span>
        <div className="cal-who"><Icon name="calendar" size={18} /><span>Connected as {conn.email}</span><StatusChip tone="success">Connected</StatusChip></div>
        {conn.lastError && <p className="wp-small cal-err">{conn.lastError}</p>}
        <label className="wp-field"><span className="wp-field-label">Put shoots on</span>
          <select className="input" value={pick} disabled={!cals} onChange={(e) => setPick(e.target.value)}>
            {!cals && <option value="">Loading your calendars…</option>}
            {cals?.map((c) => <option key={c.id} value={c.id}>{c.name}{c.primary ? " (main)" : ""}</option>)}
          </select></label>
        <Checkbox checked={vendors} onChange={setVendors} label="Invite booked vendors to the calendar event" hint="Uses their email from Vendors." />
        <Checkbox checked={client} onChange={setClient} label="Invite the client contact" hint="Everyone at the client who can open the project gets Google's invite." />
        {err && <p className="error" role="alert">{err}</p>}
        <Button variant="ghost" loading={busy === "off"} className="cal-off" onClick={async () => { setBusy("off"); try { await disconnect({}); show("Disconnected. Events already on your calendar stay there."); } catch (e) { setErr(errText(e)); } finally { setBusy(null); } }}>Disconnect</Button>
      </div>
      <Button variant="primary" loading={busy === "save"} disabled={!pick || !changed} onClick={() => void onSave()}>Save</Button>
    </>
  );
}
