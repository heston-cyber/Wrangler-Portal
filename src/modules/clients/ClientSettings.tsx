// The client's Settings (P1 / Client / Settings): their name, email, password, Sign out, and (Nov 2) Notifications.
import { useState } from "react";
import { SignInRows } from "../security/Security";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "../../ui/wp";
import { NotificationList } from "../settings/Notifications";
import { useToast } from "../../ui/kit";
import { TopBar } from "../../shell/Shell";
import { linkProps } from "../../lib/router";
import { useSignOutAsk } from "../../shell/SignOut";

export default function ClientSettings({ me }: { me: { name: string | null; email: string } }) {
  const [signOut, signOutDialog] = useSignOutAsk();
  const setName = useMutation(api.users.setName);
  const ntf = useQuery(api.notifications.client, {});
  const setNtf = useMutation(api.notifications.setClient);
  const brands = useQuery(api.business.brand);
  const business = brands?.[0]?.name ?? "Wrangler Productions";
  const [name, setN] = useState(me.name ?? "");
  const [toast, show] = useToast();
  const changed = name.trim() !== (me.name ?? "") && name.trim().length > 0;
  return (
    <>
      <TopBar><span className="here">Settings</span></TopBar>
      <div className="wp-page cset">
        <header className="wp-sethead"><span className="wp-eyebrow">Settings</span><h1 className="wp-h3">Your account.</h1></header>
        <section className="wp-card glass cset-rows" aria-label="Your account">
          <div className="r">
            <span className="l"><b>Your name</b><span>Shown on the notes you leave.</span></span>
            <span className="v">
              <input className="input" value={name} onChange={(e) => setN(e.target.value)} placeholder="Your name" aria-label="Your name" maxLength={60} />
              <Button size="sm" disabled={!changed} onClick={async () => { await setName({ name }); show("Name saved."); }}>Save</Button>
            </span>
          </div>
          {/* Phase 5e step 2 (842:11010): Password and Email, with the same dialogs as Settings › Security */}
          <SignInRows rows show={show} />
          <div className="r"><span className="l"><b>Help</b><span>Short guides: signing, paying, uploading and more.</span></span><span className="v"><a className="btn sm" {...linkProps("/help")}>Open Help</a></span></div>
          <div className="r"><span className="l"><b>Sign out</b></span><span className="v"><Button size="sm" onClick={signOut}>Sign out</Button></span></div>{signOutDialog}
        </section>
        {/* Nov 2: every email, each with its own switch (it replaces the one "Email me when something new arrives" switch) */}
        <header className="wp-sethead cset-ntf"><span className="wp-eyebrow">Notifications</span><h2 className="wp-h4">The emails you get.</h2>
          <p className="wp-body">{`Each one is on until you switch it off. Bills and documents from ${business} always arrive.`}</p></header>
        <NotificationList className="wp-card glass" items={ntf?.items} onToggle={async (key, on) => { await setNtf({ key, on }); show(on ? "On." : "Off. You won't get these emails."); }} />
      </div>
      {toast}
    </>
  );
}
