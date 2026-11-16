// Shot lists: time and day labels shared by the pages, the block and the PDF.
/** "07:30" → "7:30 AM". */
export function clock(t: string) {
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
/** A setup's window: "7:30–8:30 AM" (one AM/PM when both share it), "7:30 AM", or "". */
export function windowOf(start: string | null, end: string | null) {
  if (!start) return "";
  if (!end) return clock(start);
  const a = clock(start), b = clock(end);
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)}–${b}` : `${a}–${b}`;
}
/** "2026-11-16" → "Mon 11/16". */
export const shortDay = (ymd: string) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  return `${d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short" })} ${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};
