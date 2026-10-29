// The page editor's containers and special blocks, drawn by React inside the editor (E1–E2, Oct 27). They read the
// document's fields, totals and style from BuilderCtx, and change their own settings with updateAttributes.
import { createContext, useContext } from "react";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { BookmarkPlus, Plus, X } from "lucide-react";
import { fill, money, type BuildDoc, type ItemRow, type PNode, newId, totals } from "../../../../../convex/lib/wsBuilder";

export type BuilderCtxValue = {
  doc: BuildDoc;
  values: Record<string, string>;
  px: (pt: number) => number;
  onDetails: () => void;
  onSaveClause: (section: PNode) => void;
};
export const BuilderCtx = createContext<BuilderCtxValue | null>(null);

export function SectionView({ node, updateAttributes }: NodeViewProps) {
  const ctx = useContext(BuilderCtx);
  const a = node.attrs as { look: string; initials: boolean };
  return (
    <NodeViewWrapper as="section" className={`wsb-sec ${a.look === "card" ? "wsb-card" : "wsb-plain"}`} data-look={a.look}>
      <NodeViewContent className="wsb-sec-body" />
      <div className="wsb-secfoot" contentEditable={false}>
        <label className="wsb-check"><input type="checkbox" checked={!!a.initials} onChange={(e) => updateAttributes({ initials: e.target.checked })} />Client initials here</label>
        <button type="button" className="btn ghost sm" onClick={() => ctx?.onSaveClause(node.toJSON() as PNode)}><BookmarkPlus size={13} />Save to clause library</button>
      </div>
    </NodeViewWrapper>
  );
}

export function AtomView(props: NodeViewProps) {
  const ctx = useContext(BuilderCtx);
  const name = props.node.type.name;
  return (
    <NodeViewWrapper className={`wsb-atom wsb-atom-${name}${props.selected ? " sel" : ""}`} data-atom={name} contentEditable={false}>
      {ctx && <Atom {...props} ctx={ctx} />}
    </NodeViewWrapper>
  );
}

function Atom({ node, updateAttributes, ctx }: NodeViewProps & { ctx: BuilderCtxValue }) {
  const a = node.attrs as Record<string, unknown>;
  const { doc, px } = ctx;
  const f = doc.fields;
  const t = totals(doc.page);
  switch (node.type.name) {
    case "parties":
      return (
        <div className="wsb-parties" onClick={ctx.onDetails} title="Edit in Details">
          <div><span className="wsb-cap">Business</span><b>{f.business.legalName}{f.business.name ? `, dba ${f.business.name}` : ""}</b><span>{f.business.contact}</span><span>{f.business.email}</span><span>{f.business.address}</span></div>
          <div><span className="wsb-cap">Client</span><b>{f.client.company || f.client.name || "Client name (Details)"}</b>{f.client.company && <span>{f.client.name}</span>}<span>{f.client.email}</span><span>{f.client.address}</span></div>
        </div>
      );
    case "items": {
      const rows = (a.rows as ItemRow[]) ?? [];
      const set = (r: ItemRow[]) => updateAttributes({ rows: r });
      const setRow = (id: string, p: Partial<ItemRow>) => set(rows.map((r) => (r.id === id ? { ...r, ...p } : r)));
      const sum = rows.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.rate) || 0), 0);
      return (
        <table className="wsb-items">
          <thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th className="num">Amount</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td><input value={r.description} placeholder="What it is" onChange={(e) => setRow(r.id, { description: e.target.value })} /></td>
              <td><input type="number" min={0} step="any" value={r.qty} onChange={(e) => setRow(r.id, { qty: Number(e.target.value) })} /></td>
              <td><input type="number" min={0} step="any" value={r.rate} onChange={(e) => setRow(r.id, { rate: Number(e.target.value) })} /></td>
              <td className="num">{money((Number(r.qty) || 0) * (Number(r.rate) || 0))}</td>
              <td><button type="button" className="icon-btn" aria-label="Remove line" onClick={() => set(rows.filter((x) => x.id !== r.id))}><X size={13} /></button></td>
            </tr>
          ))}</tbody>
          <tfoot><tr><td colSpan={2}><button type="button" className="btn ghost sm" onClick={() => set([...rows, { id: newId(), description: "", qty: 1, rate: 0 }])}><Plus size={13} />Add a line</button></td><td className="num"><b>Total</b></td><td className="num"><b>{money(sum)}</b></td><td /></tr></tfoot>
        </table>
      );
    }
    case "payment":
      return (
        <div className="wsb-pay">
          <label>Deposit <input type="number" min={0} max={100} value={Number(a.depositPct) || 0} onChange={(e) => updateAttributes({ depositPct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} />%</label>
          <span>Total <b>{money(t.total)}</b></span><span>Deposit <b>{money(t.deposit)}</b></span><span>Balance <b>{money(t.balance)}</b></span>
          <label className="wsb-check"><input type="checkbox" checked={!!a.invoiceDeposit} onChange={(e) => updateAttributes({ invoiceDeposit: e.target.checked })} />Draft a Stripe invoice for the deposit when it's signed</label>
          <label className="wsb-check"><input type="checkbox" checked={!!a.initials} onChange={(e) => updateAttributes({ initials: e.target.checked })} />Client initials</label>
        </div>
      );
    case "signatures": {
      const all = ["heston", "client", "client2", "client3", "client4"];
      const signers = (a.signers as string[]) ?? [];
      const name = (k: string) => k === "heston" ? f.business.contact || "You" : k === "client" ? f.client.name || "Client" : doc.signers.find((s) => s.key === k)?.name || `Client ${k.replace("client", "")}`;
      return (
        <div>
          <div className="wsb-sigpick">
            {all.map((k) => <label key={k} className="wsb-check"><input type="checkbox" checked={signers.includes(k)} onChange={(e) => updateAttributes({ signers: e.target.checked ? [...signers, k].sort((p, q) => all.indexOf(p) - all.indexOf(q)) : signers.filter((y) => y !== k) })} />{k === "heston" ? "You" : k === "client" ? "Client" : `Client ${k.replace("client", "")}`}</label>)}
            <label className="wsb-check"><input type="checkbox" checked={a.showTitle !== false} onChange={(e) => updateAttributes({ showTitle: e.target.checked })} />Title line</label>
            <label className="wsb-check"><input type="checkbox" checked={a.showDate !== false} onChange={(e) => updateAttributes({ showDate: e.target.checked })} />Date line</label>
          </div>
          <div className="wsb-sigs">{signers.map((k) => (
            <div key={k}><span className="wsb-cap">{name(k)}</span><div className="wsb-line tall">Signature</div><div className="wsb-line">Name</div>{a.showTitle !== false && <div className="wsb-line">Title</div>}{a.showDate !== false && <div className="wsb-line">Date</div>}</div>
          ))}</div>
        </div>
      );
    }
    case "divider": return <div className={`wsb-sep ${doc.style.separator}`} title="Divider (its look is set in Style › Separator)" />;
    case "pagebreak": return <div className="wsb-break"><span>Page break</span></div>;
    case "spacer": return <div className="wsb-spacer" style={{ height: px(Number(a.size) || 18) }} title="Space (set its height in Format)" />;
    default: return null;
  }
}

/** Field values inside an atom's text (descriptions use {fields} too). */
export const filled = (s: string, ctx: BuilderCtxValue) => fill(s, ctx.values);
