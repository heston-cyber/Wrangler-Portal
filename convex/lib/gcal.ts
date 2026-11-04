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

/** A wall-clock time in a zone ("2026-11-05T17:00:00" in America/Chicago) as a moment. Never uses the server's own zone. */
export function zonedMs(wall: string, zone: string): number {
  const asUtc = Date.parse(`${wall.slice(0, 19)}Z`);
  if (!Number.isFinite(asUtc)) return NaN;
  const off = (ms: number) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - ms;
  };
  let ms = asUtc - off(asUtc);
  ms = asUtc - off(ms); // a second pass settles daylight-saving changes
  return ms;
}

/** Google's dateTime as a moment: with an offset (or Z) as given; without one, in its own timeZone (Google allows this
 *  when timeZone is set), else the business's. Date.parse alone would read it in the server's zone. */
export function momentOf(t: GTime): number {
  const s = t.dateTime ?? "";
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) return Date.parse(s);
  let zone = TZ;
  try { if (t.timeZone) { new Intl.DateTimeFormat("en-US", { timeZone: t.timeZone }); zone = t.timeZone; } } catch { /* unknown zone: the business's */ }
  return zonedMs(s, zone);
}

/** Google's start/end as the portal's span. Null when Google sent neither form. */
export function fromGoogle(start: GTime | undefined, end: GTime | undefined): Span | null {
  if (start?.date) {
    const last = end?.date ? addDays(end.date, -1) : start.date;
    return { date: start.date, endDate: last < start.date ? start.date : last };
  }
  if (start?.dateTime) {
    const sm = momentOf(start);
    if (!Number.isFinite(sm)) return null;
    const s = local(sm);
    const em = end?.dateTime ? momentOf(end) : NaN;
    const e = Number.isFinite(em) ? local(em) : s;
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

/** Google's own rule for event ids: base32hex (0-9 and a-v), 5 to 1024 characters. */
export const ID_OK = /^[a-v0-9]{5,1024}$/;
/** A Google event id the portal picks itself (base32hex: 0-9 a-v), so a retried write can't make two events.
 *  Review fix H3: the prefix ("pev", portal event) is base32hex too; "wp" wasn't ("w" is past "v"). */
export function newEventId(prefix = "pev") {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return prefix + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
/** A fixed id for one of a project's edit dates (same project + key → same event). Prefix "pdt" (portal date). */
export function dateEventId(projectId: string, key: string) {
  return `pdt${Array.from(new TextEncoder().encode(`${projectId}|${key}`), (b) => b.toString(16).padStart(2, "0")).join("")}`.slice(0, 1000);
}
