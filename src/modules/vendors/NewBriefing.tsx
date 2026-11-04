// Phase 3c step 3 · New briefing: what to start from. D147 (Nov 4): no booking needed. The project is optional, and
// who it goes to is picked in the builder (Send to). Started from a booking or a vendor's page, that vendor is put in
// Send to. No frame: built from the existing dialog pattern. Kept apart from Briefings.tsx so the Crew card and booking
// pages don't load the builder.
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button, DialogHeader, SkeletonRows } from "../../ui/wp";
import { Modal } from "../../ui/kit";
import { navigate } from "../../lib/router";
import { errText } from "../docs/pages/common";
import { shortRange } from "../../../convex/lib/bookings";

export function NewBriefing({ onClose, bookingId, vendorId, templateId, starter }: { onClose: () => void; bookingId?: string; vendorId?: string; templateId?: string; starter?: "shoot" | "edit" }) {
  const bookings = useQuery(api.bookings.list, {});
  const form = useQuery(api.bookings.form, {});
  const tpls = useQuery(api.briefings.templates, {});
  const create = useMutation(api.briefings.create);
  const setDetails = useMutation(api.briefings.setDetails);
  const open = (bookings ?? []).filter((b) => (b.state === "offered" || b.state === "accepted") && (!vendorId || b.vendorId === vendorId));
  // From a booking (or a vendor with one booking): that booking. Otherwise a project, or none.
  const [bid, setBid] = useState(bookingId ?? "");
  const [pid, setPid] = useState("");
  const [from, setFrom] = useState(templateId ? `t:${templateId}` : starter ?? "auto");
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const picked = open.find((b) => b._id === bid) ?? null;
  const vendor = vendorId ? form?.vendors.find((x) => x._id === vendorId) ?? null : null;
  const go = async () => {
    setBusy(true); setErr(null);
    try {
      const start = from.startsWith("t:") ? { templateId: from.slice(2) as Id<"wsTemplates"> } : from === "shoot" || from === "edit" ? { starter: from as "shoot" | "edit" } : {};
      const id = picked ? await create({ bookingId: picked._id, ...start }) : await create({ ...(pid ? { projectId: pid as Id<"projects"> } : {}), ...start });
      if (!picked && vendor) await setDetails({ briefingId: id, projectId: (pid || null) as Id<"projects"> | null, sendTo: [{ vendorId: vendor._id, email: "" }] }).catch(() => undefined);
      onClose(); navigate(`/vendors/briefings/${id}`);
    } catch (e) { setErr(errText(e)); setBusy(false); }
  };
  const auto = picked ? `${/edit|colou?r|motion|graphic|post/i.test(picked.role) ? "Edit" : "Shoot"} brief (for a ${picked.role.toLowerCase()})` : "Shoot brief";
  return (
    <Modal onClose={onClose} label="New briefing" width={560}>
      <div className="crm-dialog">
        <DialogHeader eyebrow="Vendors" title="New briefing." body="A shoot or edit brief. Write it in the builder, pick who it goes to there (vendors, booked or not, or any email), then Share it." onClose={onClose} />
        {bookings === undefined || tpls === undefined || form === undefined ? <SkeletonRows n={3} /> : (
          <div className="qz-grid">
            {open.length > 0 && <label className="wp-field qz-q wide"><span className="wp-field-label">From a booking (optional)</span>
              <select className="input" value={bid} onChange={(e) => setBid(e.target.value)}>
                <option value="">No booking</option>
                {open.map((b) => <option key={b._id} value={b._id}>{b.vendor} · {b.role} · {b.project} · {shortRange(b.start, b.end)}</option>)}
              </select></label>}
            {!picked && <label className="wp-field qz-q wide"><span className="wp-field-label">Project (optional)</span>
              <select className="input" value={pid} onChange={(e) => setPid(e.target.value)}>
                <option value="">No project</option>
                {form.projects.map((p) => <option key={p._id} value={p._id}>{p.label}</option>)}
              </select></label>}
            <label className="wp-field qz-q wide"><span className="wp-field-label">Start from</span>
              <select className="input" value={from} onChange={(e) => setFrom(e.target.value)}>
                <option value="auto">{auto}</option>
                {tpls.starters.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
                {tpls.saved.map((t) => <option key={t._id} value={`t:${t._id}`}>{t.name} (your template)</option>)}
              </select></label>
          </div>
        )}
        {err && <p className="error" role="alert">{err}</p>}
        <div className="dfoot">
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
          <Button variant="primary" loading={busy} disabled={bookings === undefined || tpls === undefined || form === undefined} onClick={() => void go()}>Write the briefing</Button>
        </div>
      </div>
    </Modal>
  );
}
