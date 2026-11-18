// Phase 7 step 4 (D108, D111, D94, D100, D101): a new vendor's onboarding, frames 749:676 (2 Profile), 749:898 (3 W-9),
// 749:1039 (4 Payment method), 749:1187 (5 the tour) and 749:1319 (already on WranglerPortal: this business's W-9 and
// payment method only). Step 1 is the sign-in (the invite's sign-up, with the code). The pages wear the business's look
// (the vendor side's switcher picks the business). The W-9 goes through the same upload as Settings.
import { useContext, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { Id } from "../../../convex/_generated/dataModel";
import { api } from "../../../convex/_generated/api";
import { Button, Card, ListRow, SectionHead, StatusChip, TextArea, TextField } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { errLine } from "../../ui/hold";
import { navigate, linkProps } from "../../lib/router";
import { MoneyInput } from "../payments/common";
import { uploadToStorage } from "../docs/pages/common";
import { Ctx } from "../vendor/ctx";
import { Tour, UploadError, type Stop } from "./ClientOnboard";

type St = NonNullable<ReturnType<typeof useQuery<typeof api.vendorOnboard.state>>>;
type Page = "profile" | "w9" | "pay";
const PAGES: Record<"full" | "short", Page[]> = { full: ["profile", "w9", "pay"], short: ["w9", "pay"] };
const LABEL: Record<Page, string> = { profile: "Profile", w9: "W-9", pay: "Payment method" };
const W9_MAX = 10 * 1024 * 1024; // vendorPortal.setW9's limit
const IRS_W9 = "https://www.irs.gov/pub/irs-pdf/fw9.pdf";
const poss = (name: string) => (/s$/i.test(name.trim()) ? `${name.trim()}'` : `${name.trim()}'s`); // "Wrangler Productions' work" (749:1319)
const day = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** /welcome on the vendor side: the steps after the sign-in, for the business the switcher is on. */
export default function VendorOnboard({ start }: { start: number | null }) {
  const { biz, list } = useContext(Ctx);
  const st = useQuery(api.vendorOnboard.state, biz ? { businessId: biz } : "skip");
  const mark = useMutation(api.vendorOnboard.step);
  const [at, setAt] = useState<number | null>(start);
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (st && at === null) setAt(st.step); }, [st, at]);
  if (!biz || st === undefined || at === null) return <div className="ob ob-client"><p className="wp-small secondary">Loading…</p></div>;
  if (st.kind === "existing") return <div className="ob ob-client"><p className="wp-body">Nothing to set up here. <a {...linkProps("/")}>Home</a></p></div>;
  const pages = PAGES[st.kind];
  const i = Math.max(0, Math.min(pages.length - 1, at));
  const page = pages[i];
  const total = st.kind === "full" ? 5 : 2, n = st.kind === "full" ? i + 2 : i + 1;
  const last = i === pages.length - 1;
  const later = async () => { await mark({ businessId: biz, at: i }).catch(() => undefined); navigate("/"); };
  const go = async (save?: () => Promise<unknown>) => {
    setBusy(true); setErr(null);
    try {
      if (save) await save();
      await mark({ businessId: biz, at: i + 1 });
      if (last) navigate(st.kind === "full" ? "/?tour=1" : "/"); else setAt(i + 1);
    } catch (e) { setErr(errLine(e)); } finally { setBusy(false); }
  };
  const foot = (next: string, disabled = false) => (
    <>{err && <p className="error" role="alert">{err}</p>}
      <div className="ob-foot"><button type="button" className="linkbtn" onClick={() => void later()}>Finish later</button><span className="sp" />
        {i > 0 && <Button variant="ghost" onClick={() => { setErr(null); setAt(i - 1); }}>Back</Button>}
        <Button type="submit" variant="primary" loading={busy} disabled={disabled}>{next}</Button></div></>
  );
  const others = list.filter((b) => b.businessId !== biz).map((b) => b.name);
  return (
    <div className="ob ob-client">
      <span className="ob-prog" style={{ gridTemplateColumns: `repeat(${total}, 1fr)` }} aria-label={`Step ${n} of ${total}`}>{Array.from({ length: total }, (_, k) => <i key={k} className={k < n ? "on" : ""} />)}</span>
      <span className="wp-small secondary">Step {n} of {total} · {LABEL[page]}</span>
      {page === "profile" && <Profile key={biz} st={st} foot={foot} go={go} />}
      {page === "w9" && <W9 key={biz} st={st} foot={foot} go={go} others={others} />}
      {page === "pay" && <Pay key={biz} st={st} foot={foot} go={go} />}
    </div>
  );
}

type Part = { st: St; foot: (next: string, disabled?: boolean) => React.ReactNode; go: (save?: () => Promise<unknown>) => Promise<void> };

/** 749:676 Your profile: pre-filled with what the business typed in Add vendor. */
function Profile({ st, foot, go }: Part) {
  const save = useMutation(api.vendorOnboard.profile);
  const p = st.profile;
  const [f, setF] = useState({ name: p.name, businessName: p.businessName, basedIn: p.basedIn, gear: p.gear, portfolio: p.portfolio });
  const [roles, setRoles] = useState<string[]>(p.roles);
  const [other, setOther] = useState("");
  const [cents, setCents] = useState(p.rate?.cents ?? 0), [unit, setUnit] = useState<"day" | "hour">(p.rate?.unit ?? "hour");
  const toggle = (r: string) => setRoles(roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r]);
  const choices = [...new Set([...st.roleChoices, ...roles])];
  const addOther = () => { const r = other.trim(); if (r && !roles.includes(r)) setRoles([...roles, r]); setOther(""); };
  const submit = () => go(() => save({
    businessId: st.businessId, name: f.name, businessName: f.businessName || undefined, roles: [...roles, ...(other.trim() && !roles.includes(other.trim()) ? [other.trim()] : [])],
    ...(cents > 0 || p.rate ? { rateCents: cents, rateUnit: unit } : {}), basedIn: f.basedIn || undefined, gear: f.gear, portfolio: f.portfolio || undefined,
  }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <h1 className="wp-h2">Your profile.</h1>
      <p className="wp-body secondary">{st.business} filled in what they know. Check it and add the rest.</p>
      <div className="ob-card glass">
        <div className="ob-two"><TextField label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={120} autoComplete="name" />
          <TextField label="Business name (optional)" value={f.businessName} onChange={(e) => setF({ ...f, businessName: e.target.value })} maxLength={120} autoComplete="organization" /></div>
        <div className="wp-field"><span className="wp-field-label">Roles</span>
          <div className="qz-chips">
            {choices.map((r) => <button key={r} type="button" className={`qz-chip${roles.includes(r) ? " on" : ""}`} aria-pressed={roles.includes(r)} onClick={() => toggle(r)}>{r}</button>)}
            <span className="qz-addword"><input className="input sm" placeholder="+ Other" aria-label="Another role" value={other} maxLength={40} onChange={(e) => setOther(e.target.value)} onBlur={addOther} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addOther(); } }} /></span>
          </div></div>
        <div className="ob-two">
          <div className="wp-field"><span className="wp-field-label">Your rate</span>
            <span className="vd-rate"><MoneyInput label="Your rate" value={cents} onChange={setCents} placeholder="00" />
              <select className="input" aria-label="Per" value={unit} onChange={(e) => setUnit(e.target.value as "day" | "hour")}><option value="hour">/ hour</option><option value="day">/ day</option></select></span></div>
          <TextField label="Based in" value={f.basedIn} onChange={(e) => setF({ ...f, basedIn: e.target.value })} maxLength={80} placeholder="City, or Remote" />
        </div>
        <TextArea label="Gear (optional)" value={f.gear} onChange={(e) => setF({ ...f, gear: e.target.value })} compact maxLength={1200} placeholder="Cameras, lenses, software… separated by commas" />
        <TextField label="Portfolio" value={f.portfolio} onChange={(e) => setF({ ...f, portfolio: e.target.value })} maxLength={300} placeholder="yoursite.com" inputMode="url" />
      </div>
      {foot("Continue", f.name.trim().length < 2)}
    </form>
  );
}

/** 749:898 Your W-9 for {business} (or 749:1319's first step: already on WranglerPortal). One per business (D100). */
function W9({ st, foot, go, others }: Part & { others: string[] }) {
  const uploadUrl = useMutation(api.vendorPortal.w9UploadUrl);
  const setW9 = useMutation(api.vendorPortal.setW9);
  const input = useRef<HTMLInputElement>(null);
  const [up, setUp] = useState(false), [msg, setMsg] = useState<{ text: string; bad?: boolean; file?: string } | null>(null);
  const RULE = "Upload a PDF up to 10 MB. A phone scan saved as PDF works.";
  const pick = async (f: File | undefined) => {
    if (!f) return;
    // 753:1951: the wrong kind of file, or over the limit (setW9 checks both again).
    if (!(f.type === "application/pdf" || /\.pdf$/i.test(f.name)) || f.size > W9_MAX) { setMsg({ text: RULE, bad: true, file: f.name }); return; }
    setUp(true); setMsg(null);
    try {
      const id = await uploadToStorage(await uploadUrl({ businessId: st.businessId }), f);
      const r = await setW9({ businessId: st.businessId, storageId: id as Id<"_storage">, name: f.name });
      setMsg(r && "error" in r ? { text: RULE, bad: true, file: f.name } : { text: "W-9 uploaded." });
    } catch (e) { setMsg({ text: errLine(e), bad: true }); } finally { setUp(false); if (input.current) input.current.value = ""; }
  };
  const short = st.kind === "short";
  const drop = (
    <>
      {st.w9 ? <div className="ob-file"><Icon name="document" size={18} /><span><b>{st.w9.name}</b><span className="wp-small secondary">Uploaded {day(st.w9.uploadedAt)}</span></span>
        <StatusChip tone="success">On file</StatusChip><Button size="sm" loading={up} onClick={() => input.current?.click()}>Replace</Button></div>
        : <button type="button" className="ob-drop" disabled={up} onClick={() => input.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void pick(e.dataTransfer.files[0]); }}>
          <Icon name="upload" size={16} />{up ? "Uploading…" : <>Drop your W-9{short ? ` for ${st.business}` : ""} (PDF), or <b>browse</b></>}</button>}
      <input ref={input} type="file" hidden accept="application/pdf,.pdf" onChange={(e) => void pick(e.target.files?.[0])} />
      {msg && (msg.file ? <UploadError file={msg.file} text={msg.text} onRetry={() => input.current?.click()} />
        : <span className={`wp-small ${msg.bad ? "error" : "secondary"}`} role={msg.bad ? "alert" : "status"}>{msg.text}</span>)}
    </>
  );
  return (
    <form onSubmit={(e) => { e.preventDefault(); void go(); }}>
      {short ? <>
        <span className="wp-eyebrow">{st.business} added you</span>
        <h1 className="wp-h2">You're already on WranglerPortal.</h1>
        <p className="wp-body secondary">You're signed in as {st.signedInAs}. {st.business} just needs their own W-9 and how you like to be paid. Your profile is already done.</p>
        <div className="ob-card glass">{drop}
          <p className="wp-small secondary">{st.business} only sees what you share with them; {others.length === 1 ? poss(others[0]) : "your other businesses'"} work stays separate. PDF, up to 10 MB.</p></div>
      </> : <>
        <h1 className="wp-h2">Your W-9 for {st.business}.</h1>
        <p className="wp-body secondary">Needed before your first payment, not before bookings. Each business you work for gets its own copy.</p>
        <div className="ob-card glass">{drop}
          <p className="wp-small secondary">PDF, up to 10 MB. Only {st.business} can download it.</p>
          <a className="ob-ext" href={IRS_W9} target="_blank" rel="noopener noreferrer"><Icon name="document" size={14} />Get a blank W-9 from irs.gov</a></div>
      </>}
      {foot(st.w9 ? "Continue" : "Skip for now", up)}
    </form>
  );
}

/** 749:1039 How you like to be paid: the method and a note only, never bank numbers (D101). */
function Pay({ st, foot, go }: Part) {
  const save = useMutation(api.vendorOnboard.payMethod);
  const [method, setMethod] = useState<string | null>(st.pay?.method ?? null);
  const [note, setNote] = useState(st.pay?.note ?? "");
  return (
    <form onSubmit={(e) => { e.preventDefault(); void go(method ? () => save({ businessId: st.businessId, method, note: note || undefined }) : undefined); }}>
      <h1 className="wp-h2">How you like to be paid.</h1>
      <p className="wp-body secondary">{st.business} pays you their usual way and marks it paid here.</p>
      <div className="ob-card glass">
        <div className="wp-field"><span className="wp-field-label">Method</span>
          <div className="wp-seg" role="group" aria-label="Method">{st.methods.map((m) => <button key={m} type="button" aria-pressed={method === m} onClick={() => setMethod(m)}>{m}</button>)}</div></div>
        <TextField label={`Note for ${st.business} (optional)`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Same account as my last invoice." />
        <div className="ob-banner"><Icon name="lock" size={16} /><span><b>Don't type account or routing numbers here</b>
          <span className="wp-small secondary">Share those with the business directly. The portal only keeps the method and your note.</span></span></div>
      </div>
      {foot(method ? "Continue" : "Skip for now")}
    </form>
  );
}

// ---------- Getting started on the vendor's Home, and the tour (749:1187) ----------

const STOPS: Stop[] = [
  { href: "/vendor/bookings", title: "Bookings", text: "New jobs land here. Accept or decline each one." },
  { href: "/vendor/briefings", title: "Briefings", text: "Shoot and edit briefs come here. Read each one, then press I've read it." },
  { href: "/vendor/invoices", title: "Invoices", text: "Log hours or send an invoice for a booking, and see when it's approved and paid." },
];

/** The Home card until everything is done (or only the tour, for a vendor from before Phase 7); opens /welcome on a new
 *  vendor's first visit to that business, and the tour after the last step. */
export function VendorGettingStarted() {
  const { biz } = useContext(Ctx);
  const st = useQuery(api.vendorOnboard.state, biz ? { businessId: biz } : "skip");
  const tourDone = useMutation(api.vendorOnboard.tour);
  const [touring, setTouring] = useState(() => new URLSearchParams(location.search).get("tour") === "1");
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!st || opened.current === st.businessId) return;
    opened.current = st.businessId;
    if (st.kind === "existing") { if (!st.done.tour && !st.tourSkipped) setTouring(true); return; } // D114's rule, for vendors
    const fresh = !st.started && !st.done.w9 && !st.done.pay && (st.kind === "short" || !st.done.profile);
    if (!fresh) return;
    const key = `wp.vwelcome.${st.businessId}`;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, "1"); } catch { /* private window */ }
    navigate("/welcome");
  }, [st]);
  if (!st || !biz) return null;
  const end = (skipped: boolean) => {
    setTouring(false); void tourDone({ businessId: biz, skipped });
    if (new URLSearchParams(location.search).has("tour")) window.history.replaceState(null, "", location.pathname);
  };
  const tour = touring && st.kind !== "short" ? <Tour stops={STOPS} count onEnd={end} /> : null;
  const full = st.kind === "full";
  const rows = st.kind === "existing" ? [] : [
    ...(full ? [{ t: "Sign in", done: true, sub: "Done" },
      { t: "Your profile", done: st.done.profile, sub: st.done.profile ? "Done" : "Roles, rate, gear and portfolio", go: () => navigate("/welcome?step=0") }] : []),
    { t: `W-9 for ${st.business}`, done: st.done.w9, sub: st.done.w9 ? "On file" : "Needed before your first payment", go: () => navigate(`/welcome?step=${full ? 1 : 0}`) },
    { t: "How you like to be paid", done: st.done.pay, sub: st.done.pay ? `Done · ${st.pay?.method}` : "The method and a note", go: () => navigate(`/welcome?step=${full ? 2 : 1}`) },
    ...(full ? [{ t: "Tour", done: st.done.tour, sub: st.done.tour ? "Done" : st.tourSkipped ? "Skipped · take it any time" : "A minute around your portal", go: () => setTouring(true), verb: "Start" }] : []),
  ];
  const left = rows.filter((x) => !x.done).length;
  if (!left) return tour;
  return (
    <>
      <Card label="Getting started" head={<SectionHead label="Getting started" count={`${left} left`} />}>
        {rows.map((x) => <ListRow key={x.t} lead={{ icon: x.done ? "check-circle" : "clock" }} title={x.t} meta={x.sub}
          action={x.done || !("go" in x) || !x.go ? undefined : <Button size="sm" onClick={x.go}>{"verb" in x && x.verb ? x.verb : "Finish"}</Button>} />)}
      </Card>
      {tour}
    </>
  );
}
