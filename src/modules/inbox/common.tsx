// Shared by the client's Inbox, Their Inbox on the client page and Sent: icons, times and read lines.
import type { IconName } from "../../ui/Icon";

export type InboxKind = "cut_ready" | "reply" | "to_sign" | "signed" | "cancelled" | "note" | "stage" | "final_files" | "invoice" | "payment";
export const INBOX_ICON: Record<InboxKind, IconName> = { cut_ready: "video", reply: "note", to_sign: "sign", signed: "check-circle", cancelled: "close", note: "mail", stage: "activity", final_files: "download", invoice: "invoice", payment: "check-circle" };

const TZ = "America/Chicago";
const DAY = 86_400_000;
const ymd = (t: number) => new Date(t).toLocaleDateString("en-CA", { timeZone: TZ });
export const monthDay = (t: number) => new Date(t).toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric" });
export const timeOfDay = (t: number) => new Date(t).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });

/** "today", "yesterday", "Oct 26": the end of a detail line. */
export function dayWord(t: number, now = Date.now()) {
  if (ymd(t) === ymd(now)) return "today";
  if (ymd(t) === ymd(now - DAY)) return "yesterday";
  return monthDay(t);
}
export const Day = (t: number, now = Date.now()) => { const w = dayWord(t, now); return w[0].toUpperCase() + w.slice(1); };

/** An item's second line: a note says who it's from; everything else says what it's about. */
export function itemDetail(i: { kind: string; text: string }, business: string) {
  return i.kind === "note" ? `A note from ${business}` : i.text;
}
export const firstName = (who: string | null | undefined) => (who ?? "").trim().split(/\s+/)[0] || (who ?? "");
