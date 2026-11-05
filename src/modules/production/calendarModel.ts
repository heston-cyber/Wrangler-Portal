// Phase 5b step 5 (Nov 3, D143): Production › Calendar's pure parts: days and weeks, what goes on each day, times,
// laying out a day's timed events side by side, and the drag rules (15-minute snap, when to ask before moving).
export const TZ = "America/Chicago";
export const SNAP = 15;

export const addDays = (ymd: string, n: number) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const dow = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay();
export const startOfWeek = (ymd: string) => addDays(ymd, -dow(ymd));
export const monthOf = (ymd: string) => ymd.slice(0, 7);
export const firstOfMonth = (ymd: string) => `${ymd.slice(0, 7)}-01`;
export function addMonths(ymd: string, n: number) {
  const d = new Date(`${firstOfMonth(ymd)}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}
/** The 6 weeks a month view shows (Sunday first). */
export function monthGrid(ymd: string): string[] {
  const start = startOfWeek(firstOfMonth(ymd));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

const fmt = (ymd: string, o: Intl.DateTimeFormatOptions) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", ...o });
export const monthTitle = (ymd: string) => fmt(ymd, { month: "long", year: "numeric" });
export const dayShort = (ymd: string) => fmt(ymd, { weekday: "short", month: "short", day: "numeric" }).replace(",", ""); // "Thu Nov 5"
export const dayHead = (ymd: string) => fmt(ymd, { weekday: "short", month: "short", day: "numeric" }).replace(",", "").toUpperCase(); // "TUE NOV 3"
export const weekday = (ymd: string) => fmt(ymd, { weekday: "short" }).toUpperCase();
export const dayNum = (ymd: string) => Number(ymd.slice(8));
export function weekTitle(start: string) {
  const end = addDays(start, 6);
  const a = fmt(start, { month: "short", day: "numeric" }), y = end.slice(0, 4);
  return monthOf(start) === monthOf(end) ? `${a} – ${dayNum(end)}, ${y}` : `${a} – ${fmt(end, { month: "short", day: "numeric" })}, ${y}`;
}

export const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export const toHHMM = (m: number) => { const x = Math.max(0, Math.min(24 * 60 - 1, Math.round(m))); return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`; };
export const snap15 = (m: number) => Math.round(m / SNAP) * SNAP;
/** "9:00 AM", or "9 AM" when short. */
export function clock(hhmm: string, short = false) {
  const [h, m] = hhmm.split(":").map(Number);
  const hh = ((h + 11) % 12) + 1, ap = h < 12 ? "AM" : "PM";
  return short && m === 0 ? `${hh} ${ap}` : `${hh}:${String(m).padStart(2, "0")} ${ap}`;
}
/** "10a", "5p", "12:30p": the month view's time prefix. */
export function tiny(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "a" : "p"}`;
}
export const nowLocal = () => {
  const d = new Date();
  return { date: d.toLocaleDateString("en-CA", { timeZone: TZ }), min: toMin(d.toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).replace(/^24/, "00")) };
};

// ---------- one list of things on the calendar ----------

export type Layer = "shoots" | "dates";
export type Item = {
  key: string;
  kind: "shoot" | "date" | "event";
  title: string;
  date: string; endDate: string;
  start: string | null; end: string | null;   // null: all day
  color: number | "shoot" | "date";
  where: string | null;
  source: string;                             // "Portal", or the Google Calendar's name
  guests: string[];
  people?: number;                            // a shoot: the client's people who are asked to confirm again when it moves
  canDrag: boolean;
  hasEnd?: boolean;                           // a shoot with a wrap time (without one, its end is call + 2 hours)
  ref: { eventId?: string; shootId?: string; projectId?: string; label?: string };
};

/** Does dropping it somewhere else ask first? Only when it has guests Google could email. */
export const moveNeedsAsk = (x: { guests: string[] }) => x.guests.length > 0;

export const onDay = (x: Pick<Item, "date" | "endDate">, ymd: string) => x.date <= ymd && x.endDate >= ymd;
export const sortItems = (a: Item, b: Item) => (a.start === null ? -1 : 0) - (b.start === null ? -1 : 0) || (a.start ?? "").localeCompare(b.start ?? "") || a.title.localeCompare(b.title);

/** A day's timed items, side by side where they overlap: column and how many columns its group has. */
export function layoutDay(items: Item[], day: string): Array<{ item: Item; top: number; bottom: number; col: number; cols: number }> {
  const timed = items.filter((x) => x.start !== null && onDay(x, day)).map((x) => {
    const top = x.date < day ? 0 : toMin(x.start!);
    const bottom = x.endDate > day ? 24 * 60 : Math.max(top + 20, toMin(x.end ?? x.start!));
    return { item: x, top, bottom, col: 0, cols: 1 };
  }).sort((a, b) => a.top - b.top || b.bottom - a.bottom);
  let group: typeof timed = [];
  let groupEnd = -1;
  const close = () => { const n = Math.max(1, ...group.map((g) => g.col + 1)); for (const g of group) g.cols = n; group = []; };
  for (const t of timed) {
    if (t.top >= groupEnd) { close(); groupEnd = -1; }
    const used = new Set(group.filter((g) => g.bottom > t.top).map((g) => g.col));
    let c = 0;
    while (used.has(c)) c++;
    t.col = c;
    group.push(t);
    groupEnd = Math.max(groupEnd, t.bottom);
  }
  close();
  return timed;
}
