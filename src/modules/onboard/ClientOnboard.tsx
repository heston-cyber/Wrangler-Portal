// Phase 7 step 3 (D107, D111, D112, D114): a new client's onboarding, frames 747:333 (2 About you), 747:489 (3 Your
// company), 747:681 (4 Preferences), 748:169 (5 the tour) and the Home card (748:384 Getting started). Step 1 is the
// sign-in (the invite's sign-up, with the code). The pages wear the business's look. People a client asks to add wait for
// the business owner (D112). Clients who were here before Phase 7 see only the tour (D114).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery } from "convex/react";
import type { Id } from "../../../convex/_generated/dataModel";
import { api } from "../../../convex/_generated/api";
import { Button, Card, ListRow, SectionHead, StatusChip, TextField, Toggle } from "../../ui/wp";
import { errLine } from "../../ui/hold";
import { navigate, linkProps } from "../../lib/router";

type St = NonNullable<ReturnType<typeof useQuery<typeof api.clientOnboard.state>>>;
type Step = 2 | 3 | 4;
const LABEL: Record<Step, string> = { 2: "About you", 3: "Your company", 4: "Preferences" };
const HEX = /^#[0-9a-fA-F]{6}$/;

/** /welcome: steps 2–4; the tour (step 5) starts on Home. */
export default function ClientOnboard({ start }: { start: number | null }) {
  const st = useQuery(api.clientOnboard.state, {});
  const mark = useMutation(api.clientOnboard.step);
  const [step, setStep] = useState<Step>(() => (start && start >= 2 && start <= 4 ? start : 2) as Step);
  const placed = useRef(false);
  useEffect(() => { if (st && !placed.current && !start) { placed.current = true; setStep(Math.min(4, Math.max(2, st.step + 2)) as Step); } }, [st, start]);
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  if (st === null) return <div className="wp-page"><p className="wp-body">Nothing to set up here. <a {...linkProps("/")}>Home</a></p></div>;
  if (!st) return <div className="wp-page"><p className="wp-small secondary">Loading…</p></div>;
  const later = async () => { await mark({ at: step - 2 }).catch(() => undefined); navigate("/"); };
  const go = async (save: () => Promise<unknown>, done: "about" | "company" | "prefs") => {
    setBusy(true); setErr(null);
    try { await save(); await mark({ done, at: step - 1 }); if (step === 4) navigate("/?tour=1"); else setStep((step + 1) as Step); }
    catch (e) { setErr(errLine(e)); } finally { setBusy(false); }
  };
  const foot = (next = "Continue", disabled = false) => (
    <>{err && <p className="error" role="alert">{err}</p>}
      <div className="ob-foot"><button type="button" className="linkbtn" onClick={() => void later()}>Finish later</button><span className="sp" />
        {step > 2 && <Button variant="ghost" onClick={() => setStep((step - 1) as Step)}>Back</Button>}
        <Button type="submit" variant="primary" loading={busy} disabled={disabled}>{next}</Button></div></>
  );
  return (
    <div className="wp-page"><div className="ob ob-client">
      <span className="ob-prog" style={{ gridTemplateColumns: "repeat(5, 1fr)" }} aria-label={`Step ${step} of 5`}>{[1, 2, 3, 4, 5].map((n) => <i key={n} className={n <= step ? "on" : ""} />)}</span>
      <span className="wp-small secondary">Step {step} of 5 · {LABEL[step]}</span>
      {step === 2 && <About st={st} foot={foot} onSave={(f) => go(f, "about")} />}
      {step === 3 && <Company st={st} foot={foot} onSave={(f) => go(f, "company")} />}
      {step === 4 && <Prefs st={st} foot={foot} onSave={(f) => go(f, "prefs")} />}
    </div></div>
  );
}

type Part = { st: St; foot: (next?: string, disabled?: boolean) => React.ReactNode; onSave: (save: () => Promise<unknown>) => Promise<void> };

function About({ st, foot, onSave }: Part) {
  const save = useMutation(api.clientOnboard.about);
  const [f, setF] = useState(st.about);
  return (
    <form onSubmit={(e) => { e.preventDefault(); void onSave(() => save({ name: f.name, title: f.title || undefined, phone: f.phone || undefined })); }}>
      <h1 className="wp-h2">About you.</h1>
      <p className="wp-body secondary">So {st.business || "they"} know{st.business ? "s" : ""} who's who.</p>
      <div className="ob-card glass">
        <div className="ob-two"><TextField label="Your name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={60} />
          <TextField label="Title (optional)" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={60} /></div>
        <TextField label="Phone" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="(000) 000-0000" hint="Used for shoot-day questions only." maxLength={30} />
      </div>
      {foot("Continue", f.name.trim().length < 2)}
    </form>
  );
}

function Company({ st, foot, onSave }: Part) {
  const save = useMutation(api.clientOnboard.company);
  const uploadUrl = useMutation(api.clientOnboard.logoUploadUrl);
  const setLogo = useMutation(api.clientOnboard.setLogo);
  const [f, setF] = useState(st.billing);
  const [colors, setColors] = useState<string[]>(() => [...st.brand.colors, "", ""].slice(0, Math.max(3, st.brand.colors.length + 1)));
  const [msg, setMsg] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pick = async (file: File) => {
    if (!/^image\/(png|jpeg|svg\+xml|webp)$/.test(file.type) || file.size > 5 * 1024 * 1024) { setMsg("Use a PNG, SVG, JPG or WebP under 5 MB."); return; }
    try { const r = await fetch(await uploadUrl({}), { method: "POST", headers: { "Content-Type": file.type }, body: file }); const { storageId } = (await r.json()) as { storageId: Id<"_storage"> }; await setLogo({ storageId }); setMsg("Logo added."); }
    catch (e) { setMsg(errLine(e)); }
  };
  const bad = colors.some((c) => c.trim() && !HEX.test(c.trim()));
  return (
    <form onSubmit={(e) => { e.preventDefault(); void onSave(() => save({ billingName: f.name, billingEmail: f.email, address: f.address, colors: colors.filter((c) => c.trim()) })); }}>
      <h1 className="wp-h2">{st.company}.</h1>
      <p className="wp-body secondary">Billing details for invoices, and your brand for the work we make. You can change these later.</p>
      <div className="ob-card glass">
        <span className="wp-eyebrow">Billing</span>
        <div className="ob-two"><TextField label="Billing contact" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} />
          <TextField label="Billing email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <TextField label="Billing address" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} placeholder="Street, city, state ZIP" maxLength={200} />
        <span className="wp-eyebrow">Your brand</span>
        <button type="button" className="ob-drop" onClick={() => input.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const x = e.dataTransfer.files[0]; if (x) void pick(x); }}>
          {st.brand.logoUrl ? <img src={st.brand.logoUrl} alt="" /> : <>Drop your logo (SVG or PNG), or <b>browse</b></>}</button>
        <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={(e) => { const x = e.target.files?.[0]; e.target.value = ""; if (x) void pick(x); }} />
        {msg && <span className="wp-small secondary" role="status">{msg}</span>}
        <div className="ob-colors">{colors.map((c, i) => (
          <label key={i} className="ob-color"><span className="sw" style={{ background: HEX.test(c) ? c : "transparent" }} />
            <input className="input sm" value={c} placeholder="#" maxLength={7} aria-label={`Brand colour ${i + 1}`} onChange={(e) => { const n = [...colors]; n[i] = e.target.value.trim(); if (i === n.length - 1 && n[i] && n.length < 6) n.push(""); setColors(n); }} /></label>))}</div>
        <p className="wp-small secondary">This fills {st.company}'s brand kit, which {st.business || "they"} use{st.business ? "s" : ""} for decks and briefs.</p>
      </div>
      {foot("Continue", bad)}
    </form>
  );
}

function Prefs({ st, foot, onSave }: Part) {
  const prefs = useQuery(api.notifications.client, {});
  const setPref = useMutation(api.notifications.setClient);
  const ask = useMutation(api.clientOnboard.askColleague);
  const [email, setEmail] = useState(""), [msg, setMsg] = useState<string | null>(null);
  return (
    <form onSubmit={(e) => { e.preventDefault(); void onSave(async () => null); }}>
      <h1 className="wp-h2">Emails and people.</h1>
      <p className="wp-body secondary">Choose what we email you, and who else at {st.company} should have access.</p>
      <div className="ob-card glass">
        <span className="wp-eyebrow">Email me when</span>
        {(prefs?.items ?? []).filter((i) => !i.always).map((i) => (
          <div key={i.key} className="ob-pref"><span>{i.label}</span><Toggle label={i.label} checked={i.on} onChange={(on) => void setPref({ key: i.key, on })} /></div>))}
        <span className="wp-eyebrow">Others at {st.company}</span>
        <div className="ob-add"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="dan@company.com" aria-label="Their email" />
          <Button type="button" onClick={() => void ask({ email }).then(() => { setEmail(""); setMsg(`${st.business || "The business"} will approve them before they get access.`); }, (e) => setMsg(errLine(e)))} disabled={!email.trim()}>Add</Button></div>
        {st.asked.map((r) => <ListRow key={r._id} lead={{ avatar: r.name ?? r.email }} title={r.name ? `${r.name} · ${r.email}` : r.email}
          meta={r.status === "pending" ? `Waiting for ${st.business || "the business"} to approve` : r.status === "approved" ? "Invited" : "Not added"}
          chip={<StatusChip tone={r.status === "pending" ? "warning" : r.status === "approved" ? "success" : "neutral"}>{r.status === "pending" ? "Pending" : r.status === "approved" ? "Approved" : "Declined"}</StatusChip>} />)}
        {msg && <p className="wp-small secondary" role="status">{msg}</p>}
        <p className="wp-small secondary">{st.business || "The business"} approves new people before they get access.</p>
      </div>
      {foot("Continue")}
    </form>
  );
}

/** 748:384: Getting started on the client's Home, until everything is done; and the tour (748:169) when asked. */
export function GettingStarted() {
  const st = useQuery(api.clientOnboard.state, {});
  const tourDone = useMutation(api.clientOnboard.tour);
  const [touring, setTouring] = useState(() => new URLSearchParams(location.search).get("tour") === "1");
  const opened = useRef(false);
  useEffect(() => { // a new client's first visit opens their onboarding (once per browser session)
    if (!st || opened.current || st.existing || st.step > 0 || Object.values(st.done).some(Boolean)) return;
    opened.current = true;
    try { if (sessionStorage.getItem("wp.welcomeOpened")) return; sessionStorage.setItem("wp.welcomeOpened", "1"); } catch { /* ignore */ }
    navigate("/welcome");
  }, [st]);
  useEffect(() => { // D114: a client who was here before sees only the tour, once
    if (st && st.existing && !st.done.tour && !st.tourSkipped) setTouring(true);
  }, [st]);
  if (!st) return null;
  const tour = touring ? <Tour stops={STOPS} onEnd={(skipped) => { setTouring(false); void tourDone({ skipped }); }} /> : null;
  if (st.existing) return tour;
  const rows = [
    { t: "Sign in", done: true, sub: "Done" },
    { t: "About you", done: st.done.about, sub: st.done.about ? "Done" : "Your name, title and phone", go: () => navigate("/welcome?step=2") },
    { t: "Your company", done: st.done.company, sub: st.done.company ? (st.billing.address && st.brand.logoUrl ? "Done" : `Done · ${[!st.billing.address && "billing address", !st.brand.logoUrl && "logo"].filter(Boolean).join(" and ")} still empty`) : "Billing details and your brand", go: () => navigate("/welcome?step=3") },
    { t: "Preferences", done: st.done.prefs, sub: st.done.prefs ? "Done" : "Which emails you get, and who else has access", go: () => navigate("/welcome?step=4") },
    { t: "Tour", done: st.done.tour, sub: st.done.tour ? "Done" : st.tourSkipped ? "Skipped · take it any time" : "A minute around your portal", go: () => setTouring(true), verb: "Start" },
  ];
  const left = rows.filter((x) => !x.done).length;
  if (!left) return tour;
  return (
    <>
      <Card label="Getting started" head={<SectionHead label="Getting started" count={`${left} left`} />}>
        {rows.map((x) => <ListRow key={x.t} lead={{ icon: x.done ? "check-circle" : "clock" }} title={x.t} meta={x.sub}
          action={x.done || !x.go ? undefined : <Button size="sm" onClick={x.go}>{x.verb ?? "Finish"}</Button>} />)}
      </Card>
      {tour}
    </>
  );
}

// ---------- the tour (748:169): a coachmark on each part of the portal the business uses ----------
export type Stop = { href: string; title: string; text: string };
const STOPS: Stop[] = [
  { href: "/inbox", title: "Inbox", text: "Notes and updates from the team land here. You get an email too, as you chose." },
  { href: "/messages", title: "Messages", text: "Talk with the team about your project; everyone on it sees the thread." },
  { href: "/review", title: "Review", text: "Watch cuts and leave notes on the exact frame. Each version is a round." },
  { href: "/delivery", title: "Delivery", text: "Your final files live here: watch, download or share them." },
  { href: "/docs", title: "Docs", text: "Contracts and documents to sign, and copies of what you've signed." },
  { href: "/payments/invoices", title: "Payments", text: "Invoices to pay and receipts, in one place." },
];
/** Coachmarks on the menu links that are there (748:169 for clients, 749:1187 for vendors: "1 of 3 · Bookings"). */
export function Tour({ stops: all, onEnd, count }: { stops: Stop[]; onEnd: (skipped: boolean) => void; count?: boolean }) {
  const [stops, setStops] = useState<Stop[] | null>(null);
  useEffect(() => { const t = setTimeout(() => setStops(all.filter((x) => visible(x.href))), 300); return () => clearTimeout(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- after the menu has drawn
  const [i, setI] = useState(0);
  const [box, setBox] = useState<DOMRect | null>(null);
  const s = stops?.[i];
  useLayoutEffect(() => {
    if (!s) return;
    const el = target(s.href) ?? target("/more", "more"); // a phone: the page sits under More
    const measure = () => setBox(el?.getBoundingClientRect() ?? null);
    measure();
    addEventListener("resize", measure);
    addEventListener("scroll", measure, true);
    return () => { removeEventListener("resize", measure); removeEventListener("scroll", measure, true); };
  }, [s]);
  useEffect(() => { if (stops && stops.length === 0) onEnd(false); }, [stops, onEnd]);
  if (!s || !stops) return null;
  const vh = typeof innerHeight === "number" ? innerHeight : 800;
  // Beside the link in the side menu; otherwise above it when it's low on the screen (the phone's tab bar), or below it.
  const vw = innerWidth, under = box ? Math.max(16, Math.min(box.left + box.width / 2 - 160, vw - 336)) : 16;
  const style: React.CSSProperties = !box ? { left: 16, right: 16, bottom: 96, margin: "0 auto" }
    : box.right + 352 <= vw ? { top: Math.max(12, box.top - 8), left: box.right + 16 }
    : box.top > vh * 0.6 ? { left: under, bottom: vh - box.top + 14 }
    : { left: under, top: box.bottom + 14 };
  return createPortal(
    <>
      {box && <div className="tour-ring" aria-hidden style={{ top: box.top - 4, left: box.left - 4, width: box.width + 8, height: box.height + 8 }} />}
      <div className="tour" role="dialog" aria-label={`Tour, ${i + 1} of ${stops.length}: ${s.title}`} style={style}>
        <span className="wp-eyebrow">{count ? `${i + 1} of ${stops.length}` : `Tip ${i + 1}`} · {s.title}</span>
        <p className="wp-small">{s.text}{!target(s.href) && target("/more", "more") ? " You'll find it under More." : ""}</p>
        <div className="tour-acts"><button type="button" className="linkbtn wp-small" onClick={() => onEnd(true)}>Skip tour</button><span className="sp" />
          <Button size="sm" variant="primary" onClick={() => (i + 1 < stops.length ? setI(i + 1) : onEnd(false))}>{i + 1 < stops.length ? "Next" : "Done"}</Button></div>
      </div>
    </>,
    document.body,
  );
}
// A menu link to this page (links can carry a query, e.g. the kit's), on screen now.
// The phone's closed side menu is still in the page, just off screen, so the link must be inside the window.
const target = (href: string, label?: string) => {
  const on = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).filter((el) => {
    try {
      if (new URL(el.href).pathname !== href || el.offsetParent === null) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight;
    } catch { return false; }
  });
  return (label && on.find((el) => el.textContent?.toLowerCase().includes(label))) || on[0] || null;
};
// In the client's menu at all (on a phone some of it sits under More).
const visible = (href: string) => Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).some((el) => { try { return new URL(el.href).pathname === href; } catch { return false; } });
