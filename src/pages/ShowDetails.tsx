// Show details (R2b): switch each field on or off and drag to reorder. Saved to the account as you go.
import { useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, X } from "lucide-react";
import { Modal } from "../ui/kit";
import { DEFAULT_FIELDS, FIELDS, type FieldKey } from "../lib/details";

export function ShowDetails({ fields, onChange, onClose }: { fields: FieldKey[]; onChange: (f: FieldKey[]) => void; onClose: () => void }) {
  // Shown fields first, in their order; then the rest in their usual order.
  const order: FieldKey[] = [...fields, ...FIELDS.map((f) => f.key).filter((k) => !fields.includes(k))];
  const [dragging, setDragging] = useState<FieldKey | null>(null);
  const label = (k: FieldKey) => FIELDS.find((f) => f.key === k)!;
  const shownIn = (o: FieldKey[], on: Set<FieldKey>) => o.filter((k) => on.has(k));
  const move = (k: FieldKey, to: number) => {
    const o = order.filter((x) => x !== k);
    o.splice(Math.max(0, Math.min(o.length, to)), 0, k);
    onChange(shownIn(o, new Set(fields)));
  };
  const toggle = (k: FieldKey) => {
    const on = new Set(fields);
    if (on.has(k)) on.delete(k); else on.add(k);
    onChange(shownIn(order, on));
  };
  return (
    <Modal onClose={onClose} label="Show details" width={480}>
      <div style={{ display: "grid", gap: 14 }}>
        <div className="dhead">
          <div style={{ display: "grid", gap: 6 }}>
            <span className="eyebrow">Show details</span>
            <h2 className="headline">Next to each video. <span className="rest">Same on every device you sign in on. Drag to reorder.</span></h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <ul className="fieldlist">
          {order.map((k, i) => {
            const f = label(k);
            const on = fields.includes(k);
            return (
              <li key={k} className={`${on ? "on" : ""}${dragging === k ? " dragging" : ""}`} draggable
                onDragStart={(e) => { setDragging(k); e.dataTransfer.effectAllowed = "move"; }}
                onDragEnd={() => setDragging(null)}
                onDragOver={(e) => { e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); if (dragging && dragging !== k) move(dragging, i); setDragging(null); }}>
                <GripVertical size={15} className="grip" aria-hidden />
                <label className="fl">
                  <input type="checkbox" checked={on} onChange={() => toggle(k)} />
                  <span>{f.label} <span className="secondary">· {f.hint}</span></span>
                </label>
                <span className="fmove">
                  <button className="icon-btn" disabled={i === 0} onClick={() => move(k, i - 1)} aria-label={`Move ${f.label} up`}><ArrowUp size={14} /></button>
                  <button className="icon-btn" disabled={i === order.length - 1} onClick={() => move(k, i + 1)} aria-label={`Move ${f.label} down`}><ArrowDown size={14} /></button>
                </span>
              </li>
            );
          })}
        </ul>
        <div className="dfoot">
          <button className="btn" onClick={() => onChange(DEFAULT_FIELDS)}>Reset</button>
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </Modal>
  );
}
