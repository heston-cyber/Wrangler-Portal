// Settings: your profile for now. Labels, members and connections come with later phases.
import { useState } from "react";
import { useMutation } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Settings as SettingsIcon } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { TopBar } from "../shell/Shell";
import { Avatar, useToast } from "../ui/kit";

export default function Settings({ me }: { me: { name: string | null; email: string } }) {
  const setName = useMutation(api.users.setName);
  const { signOut } = useAuthActions();
  const [name, setN] = useState(me.name ?? "");
  const [toast, show] = useToast();
  const changed = name.trim() !== (me.name ?? "") && name.trim().length > 0;
  return (
    <>
      <TopBar><SettingsIcon size={15} color="var(--text-secondary)" /><span className="here">Settings</span></TopBar>
      <div className="content">
        <div className="settings">
          <div style={{ display: "grid", gap: 8 }}>
            <span className="eyebrow">Account</span>
            <h1 className="headline">Your profile. <span className="rest">The name here goes on every note and reply you leave.</span></h1>
          </div>
          <div className="panel">
            <div className="prow">
              <span className="pl">Name</span>
              <span className="pr">
                <input className="input sm" value={name} onChange={(e) => setN(e.target.value)} placeholder="Heston" aria-label="Name" />
                {changed && <button className="btn primary sm" onClick={async () => { await setName({ name }); show("Name saved"); }}>Save</button>}
              </span>
            </div>
            <div className="prow"><span className="pl">Email</span><span className="pr secondary">{me.email}</span></div>
            <div className="prow"><span className="pl">Picture</span><span className="pr"><Avatar name={name || me.email} size="lg" /></span></div>
          </div>
          <div className="panel">
            <div className="prow">
              <span className="pl">Sign out <span className="secondary" style={{ display: "block", fontSize: 12.5 }}>Ends this session on this device.</span></span>
              <span className="pr"><button className="btn sm" onClick={() => void signOut()}>Sign out</button></span>
            </div>
          </div>
        </div>
      </div>
      {toast}
    </>
  );
}
