// Phase 3c step 2 · bookings, the pure parts (shared by the server and the Book a vendor dialog): how long a booking
// is, what it is expected to cost, the rate Pricing suggests for a role, and the state it shows.
import type { Rates } from "./estimate";

export type Unit = "day" | "hour";
export type BookingStatus = "offered" | "accepted" | "declined" | "cancelled";
export type BookingState = BookingStatus | "done";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const isDate = (s: string) => DATE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** Days from start to end, both counted (Nov 6 – Nov 7 is 2). */
export function daysIn(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

/** The agreed rate × days, or × the expected hours for an hourly booking. */
export function expectedCents(b: { start: string; end: string; rate: { cents: number; unit: Unit }; hours?: number | null }): number {
  if (b.rate.unit === "hour") return Math.round(b.rate.cents * (b.hours ?? 0));
  return b.rate.cents * Math.max(1, daysIn(b.start, b.end));
}

/** Done = accepted and its last day has passed (in Central time, where the businesses are for now). */
export function bookingState(b: { status: BookingStatus; end: string }, today: string): BookingState {
  return b.status === "accepted" && b.end < today ? "done" : b.status;
}
export const todayCentral = (now = Date.now()) => new Date(now).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

export type Suggestion = { cents: number; unit: Unit; source: "pricing" | "vendor"; name: string; baseCents: number; baseUnit: Unit; hoursPerDay: number };

/**
 * The rate to suggest for a role, in the unit asked for: the business's Pricing subcontractor cost with that name
 * (Shooter $125 / hour → $1,000 / day at an 8-hour day), else the vendor's own rate for the role. Null when neither.
 */
export function suggestRate(r: Pick<Rates, "costs" | "kinds" | "fullDayHours"> | null | undefined, vendorRates: Array<{ role: string; unit: Unit; cents: number }>, role: string, unit: Unit): Suggestion | null {
  const key = role.trim().toLowerCase();
  if (!key) return null;
  const h = r?.fullDayHours && r.fullDayHours > 0 ? r.fullDayHours : 8;
  const convert = (cents: number, from: Unit) => (from === unit ? cents : unit === "day" ? Math.round(cents * h) : Math.round(cents / h));
  const c = r?.costs.find((x) => x.name.trim().toLowerCase() === key);
  if (c && c.cents > 0) {
    const from: Unit = r?.kinds.find((k) => k.id === c.kindId)?.unit ?? "hour";
    return { cents: convert(c.cents, from), unit, source: "pricing", name: c.name, baseCents: c.cents, baseUnit: from, hoursPerDay: h };
  }
  const own = vendorRates.find((x) => x.role.trim().toLowerCase() === key && x.cents > 0);
  if (own) return { cents: convert(own.cents, own.unit), unit, source: "vendor", name: own.role, baseCents: own.cents, baseUnit: own.unit, hoursPerDay: h };
  return null;
}

/** "Apr 16 – 18, 2027", "Nov 30 – Dec 2, 2026", "Nov 20, 2026". */
export function dateRange(start: string, end: string): string {
  const d = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", ...o });
  if (start === end) return d(start, { month: "short", day: "numeric", year: "numeric" });
  if (start.slice(0, 4) !== end.slice(0, 4)) return `${d(start, { month: "short", day: "numeric", year: "numeric" })} – ${d(end, { month: "short", day: "numeric", year: "numeric" })}`;
  if (start.slice(0, 7) === end.slice(0, 7)) return `${d(start, { month: "short", day: "numeric" })} – ${d(end, { day: "numeric" })}, ${end.slice(0, 4)}`;
  return `${d(start, { month: "short", day: "numeric" })} – ${d(end, { month: "short", day: "numeric" })}, ${end.slice(0, 4)}`;
}
/** The same without the year when it's this year ("Nov 6 – 7"), for lists. */
export function shortRange(start: string, end: string, thisYear = String(new Date().getFullYear())): string {
  const r = dateRange(start, end);
  return start.slice(0, 4) === thisYear && end.slice(0, 4) === thisYear ? r.replace(`, ${thisYear}`, "") : r;
}

/** Why a vendor declines (732:3285). */
export const DECLINE_REASONS = ["Booked that day", "Rate doesn't work", "Too far", "Other"] as const;
/** How a vendor gets paid (D101: the method and a note only, never bank numbers). */
export const PAY_METHODS = ["ACH", "Zelle", "Check", "Other"];
