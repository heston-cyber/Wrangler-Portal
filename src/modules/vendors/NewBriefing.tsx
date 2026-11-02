// Phase 3c step 3 · New briefing: who it's for (a booked vendor) and what to start from. No frame: built from the
// existing dialog pattern. Kept apart from Briefings.tsx so the Crew card and booking pages don't load the builder.
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button, ButtonLink, DialogHeader, EmptyState, SkeletonRows } from "../../ui/wp";
import { Modal } from "../../ui/kit";
import { navigate } from "../../lib/router";
import { errText } from "../docs/pages/common";
import { shortRange } from "../../../convex/lib/bookings";

// ---------- New briefing: who it's for, what to start from ----------

export function NewBriefing({ onClose, bookingId, vendorId, templateId, starter }: { onClose: () => void; bookingId?: string; vendorId?: string; templateId?: string; starter?: "shoot" | "edit" }) {
  const bookings = useQuery(api.bookings.list, {});
  const tpls = useQuery(api.briefings.templates, {});
  const create = useMutation(api.briefings.create);
  const open = (bookings ?? []).filter((b) => (b.state === "offered" || b.state === "accepted") && (!vendorId || b.vendorId === vendorId));
  const [bid, setBid] = useState(bookingId ?? "");
  const [from, setFrom] = useState(templateId ? `t:${templateId}` : starter ?? "auto");
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const picked = open.find((b) => b._id === bid) ?? (open.length === 1 ? open[0] : null);
  const go = async () => {
    if (!picked) return;
    setBusy(true); setErr(null);
    try {
      const id = await create({ bookingId: picked._id, ...(from.startsWith("t:") ? { templateId: from.slice(2) as Id<"wsTemplates"> } : from === "shoot" || from === "edit" ? { starter: from } : {}) });
      onClose(); navigate(`/vendors/briefings/${id}`);
    } catch (e) { setErr(errText(e)); setBusy(false); }
  };
  return (
    <Modal onClose={onClose} label="New briefing" width={560}>
      <div className="crm-dialog">
        <DialogHeader eyebrow="Vendors" title="New briefing." body="A shoot or edit brief for someone you've booked. You write it in the builder, then send it to them." onClose={onClose} />
        {bookings === undefined || tpls === undefined ? <SkeletonRows n={3} /> : open.length === 0 ? (
          <EmptyState icon="calendar" title="No one to brief yet." body="Briefings go to vendors booked on a project. Book someone first." actions={<ButtonLink variant="primary" to="/vendors/bookings">Bookings</ButtonLink>} />
        ) : (
          <div className="qz-grid">
            <label className="wp-field qz-q wide"><span className="wp-field-label">Who it's for</span>
              <select className="input" value={picked?._id ?? ""} onChange={(e) => setBid(e.target.value)}>
                {!picked && <option value="" disabled>Pick a booking</option>}
                {open.map((b) => <option key={b._id} value={b._id}>{b.vendor} · {b.role} · {b.project} · {shortRange(b.start, b.end)}</option>)}
              </select></label>
            <label className="wp-field qz-q wide"><span className="wp-field-label">Start from</span>
              <select className="input" value={from} onChange={(e) => setFrom(e.target.value)}>
                <option value="auto">{picked ? `${/edit|colou?r|motion|graphic|post/i.test(picked.role) ? "Edit" : "Shoot"} brief (for a ${picked.role.toLowerCase()})` : "Shoot or Edit brief, by their role"}</option>
                {tpls.starters.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
                {tpls.saved.map((t) => <option key={t._id} value={`t:${t._id}`}>{t.name} (your template)</option>)}
              </select></label>
          </div>
        )}
        {err && <p className="error" role="alert">{err}</p>}
        <div className="dfoot">
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
          <Button variant="primary" loading={busy} disabled={!picked} onClick={() => void go()}>Write the briefing</Button>
        </div>
      </div>
    </Modal>
  );
}

