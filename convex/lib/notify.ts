// Notifications (Heston, Nov 2: "email notifications for everything, with a notifications settings menu so every
// business, vendor and client can configure their notifications"). The one list of every email the portal sends,
// by who gets it: the business owner, a vendor, or a client. Each one either has a switch (on unless the person turns
// it off, per business) or is always sent: sign-in codes, invites, documents to sign or pay, signed copies, receipts
// and security alerts are records or the job itself, so they can't be switched off. Shared with the pages (no
// server imports).

export type Side = "owner" | "vendor" | "client";
export type Notice = {
  key: string;          // the switch, stored in emailPrefs.off (versions/replies/notes keep their own columns)
  side: Side;
  group: string;        // the heading it sits under in Settings › Notifications
  label: string;
  hint?: string;
  kinds: string[];      // the email kinds (deliverOnce / sendEmail tags) this switch covers
  always?: boolean;     // shown, but not switchable
};

export const NOTICES: Notice[] = [
  // ---------- to the business owner ----------
  { key: "review_notes", side: "owner", group: "Review", label: "Clients leave notes on a video", hint: "One email per sitting, 10 minutes after their last note.", kinds: ["alert"] },
  { key: "sign_progress", side: "owner", group: "Contracts", label: "Someone signs a document", hint: "Each signature, and when everyone has signed.", kinds: ["ws-owner-signed", "ws-owner-all_signed"] },
  { key: "sign_locked", side: "owner", group: "Contracts", label: "A signing link is locked after wrong codes", kinds: ["ws-owner-locked"], always: true },
  { key: "sign_copy", side: "owner", group: "Contracts", label: "Your copy of a signed document", kinds: ["ws-copy-owner"], always: true },
  { key: "quote_answers", side: "owner", group: "Quotes and proposals", label: "A client accepts or declines a quote", kinds: ["quote-accepted", "quote-declined"] },
  { key: "proposal_answers", side: "owner", group: "Quotes and proposals", label: "A client accepts or declines a proposal", kinds: ["proposal-accepted", "proposal-declined"] },
  { key: "client_paid", side: "owner", group: "Payments", label: "A client pays an invoice", kinds: ["owner-paid"] },
  { key: "subscription_failed", side: "owner", group: "Payments", label: "A subscription payment fails", kinds: ["subscription-failed-owner"] },
  { key: "booked_calls", side: "owner", group: "Clients", label: "A lead books, moves or cancels a call", hint: "It also shows under Needs you on your Dashboard.", kinds: ["call_booked_owner", "call_cancelled_owner", "call_moved_owner"] }, // Phase 5d (Q86)
  { key: "booking_answers", side: "owner", group: "Vendors", label: "A vendor accepts or declines a booking", kinds: ["booking_accepted", "booking_declined"] },
  { key: "briefing_read", side: "owner", group: "Vendors", label: "A vendor reads a briefing", kinds: ["briefing_read"] },
  { key: "vendor_invoices", side: "owner", group: "Vendors", label: "A vendor sends an invoice", kinds: ["vendor_invoice"] },
  { key: "vendor_w9", side: "owner", group: "Vendors", label: "A vendor uploads a W-9", kinds: ["vendor_w9"] },
  { key: "vendor_payouts", side: "owner", group: "Vendors", label: "A vendor payment through Stripe goes out, fails or comes back", kinds: ["vendor_payout_posted", "vendor_payout_failed"] },
  { key: "shoot_confirmed", side: "owner", group: "Shoots and files", label: "A client confirms a shoot", kinds: ["shoot_confirmed"] },
  { key: "files_uploaded", side: "owner", group: "Shoots and files", label: "A client uploads files you asked for", hint: "One email per sitting, 10 minutes after their last file.", kinds: ["files_uploaded"] },
  { key: "brief_answered", side: "owner", group: "Shoots and files", label: "A client sends back the kickoff brief", hint: "And when they change it afterwards.", kinds: ["brief_answered"] },
  // Phase 5 (Nov 3)
  { key: "footage", side: "owner", group: "Delivery", label: "A client keeps their raw footage, or a storage year is about to renew", hint: "With the invoice draft for you to send.", kinds: ["footage_kept", "footage_renewal"] },
  { key: "footage_ended", side: "owner", group: "Delivery", label: "The keep date comes and the raw footage wasn't kept", hint: "The portal never deletes files, so this always arrives.", kinds: ["footage_ended"], always: true }, // also: Keep it never paid, and a storage invoice paid late (review fixes)
  { key: "testimonials", side: "owner", group: "Delivery", label: "A client sends a testimonial", kinds: ["testimonial"] },
  { key: "owner_codes", side: "owner", group: "Your account", label: "Sign-in codes and password resets", kinds: ["code", "reset"], always: true },

  // ---------- to a vendor ----------
  { key: "bookings", side: "vendor", group: "Bookings", label: "A new booking, or a booking is cancelled", kinds: ["booking_offer", "booking_cancelled"] },
  { key: "briefings", side: "vendor", group: "Briefings", label: "A briefing is sent to you", kinds: ["briefing"] },
  { key: "vendor_call_sheets", side: "vendor", group: "Call sheets", label: "A call sheet is sent to you, or updated", hint: "With reminders when you haven't opened one yet.", kinds: ["vendor_callsheet", "vendor_callsheet_update"] }, // Phase 5b step 3
  { key: "invoice_updates", side: "vendor", group: "Invoices", label: "Your invoice is approved, declined or paid", kinds: ["vendor_invoice_approved", "vendor_invoice_declined", "vendor_invoice_paid", "vendor_payout_returned"] },
  { key: "vendor_payout_setup", side: "vendor", group: "Your account", label: "A business asks you to set up direct deposit", kinds: ["vendor_payout_setup"], always: true },
  { key: "vendor_invite", side: "vendor", group: "Your account", label: "Invites from a business", kinds: ["vendor_invite"], always: true },
  { key: "vendor_codes", side: "vendor", group: "Your account", label: "Sign-in codes and password resets", kinds: ["code", "reset"], always: true },

  // ---------- to a client ----------
  { key: "versions", side: "client", group: "Review", label: "A new version is ready to watch", kinds: ["versions"] },
  { key: "replies", side: "client", group: "Review", label: "Someone replies to your note", kinds: ["replies"] },
  { key: "notes", side: "client", group: "Inbox", label: "A note from the business", kinds: ["notes"] },
  { key: "invoice_reminders", side: "client", group: "Payments", label: "Reminders before an invoice is due", hint: "Overdue notices, and reminders the business sends by hand, still arrive.", kinds: ["invoice-reminder-before"] },
  { key: "subscription_upcoming", side: "client", group: "Payments", label: "A subscription charge is coming up", kinds: ["subscription-upcoming"] },
  { key: "client_bills", side: "client", group: "Payments", label: "Invoices, receipts, overdue notices and failed payments", kinds: ["invoice", "invoice-reminder-overdue", "invoice-reminder-manual", "receipt", "payment-failed", "subscription", "subscription-failed", "subscription-cancelled"], always: true },
  { key: "client_shoots", side: "client", group: "Shoots and files", label: "Shoots scheduled or moved, files asked for, and the kickoff brief", hint: "They ask you to confirm, upload or answer, so they always arrive.", kinds: ["shoot", "file_request", "brief"], always: true },
  { key: "call_sheets", side: "client", group: "Shoots and files", label: "A call sheet is sent to you, or updated", hint: "With reminders when you haven't opened one yet.", kinds: ["callsheet", "callsheet_update"] }, // Phase 5b step 3
  { key: "files_due", side: "client", group: "Shoots and files", label: "A reminder the day before files are due", hint: "Only when nothing has been uploaded yet.", kinds: ["files_due"] },
  { key: "footage_offer", side: "client", group: "Delivery", label: "An offer to keep your raw footage after delivery", kinds: ["footage_offer"] },
  { key: "client_docs", side: "client", group: "Documents", label: "Quotes, proposals, documents to sign and signed copies", kinds: ["quote", "proposal", "ws-sign", "ws-reminder", "ws-cancelled", "ws-copy", "ws-code"], always: true },
  { key: "client_access", side: "client", group: "Your account", label: "Invites, shared links and sign-in codes", kinds: ["invite", "share-invite", "code", "reset"], always: true },
];

export const noticesFor = (side: Side) => NOTICES.filter((n) => n.side === side);
/** The switch an email kind belongs to (null: always sent, or not in the list). */
export function switchFor(kind: string): Notice | null {
  const n = NOTICES.find((x) => !x.always && x.kinds.includes(kind));
  return n ?? null;
}
export const SWITCH_KEYS = NOTICES.filter((n) => !n.always).map((n) => n.key);
