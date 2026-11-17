// 5m (D199): a client's tasks on their Home (with Done) and a vendor's on theirs. Kept apart from Work so the portals
// don't load Work's pages.
import { useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useToast } from "../../ui/kit";
import { Button, Card, Divider, ListRow, SectionHead, StatusChip } from "../../ui/wp";
import { errLine } from "../../ui/hold";

const dayText = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "numeric", day: "numeric" });

// ---------- the client's Home and the vendor's Home (D199) ----------

export function ClientTaskRows({ onCount }: { onCount?: (n: number) => void }) {
  const ts = useQuery(api.work.forClient);
  const done = useMutation(api.work.clientDone);
  const [toast, show] = useToast();
  const open = (ts ?? []).filter((t) => t.status !== "done");
  useEffect(() => { onCount?.(open.length); }, [open.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open.length) return toast;
  return (
    <>
      {open.map((t) => (
        <div key={t._id} className="wp-rowwrap"><Divider />
          <ListRow className="ilead" lead={{ icon: "work" }} title={t.title} meta={`A task from ${t.from ?? "your producer"}${t.project ? ` · ${t.project}` : ""}${t.due ? ` · due ${dayText(t.due)}` : ""}`}
            chip={<span className="pc-only"><StatusChip tone="accent">Task</StatusChip></span>} action={<Button size="sm" variant="primary" onClick={() => void done({ taskId: t._id, done: true }).then(() => show("Done. Thanks!"), (e) => show(errLine(e)))}>Done</Button>} />
        </div>
      ))}
      {toast}
    </>
  );
}

export function VendorTasksCard({ businessId, from }: { businessId: Id<"businesses"> | null; from: string }) {
  const ts = useQuery(api.work.forVendor, businessId ? { businessId } : "skip");
  const done = useMutation(api.work.vendorDone);
  const [toast, show] = useToast();
  const open = (ts ?? []).filter((t) => t.status !== "done");
  if (!open.length) return toast;
  return (
    <>
      <Card label={`Tasks from ${from}`} head={<SectionHead label={`Tasks from ${from}`} count={open.length} />}>
        {open.map((t, i) => <div key={t._id} className="wp-rowwrap">{i > 0 && <Divider />}
          <ListRow className="ilead" lead={{ icon: "work" }} title={t.title} meta={[t.project, t.due ? `due ${dayText(t.due)}` : null].filter(Boolean).join(" · ")} action={<Button size="sm" variant="primary" onClick={() => void done({ businessId: businessId ?? undefined, taskId: t._id, done: true }).then(() => show("Done."), (e) => show(errLine(e)))}>Done</Button>} /></div>)}
      </Card>
      {toast}
    </>
  );
}
