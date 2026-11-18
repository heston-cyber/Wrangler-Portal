// Phase 7 step 2 (D109, D111): a new business's setup, frames 750:1123 (2 Your business), 750:1399 (3 Email), 750:1649
// (4 Pricing), 750:1885 (5 Connections), 750:2099 (6 First client), and the Home checklist (751:1096). Step 1 is the
// sign-in (SignIn's owner Welcome). Every step has Finish later; Continue saves and moves on. From step 3 the page wears
// the colours just chosen (Q33: it starts in the WranglerPortal look and becomes theirs).
// Not built from the frames: step 2's Time zone. Every date the portal shows is in Central Time today; a per-business
// time zone is a separate change (reported to Heston, Nov 18).
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { Id } from "../../../convex/_generated/dataModel";
import { api } from "../../../convex/_generated/api";
import { Button, ListRow, StatusChip, TextField } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { errLine } from "../../ui/hold";
import { navigate, linkProps } from "../../lib/router";
import { Frame } from "../payments/ClientInvoice";

type Step = 2 | 3 | 4 | 5 | 6;
const TITLES: Record<Step, [string, string, string]> = {
  2: ["Your business", "Your business and its look.", "Clients see this on every page and email."],
  3: ["Email", "How your emails look.", "Invoices, invites and updates go out under your name."],
  4: ["Pricing", "Your rates.", "Quotes, proposals and estimates suggest prices from these. Fill in what you know; the rest lives in Settings › Pricing."],
  5: ["Connections", "Connect your tools.", "All optional. Each one turns on a part of the portal; you can connect them later in Settings."],
  6: ["First client", "Invite your first client.", "They get a welcome email in your look and set up their side."],
};
const KEY: Record<Step, "business" | "email" | "pricing" | "connections" | "client"> = { 2: "business", 3: "email", 4: "pricing", 5: "connections", 6: "client" };
const hex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);

export default function Setup({ start }: { start: number | null }) {
  const st = useQuery(api.setup.state, {});
  const biz = useQuery(api.business.settings, {});
  const mark = useMutation(api.setup.step);
  const [step, setStep] = useState<Step>(() => (start && start >= 2 && start <= 6 ? start : 2) as Step);
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const placed = useRef(false);
  useEffect(() => { // open on the step they left, unless a step was asked for
    if (placed.current || !st || start) return;
    placed.current = true;
    setStep(Math.min(6, Math.max(2, st.step + 2)) as Step);
  }, [st, start]);
  if (st === null) return <Frame inShell={false} bar={null}><p className="wp-body">Setup is done for this business. <a {...linkProps("/")}>Back to the portal</a></p></Frame>;
  if (!st || !biz) return <Frame inShell={false} bar={null}><p className="wp-small secondary">Loading…</p></Frame>;
  const themed = step >= 3 && hex(biz.accent ?? "");
  const later = async () => { await mark({ at: step - 2 }).catch(() => undefined); navigate("/"); };
  const go = async (save: () => Promise<unknown>) => {
    setBusy(true); setErr(null);
    try { await save(); await mark({ done: KEY[step], at: step - 1 }); if (step === 6) navigate("/"); else setStep((step + 1) as Step); }
    catch (e) { setErr(errLine(e)); } finally { setBusy(false); }
  };
  const [label, title, sub] = TITLES[step];
  return (
    <Frame inShell={false} bar={null} brand={step >= 3 ? { name: biz.name, logoUrl: biz.logoUrl } : null}>
      <div className="ob" style={themed ? { ["--accent" as string]: biz.accent!, ["--ob-bg" as string]: hex(biz.background ?? "") ? biz.background! : undefined } : undefined}>
        {step < 3 && <span className="ob-brand">WranglerPortal</span>}
        <span className="ob-prog" aria-label={`Step ${step} of 6`}>{[1, 2, 3, 4, 5, 6].map((n) => <i key={n} className={n <= step ? "on" : ""} />)}</span>
        <span className="wp-small secondary">Step {step} of 6 · {label}</span>
        <h1 className="wp-h2">{title}</h1>
        <p className="wp-body secondary">{sub}</p>
        {step === 2 && <BusinessStep biz={biz} busy={busy} err={err} onNext={go} onLater={later} onBack={null} />}
        {step === 3 && <EmailStep biz={biz} busy={busy} err={err} onNext={go} onLater={later} onBack={() => setStep(2)} />}
        {step === 4 && <PricingStep rates={st.rates} busy={busy} err={err} onNext={go} onLater={later} onBack={() => setStep(3)} />}
        {step === 5 && <ConnectStep c={st.connections} busy={busy} err={err} onNext={go} onLater={later} onBack={() => setStep(4)} />}
        {step === 6 && <ClientStep busy={busy} err={err} onNext={go} onLater={later} onBack={() => setStep(5)} />}
      </div>
    </Frame>
  );
}

type Biz = NonNullable<ReturnType<typeof useQuery<typeof api.business.settings>>>;
type StepProps = { busy: boolean; err: string | null; onNext: (save: () => Promise<unknown>) => Promise<void>; onLater: () => Promise<void>; onBack: (() => void) | null };

function Foot({ busy, err, onLater, onBack, next = "Continue", disabled }: Omit<StepProps, "onNext"> & { next?: string; disabled?: boolean }) {
  return (
    <>
      {err && <p className="error" role="alert">{err}</p>}
      <div className="ob-foot">
        <button type="button" className="linkbtn" onClick={() => void onLater()}>Finish later</button>
        <span className="sp" />
        {onBack && <Button variant="ghost" onClick={onBack}>Back</Button>}
        <Button type="submit" variant="primary" loading={busy} disabled={disabled}>{next}</Button>
      </div>
    </>
  );
}

function BusinessStep({ biz, ...p }: { biz: Biz } & StepProps) {
  const save = useMutation(api.business.updateSettings);
  const [f, setF] = useState({ name: biz.name, legalName: biz.legalName ?? "", accent: biz.accent ?? "", background: biz.background ?? "" });
  const bad = (v: string) => !!v && !hex(v);
  return (
    <form onSubmit={(e) => { e.preventDefault(); void p.onNext(() => save({ name: f.name, legalName: f.legalName || null, accent: f.accent.toUpperCase() || null, background: f.background.toUpperCase() || null })); }}>
      <div className="ob-card glass">
        <div className="ob-two">
          <TextField label="Business name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={80} />
          <TextField label="Legal name" value={f.legalName} onChange={(e) => setF({ ...f, legalName: e.target.value })} maxLength={120} />
        </div>
        <div className="ob-two"><LogoPick label="Logo · on dark" which="dark" url={biz.logoUrl} /><LogoPick label="Logo · on light" which="light" url={biz.logoLightUrl ?? null} /></div>
        <div className="ob-two">
          <TextField label="Accent colour" value={f.accent} onChange={(e) => setF({ ...f, accent: e.target.value.trim() })} placeholder="#FF0000" maxLength={7} error={bad(f.accent) ? "A colour like #2F7BFF." : undefined} />
          <TextField label="Background colour" value={f.background} onChange={(e) => setF({ ...f, background: e.target.value.trim() })} placeholder="#030104" maxLength={7} error={bad(f.background) ? "A colour like #06080D." : undefined} />
        </div>
        <p className="wp-small secondary">Logos up to 1 MB: PNG, JPG, SVG or WebP. You can change all of this in Settings › Business.</p>
      </div>
      <Foot {...p} disabled={!f.name.trim() || bad(f.accent) || bad(f.background)} />
    </form>
  );
}

function LogoPick({ label, which, url }: { label: string; which: "dark" | "light"; url: string | null }) {
  const uploadUrl = useMutation(api.business.logoUploadUrl);
  const setLogo = useMutation(api.business.setLogo);
  const input = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const pick = async (file: File) => {
    if (!/^image\/(png|jpeg|svg\+xml|webp)$/.test(file.type) || file.size > 1_000_000) { setMsg("Use a PNG, JPG, SVG or WebP image under 1 MB."); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(await uploadUrl({}), { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!r.ok) throw new Error("The upload didn't finish. Try again.");
      const { storageId } = (await r.json()) as { storageId: Id<"_storage"> };
      await setLogo({ storageId, which });
    } catch (e) { setMsg(errLine(e)); } finally { setBusy(false); }
  };
  return (
    <div className="wp-field">
      <span className="wp-field-label">{label}</span>
      <button type="button" className={`ob-drop${which === "light" ? " light" : ""}`} aria-busy={busy || undefined} onClick={() => input.current?.click()}
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void pick(f); }}>
        {url ? <img src={url} alt="" /> : <><Icon name="upload" size={16} /> Drop, or <b>browse</b></>}
      </button>
      {msg && <span className="wp-small error">{msg}</span>}
      <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void pick(f); }} />
    </div>
  );
}

function EmailStep({ biz, ...p }: { biz: Biz } & StepProps) {
  const save = useMutation(api.business.updateSettings);
  const [f, setF] = useState({ emailFromName: biz.emailFromName ?? biz.name, replyTo: biz.replyTo ?? biz.ownerEmail ?? "", address: biz.address ?? "", privacyUrl: biz.privacyUrl ?? "" });
  return (
    <form onSubmit={(e) => { e.preventDefault(); void p.onNext(() => save({ emailFromName: f.emailFromName || null, replyTo: f.replyTo || null, address: f.address || null, privacyUrl: f.privacyUrl || null })); }}>
      <div className="ob-card glass">
        <div className="ob-two">
          <TextField label="From name" value={f.emailFromName} onChange={(e) => setF({ ...f, emailFromName: e.target.value })} maxLength={80} />
          <TextField label="Replies go to" type="email" value={f.replyTo} onChange={(e) => setF({ ...f, replyTo: e.target.value })} />
        </div>
        <TextField label="Business address" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} placeholder="Street, city, state ZIP" maxLength={200} />
        <TextField label="Privacy policy link" type="url" value={f.privacyUrl} onChange={(e) => setF({ ...f, privacyUrl: e.target.value })} placeholder="https://" />
        <p className="wp-small secondary">Stripe needs the address and privacy link on receipts.</p>
      </div>
      <Foot {...p} />
    </form>
  );
}

type RatesIn = { hourly: number | null; daily: number | null; shooting: number | null; editing: number | null };
function PricingStep({ rates, ...p }: { rates: RatesIn } & StepProps) {
  const save = useMutation(api.setup.saveRates);
  const [f, setF] = useState(() => Object.fromEntries(Object.entries(rates).map(([k, x]) => [k, x === null ? "" : String(x)])) as Record<keyof RatesIn, string>);
  const num = (s: string) => (s.trim() === "" ? undefined : Number(s.replace(/[$,]/g, "")));
  const bad = Object.values(f).some((s) => s.trim() !== "" && !(Number(s.replace(/[$,]/g, "")) >= 0));
  const field = (k: keyof RatesIn, label: string, ph: string) => <TextField label={label} inputMode="decimal" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder={ph} />;
  return (
    <form onSubmit={(e) => { e.preventDefault(); void p.onNext(() => save({ hourly: num(f.hourly), daily: num(f.daily), shooting: num(f.shooting), editing: num(f.editing) })); }}>
      <div className="ob-card glass">
        <div className="ob-two">{field("hourly", "Hourly rate", "$000")}{field("daily", "Daily rate", "$0,000")}</div>
        <div className="ob-two">{field("shooting", "Shooting rate", "$000 / hour")}{field("editing", "Editing rate", "$000 / hour")}</div>
        <p className="wp-small secondary">Discounts, multipliers, subcontractor costs and a custom formula are in Settings › Pricing.</p>
      </div>
      <Foot {...p} disabled={bad} />
    </form>
  );
}

const TOOLS = [
  { k: "stripe", name: "Stripe", sub: "Send invoices and take card and bank payments", to: "/settings/payments", verb: "Connect" },
  { k: "dropbox", name: "Dropbox", sub: "Final files, uploads and file requests", to: "/settings/dropbox", verb: "Connect" },
  { k: "claude", name: "Claude connectors", sub: "Draft proposals, notes and ledger entries from your own Claude app", to: "/settings/connectors", verb: "Set up" },
  { k: "calendar", name: "Google Calendar", sub: "Put shoots on your calendar", to: "/settings/calendar", verb: "Connect" },
] as const;
function ConnectStep({ c, ...p }: { c: Record<"stripe" | "dropbox" | "claude" | "calendar", boolean> } & StepProps) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); void p.onNext(async () => null); }}>
      <div className="ob-card glass ob-tools">
        {TOOLS.map((t) => (
          <div key={t.k} className="ob-tool"><span><b>{t.name}</b><span className="wp-small secondary">{t.sub}</span></span>
            {c[t.k] ? <StatusChip tone="success">Connected</StatusChip> : <Button size="sm" onClick={() => navigate(t.to)}>{t.verb}</Button>}</div>
        ))}
        <p className="wp-small secondary">Each one opens its page in Settings. The checklist on your Home brings you back here.</p>
      </div>
      <Foot {...p} />
    </form>
  );
}

function ClientStep(p: StepProps) {
  const send = useMutation(api.setup.firstClient);
  const [f, setF] = useState({ company: "", name: "", email: "" });
  return (
    <form onSubmit={(e) => { e.preventDefault(); void p.onNext(() => send(f)); }}>
      <div className="ob-card glass">
        <TextField label="Company" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} maxLength={80} required />
        <div className="ob-two">
          <TextField label="Contact name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={60} />
          <TextField label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
        </div>
        <p className="wp-small secondary">Or skip this and invite clients from Clients › Companies.</p>
      </div>
      <Foot {...p} next="Send invite" disabled={!f.company.trim() || !f.email.trim()} />
    </form>
  );
}

/** 751:1096: the setup checklist at the top of a new business's Home, until it's done or hidden. */
export function SetupChecklist() {
  const st = useQuery(api.setup.state, {});
  const hide = useMutation(api.setup.hide);
  const asked = useRef(false);
  useEffect(() => { // the first time in, setup opens by itself (once per browser session)
    if (!st || asked.current || st.finished || st.hidden || st.step > 0 || Object.values(st.done).some(Boolean)) return;
    asked.current = true;
    try { if (sessionStorage.getItem("wp.setupOpened")) return; sessionStorage.setItem("wp.setupOpened", "1"); } catch { /* ignore */ }
    navigate("/setup");
  }, [st]);
  if (!st || st.finished || st.hidden) return null;
  const r = st.rates, rateCount = [r.hourly, r.daily, r.shooting, r.editing].filter((x) => x !== null).length;
  const rows = [
    { t: "Your business and its look", done: st.done.business, sub: st.done.business ? "Done" : "Name, logo and colours", to: "/setup?step=2", verb: "Finish" },
    { t: "Email", done: st.done.email, sub: st.done.email ? "Done" : "Who your emails come from", to: "/setup?step=3", verb: "Finish" },
    { t: "Pricing", done: st.done.pricing && rateCount === 4, sub: rateCount ? `${rateCount} rate${rateCount === 1 ? "" : "s"} set${rateCount < 4 ? " · add the rest" : ""}` : "Your rates", to: rateCount ? "/settings/rates" : "/setup?step=4", verb: "Finish" },
    { t: "Stripe", done: st.connections.stripe, sub: st.connections.stripe ? "Connected" : "Needed to send invoices and take payments", to: "/settings/payments", verb: "Connect" },
    { t: "Google Calendar", done: st.connections.calendar, sub: st.connections.calendar ? "Connected" : "Optional · put shoots on your calendar", to: "/settings/calendar", verb: "Connect" },
    { t: "Invite your first client", done: st.done.client, sub: st.done.client ? "Done" : "They get a welcome email in your look", to: "/setup?step=6", verb: "Invite" },
  ];
  const n = rows.filter((x) => x.done).length;
  return (
    <section className="wp-card glass ob-check" aria-label="Set up">
      <div className="ob-checkhead"><span className="wp-eyebrow">Set up {st.business}</span><span className="wp-small secondary">{n} of {rows.length} done</span><span className="sp" />
        <button type="button" className="linkbtn wp-small" onClick={() => void hide({ hidden: true })}>Hide</button></div>
      {rows.map((x) => (
        <ListRow key={x.t} lead={{ icon: x.done ? "check-circle" : "clock" }} title={x.t} meta={x.sub}
          action={x.done ? undefined : <Button size="sm" onClick={() => navigate(x.to)}>{x.verb}</Button>} />
      ))}
    </section>
  );
}
