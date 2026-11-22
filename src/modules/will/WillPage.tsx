// Nov 22 (Heston, approved: D1 answers only in this browser, D3 the declaration page now and a notary page left blank,
// D4 clean and simple, no glass; then "Each does their own" and "Hidden link, no sign-in"): the will walkthrough at a
// hidden address (WILL_PATH). It's in no menu and needs no sign-in, so Heston and Emily-Rose can each make their own will
// on their own computer at the same time. Nothing on this page is sent anywhere: it makes no server calls, the answers
// are kept in this browser's storage, and the PDFs are made here.
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Checkbox, Segmented, TextArea, TextField } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import {
  STEPS, blank, firstIncomplete, stepIssues, upgrade, warnings, willFor,
  type Gift, type Named, type Pronoun, type StepKey, type WillAnswers,
} from "./willText";

/** The page's hidden address (no sign-in). Changing it only moves the page; nothing is stored under it. */
export const WILL_PATH = /^\/will\/r8vq2n5w\/?$/;
export const WILL_KEY = "wp-will-v1";
function load(): WillAnswers {
  try { const raw = localStorage.getItem(WILL_KEY); return raw ? upgrade(JSON.parse(raw)) : blank(); } catch { return blank(); }
}
function store(a: WillAnswers) { try { localStorage.setItem(WILL_KEY, JSON.stringify(a)); } catch { /* private window: kept for this visit only */ } }
function erase() { try { localStorage.removeItem(WILL_KEY); } catch { /* nothing stored */ } }

export default function WillWalkthrough() {
  const [a, setA] = useState<WillAnswers>(load);
  const [step, setStep] = useState<StepKey>("start");
  const [tried, setTried] = useState(false);
  const [confirmErase, setConfirmErase] = useState(false);
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => { store(a); }, [a]);
  useEffect(() => { document.title = "Will"; }, []);
  const i = STEPS.findIndex((s) => s.key === step);
  const issues = stepIssues(a, step);
  const err = (k: string) => (tried ? issues[k] : undefined);
  const set = (patch: Partial<WillAnswers>) => setA((x) => ({ ...x, ...patch }));
  const go = (k: StepKey) => { setStep(k); setTried(false); top.current?.scrollIntoView({ block: "start" }); };
  const next = () => {
    if (Object.keys(issues).length) { setTried(true); return; }
    if (i < STEPS.length - 1) go(STEPS[i + 1].key);
  };
  const B = a.b.name.trim() || "your spouse";

  return (
    <div className="will-page" ref={top}>
      <div className="will-wrap">
        <div className="will-top">
          <span className="will-brand"><b>Will</b> <span className="wp-small secondary">· a temporary Oklahoma will</span></span>
          <span className="will-top-r"><span className="wp-small secondary"><Icon name="lock" size={14} /> Saved only on this device</span></span>
        </div>
        <div className="will-grid">
          <nav className="will-steps" aria-label="Steps">
            <ol>
              {STEPS.map((s, n) => {
                // Steps up to the first one still needing an answer can be opened; the ones before it are done.
                const reach = Math.max(i, STEPS.findIndex((x) => x.key === (firstIncomplete(a) ?? "review")));
                const done = n < reach && n !== i && s.key !== "review";
                return (
                  <li key={s.key}>
                    <button type="button" aria-current={s.key === step ? "step" : undefined} className={done ? "done" : undefined}
                      disabled={n > reach} onClick={() => go(s.key)}>
                      <span className="n">{done ? <Icon name="check" size={12} /> : n + 1}</span>{s.title}
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
          <main className="will-card">
            <div className="will-progress" aria-hidden><span style={{ width: `${(i / (STEPS.length - 1)) * 100}%` }} /></div>
            <span className="wp-eyebrow">Step {i + 1} of {STEPS.length}</span>
            <h1 className="will-h">{STEPS[i].title}</h1>

            {step === "start" && <Start />}

            {step === "you" && <>
              <p className="will-lead">Full legal names, exactly as they appear on your driver's licenses. This makes your will; your spouse makes theirs on their own device.</p>
              <PersonFields label="You" p={a.a} err={(k) => err(`a.${k}`)} onChange={(p) => set({ a: { ...a.a, ...p } })} />
              <fieldset className="will-set"><legend>Your spouse</legend>
                <TextField label="Full legal name" value={a.b.name} error={err("b.name")} onChange={(e) => set({ b: { ...a.b, name: e.target.value } })} autoComplete="off" />
              </fieldset>
              <h2 className="will-sub">Where you live</h2>
              <div className="will-row">
                <TextField label="City" value={a.city} error={err("city")} onChange={(e) => set({ city: e.target.value })} placeholder="Oklahoma City" />
                <TextField label="County" value={a.county} error={err("county")} onChange={(e) => set({ county: e.target.value })} placeholder="Oklahoma" hint="Just the name; “County” is added." />
              </div>
              <p className="wp-small secondary">State: Oklahoma.</p>
            </>}

            {step === "children" && <>
              <p className="will-lead">Children you have now. The wills also cover any child born or adopted later, so the baby is included automatically.</p>
              {a.children.map((c, n) => (
                <div className="will-row will-item" key={n}>
                  <TextField label={`Child ${n + 1}: full name`} value={c.name} error={err(`children.${n}`)} onChange={(e) => set({ children: a.children.map((x, j) => (j === n ? { ...x, name: e.target.value } : x)) })} />
                  <TextField label="Born (optional)" value={c.born} placeholder="May 4, 2027" onChange={(e) => set({ children: a.children.map((x, j) => (j === n ? { ...x, born: e.target.value } : x)) })} />
                  <RemoveBtn label={`Remove child ${n + 1}`} onClick={() => set({ children: a.children.filter((_, j) => j !== n) })} />
                </div>
              ))}
              <Button variant="ghost" icon="plus" onClick={() => set({ children: [...a.children, { name: "", born: "" }] })}>{a.children.length ? "Add another child" : "Add a child"}</Button>
              <h2 className="will-sub">A baby on the way</h2>
              <Checkbox checked={a.expecting} onChange={(v) => set({ expecting: v })} label="We're expecting a child" hint="Named in the will as on the way. Once the baby's born, add them above and print again if you like; the wills work either way." />
              {a.expecting && <TextField label="Due" value={a.due} error={err("due")} onChange={(e) => set({ due: e.target.value })} placeholder="April 2027" />}
            </>}

            {step === "executor" && <>
              <p className="will-lead">The executor carries out the will: gathers what you own, pays final bills and hands everything to the right people. If you name no one, a court picks someone.</p>
              <Checkbox checked={a.executorSpouse} onChange={(v) => set({ executorSpouse: v })} label={`My spouse is my executor`} hint={`${B === "your spouse" ? "Your spouse" : B} carries out your will. Most couples name each other.`} />
              {!a.executorSpouse && <NamedFields label="Executor" n={a.executor} err={(k) => err(`executor.${k}`)} onChange={(x) => set({ executor: { ...a.executor, ...x } })} />}
              <NamedFields label="Backup executor" hint="Steps in if the first choice can't or won't serve, including if you both die." n={a.backupExecutor} err={(k) => err(`backupExecutor.${k}`)} onChange={(x) => set({ backupExecutor: { ...a.backupExecutor, ...x } })} />
              <Checkbox checked={a.noBond} onChange={(v) => set({ noBond: v })} label="The executor doesn't need to post a bond" hint="A bond is insurance the court can require; skipping it saves your family money and time. Usual when you trust your executor." />
            </>}

            {step === "inherit" && <>
              <p className="will-lead">Who gets everything you don't give away as a specific gift.</p>
              <ol className="will-order">
                <li><b>First, your spouse.</b> Everything goes to {B}.</li>
                <li><b>If your spouse has died, your children</b>, in equal shares (including the baby). A child who has died has their share go to their own children.</li>
                <li><b>If none of your family survives you</b>, the people below, in equal shares.</li>
              </ol>
              {a.fallback.map((f, n) => (
                <div className="will-row will-item" key={n}>
                  <TextField label={`Backup beneficiary ${n + 1}: full name`} value={f.name} onChange={(e) => set({ fallback: a.fallback.map((x, j) => (j === n ? { ...x, name: e.target.value } : x)) })} />
                  <TextField label="Relationship" value={f.relation} placeholder="sister, parents, friend" onChange={(e) => set({ fallback: a.fallback.map((x, j) => (j === n ? { ...x, relation: e.target.value } : x)) })} />
                  {a.fallback.length > 1 && <RemoveBtn label={`Remove backup beneficiary ${n + 1}`} onClick={() => set({ fallback: a.fallback.filter((_, j) => j !== n) })} />}
                </div>
              ))}
              {err("fallback") && <p className="wp-field-error" role="alert">{err("fallback")}</p>}
              <Button variant="ghost" icon="plus" onClick={() => set({ fallback: [...a.fallback, { name: "", relation: "" }] })}>Add a person</Button>
              <h2 className="will-sub">Survival period</h2>
              <p className="wp-small secondary">Someone must outlive you by this long to inherit. It keeps property from passing twice if you both die close together.</p>
              <select className="input will-select" aria-label="Survival period" value={a.survivalDays} onChange={(e) => set({ survivalDays: Number(e.target.value) })}>
                {[30, 60, 90, 120].map((d) => <option key={d} value={d}>{d} days</option>)}
                <option value={0}>None</option>
              </select>
            </>}

            {step === "gifts" && <>
              <p className="will-lead">Optional. Particular things to particular people, like a vehicle, a camera kit or a family heirloom. Skip this if everything goes to your spouse.</p>
              <GiftList title="Your gifts" list={a.giftsA} err={(n) => err(`giftsA.${n}`)} onChange={(l) => set({ giftsA: l })} />
            </>}

            {step === "guardian" && <>
              {a.children.some((c) => c.name.trim()) || a.expecting ? <>
                <p className="will-lead">Who raises your child if you both die. The surviving parent keeps custody, so this only matters if neither of you can.</p>
                <NamedFields label="Guardian" hint="One person, or a couple written as “Jane Doe and John Doe”." n={a.guardian} err={(k) => err(`guardian.${k}`)} onChange={(x) => set({ guardian: { ...a.guardian, ...x } })} />
                <NamedFields label="Backup guardian" n={a.backupGuardian} err={(k) => err(`backupGuardian.${k}`)} onChange={(x) => set({ backupGuardian: { ...a.backupGuardian, ...x } })} />
              </> : <p className="will-lead">No children yet and none on the way, so there's no guardian to name. Go on to the next step.</p>}
            </>}

            {step === "money" && <>
              <p className="will-lead">Anything a child (or anyone young) inherits is managed for them until the age you pick here.</p>
              {(a.children.some((c) => c.name.trim()) || a.expecting) && (
                <Checkbox checked={a.managerSame} onChange={(v) => set({ managerSame: v })} label="The guardian manages the money too" hint={a.guardian.name.trim() ? `${a.guardian.name.trim()}, with ${a.backupGuardian.name.trim() || "the backup guardian"} as backup.` : "The guardian and backup guardian you named."} />
              )}
              {(!a.managerSame || !(a.children.some((c) => c.name.trim()) || a.expecting)) && <>
                <NamedFields label="Money manager" n={a.manager} err={(k) => err(`manager.${k}`)} onChange={(x) => set({ manager: { ...a.manager, ...x } })} />
                <NamedFields label="Backup money manager" n={a.backupManager} err={(k) => err(`backupManager.${k}`)} onChange={(x) => set({ backupManager: { ...a.backupManager, ...x } })} />
              </>}
              <h2 className="will-sub">Age they get it outright</h2>
              <select className="input will-select" aria-label="Age they get it outright" value={a.age} onChange={(e) => set({ age: Number(e.target.value) })}>
                {[18, 21, 25, 30, 35].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <p className="wp-small secondary">{a.age <= 21
                ? "Up to 21, the manager holds it as a custodian under Oklahoma's Uniform Transfers to Minors Act; simple and standard."
                : `Over 21, Oklahoma's custodian rules don't reach, so the will sets up a simple trust that holds it until ${a.age}, paying for health, education and living costs along the way.`}</p>
            </>}

            {step === "wishes" && <>
              <p className="will-lead">Optional. Leave these blank to skip them.</p>
              <TextField label="Who takes your pets" value={a.petsTo} placeholder="Full name" onChange={(e) => set({ petsTo: e.target.value })} />
              <TextArea label="Your funeral and burial wishes" compact value={a.wishesA} placeholder="Cremation, a small service at…" hint="A wish, not a binding instruction. Tell your family too; a will is often read after the funeral." onChange={(e) => set({ wishesA: e.target.value })} />
            </>}

            {step === "signing" && <>
              <p className="will-lead">Where you'll sign. The date is left blank so you write it by hand on the day.</p>
              <div className="will-row">
                <TextField label="City" value={a.signCity || a.city} error={err("signCity")} onChange={(e) => set({ signCity: e.target.value })} />
                <TextField label="County" value={a.signCounty || a.county} error={err("signCounty")} onChange={(e) => set({ signCounty: e.target.value })} />
              </div>
              <h2 className="will-sub">What gets printed</h2>
              <ul className="will-list">
                <li>The will, with a place to initial every page, your signature at the end, then two witnesses' signatures, names and addresses.</li>
                <li>A self-proving declaration page that you and both witnesses sign the same day. No notary needed; it lets a court accept the will without tracking down your witnesses.</li>
                <li>A notary page, left blank. If you notarize later, you and both witnesses go to the notary together.</li>
              </ul>
            </>}

            {step === "review" && <Review a={a} />}

            <div className="will-nav">
              {i > 0 ? <Button variant="ghost" icon="arrow-left" onClick={() => go(STEPS[i - 1].key)}>Back</Button> : <span />}
              {step !== "review" && <Button variant="primary" iconEnd="arrow-right" onClick={next}>{step === "start" ? "Start" : "Next"}</Button>}
            </div>
            {tried && Object.keys(issues).length > 0 && <p className="wp-small will-fix" role="status">Fill in the fields marked above to go on.</p>}
          </main>
        </div>
        <div className="will-foot">
          {confirmErase
            ? <span className="will-erase"><span className="wp-small">Erase every answer on this device?</span>
                <Button size="sm" variant="danger" onClick={() => { erase(); setA(blank()); setConfirmErase(false); go("start"); }}>Erase</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmErase(false)}>Keep them</Button></span>
            : <Button size="sm" variant="ghost" icon="close" onClick={() => setConfirmErase(true)}>Start over</Button>}
        </div>
      </div>
    </div>
  );
}

function Start() {
  return <>
    <p className="will-lead">This walks you through a simple, temporary will, then makes the PDF to print and sign. It takes about 15 minutes.</p>
    <ul className="will-list">
      <li><b>One will each.</b> You make yours here and your spouse makes theirs on their own device, at the same time if you like.</li>
      <li><b>Agree first</b> on your executor, guardian, the backups, who manages the baby's money and until what age, so both wills match.</li>
      <li><b>Only on this device.</b> Your answers are saved in this browser so you can stop and come back. Nothing is sent to the portal or anywhere else.</li>
      <li><b>Signed on paper.</b> Oklahoma needs a printed will, signed at the end in front of two adult witnesses who aren't named in it.</li>
      <li><b>Have ready:</b> full legal names, who you'd trust as executor and as guardian (plus a backup for each), and who inherits if none of your family survives you.</li>
    </ul>
    <p className="wp-small secondary">This isn't legal advice. It follows Oklahoma law (Okla. Stat. tit. 84, §55) and your guide, and an estate attorney can review the PDFs before you sign.</p>
  </>;
}

function Review({ a }: { a: WillAnswers }) {
  const missing = firstIncomplete(a);
  const wills = useMemo(() => (missing ? [] : [willFor(a, "a")]), [a, missing]);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(0);
  if (missing) return <p className="will-lead">“{STEPS.find((s) => s.key === missing)!.title}” still needs an answer. Use the steps on the left to finish it.</p>;
  const run = async (key: string, f: () => Promise<void>) => { setBusy(key); try { await f(); } finally { setBusy(null); } };
  const pdfs = () => import("./willPdf");
  return <>
    <p className="will-lead">Read your will all the way through. To change something, go back to its step; the wills update as you type.</p>
    <ul className="will-warn">{warnings(a).map((w) => <li key={w}><Icon name="info" size={16} />{w}</li>)}</ul>
    {wills.map((w, n) => (
      <section className="will-doc" key={w.title}>
        <button type="button" className="will-doc-h" aria-expanded={open === n} onClick={() => setOpen(open === n ? null : n)}>
          <Icon name="document" size={18} /><span>{w.title}</span><span className="sp" /><span className="wp-small secondary">{open === n ? "Hide" : "Read"}</span>
        </button>
        {open === n && <div className="will-text">
          <h3>Last Will and Testament</h3><p className="c">of {w.testator}</p>
          <p>{w.intro}</p>
          {w.articles.map((x) => <div key={x.title}><h4>{x.title}</h4>{x.paras.map((p, j) => <p key={j}>{p}</p>)}</div>)}
          <h4>Signature</h4><p>{w.signing}</p><p className="sig">______________________________ {w.testator}, Testator</p>
          <h4>Witnesses</h4><p>{w.attestation}</p><p className="sig">Two witness lines: signature, printed name and residence address.</p>
          <p className="wp-small secondary">Then the self-proving declaration page (signed the same day) and the notary page (left blank).</p>
        </div>}
      </section>
    ))}
    <div className="will-dl">
      {wills.map((w) => <Button key={w.title} variant="primary" icon="download" loading={busy === w.title} onClick={() => void run(w.title, async () => (await pdfs()).downloadWill(w))}>Download my will</Button>)}
      <Button variant="secondary" icon="download" loading={busy === "list"} onClick={() => void run("list", async () => (await pdfs()).downloadChecklist())}>Signing-day checklist</Button>
    </div>
    <p className="wp-small secondary">Print it single-sided. Don't write on a printed will; change it here and print again.</p>
  </>;
}

function PersonFields({ label, p, err, onChange }: { label: string; p: { name: string; aka: string; pronoun: Pronoun }; err: (k: string) => string | undefined; onChange: (p: Partial<{ name: string; aka: string; pronoun: Pronoun }>) => void }) {
  return (
    <fieldset className="will-set">
      <legend>{label}</legend>
      <div className="will-row">
        <TextField label="Full legal name" value={p.name} error={err("name")} onChange={(e) => onChange({ name: e.target.value })} autoComplete="off" />
        <TextField label="Also known as (optional)" value={p.aka} hint="A nickname or maiden name on accounts" onChange={(e) => onChange({ aka: e.target.value })} autoComplete="off" />
      </div>
      <div className="wp-field"><span className="wp-field-label">The will refers to them as</span>
        <Segmented label={`${label}: pronoun`} value={p.pronoun} onChange={(k) => onChange({ pronoun: k })} items={[{ key: "he", label: "He" }, { key: "she", label: "She" }, { key: "they", label: "They" }]} />
      </div>
    </fieldset>
  );
}

function NamedFields({ label, hint, n, err, onChange }: { label: string; hint?: string; n: Named; err: (k: string) => string | undefined; onChange: (n: Partial<Named>) => void }) {
  return (
    <fieldset className="will-set">
      <legend>{label}</legend>
      {hint && <p className="wp-small secondary">{hint}</p>}
      <div className="will-row three">
        <TextField label="Full name" value={n.name} error={err("name")} onChange={(e) => onChange({ name: e.target.value })} autoComplete="off" />
        <TextField label="Relationship (optional)" value={n.relation} placeholder="brother" onChange={(e) => onChange({ relation: e.target.value })} />
        <TextField label="City and state (optional)" value={n.place} placeholder="Edmond, Oklahoma" onChange={(e) => onChange({ place: e.target.value })} />
      </div>
    </fieldset>
  );
}

function GiftList({ title, list, err, onChange }: { title: string; list: Gift[]; err: (n: number) => string | undefined; onChange: (l: Gift[]) => void }) {
  const upd = (n: number, g: Partial<Gift>) => onChange(list.map((x, j) => (j === n ? { ...x, ...g } : x)));
  return (
    <fieldset className="will-set">
      <legend>{title}</legend>
      {!list.length && <p className="wp-small secondary">None.</p>}
      {list.map((g, n) => (
        <div className="will-gift" key={n}>
          <TextField label="Item" value={g.item} placeholder="my 2011 Jeep Wrangler" error={err(n)} onChange={(e) => upd(n, { item: e.target.value })} />
          <div className="will-row">
            <TextField label="Goes to" value={g.to} placeholder="Full name" onChange={(e) => upd(n, { to: e.target.value })} />
            <TextField label="If they've died, to (optional)" value={g.backup} onChange={(e) => upd(n, { backup: e.target.value })} />
            <RemoveBtn label={`Remove gift ${n + 1}`} onClick={() => onChange(list.filter((_, j) => j !== n))} />
          </div>
        </div>
      ))}
      <Button variant="ghost" icon="plus" onClick={() => onChange([...list, { item: "", to: "", backup: "" }])}>Add a gift</Button>
    </fieldset>
  );
}

function RemoveBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" className="will-x" aria-label={label} title={label} onClick={onClick}><Icon name="close" size={16} /></button>;
}
