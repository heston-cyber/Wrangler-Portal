// Phase 5e step 1 (Nov 5): Project page › Assigned people (frames 815:13538 owner, 815:14202 only you, 815:14790 Producer).
// Team members only (D146). Everyone who can open the project sees who's on it; only the owner assigns.
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button, Card, Checkbox, DialogHeader, ListRow, SectionHead, StatusChip } from "../../ui/wp";
import { Modal } from "../../ui/kit";
import { errText } from "../docs/pages/common";
import { ROLE_NAMES, type TeamRole } from "../../../convex/lib/perms";

export function AssignedCard({ projectId }: { projectId: Id<"projects"> }) {
  const d = useQuery(api.team.projectPeople, { projectId });
  const [open, setOpen] = useState(false);
  if (!d) return null;
  if (!d.people.length && !d.candidates.length) return null; // no team yet: nothing to show
  return (
    <Card className="pj-assigned" label="Assigned to this project" head={<SectionHead label="Assigned to this project" count={d.people.length || undefined} action={d.canAssign ? <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Assign people</Button> : undefined} />}>
      {d.people.length === 0 ? <p className="pj-pad secondary">Nobody else is on this project.</p>
        : d.people.map((p) => <ListRow key={p.userId} lead={{ avatar: p.name, two: true }} title={p.name} chip={<StatusChip tone="neutral">{ROLE_NAMES[p.role as TeamRole]}</StatusChip>} />)}
      {open && <AssignDialog projectId={projectId} people={d.people.map((p) => p.userId)} candidates={d.candidates} onClose={() => setOpen(false)} />}
    </Card>
  );
}

function AssignDialog({ projectId, people, candidates, onClose }: { projectId: Id<"projects">; people: Id<"users">[]; candidates: Array<{ userId: Id<"users">; name: string; role: string }>; onClose: () => void }) {
  const assign = useMutation(api.team.assign);
  const [picked, setPicked] = useState<Set<string>>(new Set(people));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setErr(null);
    try { await assign({ projectId, userIds: [...picked] as Id<"users">[] }); onClose(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} label="Assign people" width={520}>
      <div className="crm-dialog team-dialog">
        <DialogHeader eyebrow="Project" title="Assign people" body="Pick who works on this project. Editors see only the projects they're assigned to." onClose={onClose} />
        <div className="team-picks">
          {candidates.map((c) => <Checkbox key={c.userId} checked={picked.has(c.userId)} label={c.name} hint={ROLE_NAMES[c.role as TeamRole]}
            onChange={(on) => setPicked((s) => { const n = new Set(s); if (on) n.add(c.userId); else n.delete(c.userId); return n; })} />)}
        </div>
        {err && <p className="error" role="alert">{err}</p>}
        <div className="dfoot">
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}
