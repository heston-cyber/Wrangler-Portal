// Phase 5b step 5 (Nov 3, D143): Google Calendar times <-> the portal's. The portal keeps every time as the business's
// wall clock (America/Chicago, like shoots): a day (YYYY-MM-DD) and, unless it's all day, HH:MM start and end.
// Google gives either { date } (all day, end exclusive) or { dateTime } with an offset (or in UTC).
export const TZ = "America/Chicago";

export type Span = { date: string; endDate: string; start?: string; end?: string };
type GTime = { date?: string; dateTime?: string; timeZone?: string };

export const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));
export const isTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
export function addDays(ymd: string, n: number) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** A moment, as the business's day and time. */
export function local(ms: number): { date: string; time: string } {
  const d = new Date(ms);
  const date = d.toLocaleDateString("en-CA", { timeZone: TZ });
  const time = d.toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).replace(/^24/, "00");
  return { date, time };
}

/** Google's start/end as the portal's span. Null when Google sent neither form. */
export function fromGoogle(start: GTime | undefined, end: GTime | undefined): Span | null {
  if (start?.date) {
    const last = end?.date ? addDays(end.date, -1) : start.date;
    return { date: start.date, endDate: last < start.date ? start.date : last };
  }
  if (start?.dateTime) {
    const s = local(Date.parse(start.dateTime));
    const e = end?.dateTime ? local(Date.parse(end.dateTime)) : s;
    // An event ending at midnight ends on the day before, at 24:00 (shown as 23:59).
    if (e.time === "00:00" && e.date > s.date) return { date: s.date, endDate: addDays(e.date, -1), start: s.time, end: "23:59" };
    return { date: s.date, endDate: e.date < s.date ? s.date : e.date, start: s.time, end: e.time };
  }
  return null;
}

/** The portal's span as Google's start/end (times in the business's zone; all-day ends are exclusive). */
export function toGoogle(s: Span): { start: GTime; end: GTime } {
  if (!s.start) return { start: { date: s.date }, end: { date: addDays(s.endDate, 1) } };
  const end = s.end ?? s.start;
  return { start: { dateTime: `${s.date}T${s.start}:00`, timeZone: TZ }, end: { dateTime: `${s.endDate}T${end}:00`, timeZone: TZ } };
}

/** Google's `updated` (RFC 3339) in ms; 0 when missing. */
export const updatedMs = (u: unknown) => { const n = typeof u === "string" ? Date.parse(u) : NaN; return Number.isFinite(n) ? n : 0; };

/** Checks a span the owner typed or dragged to. Returns an error message, or null. */
export function spanError(s: Span): string | null {
  if (!isDay(s.date) || !isDay(s.endDate)) return "Pick the day.";
  if (s.endDate < s.date) return "It ends before it starts.";
  if ((s.start && !isTime(s.start)) || (s.end && !isTime(s.end))) return "Pick a start and end time.";
  if (!!s.start !== !!s.end) return "Pick a start and end time.";
  if (s.start && s.end && s.endDate === s.date && s.end <= s.start) return "It ends before it starts.";
  if (Date.parse(`${s.endDate}T12:00:00Z`) - Date.parse(`${s.date}T12:00:00Z`) > 60 * 86_400_000) return "Keep an event under two months.";
  return null;
}

/** A Google event id the portal picks itself (base32hex: 0-9 a-v), so a retried write can't make two events. */
export function newEventId(prefix = "wp") {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return prefix + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
/** A fixed id for one of a project's edit dates (same project + key → same event). */
export function dateEventId(projectId: string, key: string) {
  return `wpd${Array.from(new TextEncoder().encode(`${projectId}|${key}`), (b) => b.toString(16).padStart(2, "0")).join("")}`.slice(0, 1000);
}
