// Phase 5b step 3 (Nov 3): Production › Call sheets (D126). List 765:2852 (Empty 771:6965), Templates 765:3564,
// New · Start 765:4235, the five questions 766:2956 / 766:3567 / 766:4212 / 766:4876 / 766:5581, the Editor (the Docs
// builder, 765:2056), Detail · Sent 766:6342 (phone 769:7589). The dialogs and the sheet as readers see it are in
// callSheetParts.tsx (the builder uses them too).
import { Fragment, Suspense, lazy, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button, ButtonLink, Card, Divider, EmptyState, ListRow, PageHeader, PillTabs, SectionHead, SkeletonRows, StatusChip, TextField, Toggle } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { Modal, useToast } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps, navigate } from "../../lib/router";
import { errText } from "../docs/pages/common";
import { fieldValues, newId, pageOf, type Fields } from "../../../convex/lib/wsBuilder";
import { clockOf, sheetDay, type Answers } from "../../../convex/lib/callSheet";
import { PeoplePicker, SendUpdate, SheetView, groupsOf, opened, reachable, type CallSheetInfo } from "./callSheetParts";

const Builder = lazy(() => import("../docs/builder/Builder"));
type Row = NonNullable<ReturnType<typeof useQuery<typeof api.callSheets.list>>>["rows"][number];
const md = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const edited = (t: number) => (new Date(t).toDateString() === new Date().toDateString() ? "Edited today" : `Edited ${md(t)}`);
const Line = ({ first, children }: { first: boolean; children: React.ReactNode }) => <div className="wp-rowwrap">{!first && <Divider />}{children}</div>;
const go = (to: string) => (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); navigate(to); };
const Crumbs = ({ children }: { children?: React.ReactNode }) => <TopBar><a {...linkProps("/production")}>Production</a><Sep />{children ?? <span className="here">Call sheets</span>}</TopBar>;
const CS = <a {...linkProps("/production/call-sheets")}>Call sheets</a>;

/** The chip and next step for a sheet (list, Production, Dashboard). */
export function sheetChip(s: { state: "questions" | "draft" | "sent"; opened: number; of: number }) {
  if (s.state === "sent") return <StatusChip tone="success">{s.of && s.opened === s.of ? "All opened" : `${s.opened} of ${s.of} opened`}</StatusChip>;
  return s.state === "draft" ? <StatusChip tone="warning">Not sent</StatusChip> : <StatusChip tone="neutral">Draft</StatusChip>;
}
export const sheetHref = (r: { _id: string; state: "questions" | "draft" | "sent" }) => (r.state === "sent" ? `/production/call-sheets/${r._id}` : r.state === "draft" ? `/production/call-sheets/${r._id}/edit` : `/production/call-sheets/${r._id}/questions`);

function useStarters() {
  const ensure = useMutation(api.callSheets.ensureStarters);
  const once = useRef(false);
  useEffect(() => { if (!once.current) { once.current = true; void ensure({}).catch(() => undefined); } }, [ensure]);
}

// ---------- the list (765:2852 · 771:6965) and Templates (765:3564) ----------

type Tab = "all" | "notSent" | "sent" | "templates";
export default function CallSheetsPage() {
  useStarters();
  const d = useQuery(api.callSheets.list, {});
  const first = new URLSearchParams(location.search).get("tab");
  const [tab, setTab] = useState<Tab>(first === "templates" || first === "sent" || first === "notSent" ? first : "all");
  const rows = (d?.rows ?? []).filter((r) => tab === "all" || (tab === "sent" ? r.state === "sent" : r.state !== "sent"));
  const meta = (r: Row) => [sheetDay(r.date), r.state === "questions" ? "Draft from the questionnaire" : `${r.people - r.guests} ${r.people - r.guests === 1 ? "person" : "people"}${r.guests ? `, ${r.guests} ${r.guests === 1 ? "guest" : "guests"}` : ""}`,
    r.state === "sent" && r.sentAt ? `Sent ${md(r.sentAt)}` : r.state === "draft" ? edited(r.editedAt) : null].filter(Boolean).join(" · ");
  return (
    <>
      {tab === "templates" ? <Crumbs>{CS}<Sep /><span className="here">Templates</span></Crumbs> : <Crumbs />}
      <div className="wp-page prod">
        <PageHeader eyebrow="Production" title="Call sheets." sub="Written, sent and opened." actions={<ButtonLink variant="primary" to="/production/call-sheets/new" iconEnd={false}>New call sheet</ButtonLink>} />
        {d === undefined ? <Card label="Loading"><SkeletonRows n={4} /></Card>
          : d === null ? null
          : d.rows.length === 0 && tab !== "templates" ? <EmptyState icon="document" title="No call sheets yet"
              body="Write one for a shoot: answer a few questions, start from a template, or write it in the editor. Everyone on it reads it in the portal."
              actions={<><ButtonLink variant="primary" to="/production/call-sheets/new" iconEnd={false}>New call sheet</ButtonLink><Button onClick={() => setTab("templates")}>Use a template</Button></>} />
          : <>
            <PillTabs label="Which call sheets" value={tab} onChange={setTab} items={[
              { key: "all", label: "All", count: d.rows.length }, { key: "notSent", label: "Not sent", count: d.rows.filter((r) => r.state !== "sent").length },
              { key: "sent", label: "Sent", count: d.rows.filter((r) => r.state === "sent").length }, { key: "templates", label: "Templates", count: d.templates.length },
            ]} />
            {tab === "templates" ? <>
              <Card label="Templates">
                {d.templates.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "document" }} title="No call sheet templates yet." />
                  : d.templates.map((t, i) => (
                    <Line key={t._id} first={i === 0}>
                      <ListRow className="ilead ovact" lead={{ icon: "document" }} to={`/production/call-sheets/templates/${t._id}`} title={t.name}
                        meta={[t.description, t.used ? `Used ${t.used === 1 ? "once" : `${t.used} times`}` : "Not used yet"].filter(Boolean).join(" · ")}
                        action={<Button size="sm" onClick={go(`/production/call-sheets/new?template=${t._id}`)}>Use</Button>} />
                    </Line>
                  ))}
              </Card>
              <p className="wp-small secondary cs-foot">Save any call sheet as a template from the editor. Templates keep the layout, not the people.</p>
            </> : rows.length === 0 ? <EmptyState icon="document" title={tab === "sent" ? "Nothing sent yet." : "Everything's sent."} />
            : <Card label="Call sheets">
              {rows.map((r, i) => (
                <Line key={r._id} first={i === 0}>
                  <ListRow className="ilead ovact" lead={{ icon: "document" }} to={sheetHref(r)} title={r.title} meta={meta(r)} chip={sheetChip(r)} chevron={r.state === "sent"}
                    action={r.state === "sent" ? undefined : r.state === "draft" ? <Button size="sm" onClick={go(`/production/call-sheets/${r._id}/edit?send=1`)}>Send</Button> : <Button size="sm" onClick={go(sheetHref(r))}>Finish it</Button>} />
                </Line>
              ))}
            </Card>}
          </>}
      </div>
    </>
  );
}

// ---------- New · Start (765:4235) ----------

export function NewCallSheet({ shootId, templateId }: { shootId: string | null; templateId: string | null }) {
  useStarters();
  const o = useQuery(api.callSheets.newOptions, {});
  const create = useMutation(api.callSheets.create);
  const [shoot, setShoot] = useState<string>(shootId ?? "");
  const [tpl, setTpl] = useState<string>(templateId ?? "");
  const [picking, setPicking] = useState(!!templateId);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, show] = useToast();
  useEffect(() => { if (o && !shoot && o.shoots[0]) setShoot(o.shoots[0]._id); }, [o]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (o && !tpl && o.templates[0]) setTpl(o.templates[0]._id); }, [o]); // eslint-disable-line react-hooks/exhaustive-deps
  const start = async (how: "questions" | "template" | "blank") => {
    if (!shoot) return;
    setBusy(how);
    try {
      const id = await create({ shootId: shoot as Id<"shoots">, how, ...(how === "template" ? { templateId: tpl as Id<"wsTemplates"> } : how === "questions" && templateId ? { templateId: templateId as Id<"wsTemplates"> } : {}) });
      navigate(how === "questions" ? `/production/call-sheets/${id}/questions` : `/production/call-sheets/${id}/edit`);
    } catch (e) { show(errText(e)); setBusy(null); }
  };
  return (
    <>
      <Crumbs>{CS}<Sep /><span className="here">New call sheet</span></Crumbs>
      <div className="wp-page prod">
        <PageHeader eyebrow="Production" title="New call sheet." sub="Pick the shoot first, then how you want to write it." />
        {o === undefined ? <Card label="Loading"><SkeletonRows n={2} /></Card> : o === null ? null : <>
          <section className="qz-card glass">
            <span className="wp-eyebrow">Shoot</span>
            {o.shoots.length === 0 ? <p className="wp-body secondary">Every upcoming shoot has a call sheet. <a {...linkProps("/production/shoots")} className="cs-link">Schedule a shoot</a> to write another.</p> : <>
              <label className="wp-field"><span className="wp-field-label">Shoot</span>
                <span className="qz-icon-in"><Icon name="video" size={16} /><select className="input" value={shoot} onChange={(e) => setShoot(e.target.value)}>{o.shoots.map((s) => <option key={s._id} value={s._id}>{s.label}</option>)}</select></span></label>
              <span className="wp-small secondary">Only shoots that don’t have a call sheet yet are listed.</span>
            </>}
          </section>
          <div className="cs-ways">
            <section className="qz-card glass cs-way"><Icon name="quote" size={20} /><b>Answer a few questions</b><p className="wp-small">Five short steps: times, place, people, schedule. The sheet fills itself in and opens in the editor.</p>
              <Button variant="primary" disabled={!shoot} loading={busy === "questions"} onClick={() => void start("questions")}>Start the questions</Button></section>
            <section className="qz-card glass cs-way"><Icon name="document" size={20} /><b>Use a template</b><p className="wp-small">Start from a saved layout, like Standard shoot day. Then edit it in the editor.</p>
              {picking ? <div className="cs-pick">
                <select className="input" aria-label="Template" value={tpl} onChange={(e) => setTpl(e.target.value)}>{o.templates.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}</select>
                <Button variant="primary" disabled={!shoot || !tpl} loading={busy === "template"} onClick={() => void start("template")}>Use it</Button></div>
                : <Button disabled={!shoot || !o.templates.length} onClick={() => setPicking(true)}>Choose a template</Button>}</section>
            <section className="qz-card glass cs-way"><Icon name="document" size={20} /><b>Start blank</b><p className="wp-small">Open an empty sheet in the editor and write it yourself.</p>
              <Button disabled={!shoot} loading={busy === "blank"} onClick={() => void start("blank")}>Open the editor</Button></section>
          </div>
        </>}
      </div>
      {toast}
    </>
  );
}

// ---------- the questions (766:2956 … 766:5581) ----------

const STEPS = ["Shoot", "Times and place", "People", "Schedule", "Review"];
const HEADS: Array<[string, string]> = [
  ["Which shoot, and where do we start?", "The date and the client come from the shoot."],
  ["When and where?", "Times people need to be there, and how to find the place."],
  ["Who gets the call sheet?", "Everyone you tick is emailed a link to read it in the portal."],
  ["What happens, and when?", "A few lines is enough. You can add more in the editor."],
  ["Ready to make the call sheet?", "Here’s what goes on it."],
];

export function CallSheetQuestions({ callSheetId }: { callSheetId: string }) {
  const cs = useQuery(api.callSheets.get, { callSheetId });
  const save = useMutation(api.callSheets.saveAnswers);
  const make = useMutation(api.callSheets.make);
  const [a, setA] = useState<Answers | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [toast, show] = useToast();
  useEffect(() => { if (cs && !a && cs.answers) { setA(cs.answers); setStep(cs.step ?? 0); } }, [cs, a]);
  useEffect(() => { if (cs?.buildId) navigate(`/production/call-sheets/${cs._id}/edit`); }, [cs?.buildId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (cs === undefined || (cs && !a && cs.answers)) return <><Crumbs>{CS}<Sep /><span className="here">New call sheet</span></Crumbs><div className="wp-page qz"><Card label="Loading"><SkeletonRows n={4} /></Card></div></>;
  if (cs === null || !a) return <><Crumbs /><div className="wp-page"><EmptyState icon="document" title="This call sheet isn't here." actions={<ButtonLink to="/production/call-sheets">All call sheets</ButtonLink>} /></div></>;
  const set = (p: Partial<Answers>) => setA({ ...a, ...p });
  const flush = async (s = step) => { await save({ callSheetId: cs._id, answers: { ...a, templateId: (a.templateId as Id<"wsTemplates"> | null) ?? null }, step: s }); };
  const goStep = async (s: number) => { try { await flush(s); setStep(s); window.scrollTo(0, 0); } catch (e) { show(errText(e)); } };
  const later = async () => { try { await flush(); navigate("/production/call-sheets"); } catch (e) { show(errText(e)); } };
  const done = async () => { setBusy(true); try { await flush(); await make({ callSheetId: cs._id }); navigate(`/production/call-sheets/${cs._id}/edit`); } catch (e) { show(errText(e)); setBusy(false); } };
  const g = groupsOf(cs);
  const onCount = cs.people.filter((p) => p.on).length, guests = g.guests.filter((p) => p.on).length;
  const tplName = cs.templates.find((t) => t._id === a.templateId)?.name ?? "Blank";
  const sofar: Array<[string, string]> = ([
    ["Shoot", step > 0 ? cs.title : ""], ["Date", step > 0 ? sheetDay(cs.shoot.date) : ""], ["Crew call", step === 2 ? clockOf(a.crewCall) : ""], ["Location", step === 2 ? a.locationName : ""],
    ["People", step > 2 ? `${onCount}${guests ? ` (${guests} ${guests === 1 ? "guest" : "guests"})` : ""}` : ""],
  ] as Array<[string, string]>).filter(([, v]) => v);
  const time = (label: string, v: string, on: (v: string) => void) => <label className="wp-field"><span className="wp-field-label">{label}</span><input className="input" type="time" value={v} onChange={(e) => on(e.target.value)} /></label>;
  const rows: Array<[string, string]> = [
    ["Shoot", `${cs.title} · ${sheetDay(cs.shoot.date)}`], ["Crew call · Talent call · Wrap", [a.crewCall, a.talentCall, a.wrap].map((x) => (x ? clockOf(x) : "–")).join(" · ")],
    ["Location", [a.locationName, a.address].filter(Boolean).join(", ") || "–"],
    ["Gets it", [`${reachable(g.crew).length} crew`, `${reachable(g.client).length} client ${reachable(g.client).length === 1 ? "person" : "people"}`, reachable(g.guests).length ? `${reachable(g.guests).length} ${reachable(g.guests).length === 1 ? "guest" : "guests"}` : ""].filter(Boolean).join(", ")],
    ["Schedule", `${a.schedule.filter((r) => r.time || r.what).length} rows`], ["Weather", a.weather ? "Added the day before" : "Not added"], ["Starts from", tplName],
  ];
  return (
    <>
      <Crumbs>{CS}<Sep /><span className="here">New call sheet</span></Crumbs>
      <div className="wp-page qz">
        <header className="wp-pagehead"><div className="txt">
          <span className="wp-eyebrow">Call sheet questions · Step {step + 1} of 5</span>
          <h1 className="wp-h2">{HEADS[step][0]}</h1><p className="wp-body">{HEADS[step][1]}</p>
        </div></header>
        <nav className="qz-steps" aria-label="Steps">
          {STEPS.map((t, i) => (
            <span key={t} className="qz-stepwrap">{i > 0 && <span className="qz-dash" aria-hidden />}
              <button type="button" className={`qz-step${i === step ? " on" : i < step ? " done" : ""}`} aria-current={i === step ? "step" : undefined} onClick={() => void goStep(i)}>
                <span className="n">{i < step ? <Icon name="check" size={12} plain /> : i + 1}</span>{t}
              </button>
            </span>
          ))}
        </nav>
        <div className="qz-cols">
          <div className="col">
            <section className="qz-card glass" aria-label={STEPS[step]}>
              <span className="wp-eyebrow">{STEPS[step]}</span>
              {step === 0 && <>
                <label className="wp-field"><span className="wp-field-label">Shoot</span><span className="qz-icon-in"><Icon name="video" size={16} /><input className="input" readOnly value={`${cs.title} · ${sheetDay(cs.shoot.date)}`} /></span></label>
                <label className="wp-field"><span className="wp-field-label">Start from</span>
                  <select className="input" value={a.templateId ?? ""} onChange={(e) => set({ templateId: e.target.value || null })}>
                    {cs.templates.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}<option value="">Blank</option>
                  </select><span className="wp-small secondary">A saved template. Pick “Blank” to start empty.</span></label>
                <dl className="crm-dl cs-dl"><dt>Date</dt><dd>{sheetDay(cs.shoot.date)} · from the shoot</dd><dt>Client</dt><dd>{cs.client ?? "–"}</dd></dl>
              </>}
              {step === 1 && <>
                <div className="cs-three">{time("Crew call", a.crewCall, (v) => set({ crewCall: v }))}{time("Talent call", a.talentCall, (v) => set({ talentCall: v }))}{time("Wrap", a.wrap, (v) => set({ wrap: v }))}</div>
                <TextField label="Location name" value={a.locationName} onChange={(e) => set({ locationName: e.target.value })} />
                <TextField label="Address" value={a.address} onChange={(e) => set({ address: e.target.value })} />
                <TextField label="Parking and load-in" value={a.parking} onChange={(e) => set({ parking: e.target.value })} />
                <div className="cs-toggle"><span><b>Add the weather the day before</b><span className="wp-small secondary">Saved with the sheet. The forecast itself arrives in a later update.</span></span><Toggle checked={a.weather} onChange={(v) => set({ weather: v })} label="Add the weather the day before" /></div>
              </>}
              {step === 2 && <PeoplePicker cs={cs} show={show} />}
              {step === 3 && <>
                <div className="cs-sched">
                  {a.schedule.map((r, i) => (
                    <div key={r.id} className="cs-schedrow">
                      {time("Time", r.time, (v) => set({ schedule: a.schedule.map((x, j) => (j === i ? { ...x, time: v } : x)) }))}
                      <TextField label="What happens" value={r.what} onChange={(e) => set({ schedule: a.schedule.map((x, j) => (j === i ? { ...x, what: e.target.value } : x)) })} />
                      <TextField label="Who" value={r.who} onChange={(e) => set({ schedule: a.schedule.map((x, j) => (j === i ? { ...x, who: e.target.value } : x)) })} />
                      <button type="button" className="icon-btn cs-x" aria-label="Remove row" onClick={() => set({ schedule: a.schedule.filter((_, j) => j !== i) })}><Icon name="close" size={14} /></button>
                    </div>
                  ))}
                  <button type="button" className="btn ghost sm qz-add" onClick={() => set({ schedule: [...a.schedule, { id: newId(), time: "", what: "", who: "" }] })}><Icon name="plus" size={14} />Add a row</button>
                </div>
                <TextField label="Notes for everyone" value={a.notes} onChange={(e) => set({ notes: e.target.value })} hint="Shown at the bottom of the sheet." />
              </>}
              {step === 4 && <dl className="crm-dl cs-dl">{rows.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>}
            </section>
            <div className="qz-foot">
              <button type="button" className="btn ghost" onClick={() => void later()}>Save and finish later</button>
              <span className="sp" />
              {step > 0 && <button type="button" className="btn" onClick={() => void goStep(step - 1)}>Back</button>}
              {step < 4 ? <Button variant="primary" onClick={() => void goStep(step + 1)}>Next</Button> : <Button variant="primary" loading={busy} onClick={() => void done()}>Make the call sheet</Button>}
            </div>
          </div>
          <aside className="col right">
            <section className="qz-side glass"><span className="wp-eyebrow">So far</span>
              {sofar.length ? <dl className="crm-dl">{sofar.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl> : <p className="wp-small secondary">Your answers show here as you go.</p>}
            </section>
            <section className="qz-side glass"><span className="wp-eyebrow">What happens next</span>
              <p className="wp-small">{step === 4 ? "You can still change anything in the editor before you send it." : "At the end the sheet opens in the editor. Nothing is sent to anyone yet."}</p></section>
          </aside>
        </div>
      </div>
      {toast}
    </>
  );
}

// ---------- the editor (765:2056) and a template ----------

export function CallSheetEditor({ callSheetId }: { callSheetId: string }) {
  const cs = useQuery(api.callSheets.get, { callSheetId });
  useEffect(() => { if (cs && !cs.buildId) navigate(`/production/call-sheets/${cs._id}/questions`); }, [cs]);
  if (cs === undefined || (cs && !cs.buildId)) return <><Crumbs /><div className="wp-page"><Card label="Loading"><SkeletonRows n={3} /></Card></div></>;
  if (cs === null) return <><Crumbs /><div className="wp-page"><EmptyState icon="document" title="This call sheet isn't here." actions={<ButtonLink to="/production/call-sheets">All call sheets</ButtonLink>} /></div></>;
  return <Suspense fallback={null}><Builder key={cs.buildId!} mode={{ kind: "build", buildId: cs.buildId!, callSheet: cs }} /></Suspense>;
}
export function CallSheetTemplate({ templateId }: { templateId: string }) {
  return <Suspense fallback={null}><Builder key={templateId} mode={{ kind: "template", templateId: templateId as Id<"wsTemplates">, callSheet: true }} /></Suspense>;
}

// ---------- Detail · Sent (766:6342; phone 769:7589) ----------

export function CallSheetDetail({ callSheetId }: { callSheetId: string }) {
  const cs = useQuery(api.callSheets.get, { callSheetId });
  const remind = useMutation(api.callSheets.remind);
  const endGuest = useMutation(api.callSheets.endGuest);
  const restoreGuest = useMutation(api.callSheets.restoreGuest);
  const [dialog, setDialog] = useState<"update" | "preview" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, show] = useToast();
  if (cs === undefined) return <><Crumbs /><div className="wp-page"><Card label="Loading"><SkeletonRows n={4} /></Card></div></>;
  if (cs === null) return <><Crumbs /><div className="wp-page"><EmptyState icon="document" title="This call sheet isn't here." actions={<ButtonLink to="/production/call-sheets">All call sheets</ButtonLink>} /></div></>;
  const short = sheetDay(cs.shoot.date).replace(/^\w+ /, "");
  const doRemind = async (id?: string) => {
    setBusy(id ?? "all");
    try { const r = await remind({ callSheetId: cs._id, ...(id ? { id } : {}) }); show(r.sent ? `Reminder sent to ${r.sent === 1 ? (cs.people.find((p) => p.id === id)?.name ?? "1 person") : `${r.sent} people`}` : "Everyone it went to has opened it, or was just reminded."); }
    catch (e) { show(errText(e)); } finally { setBusy(null); }
  };
  const sentTo = cs.people.filter((p) => p.sentAt || (p.kind === "guest" && p.on));
  const list = cs.status === "sent" ? sentTo : cs.people.filter((p) => p.on);
  type P = CallSheetInfo["people"][number];
  // Step 4 (D127): a guest's line says where their access stands (769:7589 / 766:6342: "has not signed in yet").
  const guestNote = (p: P) => p.endedAt ? "access ended" : !p.access ? (p.note ?? "can’t open it").replace(/^./, (c) => c.toLowerCase()) : p.sentAt && !p.openedAt ? "has not signed in yet" : "";
  const sub = (p: P) => p.kind === "crew" ? `Crew${p.role ? ` · ${p.role}` : ""}` : p.kind === "client" ? (cs.client ?? "Client") : [`Guest · ${p.role ?? "Talent"}`, guestNote(p)].filter(Boolean).join(" · ");
  const guests = cs.people.filter((p) => p.kind === "guest" && p.on);
  const notOpened = cs.people.filter((p) => p.sentAt && !p.openedAt && p.access).length;
  const chipOf = (p: P) => p.kind === "guest" && p.endedAt ? <StatusChip tone="neutral">Access ended</StatusChip> : p.kind === "guest" && !p.sentAt ? (cs.status === "sent" ? <StatusChip tone="neutral">Not sent</StatusChip> : undefined)
    : cs.status !== "sent" ? undefined : p.openedAt ? <StatusChip tone="success">Opened {opened(p.openedAt)}</StatusChip> : <StatusChip tone="warning">Not opened</StatusChip>;
  const doRestore = async (p: P) => {
    setBusy(`restore:${p.id}`);
    try { await restoreGuest({ callSheetId: cs._id, id: p.id }); show(`${p.name}’s access is back. They get the sheet with your next update or reminder.`); } catch (e) { show(errText(e)); } finally { setBusy(null); }
  };
  const doEnd = async (p: P) => {
    if (!window.confirm(`End ${p.name}’s access to this call sheet? Their link will show that it’s no longer available.`)) return;
    setBusy(`end:${p.id}`);
    try { await endGuest({ callSheetId: cs._id, id: p.id }); show(`${p.name}’s access ended`); } catch (e) { show(errText(e)); } finally { setBusy(null); }
  };
  return (
    <>
      <Crumbs>{CS}<Sep /><span className="here">{cs.client ? `${cs.client} · ${short}` : short}</span></Crumbs>
      <div className="wp-page prod cs-detail">
        <a {...linkProps("/production/call-sheets")} className="cs-back"><Icon name="arrow-left" size={18} />Call sheets</a>
        <PageHeader eyebrow="Call sheet" title={cs.title} sub={[sheetDay(cs.shoot.date), `Crew call ${clockOf(cs.crewCall)}`, cs.place].filter(Boolean).join(" · ")}
          actions={<><ButtonLink to={`/production/call-sheets/${cs._id}/edit`} iconEnd={false} className="hide-sm">Open in editor</ButtonLink>
            {cs.status === "sent" ? <Button variant="primary" onClick={() => setDialog("update")}>Send an update</Button> : <ButtonLink variant="primary" to={`/production/call-sheets/${cs._id}/edit?send=1`} iconEnd={false}>Send call sheet</ButtonLink>}</>} />
        {cs.changed && <section className="wp-notice warn cs-warn"><Icon name="alert" size={20} /><span className="txt"><b>You changed the sheet after sending it</b><br />{cs.changes.length ? `${cs.changes.join(". ")}. ` : ""}Send an update so everyone sees it.</span><Button size="sm" className="hide-sm" onClick={() => setDialog("update")}>Send an update</Button></section>}
        {cs.status === "draft" && <section className="wp-notice"><Icon name="info" size={20} /><span className="txt"><b>Not sent yet</b><br />Finish it in the editor, then send it from there.</span></section>}
        <div className="pov-cols">
          <div className="col">
            <Card label="Who has opened it" head={<SectionHead label={cs.status === "sent" ? "Who has opened it" : "Who gets it"} count={list.length || undefined} action={cs.status === "sent" && notOpened > 1 ? <Button size="sm" variant="ghost" loading={busy === "all"} onClick={() => void doRemind()}>Remind everyone</Button> : undefined} />}>
              {list.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "user" }} title="Nobody yet." meta="Tick people in the editor's Details." />
                : list.map((p, i) => (
                  <Line key={p.id} first={i === 0}>
                    <ListRow className="ilead ovact cs-who" lead={{ icon: "user" }} title={p.name}
                      meta={<><span className="hide-lg">{sub(p)}</span><span className="show-sm">{sub(p)}{p.sentAt && !p.endedAt ? (p.openedAt ? " · Opened" : cs.status === "sent" ? " · Not opened" : "") : ""}</span></>}
                      chip={chipOf(p)}
                      action={cs.status === "sent" && p.access && p.on && ((p.sentAt && !p.openedAt) || (p.kind === "guest" && !p.sentAt)) ? <Button size="sm" loading={busy === p.id} onClick={() => void doRemind(p.id)}>{p.sentAt ? "Remind" : "Send it"}</Button> : undefined} />
                  </Line>
                ))}
            </Card>
          </div>
          <div className="col">
            <Card label="The sheet" head={<SectionHead label="The sheet" action={<Button size="sm" variant="ghost" onClick={() => setDialog("preview")}>Preview</Button>} />}>
              <dl className="pov-paid prod-week">
                <dt>Sent</dt><dd>{cs.sentAt ? new Date(cs.sentAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).replace(",", " ·") : "Not yet"}</dd>
                <dt>Updates sent</dt><dd>{cs.updates}</dd>
                <dt>Readers</dt><dd>Everyone sees the whole sheet</dd>
              </dl>
            </Card>
            {guests.length > 0 && <Card label="Guest access" head={<SectionHead label="Guest access" />}>
              <dl className="pov-paid prod-week cs-guests">{guests.map((g) => <Fragment key={g.id}><dt>{g.name}</dt><dd>
                {g.endedAt ? "Access ended" : !g.access ? g.note : "Ends the day after the shoot"}
                {!g.endedAt && g.access && <Button size="sm" variant="ghost" loading={busy === `end:${g.id}`} onClick={() => void doEnd(g)}>End access</Button>}
                {g.endedAt && <Button size="sm" variant="ghost" loading={busy === `restore:${g.id}`} onClick={() => void doRestore(g)}>Restore access</Button>}
              </dd></Fragment>)}</dl>
              <p className="wp-small secondary cs-pad">Also ends if the project closes or the shoot is cancelled. You can end it by hand, and restore it (they get the sheet again with the next update or reminder).</p>
            </Card>}
          </div>
        </div>
      </div>
      {dialog === "update" && <SendUpdate cs={cs} onClose={() => setDialog(null)} show={show} />}
      {dialog === "preview" && <SheetPreview cs={cs} onClose={() => setDialog(null)} />}
      {toast}
    </>
  );
}

/** The Detail page's Preview: the page as it is in the editor now (readers see the copy that was sent). */
function SheetPreview({ cs, onClose }: { cs: CallSheetInfo; onClose: () => void }) {
  const b = useQuery(api.builder.getBuild, cs.buildId ? { buildId: cs.buildId } : "skip");
  return (
    <Modal onClose={onClose} label="Preview" width={820}>
      <div className="crm-dialog">
        <div className="wp-listhead"><span className="wp-eyebrow">{cs.changed ? "Preview · with your changes (not sent yet)" : "Preview · what everyone reads"}</span><button className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="close" size={18} /></button></div>
        {b === undefined ? <SkeletonRows n={4} /> : !b ? <p className="secondary">Nothing to preview yet.</p> : <PreviewBody b={b} />}
      </div>
    </Modal>
  );
}
function PreviewBody({ b }: { b: NonNullable<ReturnType<typeof useQuery<typeof api.builder.getBuild>>> }) {
  const page = pageOf(b.blocks);
  return <SheetView page={page} values={fieldValues(b.fields as Fields, page)} accent={(b.style as { accent?: string })?.accent} />;
}
