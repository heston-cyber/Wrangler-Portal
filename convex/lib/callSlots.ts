// Phase 5d step 1 (Nov 4, D119/D144): booking calls. The open times a lead can pick, worked out from the owner's
// settings (Settings › Booking calls), what's busy on the calendar they ticked, and the calls already booked. Every
// time here is a moment (ms since 1970); the hours offered are the business's wall clock (America/Chicago).
import { TZ, addDays, local, zonedMs } from "./gcal";

export type DayHours = { on: boolean; start: string; end: string };
export type CallPrefs = { lengthMin: number; bufferMin: number; aheadDays: number; noticeHours: number; hours: DayHours[] }; // hours[0] is Monday
export type Span = { s: number; e: number };

export const LENGTHS = [15, 30, 45, 60] as const;
export const BUFFERS = [0, 5, 10, 15, 30] as const;
export const AHEAD = [7, 14, 30, 60] as const;
export const NOTICE = [1, 2, 4, 12, 24, 48] as const;
export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export const DEFAULT_PREFS: CallPrefs = {
  lengthMin: 30, bufferMin: 10, aheadDays: 30, noticeHours: 4,
  hours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ on: d < 5, start: "09:00", end: d === 4 ? "15:00" : "17:00" })),
};

const isTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** Settings as saved, checked. Throws a plain sentence when something can't be used. */
export function checkPrefs(p: CallPrefs): CallPrefs {
  if (!(LENGTHS as readonly number[]).includes(p.lengthMin)) throw new Error("Pick a call length.");
  if (!(BUFFERS as readonly number[]).includes(p.bufferMin)) throw new Error("Pick the time kept free after each call.");
  if (!(AHEAD as readonly number[]).includes(p.aheadDays)) throw new Error("Pick how far ahead leads can book.");
  if (!(NOTICE as readonly number[]).includes(p.noticeHours)) throw new Error("Pick the shortest notice.");
  if (!Array.isArray(p.hours) || p.hours.length !== 7) throw new Error("Set the hours for each day.");
  const hours = p.hours.map((h, i) => {
    if (!isTime(h.start) || !isTime(h.end)) throw new Error(`Set ${DAY_NAMES[i]}'s hours.`);
    if (h.on && h.end <= h.start) throw new Error(`${DAY_NAMES[i]} ends before it starts.`);
    return { on: !!h.on, start: h.start, end: h.end };
  });
  return { lengthMin: p.lengthMin, bufferMin: p.bufferMin, aheadDays: p.aheadDays, noticeHours: p.noticeHours, hours };
}

const overlaps = (a: Span, b: Span) => a.s < b.e && b.s < a.e;

/** Monday = 0 for a business-local day. */
export const weekday = (ymd: string) => (new Date(`${ymd}T12:00:00Z`).getUTCDay() + 6) % 7;

/** Every open start time from (now + notice) to the end of the last day offered. `busy` and `taken` block the call
 *  and the buffer kept free on each side of it. Capped, so a page never gets thousands. */
export function openSlots(p: CallPrefs, now: number, busy: Span[], taken: Span[], cap = 600): number[] {
  const len = p.lengthMin * 60_000, buf = p.bufferMin * 60_000;
  const earliest = now + p.noticeHours * 3_600_000;
  const blocks = [...busy, ...taken];
  const out: number[] = [];
  const today = local(now).date;
  for (let i = 0; i <= p.aheadDays; i++) {
    const day = addDays(today, i);
    const h = p.hours[weekday(day)];
    if (!h?.on) continue;
    const dayEnd = zonedMs(`${day}T${h.end}:00`, TZ);
    for (let s = zonedMs(`${day}T${h.start}:00`, TZ); s + len <= dayEnd; s += len) {
      if (s < earliest) continue;
      const guard = { s: s - buf, e: s + len + buf };
      if (blocks.some((b) => overlaps(guard, b))) continue;
      out.push(s);
      if (out.length >= cap) return out;
    }
  }
  return out;
}

/** The window busy times are read for: now to the end of the last day offered. */
export function window(p: CallPrefs, now: number): Span {
  const last = addDays(local(now).date, p.aheadDays + 1);
  return { s: now, e: zonedMs(`${last}T00:00:00`, TZ) };
}

/** Google's events as busy spans: free ("transparent") events, cancelled ones and ones the account declined don't count. */
export function busyFrom(items: Array<{ status?: string; transparency?: string; start?: { date?: string; dateTime?: string; timeZone?: string }; end?: { date?: string; dateTime?: string; timeZone?: string }; attendees?: Array<{ self?: boolean; responseStatus?: string }> }>, momentOf: (t: { date?: string; dateTime?: string; timeZone?: string }) => number): Span[] {
  const out: Span[] = [];
  for (const ev of items) {
    if (ev.status === "cancelled" || ev.transparency === "transparent") continue;
    if (ev.attendees?.some((a) => a.self && a.responseStatus === "declined")) continue;
    if (ev.start?.date) {
      const s = zonedMs(`${ev.start.date}T00:00:00`, TZ), e = zonedMs(`${ev.end?.date ?? addDays(ev.start.date, 1)}T00:00:00`, TZ);
      if (e > s) out.push({ s, e });
      continue;
    }
    if (!ev.start?.dateTime || !ev.end?.dateTime) continue;
    const s = momentOf(ev.start), e = momentOf(ev.end);
    if (Number.isFinite(s) && Number.isFinite(e) && e > s) out.push({ s, e });
  }
  return out;
}
