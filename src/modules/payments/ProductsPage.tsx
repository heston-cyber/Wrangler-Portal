// Nov 21 (Heston: the Stripe product library; approved 11:00, built in the existing style, like Plans). Payments ›
// Products: one-time products in the business's own Stripe, made here or brought in from Stripe's dashboard, picked
// as invoice and quote lines with Add from library.
import { useEffect, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import type { Id } from "../../../convex/_generated/dataModel";
import { api } from "../../../convex/_generated/api";
import { Button, ButtonLink, Card, Divider, EmptyState, ListRow, PageHeader, SectionHead, SkeletonRows, StatusChip, TextArea, TextField } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { Modal, useToast } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps, navigate } from "../../lib/router";
import { errText } from "../docs/pages/common";
import { MoneyInput, money } from "./common";

export default function ProductsPage() {
  const products = useQuery(api.products.list, {});
  const pay = useQuery(api.payments.settings, {});
  const sync = useAction(api.products.sync);
  const [toast, show] = useToast();
  const [busy, setBusy] = useState(false);
  const connected = pay?.stripe?.status === "connected";
  const once = useRef(false);
  const bringIn = async (quiet: boolean) => {
    setBusy(true);
    try {
      const r = await sync({});
      if (!quiet) show(r.added ? `Brought in ${r.added} from Stripe.` : "Up to date with Stripe.");
    } catch (e) { if (!quiet) show(errText(e)); }
    setBusy(false);
  };
  // The first visit brings in what's already in Stripe's dashboard.
  useEffect(() => { if (connected && products && !products.length && !once.current) { once.current = true; void bringIn(true); } }); // eslint-disable-line react-hooks/exhaustive-deps
  const active = (products ?? []).filter((p) => !p.archived);
  const archived = (products ?? []).filter((p) => p.archived);
  const row = (p: NonNullable<typeof products>[number]) => (
    <ListRow key={p._id} className="ilead" lead={{ icon: "package" }} to={`/payments/products/${p._id}`} chevron title={p.name}
      meta={[money(p.amountCents), p.description].filter(Boolean).join(" · ")} chip={p.archived ? <StatusChip tone="neutral">Archived</StatusChip> : undefined} />
  );
  return (
    <>
      <TopBar><span className="secondary">Payments</span><Sep /><span className="here">Products</span></TopBar>
      <div className="wp-page inv-list">
        <PageHeader title="Products." sub="Your Stripe product library: items you add to invoices and quotes in one tap."
          actions={<>
            {connected && <Button onClick={() => void bringIn(false)} loading={busy}>Bring in from Stripe</Button>}
            <ButtonLink variant="primary" icon="plus" to="/payments/products/new">New product</ButtonLink>
          </>} />
        {pay && !connected && <div className="wp-notice glass"><Icon name="info" size={20} /><span className="txt"><b>Stripe isn't connected.</b> Products live in your Stripe account, so they need Stripe (Settings › Payments).</span><ButtonLink size="sm" to="/settings/payments">Settings › Payments</ButtonLink></div>}
        {products === undefined ? <Card label="Products"><SkeletonRows n={3} /></Card>
          : products.length === 0 ? <EmptyState icon="package" title="No products yet." body="A product is an item you bill often, like a half-day shoot or a drone add-on. Make one here, or bring in the ones in your Stripe."
            actions={<ButtonLink variant="primary" icon="plus" to="/payments/products/new">New product</ButtonLink>} />
          : <>
            {active.length > 0 && <Card label="Products" head={<SectionHead label="Products" count={active.length} />}>{active.map((p, i) => <div key={p._id} className="wp-rowwrap">{i > 0 && <Divider />}{row(p)}</div>)}</Card>}
            {archived.length > 0 && <Card label="Archived" head={<SectionHead label="Archived" count={archived.length} />}>{archived.map((p, i) => <div key={p._id} className="wp-rowwrap">{i > 0 && <Divider />}{row(p)}</div>)}</Card>}
          </>}
      </div>
      {toast}
    </>
  );
}

/** New product, or an existing one (edit, archive). */
export function ProductEditor({ productId }: { productId?: string }) {
  const existing = useQuery(api.products.get, productId ? { productId } : "skip");
  const save = useAction(api.products.save);
  const archive = useAction(api.products.setArchived);
  const [toast, show] = useToast();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState(0);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState<null | "save" | "archive">(null);
  const [loaded, setLoaded] = useState(!productId);
  useEffect(() => {
    if (!existing || loaded) return;
    setName(existing.name); setAmount(existing.amountCents); setDescription(existing.description ?? "");
    setLoaded(true);
  }, [existing, loaded]);
  if (productId && existing === null) return <div className="wp-page"><EmptyState icon="package" title="That product isn't here." actions={<ButtonLink to="/payments/products">All products</ButtonLink>} /></div>;
  if (productId && (!existing || !loaded)) return <div className="wp-page"><Card label="Product"><SkeletonRows n={3} /></Card></div>;
  const doSave = async () => {
    setBusy("save");
    try {
      await save({ productId: productId as Id<"products"> | undefined, name, description: description || undefined, amountCents: amount });
      show(productId ? "Product saved." : "Product made.");
      navigate("/payments/products");
    } catch (e) { show(errText(e)); }
    setBusy(null);
  };
  const doArchive = async (archived: boolean) => {
    setBusy("archive");
    try { await archive({ productId: productId as Id<"products">, archived }); show(archived ? "Product archived. Invoices already made keep it." : "Product brought back."); }
    catch (e) { show(errText(e)); }
    setBusy(null);
  };
  const title = productId ? existing?.name ?? "Product" : "New product";
  return (
    <>
      <TopBar right={<>
        <a className="btn ghost" {...linkProps("/payments/products")}>Cancel</a>
        <Button variant="primary" onClick={() => void doSave()} loading={busy === "save"} disabled={!name.trim()}>Save product</Button>
      </>}>
        <span className="secondary">Payments</span><Sep /><a {...linkProps("/payments/products")}>Products</a><Sep /><span className="here">{title}</span>
      </TopBar>
      <div className="wp-page inv-edit">
        <header className="wp-pagehead"><div className="txt"><span className="wp-eyebrow">{productId ? (existing?.archived ? "Archived product" : "Product") : "New product"}</span>
          <h1 className="wp-h2">{productId ? `${existing?.name}.` : "New product."}</h1>
          <p className="wp-body">Saved in your Stripe product library. Add it to an invoice or quote with Add from library.</p></div></header>
        <div className="inv-cols">
          <div className="col">
            <Card label="Product" head={<SectionHead label="Product" />}>
              <div className="inv-form">
                <TextField label="Name" value={name} maxLength={120} placeholder="Half-day shoot" onChange={(e) => setName(e.target.value)} hint="This is the line's description on invoices." />
                <label className="wp-field"><span className="wp-field-label">Price</span><MoneyInput label="Price" value={amount} onChange={setAmount} /><span className="wp-field-hint">US dollars, per one</span></label>
                <TextArea label="Description" value={description} rows={3} maxLength={500} placeholder="For you: what it includes" onChange={(e) => setDescription(e.target.value)} hint="Kept in Stripe with the product." />
              </div>
            </Card>
            {productId && existing && <Card label="Archive" head={<SectionHead label={existing.archived ? "Archived" : "Archive"} />}>
              <div className="inv-form">
                <p className="secondary">{existing.archived ? "It's off the library picker. Invoices already made with it are unchanged." : "Archiving takes it off the library picker. Invoices already made with it are unchanged."}</p>
                <div><Button onClick={() => void doArchive(!existing.archived)} loading={busy === "archive"}>{existing.archived ? "Bring it back" : "Archive product"}</Button></div>
              </div>
            </Card>}
          </div>
          <div className="col right">
            <Card label="Good to know" head={<SectionHead label="Good to know" />}>
              <p className="plan-note">Changing the price makes a new price in Stripe and retires the old one (Stripe can't edit a price). Invoices already made keep what they had.</p>
            </Card>
          </div>
        </div>
      </div>
      {toast}
    </>
  );
}

export type PickedItem = { productId: string; priceId: string; unitCents: number; description: string };

/** Add from library: pick a product; it comes back as a line (its name, price, and the item it came from). */
export function LibraryPicker({ onPick, onClose }: { onPick: (item: PickedItem) => void; onClose: () => void }) {
  const items = useQuery(api.products.picker, {});
  const [q, setQ] = useState("");
  const shown = (items ?? []).filter((p) => !q.trim() || `${p.name} ${p.description ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Modal onClose={onClose} label="Add from library" width={560}>
      <div style={{ display: "grid", gap: 16 }}>
        <div className="dhead">
          <div style={{ display: "grid", gap: 6 }}><span className="eyebrow">Product library</span><h2 className="headline">Add from library</h2></div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        <TextField label="Search" value={q} placeholder="Search products" onChange={(e) => setQ(e.target.value)} autoFocus />
        {items === undefined ? <SkeletonRows n={3} />
          : items.length === 0 ? <p className="secondary">No products yet. <a {...linkProps("/payments/products/new")}>Make one in Payments › Products</a>.</p>
          : shown.length === 0 ? <p className="secondary">Nothing matches “{q.trim()}”.</p>
          : <div className="lib-pick">{shown.map((p, i) => (
            <div key={p._id} className="wp-rowwrap">{i > 0 && <Divider />}
              <ListRow className="ilead" lead={{ icon: "package" }} title={p.name} meta={p.description ?? undefined} trailing={money(p.amountCents)} menu={null}
                onClick={() => { onPick({ productId: p._id, priceId: p.priceId, unitCents: p.amountCents, description: p.name }); onClose(); }} />
            </div>
          ))}</div>}
      </div>
    </Modal>
  );
}
