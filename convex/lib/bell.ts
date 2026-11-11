// Phase 5e step 4 (Nov 5): the notification centre's kinds (Design Log › Phase 5e: Notification centre, frames 822:18106 …,
// 823:19778, Settings › Notifications 823:21703). Every email the portal sends to the business owner also lands in the
// bell (D146: "bell shows every kind"), even when its email is switched off. Shared with the pages (no server imports).
import type { Perm } from "./perms";

export const BELL_KINDS = ["quotes", "contracts", "payments", "vendors", "notes", "messages", "uploads", "sitewatch"] as const;
export type BellKind = (typeof BELL_KINDS)[number];

/** The rows of Settings › Notifications and the See all page's filters, in the frame's words. */
export const BELL_NAMES: Record<BellKind, { label: string; row: string }> = {
  quotes: { label: "Quotes", row: "Proposals and quotes accepted" },
  contracts: { label: "Contracts", row: "Contracts signed" },
  payments: { label: "Payments", row: "Payments received" },
  vendors: { label: "Vendors", row: "Vendor invoices" },
  notes: { label: "Notes", row: "Notes from clients" },
  messages: { label: "Messages", row: "Messages from clients" },
  uploads: { label: "Uploads", row: "Files uploaded" },
  sitewatch: { label: "Site watch", row: "Site watch: urgent items" },
};

/** The bell panel's four groups (822:18106): All, Quotes, Contracts, Money, Messages. */
export const PANEL_GROUPS: Record<"quotes" | "contracts" | "money" | "messages", BellKind[]> = {
  quotes: ["quotes"], contracts: ["contracts"], money: ["payments", "vendors"], messages: ["notes", "messages", "uploads"],
};

/** D146: phone alerts start on for payments, signed contracts, accepted quotes and proposals, and client messages. */
export const PHONE_DEFAULT: BellKind[] = ["quotes", "contracts", "payments", "messages"];

/** Which switch lets a team member see each kind (the owner sees them all; Site watch is the owner's). */
export const BELL_PERM: Record<BellKind, Perm[] | null> = {
  quotes: ["docs", "payments"], contracts: ["docs"], payments: ["payments"], vendors: ["vendorPayments"],
  notes: ["review"], messages: ["clients"], uploads: ["projects"], sitewatch: null,
};

/** The owner email kinds (lib/notify.ts) and the bell kind each one is. */
export const EMAIL_TO_BELL: Record<string, BellKind> = {
  "quote-accepted": "quotes", "quote-declined": "quotes", "proposal-accepted": "quotes", "proposal-declined": "quotes",
  "ws-owner-signed": "contracts", "ws-owner-all_signed": "contracts", "ws-owner-locked": "contracts",
  "owner-paid": "payments", "subscription-failed-owner": "payments", "footage_kept": "payments", "footage_renewal": "payments", "footage_ended": "payments",
  "vendor_invoice": "vendors", "vendor_payout_posted": "vendors", "vendor_payout_failed": "vendors", "booking_accepted": "vendors", "booking_declined": "vendors", "vendor_w9": "vendors", "briefing_read": "vendors",
  "alert": "notes", "testimonial": "notes", "brief_answered": "notes",
  "message_owner": "messages", "call_booked_owner": "messages", "call_cancelled_owner": "messages", "call_moved_owner": "messages", "shoot_confirmed": "messages",
  "files_uploaded": "uploads",
  "site_watch_urgent": "sitewatch",
};

/** The first link to this portal in an email's text, as a path for the bell ("/payments/invoices/…"); null if none. */
export function bellLink(text: string, site: string): string | null {
  for (const m of text.matchAll(/https?:\/\/[^\s<>"')]+/g)) {
    try {
      const u = new URL(m[0]);
      if (u.origin === new URL(site).origin) return `${u.pathname}${u.search}${u.hash}` || "/";
    } catch { /* not a link */ }
  }
  return null;
}
