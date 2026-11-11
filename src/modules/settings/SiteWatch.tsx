// Phase 5c screens (Nov 4): Settings › Site watch (frames 783:8815 report, 785:9322 all clear, 785:9964 loading,
// 785:10395 long report, 785:11372 a finding, phone 787:11594) and the history page a run's row opens (Q47).
// For the portal's admins only (the backend refuses everyone else; the menu hides it). A fix is never "on the preview":
// it waits on its own watch/ branch for Heston's go (Q43), so there is no Go live button (Q44) and only Mark done (Q46).
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { Button, Card, Divider, EmptyState, ListRow, SectionHead, SkeletonRows, StatusChip, Toggle, type Tone } from "../../ui/wp";
import { Icon, type IconName } from "../../ui/Icon";
import { linkProps, navigate, useLocation } from "../../lib/router";
import { errText } from "../docs/pages/common";
import { SetHead } from "./Frame";

type Report = NonNullable<FunctionReturnType<typeof api.siteWatch.report>>;
type Row = Report["open"][number];
type RunRow = { key: string; area: string; title: string; status: string; urgent: boolean; count: number };
type Shown = { key: string; area: string; title: string; status: string; urgent: boolean; count: number; hits?: number | null; fixedAt?: number | null; quiet?: boolean };

const SHOWN = 9; // the long report shows nine, then "Show N more" (785:10395)
const AREA: Record<string, string> = { email: "Email", job: "Background job", stored: "Records", tests: "Tests", page: "Page check", build: "Build" };

const dayLabel = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const shortDay = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const clock = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();
/** "today, 8:00 AM" or "Nov 3, 8:00 AM". */
const when = (t: number) => `${sameDay(t, Date.now()) ? "today" : shortDay(t)}, ${clock(t)}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Which chip a problem wears. Needs you wins over everything: it's urgent and Heston's to decide (Q43). */
export function chipOf(r: { status: string; urgent: boolean }): { tone: Tone; text: string } {
  if (r.status === "needs_you" || (r.urgent && r.status !== "fixed" && r.status !== "cleared")) return { tone: "danger", text: "Needs you" };
  if (r.status === "fix_ready") return { tone: "warning", text: "Fix ready" };
  if (r.status === "fixed") return { tone: "success", text: "Fixed" };
  if (r.status === "cleared") return { tone: "neutral", text: "Cleared" };
  return { tone: "neutral", text: "Found" };
}
const needsYou = (r: { status: string; urgent: boolean }) => chipOf(r).text === "Needs you";

function iconOf(r: { key: string; area: string; urgent: boolean; status: string }): IconName {
  if (needsYou(r)) return "alert";
  const k = r.key.toLowerCase();
  if (k.includes("dropbox") || k.includes("drive")) return "folder";
  if (k.includes("calendar")) return "calendar";
  if (k.includes("transcript") || k.includes("footage") || k.includes("version") || k.includes("stream") || k.includes("video")) return "video";
  if (k.includes("waveform") || k.includes("scrub")) return "activity";
  if (r.area === "email") return "send";
  if (r.area === "page") return "globe";
  if (r.area === "build" || r.area === "tests") return "check-circle";
  return "activity";
}

/** The line under a problem: how many, who it hit, where, and where it stands. Never a name, an address or error text. */
function metaOf(r: Shown) {
  const unit = r.area === "stored" ? ["record", "records"] : ["time", "times"];
  const parts = [plural(r.count, unit[0], unit[1])];
  if (r.hits) parts.push(plural(r.hits, "business", "businesses"));
  parts.push(AREA[r.area] ?? r.area);
  if (needsYou(r)) parts.push("urgent");
  else if (r.status === "fix_ready") parts.push(r.quiet ? "fix ready, quiet since" : "fix ready, waiting for your go");
  else if (r.status === "fixed" && r.fixedAt) parts.push(`live since ${shortDay(r.fixedAt)}`);
  else if (r.status === "cleared" && r.fixedAt) parts.push(`cleared ${shortDay(r.fixedAt)}`);
  return parts.join(" · ");
}

const Chip = ({ r }: { r: { status: string; urgent: boolean } }) => { const c = chipOf(r); return <StatusChip tone={c.tone}>{c.text}</StatusChip>; };

/** A problem's row: icon, title and line, chip, arrow. On a phone the chip drops under the title (787:11594). */
export function SwRow({ lead, title, meta, chip, to }: { lead: IconName; title: React.ReactNode; meta?: React.ReactNode; chip: React.ReactNode; to?: string }) {
  const body = (
    <>
      <Icon name={lead} size={20} className="lead-icon" />
      <span className="txt"><span className="ttl"><span>{title}</span></span>{meta && <span className="meta">{meta}</span>}</span>
      <span className="sw-chip">{chip}</span>
      {to && <Icon name="chevron-right" size={16} className="chev" />}
    </>
  );
  return to ? <a {...linkProps(to)} className="wp-row ilead sw-item">{body}</a> : <div className="wp-row ilead sw-item">{body}</div>;
}

function Banner({ tone, title, children }: { tone: "danger" | "warning" | "success" | "neutral"; title: string; children?: React.ReactNode }) {
  return (
    <div className={`sw-banner ${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <Icon name={tone === "danger" ? "alert" : tone === "success" ? "check-circle" : tone === "warning" ? "info" : "pause"} size={20} />
      <div><b>{title}</b>{children && <p>{children}</p>}</div>
    </div>
  );
}

function Stat({ label, n, sub }: { label: string; n: number; sub: string }) {
  return <div className="pov-stat prod-tile sw-stat"><span className="lbl">{label}</span><b>{n}</b><span className="sub">{sub}</span></div>;
}

function Rows({ rows, to, empty }: { rows: Shown[]; to?: (r: Shown) => string | undefined; empty: React.ReactNode }) {
  const [all, setAll] = useState(false);
  if (rows.length === 0) return <div className="sw-nothing">{empty}</div>;
  const list = all ? rows : rows.slice(0, SHOWN);
  return (
    <>
      {list.map((r) => (
        <div key={r.key} className="wp-rowwrap">
          <SwRow lead={iconOf(r)} title={r.title} meta={metaOf(r)} chip={<Chip r={r} />} to={to?.(r)} />
        </div>
      ))}
      {rows.length > SHOWN && !all && <div className="sw-more"><Button variant="secondary" size="sm" onClick={() => setAll(true)}>Show {rows.length - SHOWN} more</Button></div>}
    </>
  );
}

/** Settings › Site watch, and the pages under it (/settings/sitewatch/<id> and /settings/sitewatch/run/<id>). */
export function SiteWatchSettings({ show }: { show: (m: string) => void }) {
  const { path } = useLocation();
  const rest = path.replace(/^\/settings\/sitewatch\/?/, "").split("/").filter(Boolean);
  if (rest[0] === "run" && rest[1]) return <RunPage id={rest[1]} />;
  if (rest[0]) return <FindingPage id={rest[0]} show={show} />;
  return <ReportPage show={show} />;
}

function ReportPage({ show }: { show: (m: string) => void }) {
  const rep = useQuery(api.siteWatch.report);
  const setPaused = useMutation(api.siteWatch.setPaused);
  const head = <SetHead title="Site watch." sub="A daily check of the portal. What it finds, the fixes it has ready, and what needs you." />;
  if (rep === undefined) return (
    <>{head}
      <div className="sw-banner skeleton" aria-hidden><SkeletonRows n={1} /></div>
      <div className="pov-stats sw-stats" aria-hidden>{[0, 1, 2, 3].map((i) => <div key={i} className="pov-stat sw-stat"><SkeletonRows n={1} /></div>)}</div>
      <Card label="Latest report" head={<SectionHead label="Latest report" count="Checking…" />}><SkeletonRows n={5} /></Card>
    </>
  );
  const rows: Shown[] = [...rep.open, ...rep.recent.map((r) => ({ ...r, hits: r.hits }))];
  const needs = rep.open.filter(needsYou);
  const ready = rep.open.filter((r) => r.status === "fix_ready" && !needsYou(r));
  const fixed = rep.recent.filter((r) => r.status === "fixed");
  const last = rep.runs[0];
  const checked = last ? when(last.at) : null;
  const flip = async (on: boolean) => {
    try { await setPaused({ paused: !on }); show(on ? "The daily check is on." : "The daily check is paused."); } catch (e) { show(errText(e)); }
  };
  return (
    <>
      {head}
      {rep.paused ? <Banner tone="neutral" title="Checks are paused">Nothing new is looked for until you turn Run the checks back on.</Banner>
        : needs.length > 0 ? <Banner tone="danger" title={`${plural(needs.length, "thing needs", "things need")} you`}>{needs.slice(0, 3).map((r) => r.title).join("; ")}. Money, signing and access are never fixed on their own.</Banner>
        : ready.length > 0 ? <Banner tone="warning" title={`${plural(ready.length, "fix is", "fixes are")} ready`}>Each is on its own branch and the tests pass. Nothing is live until you say go.</Banner>
        : rep.open.length > 0 ? <Banner tone="neutral" title={`${plural(rep.open.length, "thing", "things")} found`}>Site watch is working on what it can fix. Anything it can't will say Needs you.</Banner>
        : <Banner tone="success" title="All clear">{last ? `Nothing found in today's check at ${clock(last.at)}.` : "Nothing found yet. The first check runs tomorrow morning."}</Banner>}
      <div className="pov-stats sw-stats">
        <Stat label="Found" n={rows.length} sub="in the report" />
        <Stat label="Fix ready" n={rep.open.filter((r) => r.status === "fix_ready").length} sub="waiting for your go" />
        <Stat label="Fixed" n={fixed.length} sub="live" />
        <Stat label="Needs you" n={needs.length} sub={needs.length ? "urgent" : "nothing urgent"} />
      </div>
      <Card className="sw-report" label="Latest report" head={<SectionHead label="Latest report" count={checked ? `Checked ${checked}` : "Not checked yet"} />}>
        <Rows rows={rows} to={(r) => { const f = [...rep.open, ...rep.recent].find((x) => x.key === r.key); return f ? `/settings/sitewatch/${f._id}` : undefined; }}
          empty={<><b>Nothing to fix.</b><span>Site watch checks the portal every morning and will list anything it finds here.</span></>} />
      </Card>
      <div className="sw-two">
        <Card className="sw-sched" label="Schedule" head={<SectionHead label="Schedule" />}>
          <ListRow className="ilead" lead={{ icon: "clock" }} title="Daily check" meta="Failed jobs, emails, records left half-done" trailing={<span className="sw-when">Every morning</span>} />
          <Divider />
          <ListRow className="ilead" lead={{ icon: "globe" }} title="Page check" meta="Public pages at 1440 and 390 px" trailing={<span className="sw-when">Daily</span>} />
          <Divider />
          <ListRow className="ilead" lead={{ icon: "mail" }} title="Urgent problems" meta={`Emailed once to ${rep.support}`} />
          <div className="sw-switch"><span><b>Run the checks</b><span className="secondary">Turn off to pause the daily check.</span></span><Toggle checked={!rep.paused} onChange={(on) => void flip(on)} label="Run the checks" /></div>
        </Card>
        <Card className="sw-hist" label="History" head={<SectionHead label="History" />}>
          {rep.runs.length === 0 ? <div className="sw-nothing"><span>Each morning's report will be kept here for 30 days.</span></div>
            : <HistoryRows runs={rep.runs} />}
        </Card>
      </div>
    </>
  );
}

function HistoryRows({ runs }: { runs: Report["runs"] }) {
  const [all, setAll] = useState(false);
  const list = all ? runs : runs.slice(0, 4);
  return (
    <>
      {list.map((r) => {
        const parts = [r.found > 0 && `${r.found} found`, r.cleared > 0 && `${r.cleared} cleared`, r.found === 0 && (r.open ?? 0) > 0 && `${r.open} open`].filter(Boolean) as string[];
        return (
          <div key={r._id} className="wp-rowwrap">
            <ListRow className="ilead" lead={{ icon: "clock" }} title={dayLabel(r.at)} meta={parts.length ? parts.join(" · ") : "All clear"} to={`/settings/sitewatch/run/${r._id}`} chevron />
          </div>
        );
      })}
      {runs.length > 4 && !all && <div className="sw-more"><Button variant="secondary" size="sm" onClick={() => setAll(true)}>Show {runs.length - 4} more</Button></div>}
    </>
  );
}

/** A history row: what was open at that morning's check. It can't link on (the problems have moved on); it's the record. */
function RunPage({ id }: { id: string }) {
  const run = useQuery(api.siteWatch.run, { id });
  const back = <a className="sw-back" {...linkProps("/settings/sitewatch")}><Icon name="arrow-left" size={16} />Site watch</a>;
  if (run === undefined) return <>{back}<Card label="Report"><SkeletonRows n={4} /></Card></>;
  if (run === null) return <>{back}<EmptyState icon="clock" title="That report is gone." body="Each morning's report is kept for 30 days." actions={<Button variant="secondary" onClick={() => navigate("/settings/sitewatch")}>Back to Site watch</Button>} /></>;
  const rows: Shown[] = run.open.map((r: RunRow) => ({ ...r }));
  return (
    <>
      {back}
      <SetHead eyebrow={`Site watch · ${run.by === "agent" ? "agent's look" : "daily check"}`} title={`${dayLabel(run.at)}.`} sub={`Checked ${clock(run.at)}. What was open then; the live list is on the Site watch page.`} />
      <Card className="sw-report" label="That day's report" head={<SectionHead label="That day's report" count={rows.length || undefined} />}>
        <Rows rows={rows} empty={<><b>All clear.</b><span>Nothing was open at that check.</span></>} />
      </Card>
    </>
  );
}

async function copyText(text: string, show: (m: string) => void) {
  try { await navigator.clipboard.writeText(text); show("Copied. Paste it in the build chat to say go."); }
  catch { show("Couldn't copy. Select the text and copy it yourself."); }
}

/** One problem: what it found, the fix (if any), Copy branch and commit, Mark done (785:11372). */
function FindingPage({ id, show }: { id: string; show: (m: string) => void }) {
  const f = useQuery(api.siteWatch.finding, { id });
  const done = useMutation(api.siteWatch.markDone);
  const [busy, setBusy] = useState(false);
  const back = <a className="sw-back" {...linkProps("/settings/sitewatch")}><Icon name="arrow-left" size={16} />Site watch</a>;
  if (f === undefined) return <>{back}<Card label="Problem"><SkeletonRows n={4} /></Card></>;
  if (f === null) return <>{back}<EmptyState icon="check-circle" title="That problem isn't here any more." body="It may have been cleared or was never there." actions={<Button variant="secondary" onClick={() => navigate("/settings/sitewatch")}>Back to Site watch</Button>} /></>;
  const chip = chipOf(f);
  const open = f.status === "found" || f.status === "fix_ready" || f.status === "needs_you";
  const unit = f.area === "stored" ? ["record", "records"] : ["time", "times"];
  const markDone = async () => {
    setBusy(true);
    try { await done({ id }); show("Marked done."); navigate("/settings/sitewatch"); } catch (e) { show(errText(e)); setBusy(false); }
  };
  return (
    <>
      {back}
      <header className="wp-sethead">
        <span className="wp-eyebrow">Site watch · {chip.text}</span>
        <h1 className="wp-h3">{f.title}.</h1>
        <p className="wp-body">First seen {shortDay(f.firstAt)} · last seen {when(f.lastAt)}</p>
      </header>
      {f.status === "fix_ready" ? <Banner tone="warning" title="Fix ready, waiting for your go">Site watch made a fix on its own branch and the tests pass. It is not on the preview or live until you say go.{f.quiet && f.quietAt ? ` The problem has been quiet since ${shortDay(f.quietAt)}.` : ""}</Banner>
        : f.status === "needs_you" || chip.text === "Needs you" ? <Banner tone="danger" title="Needs you">Site watch won't fix this one on its own. Money, signing and access are always yours to decide.{f.note ? ` ${f.note}` : ""}</Banner>
        : f.status === "fixed" ? <Banner tone="success" title="Fixed">The fix is live and the check passes.</Banner>
        : f.status === "cleared" ? <Banner tone="neutral" title="Cleared">The problem went away on its own, or you marked it done.</Banner>
        : <Banner tone="neutral" title="Found">Site watch hasn't fixed this yet. A fix, when it's ready, waits here for your go.</Banner>}
      <div className="sw-two sw-find">
        <Card label="What it found" head={<SectionHead label="What it found" />}>
          <ListRow className="ilead" lead={{ icon: iconOf(f) }} title={f.title} meta={f.detail ?? "Error text and names are hidden"} />
          <Divider />
          <ListRow className="ilead" lead={{ icon: "clock" }} title="How often" meta={`${plural(f.count, unit[0], unit[1])} · first seen ${shortDay(f.firstAt)}`} />
          {f.hits ? <><Divider /><ListRow className="ilead" lead={{ icon: "users" }} title="Who it hit" meta={`${plural(f.hits, "business", "businesses")} (names hidden)`} /></> : null}
        </Card>
        {(f.status === "fix_ready" || f.status === "fixed") && f.branch && (
          <Card label="The fix" head={<SectionHead label="The fix" />}>
            <ListRow className="ilead" lead={{ icon: "check-circle" }} title="Fix made on its own branch" meta={`${f.branch}${f.commit ? ` · ${f.commit.slice(0, 7)}` : ""} · tests pass`} />
            <Divider />
            <ListRow className="ilead" lead={{ icon: "eye" }} title={f.status === "fixed" ? "Live" : "Not live yet"} meta={f.status === "fixed" ? "Merged after your go" : "Waiting for your go"} />
            {f.note && <p className="secondary sw-note">{f.note}</p>}
          </Card>
        )}
      </div>
      <div className="sw-actions">
        {f.status === "fix_ready" && f.branch && <Button variant="secondary" onClick={() => void copyText(`Site watch fix: ${f.title}\nbranch ${f.branch}${f.commit ? `\ncommit ${f.commit}` : ""}`, show)}>Copy branch and commit</Button>}
        {open && <Button variant="ghost" loading={busy} onClick={() => void markDone()}>Mark done</Button>}
      </div>
    </>
  );
}
