// Dev only (never in the live build): every Phase 1 component and both shells with sample data, so the build can be
// checked against the Figma frames without signing in. /__kit, /__kit/owner, /__kit/owner-docs, /__kit/client.
import { useState } from "react";
import { ShellFrame, TopBar, Sep } from "../shell/Shell";
import { Icon, ICON_NAMES } from "../ui/Icon";
import {
  Avatar, Badge, Button, Card, Checkbox, DialogHeader, Divider, EmptyState, IconButton, InboxItem, ListRow, PageHeader,
  PillTabs, SectionHead, Segmented, SkeletonRows, StatusChip, Tabs, TextArea, TextField, Toggle,
} from "../ui/wp";
import { useLocation } from "../lib/router";
import wpLogo from "../assets/d1/wp-logo.png";

const me = { name: "Heston Hill", email: "heston@wranglerproductions.com" };
const client = { name: "Maya Brooks", email: "maya@harborcoffee.com" };
const recent = [
  { _id: "a", title: "Spirit Days Intro", thumb: null },
  { _id: "b", title: "LC Arizona", thumb: null },
  { _id: "c", title: "Harbor Coffee 30s", thumb: null },
  { _id: "d", title: "Northline Teaser", thumb: null },
];

export default function Kit() {
  const { path } = useLocation();
  if (path.startsWith("/__kit/owner")) {
    return (
      <ShellFrame me={me} side="owner" overlay={false} light logo={wpLogo} bizName="Wrangler Productions" shared={[]} unread={0} recent={recent} search={false}>
        <TopBar><a href="/__kit/owner">Review</a><Sep /><span className="here">Projects</span></TopBar>
        <div className="wp-page"><SamplePage /></div>
      </ShellFrame>
    );
  }
  if (path.startsWith("/__kit/client")) {
    return (
      <ShellFrame me={client} side="client" overlay={false} light logo={wpLogo} bizName="Wrangler Productions" subtitle="Harbor Coffee"
        shared={[{ to: "/s/x1", label: "26127 Harbor Coffee Launch" }, { to: "/s/x2", label: "26122 Spirit Days" }]} unread={2} recent={[]} search={false}>
        <TopBar><a href="/__kit/client">Review</a><Sep /><span className="here">26127 Harbor Coffee Launch</span></TopBar>
        <div className="wp-page"><SamplePage client /></div>
      </ShellFrame>
    );
  }
  return <Gallery />;
}

function SamplePage({ client: isClient }: { client?: boolean }) {
  const [tab, setTab] = useState<"unread" | "all">("unread");
  return (
    <>
      <PageHeader eyebrow={isClient ? "Harbor Coffee" : undefined} title={isClient ? "Shared with you." : "Projects."} sub="Every project, newest first." actions={!isClient && <><Button>New project</Button><Button variant="primary" icon="upload">Upload</Button></>} />
      <PillTabs label="Show" value={tab} onChange={setTab} items={[{ key: "unread", label: "Unread", count: 2 }, { key: "all", label: "All" }]} />
      <Card head={<SectionHead label="Needs you" count={3} action={<Button variant="ghost" size="sm">See all</Button>} />}>
        <InboxItem icon="video" title="New version: Harbor Coffee 30s v4" detail="26127 Harbor Coffee Launch · ready to review" time="Today" unread />
        <Divider />
        <InboxItem icon="sign" title="Sign: Service Agreement WS-00012" detail="Sent by Wrangler Productions" time="Yesterday" unread action={<Button size="sm" variant="primary">Sign</Button>} />
        <Divider />
        <InboxItem icon="note" title="Heston replied to your note" detail="“Pulled the logo up two frames.”" time="Mon" status="Read · emailed" />
      </Card>
      <Card head={<SectionHead label="Videos" count={4} />}>
        <ListRow lead={{ thumb: null }} title="Harbor Coffee 30s" titleChip={<StatusChip>Draft</StatusChip>} meta="v4 · updated 2 hours ago" chip={<StatusChip tone="neutral">In review</StatusChip>} chevron to="/__kit/owner" />
        <Divider />
        <ListRow lead={{ icon: "folder" }} title="26122 Spirit Days" meta="3 videos" trailing="Oct 22" chevron to="/__kit/owner" />
        <Divider />
        <ListRow lead={{ avatar: "Maya Brooks" }} title="Maya Brooks" meta="maya@harborcoffee.com" chip={<StatusChip tone="success">Active</StatusChip>} action={<Button size="sm">Invite</Button>} />
        <Divider />
        <SkeletonRows n={1} />
      </Card>
      <EmptyState title="Nothing to sign." body="When Wrangler Productions sends you a document, it shows up here." actions={<Button variant="primary">Open Inbox</Button>} />
    </>
  );
}

function Gallery() {
  const [on, setOn] = useState(true);
  const [ck, setCk] = useState(true);
  const [t, setT] = useState<"a" | "b" | "c">("a");
  return (
    <div className="wp-shell" style={{ overflow: "auto", display: "block" }}>
      <div className="wp-light back" aria-hidden />
      <div style={{ padding: 40, display: "grid", gap: 32, maxWidth: 1100 }}>
        <PageHeader eyebrow="Components" title="Wrangler Portal kit." sub="The Phase 1 components, matched to 02 · Components." />
        <Section title="Buttons">
          <div style={row}>
            <Button variant="primary">Primary</Button><Button>Secondary</Button><Button variant="ghost">Ghost</Button><Button variant="danger">Delete</Button>
            <Button variant="primary" disabled>Disabled</Button><Button variant="primary" loading>Loading</Button>
          </div>
          <div style={row}>
            <Button variant="primary" size="sm">Primary</Button><Button size="sm">Secondary</Button><Button variant="ghost" size="sm">Ghost</Button><Button size="sm" loading>Saving</Button>
            <IconButton icon="more" label="More" /><IconButton icon="more" label="On" on /><IconButton icon="more" label="Disabled" disabled /><IconButton icon="more" label="Touch" touch />
          </div>
        </Section>
        <Section title="Fields">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 20 }}>
            <TextField label="Label" placeholder="Placeholder" />
            <TextField label="With hint" defaultValue="Value" hint="Hint text." />
            <TextField label="With error" defaultValue="nope" error="Enter a valid email." />
            <TextField label="Disabled" defaultValue="Value" disabled />
            <TextArea label="Message" placeholder="Write a note…" />
          </div>
          <div style={row}>
            <Toggle checked={on} onChange={setOn} label="Emails" /><Toggle checked={!on} onChange={(v) => setOn(!v)} label="Off" /><Toggle checked disabled onChange={() => {}} label="Disabled" />
            <Checkbox checked={ck} onChange={setCk} label="Label" /><Checkbox checked={!ck} onChange={(v) => setCk(!v)} label="Label" hint="Hint" />
          </div>
        </Section>
        <Section title="Tabs">
          <Tabs label="Tabs" value={t} onChange={setT} items={[{ key: "a", label: "To sign", count: 2 }, { key: "b", label: "Signed" }, { key: "c", label: "Cancelled" }]} />
          <PillTabs label="Pills" value={t} onChange={setT} items={[{ key: "a", label: "Unread" }, { key: "b", label: "All" }, { key: "c", label: "Drafts" }]} />
          <Segmented label="Segment" value={t} onChange={setT} items={[{ key: "a", label: "Day" }, { key: "b", label: "Week" }, { key: "c", label: "Month" }]} />
        </Section>
        <Section title="Chips, badges, avatars">
          <div style={row}>
            <StatusChip>To sign</StatusChip><StatusChip tone="success">Signed</StatusChip><StatusChip tone="warning">Expires soon</StatusChip><StatusChip tone="neutral">Draft</StatusChip><StatusChip tone="danger">Cancelled</StatusChip>
            <Badge n={3} /><span className="wp-dot" /><Avatar name="Heston" /><Avatar name="Maya" size={36} />
          </div>
        </Section>
        <Section title="Dialog header">
          <div className="dialog" style={{ width: 520 }}>
            <DialogHeader eyebrow="Client" title="New client." body="Add its projects next." onClose={() => {}} />
            <TextField label="Client name" placeholder="Floor Trader" />
            <div className="dfoot"><Button variant="ghost">Cancel</Button><Button variant="primary">Add client</Button></div>
          </div>
        </Section>
        <Section title={`Icons (${ICON_NAMES.length})`}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
            {ICON_NAMES.map((n) => <span key={n} title={n} style={{ display: "grid", justifyItems: "center", gap: 6, width: 72 }}><Icon name={n} /><span className="wp-small" style={{ fontSize: 10 }}>{n}</span></span>)}
          </div>
        </Section>
        <Section title="Toast">
          <div style={row}>
            <div className="toast" style={{ position: "static", transform: "none", animation: "none" }}><Icon name="check-circle" size={18} />Saved</div>
            <div className="toast error" style={{ position: "static", transform: "none", animation: "none" }}><Icon name="alert" size={18} />Couldn't save</div>
          </div>
        </Section>
      </div>
    </div>
  );
}
const row: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" };
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section style={{ display: "grid", gap: 16 }}><h2 className="wp-h4">{title}</h2>{children}</section>;
}
