// Phase 4 (Nov 2): the kickoff brief, option B. The client's steps (740:1671) and the page once it's back (740:2074);
// the owner's row on the Requests and brief card (741:1424: "Kickoff brief · Answered by Maya Brooks Nov 1 · Start an
// estimate from it"); Settings › Kickoff brief, where the business edits its questions; and the owner's preview.
// The fields are the proposal questionnaire's (Field), without files: files come through file requests.
import { Fragment, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { answerText, type Answers, type Questionnaire, type Step } from "../../../convex/lib/questionnaire";
import { Button, ButtonLink, Card, DialogHeader, Divider, EmptyState, ListRow, SkeletonRows, StatusChip } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { Modal, useToast } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps, navigate } from "../../lib/router";
import { errText } from "../docs/pages/common";
import { Field } from "../proposals/Questionnaire";
import { SetHead } from "../settings/Frame";

const monthDay = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });
const timeWord = (t: number) => new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.some((x) => (typeof x === "string" ? x.trim() : x)))
  || (typeof v === "object" && !Array.isArray(v) && !(v as { start?: string }).start);
const first = (s: string | null | undefined) => (s ?? "").trim().split(/\s+/)[0] || "";

// ---------- the owner: the row on Requests and brief ----------

type Owner = NonNullable<ReturnType<typeof useQuery<typeof api.briefs.forProject>>>;
type B = NonNullable<Owner["brief"]>;
export function useBrief(projectId: Id<"projects">) { return useQuery(api.briefs.forProject, { projectId }); }

const briefMeta = (b: B) => b.status === "submitted"
  ? `${b.submits > 1 ? `Changed by ${b.updatedBy ?? b.by} ${monthDay(b.updatedAt)}` : `Answered by ${b.by} ${monthDay(b.submittedAt!)}`}`
  : b.startedAt ? `Started · sent ${monthDay(b.sentAt)}` : `Sent ${monthDay(b.sentAt)}${b.remindedAt ? ` · reminded ${monthDay(b.remindedAt)}` : ""}`;

export function BriefRow({ projectId, d, client, divider, show }: { projectId: Id<"projects">; d: Owner; client: string | null; divider: boolean; show: (t: string) => void }) {
  const send = useMutation(api.briefs.send);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const who = client ?? "the client";
  const b = d.brief;
  const estimate = b ? `/clients/estimates/new?project=${projectId}&brief=${b._id}` : "";
  let row: React.ReactNode;
  if (!b) {
    const go = async () => {
      setBusy(true);
      try { const r = await send({ projectId }); show(`Sent. ${r.told === 1 ? "They get" : `${r.told} people get`} it in their Inbox and by email.`); } catch (e) { show(errText(e)); } finally { setBusy(false); }
    };
    row = <ListRow className="ilead" lead={{ icon: "note" }} title="Kickoff brief"
      meta={d.people ? `Not sent. ${client ?? "The client"} answers a few questions about the project, brand and dates.` : `Not sent. Share the project with ${who} first: they answer it in their portal.`}
      action={<Button size="sm" loading={busy} disabled={!d.people} onClick={() => void go()}>Send the kickoff brief</Button>} />;
  } else {
    // Back: the answers and the estimate are both a click away (no button inside a button).
    row = b.status === "submitted"
      ? <ListRow className="ilead br-row" lead={{ icon: "note" }} title="Kickoff brief" meta={briefMeta(b)}
          action={<span className="br-rowacts"><Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Answers</Button><ButtonLink size="sm" to={estimate}>Start an estimate from it</ButtonLink></span>} />
      : <ListRow className="ilead" lead={{ icon: "note" }} onClick={() => setOpen(true)} title="Kickoff brief" meta={briefMeta(b)} chevron
          chip={<StatusChip tone={b.startedAt ? "accent" : "warning"}>{b.startedAt ? "In progress" : "Waiting"}</StatusChip>} />;
  }
  return (
    <>
      <div className="wp-rowwrap">{divider && <Divider />}{row}</div>
      {open && b && <BriefDialog b={b} estimate={estimate} onClose={() => setOpen(false)} show={show} />}
    </>
  );
}

function BriefDialog({ b, estimate, onClose, show }: { b: B; estimate: string; onClose: () => void; show: (t: string) => void }) {
  const remind = useMutation(api.briefs.remind);
  const [busy, setBusy] = useState(false);
  const back = b.status === "submitted";
  return (
    <Modal onClose={onClose} label="Kickoff brief" width={600}>
      <div className="crm-dialog">
        <DialogHeader eyebrow={`Kickoff brief · ${briefMeta(b).toLowerCase()}`} title={back ? "Their answers." : b.startedAt ? "Answers so far." : "Not answered yet."}
          body={back ? undefined : "They answer in their portal, step by step. Answers show here as they're saved."} onClose={onClose} />
        {b.answers.length ? b.answers.map((s) => (
          <section key={s.step} className="br-sec"><span className="wp-eyebrow">{s.step}</span>
            <dl className="crm-dl">{s.answers.map((x) => <Fragment key={x.question}><dt>{x.question}</dt><dd>{x.answer}</dd></Fragment>)}</dl></section>
        )) : <p className="secondary">Nothing yet.</p>}
        <div className="dfoot">
          {!back && <Button loading={busy} disabled={Date.now() < b.remindAt} title={Date.now() < b.remindAt ? "One reminder a day" : undefined} onClick={async () => {
            setBusy(true);
            try { await remind({ briefId: b._id }); show("Reminder sent."); onClose(); } catch (e) { show(errText(e)); setBusy(false); }
          }}>Send a reminder</Button>}
          {back && <ButtonLink to={estimate}>Start an estimate from it</ButtonLink>}
          <Button variant="primary" onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- the client ----------

export function ComingUpBrief({ projectId }: { projectId: string }) {
  const b = useQuery(api.briefs.forClientProject, { projectId });
  if (!b || b.status !== "sent") return null;
  return (
    <div className="wp-rowwrap">
      <ListRow className="ilead" lead={{ icon: "note" }} title="Kickoff brief" meta={b.started ? "Started · your answers are saved" : "About 10 minutes"}
        action={<ButtonLink size="sm" variant="primary" to={`/briefs/${b._id}`}>{b.started ? "Finish it" : "Start"}</ButtonLink>} />
    </div>
  );
}
export const useBriefCount = (projectId: string) => { const b = useQuery(api.briefs.forClientProject, { projectId }); return b && b.status === "sent" ? 1 : 0; };

/** The steps, for the client (a brief) or the owner's preview (the business's current set, nothing saved). */
export function ClientBriefPage({ briefId, preview }: { briefId?: string; preview?: boolean }) {
  const d = useQuery(api.briefs.page, briefId && !preview ? { briefId } : "skip");
  const set = useQuery(api.briefs.settings, preview ? {} : "skip");
  const save = useMutation(api.briefs.save);
  const submit = useMutation(api.briefs.submit);
  const [toast, show] = useToast();
  const [a, setA] = useState<Answers | null>(preview ? {} : null);
  const [step, setStep] = useState(0);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const top = useRef<HTMLDivElement | null>(null);
  const aRef = useRef<Answers | null>(null);
  aRef.current = a;
  // Only the questions this page changed go up (review, Nov 2): two people answering at once don't overwrite each
  // other, and what the other one saves shows up here for the questions this page hasn't touched.
  const touched = useRef<Set<string>>(new Set());
  const changesOf = (x: Answers) => Object.fromEntries([...touched.current].map((k) => [k, x[k] ?? null]));
  useEffect(() => { if (d && a === null) { setA((d.answers ?? {}) as Answers); setStep(d.status === "sent" ? Math.min(d.step, d.questions.steps.length) : 0); } }, [d, a]);
  const serverAnswers = JSON.stringify(d?.answers ?? null);
  useEffect(() => {
    if (!d || editing) return;
    setA((prev) => (prev === null ? prev : { ...(d.answers as Answers), ...Object.fromEntries([...touched.current].map((k) => [k, prev[k]])) }));
  }, [serverAnswers]); // eslint-disable-line react-hooks/exhaustive-deps
  const submitted = d?.status === "submitted";
  const live = !preview && !!d && !submitted; // saves as they type; once it's back, changes wait for Send changes
  useEffect(() => {
    if (!dirty || !a || !live) return;
    const t = setTimeout(async () => {
      const changes = changesOf(a);
      try {
        setSavedAt(await save({ briefId: d!._id, changes, step }));
        for (const [k, val] of Object.entries(changes)) if (JSON.stringify(aRef.current?.[k] ?? null) === JSON.stringify(val)) touched.current.delete(k);
        setDirty(touched.current.size > 0);
      } catch (e) { show(errText(e)); setDirty(false); }
    }, 700);
    return () => clearTimeout(t);
  }, [a, dirty, step, live]); // eslint-disable-line react-hooks/exhaustive-deps

  const qn = (preview ? set?.questionnaire : d?.questions) as Questionnaire | undefined;
  const crumbs = preview ? <><a {...linkProps("/settings/brief")}>Settings</a><Sep /><a {...linkProps("/settings/brief/questions")}>Kickoff brief</a><Sep /><span className="here">Preview</span></>
    : <><a {...linkProps("/review")}>Review</a>{d && <><Sep /><a {...linkProps(`/projects/${d.project._id}`)}>{d.project.label}</a></>}<Sep /><span className="here">Kickoff brief</span></>;
  if (!preview && d === null) return <><TopBar>{crumbs}</TopBar><div className="wp-page"><EmptyState icon="note" title="This brief isn't here." body="It may not be shared with you any more." actions={<ButtonLink to="/inbox">Back to your Inbox</ButtonLink>} /></div></>;
  if (!qn || !a) return <><TopBar>{crumbs}</TopBar><div className="wp-page"><Card label="Loading"><SkeletonRows n={5} /></Card></div></>;

  const steps = qn.steps;
  const reviewAt = steps.length;
  const owner = preview ? "We" : first(d!.owner) || d!.business;
  const eyebrow = preview ? "Kickoff brief · preview" : `Kickoff brief · ${d!.business}`;
  const why = <aside className="col right"><section className="qz-side glass"><span className="wp-eyebrow">Why we ask</span>
    <p className="wp-small">Your answers shape the plan and the shoot. {preview ? "You" : owner} {preview ? "read" : "reads"} every one before the first call.</p></section></aside>;

  // Back with the studio: the answers, and Edit (740:2074).
  if (submitted && !editing) {
    return (
      <>
        <TopBar>{crumbs}</TopBar>
        <div className="wp-page qz br-page" ref={top}>
          <header className="wp-pagehead"><div className="txt">
            <span className="wp-eyebrow">{eyebrow}</span>
            <h1 className="wp-h2">{first(d!.me) ? `Thanks, ${first(d!.me)}.` : "Thanks."}</h1>
            <p className="wp-body">{owner} has your answers. You can change them any time before the shoot.</p>
          </div></header>
          <nav className="qz-steps" aria-label="Steps">
            {[...steps.map((s) => s.title), "Review"].map((t, i) => <span key={t + i} className="qz-stepwrap">{i > 0 && <span className="qz-dash" aria-hidden />}<span className="qz-step done"><span className="n"><Icon name="check" size={12} plain /></span>{t}</span></span>)}
          </nav>
          <div className="qz-cols">
            <div className="col">
              <section className="qz-card glass qz-review" aria-label="Your answers">
                <div className="qz-rhead"><span className="wp-eyebrow">Your answers</span><button type="button" className="btn ghost sm" onClick={() => { touched.current.clear(); setA((d!.answers ?? {}) as Answers); setEditing(true); setStep(0); setErr(null); }}>Edit</button></div>
                <dl className="crm-dl br-answers">
                  {steps.flatMap((s) => s.questions).map((x) => [x.label, answerText(x, (d!.answers as Answers)[x.id])] as const).filter(([, v]) => v).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}
                </dl>
                {d!.updatedAt && <p className="wp-small secondary">Last changed {monthDay(d!.updatedAt)}{d!.updatedBy ? ` by ${d!.updatedBy}` : ""}.</p>}
              </section>
            </div>
            {why}
          </div>
        </div>
        {toast}
      </>
    );
  }

  const cur: Step | null = step < reviewAt ? steps[step] : null;
  const setAns = (id: string, v: unknown) => { touched.current.add(id); setA({ ...a, [id]: v }); setDirty(true); setErr(null); };
  const go = (n: number) => { setStep(n); if (live) setDirty(true); setErr(null); top.current?.scrollIntoView({ block: "start" }); };
  const missing = (s: Step) => s.questions.filter((x) => x.required && blank(a[x.id]));
  const next = () => {
    if (cur) { const m = missing(cur); if (m.length) { setErr(`Answer ${m.map((x) => `"${x.label}"`).join(", ")} first.`); return; } }
    go(step + 1);
  };
  const later = async () => {
    try { if (live && dirty) { await save({ briefId: d!._id, changes: changesOf(a), step }); touched.current.clear(); setDirty(false); } navigate(`/projects/${d!.project._id}`); } catch (e) { show(errText(e)); }
  };
  const done = async () => {
    if (preview || !d) return;
    const firstMissing = steps.findIndex((s) => missing(s).length);
    if (firstMissing >= 0) { go(firstMissing); setErr(`Answer ${missing(steps[firstMissing]).map((x) => `"${x.label}"`).join(", ")} first.`); return; }
    setBusy(true);
    try { await submit({ briefId: d._id, changes: changesOf(a) }); touched.current.clear(); setDirty(false); setEditing(false); show(submitted ? `Changes sent to ${owner}.` : `Sent to ${owner}.`); window.scrollTo({ top: 0 }); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <>
      <TopBar right={preview ? <StatusChip tone="warning">Preview · nothing is saved</StatusChip> : savedAt && live ? <span className="wp-small">Saved · {timeWord(savedAt)}</span> : undefined}>{crumbs}</TopBar>
      <div className="wp-page qz br-page" ref={top}>
        <header className="wp-pagehead"><div className="txt">
          <span className="wp-eyebrow">{eyebrow}</span>
          <h1 className="wp-h2">{cur ? cur.heading : "Check your answers."}</h1>
          <p className="wp-body">{cur ? cur.sub : editing ? `Change anything with Edit, then send the changes to ${owner === "We" ? "us" : owner}.` : `Change anything with Edit. Then send it to ${owner === "We" ? "us" : owner}.`}</p>
        </div></header>
        <nav className="qz-steps" aria-label="Steps">
          {[...steps.map((s) => s.title), "Review"].map((t, i) => (
            <span key={t + i} className="qz-stepwrap">{i > 0 && <span className="qz-dash" aria-hidden />}
              <button type="button" className={`qz-step${i === step ? " on" : i < step ? " done" : ""}`} aria-current={i === step ? "step" : undefined} onClick={() => go(i)}>
                <span className="n">{i < step ? <Icon name="check" size={12} plain /> : i + 1}</span>{t}
              </button>
            </span>
          ))}
        </nav>
        <div className="qz-cols">
          <div className="col">
            {cur ? (
              <section className="qz-card glass" aria-label={cur.title}>
                <span className="wp-eyebrow">{cur.title}</span>
                <div className="qz-grid">
                  {cur.questions.map((x) => <Field key={x.id} q={x} v={a[x.id]} set={(v) => setAns(x.id, v)} r={undefined} who={[]} proposalId={null} files={{}} show={show} preview={!!preview} />)}
                </div>
              </section>
            ) : steps.map((s, i) => {
              const rows = s.questions.map((x) => [x.label, answerText(x, a[x.id])] as const).filter(([, v]) => v);
              return (
                <section key={s.id} className="qz-card glass qz-review" aria-label={s.title}>
                  <div className="qz-rhead"><span className="wp-eyebrow">{s.title}</span><button type="button" className="btn ghost sm" onClick={() => go(i)}>Edit</button></div>
                  {rows.length ? <dl className="crm-dl">{rows.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl> : <p className="wp-small secondary">Nothing answered.</p>}
                  {missing(s).length > 0 && <p className="error">Still to answer: {missing(s).map((x) => x.label).join(", ")}.</p>}
                </section>
              );
            })}
            {err && <p className="error" role="alert">{err}</p>}
            <div className="qz-foot">
              {live && <button type="button" className="btn ghost" onClick={() => void later()}>Save and finish later</button>}
              {editing && <button type="button" className="btn ghost" onClick={() => { touched.current.clear(); setEditing(false); setA((d!.answers ?? {}) as Answers); setErr(null); }}>Cancel changes</button>}
              <span className="sp" />
              {step > 0 && <button type="button" className="btn" onClick={() => go(step - 1)}>Back</button>}
              {cur ? <Button variant="primary" onClick={next}>{step === reviewAt - 1 ? "Review answers" : "Next"}</Button>
                : <Button variant="primary" loading={busy} disabled={!!preview} title={preview ? "Preview: nothing is saved" : undefined} onClick={() => void done()}>{editing ? "Send changes" : `Send to ${owner === "We" ? "us" : owner}`}</Button>}
            </div>
          </div>
          {why}
        </div>
      </div>
      {toast}
    </>
  );
}

// ---------- Settings › Kickoff brief ----------

export function KickoffSettings() {
  const s = useQuery(api.briefs.settings, {});
  const head = <SetHead title="Questions before a project starts." sub="Send it from a project's Requests and brief card. The client answers in their portal, and you can start an estimate from the answers." />;
  if (s === undefined) return <>{head}<div className="panel"><SkeletonRows n={3} /></div></>;
  const qn = s.questionnaire as Questionnaire;
  return (
    <>
      {head}
      <div className="panel pay-card br-set">
        <span className="wp-eyebrow">Your questions</span>
        <dl className="pay-rows">
          <dt>Steps</dt><dd>{qn.steps.map((x) => x.title).join(" · ")} · Review</dd>
          <dt>Questions</dt><dd>{s.questions}</dd>
          <dt>Set</dt><dd>{s.custom ? "Your own" : "Wrangler's starting set"}</dd>
        </dl>
        <p className="secondary pay-note">A brief already sent keeps the questions it went with. Files aren't asked for here: use Make a request on the project.</p>
        <div className="br-acts"><ButtonLink to="/settings/brief/preview">Preview</ButtonLink><ButtonLink variant="primary" to="/settings/brief/questions">Edit the questions</ButtonLink></div>
      </div>
    </>
  );
}
