// Nov 18 (Heston): "Make this link expire" on proposals and briefings. A tick before sending, then 1, 2, 3, 7 or 30
// days; changeable afterward (or Never). Every link to the item stops working after linkExpiresAt: emailed people's
// and the copied link. The owner's own pages are unaffected.
import { v } from "convex/values";
import { ConvexError } from "convex/values";

export const EXPIRY_DAYS = [1, 2, 3, 7, 30] as const;
export const expiryDays = v.union(v.literal(1), v.literal(2), v.literal(3), v.literal(7), v.literal(30));
const DAY = 86_400_000;

/** When a link set to last `days` from `now` stops working. Throws for anything but 1, 2, 3, 7 or 30. */
export function expiryFrom(days: number, now: number) {
  if (!(EXPIRY_DAYS as readonly number[]).includes(days)) throw new ConvexError("Links last 1, 2, 3, 7 or 30 days.");
  return now + days * DAY;
}

/** Takes any record; only proposals and briefings carry linkExpiresAt (a quote's own "valid until" is separate). */
export const linkExpired = (x: object, now = Date.now()) => { const t = (x as { linkExpiresAt?: unknown }).linkExpiresAt; return typeof t === "number" && now >= t; };

export const EXPIRED = "This link has expired. Ask for a new one.";
