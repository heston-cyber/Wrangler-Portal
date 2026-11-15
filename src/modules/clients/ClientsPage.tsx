// Clients (P1 / Owner / Clients): every client with its people, projects and what's waiting on them.
import { TopBar } from "../../shell/Shell";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button, ButtonLink, Card, Divider, EmptyState, ListRow, PageHeader, SkeletonRows, StatusChip } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { useToast } from "../../ui/kit";
import { NewClient } from "../review/Projects";
import { SelectList, type ItemSpec } from "../../ui/hold";
import type { Id } from "../../../convex/_generated/dataModel";

type ClientRow = NonNullable<ReturnType<typeof useQuery<typeof api.clients.directory>>>[number];
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "1 to sign · 1 to review", only the parts above zero (Heston, Oct 29). */
export function waitingText(c: { toSign: number; toReview: number }) {
  return [c.toSign > 0 && `${c.toSign} to sign`, c.toReview > 0 && `${c.toReview} to review`].filter(Boolean).join(" · ");
}

/** D177 (Heston, Nov 15): a client row's options. A client page is only for the owner, so no Share or Copy link;
 *  "Add follow-up" asks for a date once, whether it's one client or several selected. */
export function clientMenu(c: { _id: string; name: string }, add: (a: { who: string; about: string; due: string; clientId: Id<"clients"> }) => unknown): ItemSpec {
  return {
    id: c._id, title: c.name, noShare: true,
    actions: [{
      key: "followup", label: "Add follow-up", bulk: "Add follow-up", icon: <Icon name="calendar-plus" size={16} />,
      form: {
        title: (n) => (n === 1 ? `Add a follow-up for ${c.name}` : `Add a follow-up for ${n} clients`),
        fields: [{ key: "about", label: "About", optional: true, placeholder: "Follow up" }, { key: "due", label: "Due", type: "date" }],
        yes: (n) => (n === 1 ? "Add follow-up" : `Add ${n} follow-ups`),
      },
      run: (v) => add({ who: c.name, about: v?.about?.trim() || "Follow up", due: v?.due ?? "", clientId: c._id as Id<"clients"> }),
      done: "Follow-up added.",
      doneMany: (ok) => `Added ${ok} follow-up${ok === 1 ? "" : "s"}.`,
    }],
  };
}

function Row({ c, add }: { c: ClientRow; add: Parameters<typeof clientMenu>[1] }) {
  const waiting = waitingText(c);
  const people = plural(c.people, "person", "people"), projects = plural(c.projects, "project", "projects");
  return (
    <ListRow to={`/clients/${c._id}`} lead={{ avatar: c.name, two: true }} title={c.name} menu={clientMenu(c, add)}
      meta={<><span className="pc-only">{people} · {projects}</span><span className="ph-only">{people} · {waiting || projects}</span></>}
      chip={waiting ? <span className="pc-only"><StatusChip tone="warning">{waiting}</StatusChip></span> : undefined} chevron />
  );
}

export default function ClientsPage() {
  const clients = useQuery(api.clients.directory);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [toast, show] = useToast();
  const addFollowUp = useMutation(api.crm.addFollowUp);
  const needle = q.trim().toLowerCase();
  const rows = (clients ?? []).filter((c) => !needle || c.name.toLowerCase().includes(needle));
  return (
    <>
      {/* Phase 5f: the glass top bar (desktop); one crumb, so it fades in as the title scrolls under it */}
      <TopBar className="deskonly"><span className="here">Clients</span></TopBar>
      <div className="wp-page notop wp-clients">
        <PageHeader title="Clients." actions={<Button variant="primary" icon="plus" onClick={() => setAdding(true)}>New client</Button>} />
        <label className="ws-search wp-clientsearch">
          <Icon name="search" size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients" aria-label="Search clients" />
        </label>
        {clients === undefined ? <Card label="Clients"><SkeletonRows n={4} /></Card>
          : clients.length === 0 ? (
            <EmptyState icon="users" title="No clients yet." body="Add one, or share a cut to start."
              actions={<><Button variant="primary" icon="plus" onClick={() => setAdding(true)}>New client</Button><ButtonLink to="/review">Share a cut</ButtonLink></>} />
          ) : rows.length === 0 ? (
            <EmptyState icon="search" title="No clients match." body={`Nothing called “${q.trim()}”.`} />
          ) : (
            <SelectList name="clients">
              <Card label="Clients">
                {rows.map((c, i) => <div key={c._id} className="wp-rowwrap">{i > 0 && <Divider />}<Row c={c} add={addFollowUp} /></div>)}
              </Card>
            </SelectList>
          )}
        {adding && <NewClient onClose={() => setAdding(false)} onDone={() => { setAdding(false); show("Client added."); }} />}
        {toast}
      </div>
    </>
  );
}
