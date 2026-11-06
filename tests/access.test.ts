// Client side C1 (Oct 23): the access matrix. Every public function the site has is called as nobody, as a
// stranger with an account, and as an invited client. All of them must be refused, except the few that are meant
// to answer (listed in OPEN / SIGNED_IN below). The list of functions is read from the generated API, so a new
// function can't slip through without being classified here.
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const modules = import.meta.glob("../convex/**/*.ts");

beforeAll(async () => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.DROPBOX_APP_KEY = "test-key";
  process.env.DROPBOX_APP_SECRET = "test-secret";
  process.env.BUNNY_STREAM_LIBRARY_ID = "785477";
  process.env.BUNNY_STREAM_API_KEY = "bunny-test";
  process.env.RESEND_API_KEY = "re_test";
  process.env.SITE_URL = "https://review.wranglerportal.com";
  process.env.CONVEX_SITE_URL = "https://handsome-hummingbird-11.convex.site";
  // Convex Auth mints a JWT once a code is accepted; a throwaway RSA pair made here, never a real key.
  const { generateKeyPairSync } = await import("node:crypto");
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.JWT_PRIVATE_KEY = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const jwk = pair.publicKey.export({ format: "jwk" });
  process.env.JWKS = JSON.stringify({ keys: [{ use: "sig", alg: "RS256", ...jwk }] });
});
afterEach(() => vi.unstubAllGlobals());

// Functions anyone may call, and why.
const OPEN: Record<string, string> = {
  "users.me": "returns the caller's own identity, or null",
  "phase0.saveRun": "lab test log: append-only, capped, holds no client data",
  "shares.open": "a share link: answers by the share's own gate (off/expired/passcode/invited), tested in shares.test.ts",
  "shares.touch": "records an open on a share link: same gate; a missing token records nothing",
  "shares.unlock": "the passcode box on a share link: rate-limited; a missing token answers 'missing'",
  "clients.canSignUp": "the sign-up page's pre-check: says only whether an email is invited",
  "prefs.mine": "the owner's display settings: the video page asks whoever is looking; anyone but the owner gets {}",
  // Phase 2 Part B step 3: the invoice link (/i/<token>) from email 08 works without an account, like a share link.
  "invoicePay.page": "an invoice link: answers only for a sent invoice's own long random token (tested in invoicePay.test.ts)",
  "invoicePay.markViewed": "the same link: records the first view of that invoice only; a missing token does nothing",
  "quotes.page": "a quote link (Phase 3b, D81): answers only for a sent quote's own long random token (tested in crm.test.ts)",
  "quotes.markViewed": "the same link: records the first view of that quote only; a missing token does nothing",
  "proposals.page": "a proposal link (Phase 3b, D73): answers only for a sent proposal's own long random token (tested in proposals.test.ts)",
  "proposals.markViewed": "the same link: records the first view of that proposal only; a missing token does nothing",
  "invoicePay.start": "Pay on the same link: returns Stripe's payment secret for that invoice only; a missing token is refused",
  "invoicePay.refresh": "the same link: re-reads that invoice from Stripe; a missing token does nothing",
  "invoicePay.mine": "a client's invoices, found by their own email; anyone else gets []",
  // Phase 2b: the subscription link (/sub/<token>) from email 13 works without an account, like the invoice link.
  "subscriptions.page": "a subscription link: answers only for that subscription's own long random token (tested in subscriptions.test.ts)",
  "subscriptions.setupStart": "the same link: a SetupIntent for that subscription's customer only; a missing token is refused",
  "subscriptions.setupDone": "the same link: checks the SetupIntent is that subscription's own before using it; a missing token is refused",
  "subscriptions.mine": "a client's subscriptions, found by their own email; anyone else gets []",
  // Phase 5d step 2: Messages. A lead's conversation answers only for that thread's own long random token (/m/<token>).
  "messages.leadPage": "a lead's message link: that conversation only (tested in messages.test.ts)",
  "messages.leadSend": "the same link: writes in that conversation only; rate-limited",
  "messages.leadRead": "the same link: marks that conversation read; a missing token does nothing",
  "messages.leadUploadUrl": "the same link: an upload address for a file to attach there; rate-limited",
  "messages.unread": "the caller's own unread count (owner or client); 0 for anyone else",
  // Phase 5d step 1: booking calls. The page answers by the business's slug (closed unless Google Calendar is connected
  // and the settings are saved); the private link (/call/<token>) only for that call's own long random token. Booking,
  // moving and cancelling are rate-limited. Tested in calls.test.ts.
  "calls.page": "the booking page /book/<slug>: the business's name and open times only, or closed",
  "calls.refresh": "the same page: asks for busy times to be read again; at most once a minute, rate-limited",
  "calls.book": "the same page: books an open time; checked again with Google; rate-limited, with a hidden field for robots",
  "calls.manage": "a call's own private link: that call only",
  "calls.cancel": "the same link: cancels that call only; rate-limited",
  "calls.reschedule": "the same link: moves that call to an open time only; rate-limited",
  "calls.verify": "the same link: the 6-digit code emailed to the lead; five wrong tries and the pick is let go; rate-limited",
  "calls.resendCode": "the same link: a new code to the email given; three an hour, shared with the lead's pick limit",
  "calls.release": "the same link: lets go of that pick while it waits for its code; rate-limited",
  // D147 (Nov 4): a briefing's no-login link (/b/<token>, email 58). Tested in briefingsShare.test.ts.
  "briefings.page": "a briefing link: answers only for a shared briefing's own long random token (a person's own, or the copied link); a turned-off link answers Withdrawn with the business and title only",
  "briefings.opened": "the same link: counts an open of that briefing only; a missing token, a draft or a turned-off link does nothing; rate-limited",
  "signCopies.page": "D160: a copied person's view-only link: answers only for a copy row's own long random token; a cancelled, replaced or expired document answers without its file (tested in signCc.test.ts)",
  "signCopies.opened": "the same link: counts an open of that copy only; rate-limited",
  "briefings.markRead": "the same link: records \"I've read it\" for that briefing only (named only on a person's own link); a missing token is refused; rate-limited",
  "siteWatch.summary": "Phase 5c: open and urgent counts for the portal's admins (ALLOWED_EMAILS); null for anyone else, tested in siteWatch.test.ts",
  // Phase 5b step 4 (D127): a call-sheet guest's link (/guest/<token>, email 41), signed out.
  "guests.intro": "a guest's link: answers only for that pass's own long random token, with the sheet's title, day, the guest's first name and a masked email; tested in callSheetGuests.test.ts",
  "guests.sendCode": "the same link's \"Email me a code\": emails a code to the pass's own address only (never shown), rate-limited; a missing token is refused",
  "security.signInLocked": "the sign-in page's Too many tries (D146): only whether an email's password sign-in is resting after 5 wrong tries, and for how many minutes; tested in security.test.ts",
  // Phase 5e step 1: the Join page (/team/join/<token>, email 46).
  "team.joinPage": "a team invite's link: answers only for that invite's own long random token (its hash is stored), with the business, role, inviter and the invited email; tested in team.test.ts",
};
// Functions with their own gate (a key in the arguments): refused with the wrong key, whoever calls.
const KEYED = new Set(["r1results.report"]);
// Phase 5b step 4 (D127): the only functions a call-sheet guest's login may call, and why. Each finds the guest's own pass
// by its token and re-checks the sheet on every call (lib/guests.ts); tested in callSheetGuests.test.ts.
const GUEST: Record<string, string> = {
  "guests.home": "the guest's own call sheets (passes found by their own email), one business at a time: active ones, and ended ones that went to them (title and day only); the switcher's businesses and their unopened counts from their own passes",
  "guests.sheet": "one of the guest's own sheets by its link token: the sent copy while active, else Access ended (title and day only)",
  "guests.opened": "records the guest opening their own sheet, only while it's active",
};
// Functions any signed-in account may call (owner or client), never a stranger.
const SIGNED_IN = new Set(["help.list", "help.guide", "messages.mine", "messages.clientThreadPage", "messages.clientSend", "messages.read", /* messages.uploadUrl: only a client who can open a project (the matrix client can't; messages.test.ts) */ "users.setName", "users.switchSide", "clients.account", "shares.mine",
  // Phase 1: a client's own Inbox, Documents and their businesses' look
  "inbox.mine", "inbox.unreadCount", "inbox.markRead", "inbox.markAllRead", "documents.mine", "business.brand",
  "portal.waiting", "emails.myPrefs", "emails.setMine",
  // Nov 2: a client's Settings › Notifications (their own address only)
  "notifications.client", "notifications.setClient",
  // Phase 4: a client's shoots (only on projects they can open)
  "shoots.forClientProject", "shoots.page", "shoots.confirm",
  "fileRequests.forClientProject", "fileRequests.page", "fileRequests.start", "fileRequests.finishDirect",
  "briefs.forClientProject", "briefs.page", "briefs.save", "briefs.submit",
  // Phase 2 Part A: a client's projects (only those their share invites cover) and the final files' links (only once open)
  "projects.mine", "projects.forClient", "projects.deliveryLink",
  // Phase 5: a client's raw footage offer (only on projects they can open) and the testimonial form (only from a request they got)
  "footage.forClientProject", "footage.keep", "footage.decline", "testimonials.ask", "testimonials.send",
  // Phase 5b step 3: a call sheet sent to them (only one sent to them, on a project they can open; tested in callSheets.test.ts)
  "callSheets.forClient", "callSheets.forClientProject", "callSheets.opened",
  // Phase 5e step 2: their own password, email and devices (security.test.ts)
  "security.state", "security.changePassword", "security.startEmailChange", "security.confirmEmailChange", "security.cancelEmailChange", "security.seenDevice", "security.signOutDevice"]);
// D133 (Phase 5): functions a vendor login may call: their own side of the portal (each checks the vendor's own records,
// tested in vendorPortal.test.ts and vendorPayouts.test.ts), their own identity, and nothing of the owner's or a client's.
const VENDOR = new Set(["help.list", "help.guide", "users.switchSide",
  "vendorPortal.businesses", "vendorPortal.counts", "vendorPortal.home", "vendorPortal.bookings", "vendorPortal.booking", "vendorPortal.accept", "vendorPortal.decline",
  "vendorPortal.briefings", "vendorPortal.briefing", "vendorPortal.markRead", "vendorPortal.reviews", "vendorPortal.invoices", "vendorPortal.invoiceForm", "vendorPortal.invoice",
  "vendorPortal.saveInvoice", "vendorPortal.deleteInvoice", "vendorPortal.settings", "vendorPortal.notifications", "vendorPortal.setNotification", "vendorPortal.saveDetails",
  "vendorPortal.w9UploadUrl", "vendorPortal.setW9", "vendorPayouts.mine", "vendorPayouts.setupLink", "vendorPayouts.refreshMine",
  // Phase 5b step 3: call sheets sent to them (only while booked on the project; tested in callSheets.test.ts)
  "vendorPortal.callSheet", "vendorPortal.callSheets", "vendorPortal.openCallSheet",
  // Phase 5e step 2: their own password, email and devices (security.test.ts)
  "security.state", "security.changePassword", "security.startEmailChange", "security.confirmEmailChange", "security.cancelEmailChange", "security.seenDevice", "security.signOutDevice"]);

// Phase 5e step 1: what each team role may call with its suggested switches (lib/perms.ts SUGGESTED). A function names
// the switch that opens it (requireMe(ctx, "review"), requireAll for the whole business, requireFor for particular
// records); one that names none stays the owner's: the signing steps (approve, send, void, Heston's signature), deletes
// of projects, videos and clients, Approve final, Stripe, Dropbox, Google Calendar and Claude connections and keys, the
// Team, Activity and Dashboard feeds. The matrix Editor is assigned to no project. Behaviour is tested in team.test.ts.
const REVIEW = "Review: works on a video, its versions, notes, uploads and register numbers as the owner does (an Editor only on assigned projects)";
const SHARES = "Review: the owner's share links for clients (not an Editor)";
const PROJECTS = "Projects: the project page, its stage, dates, rounds, delivery, file requests and kickoff brief (not an Editor, except assigned projects in Review)";
const SHOOTS = "Shoots and call sheets: shoots, call sheets and the calendar's shoots and events (not an Editor)";
const PRODUCTION = "Production and Gear: gear, vendors, crew bookings and briefings, without vendor payments (not an Editor)";
const CLIENTS = "Clients and leads: clients and their people, portal invites, Inbox notes, messages, booked calls, testimonials (not an Editor; the pipeline also needs project value)";
const DOCS = "Docs: drafts, templates, clauses and documents up to approval, and proposals with their prices (approve, send, void and Heston's signature stay the owner's)";
const PAYMENTS = "Payments: invoices, reminders, quotes, plans, subscriptions and footage storage (not an Editor)";
const VENDORPAY = "Vendor payments: vendor invoices and payouts (not an Editor)";
const SETTINGS = "Settings: booking-call settings (when Settings is on for the role)";
const BUDGETS = "Clients and leads with See what a project is worth: the pipeline, estimates and the job ledger (a Producer by default, Heston Nov 5)";
const BELL = "the notification bell and Settings › Notifications: their own feed, switches and phones; items reach them only for kinds their switches cover (an Editor only for assigned projects), tested in bell.test.ts";
const REPORTS = "Payments › Reports and the Dashboard's Reports widgets (the Reports switch: the Bookkeeper by default), tested in reports.test.ts";
const REPORT_FNS = ["reports.page", "reports.widgets", "reports.logExport"];
const BELL_FNS = ["bell.feed", "bell.unread", "bell.markRead", "bell.markAllRead", "bell.prefs", "bell.setPref", "bell.phoneAllOff", "bell.subscribe", "bell.unsubscribe", "bell.pushKey", "push.ensureKey"];
const ACCOUNT = "Settings › Account and Security: their own name, password, email and devices";
const BRAND = "their business's look (name, logo, colours), like every signed-in account";
const TEAM: Record<"producer" | "editor" | "bookkeeper", Record<string, string>> = {
  producer: {
    "approvals.approve": REVIEW,
    "approvals.forVideo": REVIEW,
    "bookings.form": PRODUCTION,
    "bookings.list": PRODUCTION,
    "bookings.forProject": PRODUCTION,
    "bookings.forVendor": PRODUCTION,
    "bookings.get": PRODUCTION,
    "bookings.create": PRODUCTION,
    "bookings.cancel": PRODUCTION,
    "briefings.templates": PRODUCTION,
    "briefings.list": PRODUCTION,
    "briefings.forVendor": PRODUCTION,
    "briefings.get": PRODUCTION,
    "briefings.create": PRODUCTION,
    "briefings.setDetails": PRODUCTION,
    "briefings.deleteDraft": PRODUCTION,
    "briefings.copy": PRODUCTION,
    "briefings.setLinkOff": PRODUCTION,
    "briefings.share": PRODUCTION,
    "briefs.settings": PROJECTS,
    "briefs.saveSettings": PROJECTS,
    "briefs.resetSettings": PROJECTS,
    "briefs.forProject": PROJECTS,
    "briefs.send": PROJECTS,
    "briefs.remind": PROJECTS,
    "briefs.forEstimate": PROJECTS,
    "builder.getProfile": DOCS,
    "builder.listBuilds": DOCS,
    "builder.getBuild": DOCS,
    "builder.createBuild": DOCS,
    "builder.saveBuild": DOCS,
    "builder.deleteBuild": DOCS,
    "builder.listTemplates": DOCS,
    "builder.getTemplate": DOCS,
    "builder.saveAsTemplate": DOCS,
    "builder.updateTemplate": DOCS,
    "builder.duplicateTemplate": DOCS,
    "builder.deleteTemplate": DOCS,
    "builder.ensureStarter": DOCS,
    "builder.listClauses": DOCS,
    "builder.saveClause": DOCS,
    "builder.duplicateClause": DOCS,
    "builder.deleteClause": DOCS,
    "builder.listStyles": DOCS,
    "builder.saveStyle": DOCS,
    "builder.setDefaultStyle": DOCS,
    "builder.deleteStyle": DOCS,
    "builder.uploadUrl": DOCS,
    "builder.fileUrls": DOCS,
    "builder.checkImage": DOCS,
    "builder.listFonts": DOCS,
    "builder.addFont": DOCS,
    "builder.deleteFont": DOCS,
    "builder.ensureGoogleFont": DOCS,
    "builder.importPdf": DOCS,
    "business.brand": BRAND,
    "calendarSync.range": SHOOTS,
    "calendarSync.linkOptions": SHOOTS,
    "calendarSync.setShown": SHOOTS,
    "calendarSync.create": SHOOTS,
    "calendarSync.update": SHOOTS,
    "calendarSync.move": SHOOTS,
    "calendarSync.undoMove": SHOOTS,
    "calendarSync.remove": SHOOTS,
    "calendarSync.moveShoot": SHOOTS,
    "calendarSync.undoShoot": SHOOTS,
    "calendarSync.moveDate": SHOOTS,
    "calendarSync.shootMoveDone": SHOOTS,
    "calendarSync.askConfirmAgain": SHOOTS,
    "calendarSync.syncNow": SHOOTS,
    "callSheets.ensureStarters": SHOOTS,
    "callSheets.list": SHOOTS,
    "callSheets.newOptions": SHOOTS,
    "callSheets.get": SHOOTS,
    "callSheets.create": SHOOTS,
    "callSheets.saveAnswers": SHOOTS,
    "callSheets.make": SHOOTS,
    "callSheets.toggle": SHOOTS,
    "callSheets.addGuest": SHOOTS,
    "callSheets.removeGuest": SHOOTS,
    "callSheets.endGuest": SHOOTS,
    "callSheets.restoreGuest": SHOOTS,
    "callSheets.deleteDraft": SHOOTS,
    "callSheets.send": SHOOTS,
    "callSheets.sendUpdate": SHOOTS,
    "callSheets.remind": SHOOTS,
    "callSheets.refreshWeather": SHOOTS,
    "calls.forDeal": CLIENTS,
    "calls.done": CLIENTS,
    "clients.invite": CLIENTS,
    "clients.revokeInvite": CLIENTS,
    "clients.listInvites": CLIENTS,
    "clients.people": CLIENTS,
    "clients.addPerson": CLIENTS,
    "clients.updatePerson": CLIENTS,
    "clients.removePerson": CLIENTS,
    "clients.invitePerson": CLIENTS,
    "clients.page": CLIENTS,
    "clients.setSettings": CLIENTS,
    "clients.directory": CLIENTS,
    "crm.rates": BUDGETS,
    "crm.saveRates": BUDGETS,
    "crm.board": BUDGETS,
    "crm.addDeal": BUDGETS,
    "crm.moveDeal": BUDGETS,
    "crm.linkProject": BUDGETS,
    "crm.closeDeal": BUDGETS,
    "crm.deal": BUDGETS,
    "crm.companies": BUDGETS,
    "crm.company": BUDGETS,
    "crm.contact": BUDGETS,
    "crm.followUps": BUDGETS,
    "crm.addFollowUp": BUDGETS,
    "crm.doneFollowUp": BUDGETS,
    "crm.getEstimate": BUDGETS,
    "crm.saveEstimate": BUDGETS,
    "crm.makeContract": BUDGETS,
    "crm.ledger": BUDGETS,
    "crm.logEntry": BUDGETS,
    "crm.entryAction": BUDGETS,
    "crm.setLedgerExport": BUDGETS,
    "crm.setLedgerExportAll": BUDGETS,
    "crm.due": BUDGETS,
    "fileRequests.forProject": PROJECTS,
    "fileRequests.create": PROJECTS,
    "fileRequests.setStatus": PROJECTS,
    "gear.list": PRODUCTION,
    "gear.get": PRODUCTION,
    "gear.add": PRODUCTION,
    "gear.update": PRODUCTION,
    "gear.setStatus": PRODUCTION,
    "gear.uploadUrl": PRODUCTION,
    "gear.setPhoto": PRODUCTION,
    "gear.removePhoto": PRODUCTION,
    "gear.logMaintenance": PRODUCTION,
    "gear.exportCsv": PRODUCTION,
    "gear.forShoot": PRODUCTION,
    "gear.addToShoot": PRODUCTION,
    "gear.removeFromShoot": PRODUCTION,
    "inbox.forClient": CLIENTS,
    "inbox.noteRecipients": CLIENTS,
    "inbox.notes": CLIENTS,
    "inbox.sent": CLIENTS,
    "inbox.noteDetail": CLIENTS,
    "inbox.saveNote": CLIENTS,
    "inbox.sendNote": CLIENTS,
    "inbox.discardNote": CLIENTS,
    "library.projectNames": REVIEW,
    "library.overview": REVIEW,
    "library.createClient": CLIENTS,
    "library.markOpened": REVIEW,
    "library.renameProject": PROJECTS,
    "library.setVersionDescription": REVIEW,
    "library.createProject": PROJECTS,
    "library.createVideo": REVIEW,
    "library.renameVideo": REVIEW,
    "library.video": REVIEW,
    "library.setPoster": REVIEW,
    "library.setStartTimecode": REVIEW,
    "library.reportFrameCount": REVIEW,
    "library.retryCopy": REVIEW,
    "library.downloadCheck": REVIEW,
    "library.downloadLink": REVIEW,
    "messages.threads": CLIENTS,
    "messages.thread": CLIENTS,
    "messages.send": CLIENTS,
    "messages.startOptions": CLIENTS,
    "messages.start": CLIENTS,
    "messages.setLeadLink": CLIENTS,
    "notes.forVersion": REVIEW,
    "notes.create": REVIEW,
    "notes.editText": REVIEW,
    "notes.setStatus": REVIEW,
    "notes.setVisibility": REVIEW,
    "notes.setReplyHidden": REVIEW,
    "notes.remove": REVIEW,
    "notes.reply": REVIEW,
    "notes.voiceUploadUrl": REVIEW,
    "notes.discardVoice": REVIEW,
    "overviews.clients": CLIENTS,
    "overviews.review": REVIEW,
    "overviews.docs": DOCS,
    "overviews.proposals": DOCS,
    "overviews.vendors": PRODUCTION,
    "player.log": REVIEW,
    "player.fileFailed": REVIEW,
    "production.overview": PRODUCTION,
    "production.shoots": PRODUCTION,
    "production.projectsForShoot": PRODUCTION,
    "projects.page": PROJECTS,
    "projects.setStage": PROJECTS,
    "projects.setNextStep": PROJECTS,
    "projects.setKeyDates": PROJECTS,
    "projects.setRounds": PROJECTS,
    "projects.nextRound": PROJECTS,
    "projects.addDeliveryFile": PROJECTS,
    "projects.removeDeliveryFile": PROJECTS,
    "projects.setDelivery": PROJECTS,
    "projects.dropboxFiles": PROJECTS,
    "proposals.list": DOCS,
    "proposals.get": DOCS,
    "proposals.create": DOCS,
    "proposals.copy": DOCS,
    "proposals.deleteDraft": DOCS,
    "proposals.templates": DOCS,
    "proposals.newTemplate": DOCS,
    "proposals.send": DOCS,
    "proposals.stopLink": DOCS,
    "proposals.newLink": DOCS,
    "proposals.withdraw": DOCS,
    "proposals.later": DOCS,
    "proposals.startContract": DOCS,
    "proposals.questionnaire": DOCS,
    "proposals.saveQuestionnaire": DOCS,
    "proposals.resetQuestionnaire": DOCS,
    "proposals.startQuestionnaire": DOCS,
    "proposals.saveAnswers": DOCS,
    "proposals.answerUploadUrl": DOCS,
    "proposals.addAnswerFile": DOCS,
    "proposals.fileUrls": DOCS,
    "proposals.finish": DOCS,
    "proposals.fillInstead": DOCS,
    "proposals.dismissDrafted": DOCS,
    "proposals.setDeck": DOCS,
    "proposals.forCompany": DOCS,
    "register.list": REVIEW,
    "register.nextName": REVIEW,
    "register.newVideo": REVIEW,
    "register.setShortTitle": REVIEW,
    "register.addToRegister": REVIEW,
    "security.state": ACCOUNT,
    "security.changePassword": ACCOUNT,
    "security.startEmailChange": ACCOUNT,
    "security.confirmEmailChange": ACCOUNT,
    "security.cancelEmailChange": ACCOUNT,
    "security.seenDevice": ACCOUNT,
    "security.signOutDevice": ACCOUNT,
    "shares.create": SHARES,
    "shares.update": SHARES,
    "shares.setOff": SHARES,
    "shares.remove": SHARES,
    "shares.addMember": SHARES,
    "shares.resendInvite": SHARES,
    "shares.removeMember": SHARES,
    "shares.list": SHARES,
    "shares.forTarget": SHARES,
    "shares.coveringVideo": SHARES,
    "shares.activity": SHARES,
    "shoots.forProject": SHOOTS,
    "shoots.schedule": SHOOTS,
    "shoots.update": SHOOTS,
    "shoots.cancel": SHOOTS,
    "sign.list": DOCS,
    "sign.get": DOCS,
    "sign.uploadUrl": DOCS,
    "sign.create": DOCS,
    "sign.saveLayout": DOCS,
    "sign.revise": DOCS,
    "sign.replaceFile": DOCS,
    "sign.setHidden": DOCS,
    "sign.preview": DOCS,
    "sign.requestsFor": DOCS,
    "sign.pendingRequests": DOCS,
    "signDone.retry": DOCS,
    "signDone.downloadAudit": DOCS,
    "team.projectPeople": PROJECTS,
    "testimonials.projectsFor": CLIENTS,
    "testimonials.list": CLIENTS,
    "testimonials.markRead": CLIENTS,
    "testimonials.saveAgain": CLIENTS,
    "transcripts.retry": REVIEW,
    "transcripts.forVersion": REVIEW,
    "uploads.startUpload": REVIEW,
    "uploads.uploadFinished": REVIEW,
    "uploads.uploadFailed": REVIEW,
    "users.setName": ACCOUNT,
    "vendors.invoices": PRODUCTION,
    "vendors.list": PRODUCTION,
    "vendors.get": PRODUCTION,
    "vendors.add": PRODUCTION,
    "vendors.update": PRODUCTION,
    "vendors.archive": PRODUCTION,
    "vendors.invite": PRODUCTION,
    "views.beat": REVIEW,
    "views.forVideo": REVIEW,
    "waveforms.forVersion": REVIEW,
  },
  editor: {
    "business.brand": BRAND,
    "library.projectNames": REVIEW,
    "library.overview": REVIEW,
    "notes.voiceUploadUrl": REVIEW,
    "notes.discardVoice": REVIEW,
    "security.state": ACCOUNT,
    "security.changePassword": ACCOUNT,
    "security.startEmailChange": ACCOUNT,
    "security.confirmEmailChange": ACCOUNT,
    "security.cancelEmailChange": ACCOUNT,
    "security.seenDevice": ACCOUNT,
    "security.signOutDevice": ACCOUNT,
    "users.setName": ACCOUNT,
  },
  bookkeeper: {
    "business.brand": BRAND,
    "footage.settings": PAYMENTS,
    "footage.saveSettings": PAYMENTS,
    "footage.forProject": PAYMENTS,
    "footage.recordDrive": PAYMENTS,
    "footage.stop": PAYMENTS,
    "footage.markDone": PAYMENTS,
    "footage.reinstate": PAYMENTS,
    "footage.dismissLatePaid": PAYMENTS,
    "invoicePay.ownerLink": PAYMENTS,
    "invoiceReminders.setReminders": PAYMENTS,
    "invoiceReminders.sendReminder": PAYMENTS,
    "invoices.list": PAYMENTS,
    "invoices.overview": PAYMENTS,
    "invoices.forProject": PAYMENTS,
    "invoices.get": PAYMENTS,
    "invoices.options": PAYMENTS,
    "invoices.saveDraft": PAYMENTS,
    "invoices.deleteDraft": PAYMENTS,
    "invoices.send": PAYMENTS,
    "invoices.finalOptions": PAYMENTS,
    "invoices.draftFinal": PAYMENTS,
    "invoices.voidInvoice": PAYMENTS,
    "payments.settings": PAYMENTS,
    "plans.list": PAYMENTS,
    "plans.get": PAYMENTS,
    "plans.save": PAYMENTS,
    "plans.setArchived": PAYMENTS,
    "quotes.list": PAYMENTS,
    "quotes.get": PAYMENTS,
    "quotes.options": PAYMENTS,
    "quotes.save": PAYMENTS,
    "quotes.deleteDraft": PAYMENTS,
    "quotes.send": PAYMENTS,
    "quotes.stopLink": PAYMENTS,
    "quotes.newLink": PAYMENTS,
    "quotes.voidQuote": PAYMENTS,
    "quotes.answerMove": PAYMENTS,
    "quotes.later": PAYMENTS,
    "quotes.draftFrom": PAYMENTS,
    "security.state": ACCOUNT,
    "security.changePassword": ACCOUNT,
    "security.startEmailChange": ACCOUNT,
    "security.confirmEmailChange": ACCOUNT,
    "security.cancelEmailChange": ACCOUNT,
    "security.seenDevice": ACCOUNT,
    "security.signOutDevice": ACCOUNT,
    "subscriptions.start": PAYMENTS,
    "subscriptions.list": PAYMENTS,
    "subscriptions.get": PAYMENTS,
    "subscriptions.changePreview": PAYMENTS,
    "subscriptions.changePlan": PAYMENTS,
    "subscriptions.pause": PAYMENTS,
    "subscriptions.resume": PAYMENTS,
    "subscriptions.cancel": PAYMENTS,
    "subscriptions.setFailRule": PAYMENTS,
    "subscriptions.setClientFailRule": PAYMENTS,
    "subscriptions.failRules": PAYMENTS,
    "users.setName": ACCOUNT,
    "vendorPayments.list": VENDORPAY,
    "vendorPayments.totals1099": VENDORPAY,
    "vendorPayments.get": VENDORPAY,
    "vendorPayments.approve": VENDORPAY,
    "vendorPayments.decline": VENDORPAY,
    "vendorPayments.markPaid": VENDORPAY,
    "vendorPayouts.status": VENDORPAY,
    "vendorPayouts.balance": VENDORPAY,
    "vendorPayouts.forInvoice": VENDORPAY,
    "vendorPayouts.pay": VENDORPAY,
    "vendorPayouts.checkNow": VENDORPAY,
    "vendorPayouts.nothingWentOut": VENDORPAY,
    "vendorPayouts.askSetup": VENDORPAY,
  },
};
// Phase 5e step 4: every team role has its own bell.
for (const r of ["producer", "editor", "bookkeeper"] as const) for (const f of BELL_FNS) TEAM[r][f] = BELL;
// Phase 5e step 5: Reports, for the Bookkeeper (the Reports switch).
for (const f of REPORT_FNS) TEAM.bookkeeper[f] = REPORTS;

import { argsFor, call, publicFunctions, setup } from "./matrix";
const denied = (e: unknown) => /Sign in first|Not allowed/.test(String((e as Error).message ?? e));

describe("access matrix", () => {
  test("every public function is classified", async () => {
    const { ids } = await setup();
    const table = argsFor(ids);
    const missing = publicFunctions().map((f) => f.key).filter((k) => !(k in table));
    expect(missing).toEqual([]);
  });

  for (const who of ["nobody", "stranger", "client", "vendor", "guest", "guestInvited", "producer", "editor", "bookkeeper"] as const) {
    test(`${who}: every function refuses, except the ones meant to answer`, async () => {
      const { t, ids } = await setup();
      vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 })); // nothing external may be reached
      const subs: Record<string, string> = { stranger: ids.strangerSub, vendor: ids.vendorSub, guest: ids.guestSub, guestInvited: ids.guestInvitedSub, client: ids.clientSub, producer: ids.producerSub, editor: ids.editorSub, bookkeeper: ids.bookkeeperSub };
      const as = who === "nobody" ? t : t.withIdentity({ subject: subs[who] });
      const table = argsFor(ids);
      const results: Record<string, string> = {};
      for (const f of publicFunctions()) {
        const allowed = f.key in OPEN || (who === "client" && SIGNED_IN.has(f.key)) || (who === "vendor" && VENDOR.has(f.key)) || ((who === "guest" || who === "guestInvited") && f.key in GUEST)
          || ((who === "producer" || who === "editor" || who === "bookkeeper") && f.key in TEAM[who]);
        if (KEYED.has(f.key)) { await expect(call(as, f.ref, table[f.key], "")).rejects.toThrow(/Not allowed/); results[f.key] = "denied (own key)"; continue; }
        try {
          await call(as, f.ref, table[f.key], "");
          results[f.key] = allowed ? "answered (expected)" : "ANSWERED";
        } catch (e) {
          if (denied(e)) results[f.key] = allowed ? `DENIED: ${(e as Error).message}` : "denied";
          else results[f.key] = allowed ? "answered (expected, other error)" : `OTHER: ${String((e as Error).message).slice(0, 80)}`;
        }
      }
      const bad = Object.entries(results).filter(([, r]) => /^(ANSWERED|DENIED|OTHER)/.test(r));
      expect(bad).toEqual([]);
      // r1results.report with a wrong key is refused by its own check, with a different message.
      expect(results["users.me"]).toMatch(/answered/);
    });
  }

  test("the owner is not refused", async () => {
    const { t, ids } = await setup();
    const me = t.withIdentity({ subject: ids.ownerSub });
    expect(await me.query(api.library.overview, {})).toBeTruthy();
    expect((await me.query(api.users.me, {}))?.role).toBe("owner");
    expect(await me.query(api.clients.listInvites, {})).toHaveLength(2); // the client's, and the invited guest's (step 4 review)
  });

  test("a client sees their own identity and account, and nothing else", async () => {
    const { t, ids } = await setup();
    const c = t.withIdentity({ subject: ids.clientSub });
    expect((await c.query(api.users.me, {}))).toMatchObject({ role: "client", allowed: false });
    expect(await c.query(api.clients.account, {})).toMatchObject({ kind: "client", email: "client@example.com" });
    await c.mutation(api.users.setName, { name: "Casey" });
    expect((await c.query(api.clients.account, {})).name).toBe("Casey");
    await expect(c.query(api.library.overview, {})).rejects.toThrow(/Not allowed/);
    // The video page asks for the owner's display settings whoever is looking: a client (or a guest) gets {} back.
    expect(await c.query(api.prefs.mine, {})).toEqual({});
    expect(await t.query(api.prefs.mine, {})).toEqual({});
    await expect(c.mutation(api.prefs.set, { key: "details", value: [] })).rejects.toThrow(/Not allowed/);
  });
});

describe("who may make an account", () => {
  const signUp = (t: ReturnType<typeof convexTest>, email: string) =>
    t.action(api.auth.signIn, { provider: "password", params: { flow: "signUp", email, password: "longenoughpassword" } });

  test("an owner email and an invited email can; anyone else is refused; a code email goes out through Resend", async () => {
    const { t, ids } = await setup();
    const sent: string[] = [];
    const mails: Array<{ to: string; subject: string; text: string; from: string; html: string }> = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://api.resend.com/emails") { const b = JSON.parse(String(init?.body)); sent.push(b.to[0]); mails.push({ to: b.to[0], subject: b.subject, text: b.text, from: b.from, html: b.html }); return new Response(JSON.stringify({ id: "em_1" }), { status: 200 }); }
      return new Response("{}", { status: 500 });
    });
    const lastCode = () => /\b(\d{6})\b/.exec(mails[mails.length - 1].text)![1];
    await expect(signUp(t, "intruder@example.com")).rejects.toThrow(/hasn't been invited/);
    await t.withIdentity({ subject: ids.ownerSub }).mutation(api.clients.invite, { email: "New.Client@Example.com", name: "New Client" });
    const r = await signUp(t, "new.client@example.com") as { tokens?: unknown; started?: boolean };
    expect(r.tokens ?? null).toBeNull(); // no session yet: a code is needed first
    expect(sent).toEqual(["new.client@example.com"]);
    const user = await t.run(async (ctx) => (await ctx.db.query("users").withIndex("email", (q) => q.eq("email", "new.client@example.com")).unique()));
    expect(user).toMatchObject({ role: "client", name: "New Client" });
    const inv = await t.run(async (ctx) => (await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", "new.client@example.com")).unique()));
    expect(inv?.acceptedAt).toBeTypeOf("number");
    expect(mails[0]).toMatchObject({ from: "Wrangler Productions <review@wranglerportal.com>" });
    expect(mails[0].html).toContain('<meta name="color-scheme" content="dark">');
    expect(mails[0].subject).toMatch(/^\d{6} is your WranglerPortal code$/);
    // A wrong code is refused; the emailed one signs them in.
    await expect(t.action(api.auth.signIn, { provider: "password", params: { flow: "email-verification", email: "new.client@example.com", code: "000000" } })).rejects.toThrow();
    const done = await t.action(api.auth.signIn, { provider: "password", params: { flow: "email-verification", email: "new.client@example.com", code: lastCode() } }) as { tokens?: unknown };
    expect(done.tokens).toBeTruthy();
    // Password reset: a code by email, then a new password that signs in; the old one no longer does.
    await t.action(api.auth.signIn, { provider: "password", params: { flow: "reset", email: "new.client@example.com" } });
    expect(mails[mails.length - 1].subject).toBe("Reset your WranglerPortal password");
    const reset = await t.action(api.auth.signIn, { provider: "password", params: { flow: "reset-verification", email: "new.client@example.com", code: lastCode(), newPassword: "anotherlongpassword" } }) as { tokens?: unknown };
    expect(reset.tokens).toBeTruthy();
    await expect(t.action(api.auth.signIn, { provider: "password", params: { flow: "signIn", email: "new.client@example.com", password: "longenoughpassword" } })).rejects.toThrow();
    const back = await t.action(api.auth.signIn, { provider: "password", params: { flow: "signIn", email: "new.client@example.com", password: "anotherlongpassword" } }) as { tokens?: unknown };
    expect(back.tokens).toBeTruthy();
    // A revoked invite can't be used.
    await t.withIdentity({ subject: ids.ownerSub }).mutation(api.clients.revokeInvite, { inviteId: ids.inviteId });
    await t.run(async (ctx) => { for (const u of await ctx.db.query("users").collect()) if (u.email === "client@example.com") await ctx.db.delete(u._id); });
    await expect(signUp(t, "client@example.com")).rejects.toThrow(/hasn't been invited/);
    // An owner's email is fine, and the owner can't be "invited".
    const o = await signUp(t, "heston@wranglerproductions.com").catch((e: Error) => e);
    expect(o instanceof Error ? o.message : "ok").not.toMatch(/hasn't been invited/);
    await expect(t.withIdentity({ subject: ids.ownerSub }).mutation(api.clients.invite, { email: "heston@wranglerproductions.com" })).rejects.toThrow(/owner/);
  }, 30_000);
});
