// The shared fixtures of the access matrix (moved here from access.test.ts in Phase 0.5d step 3, so the
// two-business isolation test can run the very same function list and arguments).
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const modules = import.meta.glob("../convex/**/*.ts");

export type Ids = { requestId: Id<"wsRequests">; buildId: Id<"wsBuilds">; templateId: Id<"wsTemplates">; clauseId: Id<"wsClauses">; styleId: Id<"wsStyles">; docId: Id<"wsDocuments">; wsVersionId: Id<"wsVersions">; projectId: Id<"projects">; videoId: Id<"videos">; shareId: Id<"shares">; replyId: Id<"replies">; versionId: Id<"versions">; noteId: Id<"notes">; fileId: Id<"dropFiles">; inviteId: Id<"invites">; keyId: Id<"connectorKeys">; storageId: Id<"_storage">; clientRecId: Id<"clients">; personId: Id<"clientPeople">; inboxItemId: Id<"inboxItems">; inboxNoteId: Id<"inboxNotes">; deliveryFileId: Id<"deliveryFiles">; invoiceId: Id<"invoices">; planId: Id<"plans">; subscriptionId: Id<"subscriptions">; dealId: Id<"deals">; followUpId: Id<"followUps">; estimateId: Id<"estimates">; entryId: Id<"ledgerEntries">; quoteId: Id<"quotes">; proposalId: Id<"proposals">; offerPersonId: Id<"offerRecipients">; vendorId: Id<"vendors">; bookingId: Id<"vendorBookings">; briefingId: Id<"briefings">; businessId: Id<"businesses">; vendorInvoiceId: Id<"vendorInvoices">; shootId: Id<"shoots">; fileRequestId: Id<"fileRequests">; fileUploadId: Id<"fileUploads">; briefId: Id<"briefs">; testimonialId: Id<"testimonials">; callSheetId: Id<"callSheets">; calendarEventId: Id<"calendarEvents">; gearId: Id<"gear">; callId: Id<"calls">; callToken: string; threadId: Id<"msgThreads">; guestToken: string; guestInvitedSub: string; teamInviteId: Id<"teamInvites">; teamMemberId: Id<"memberships">; bellItemId: Id<"bellItems">; dataExportId: Id<"dataExports">; deletionId: Id<"businessDeletions">; producerSub: string; editorSub: string; bookkeeperSub: string };

// Minimal valid arguments for each function, so the access check (not argument validation) is what refuses.
export function argsFor(ids: Ids): Record<string, Record<string, unknown>> {
  return {
    "activity.feed": {},
    "clients.invite": { email: "x@example.com" }, "clients.canSignUp": { email: "x@example.com" }, "clients.revokeInvite": { inviteId: ids.inviteId }, "clients.listInvites": {}, "clients.account": {},
    "connector.createKey": {}, "connector.listKeys": {}, "connector.revokeKey": { keyId: ids.keyId },
    "dropbox.status": {}, "dropbox.flagged": {}, "dropbox.retryFlagged": { fileId: ids.fileId }, "dropbox.registerFlagged": { fileId: ids.fileId }, "dropbox.authUrl": {}, "dropbox.disconnect": {}, "dropbox.syncNow": {},
    "library.projectNames": {}, "library.overview": {}, "library.createClient": { name: "X" }, "library.markOpened": { videoId: ids.videoId },
    "library.renameProject": { projectId: ids.projectId, name: "X" }, "library.setVersionDescription": { versionId: ids.versionId, description: "x" },
    "library.createProject": { name: "X" }, "library.createVideo": { projectId: ids.projectId, title: "X" }, "library.renameVideo": { videoId: ids.videoId, title: "X" },
    "library.video": { videoId: ids.videoId }, "library.downloadCheck": { versionId: ids.versionId }, "library.downloadLink": { versionId: ids.versionId }, "library.setStartTimecode": { versionId: ids.versionId, startTimecode: "01:00:00:00" },
    "library.reportFrameCount": { versionId: ids.versionId, frameCount: 10 }, "library.retryCopy": { versionId: ids.versionId }, "library.deleteVersion": { versionId: ids.versionId }, "library.deleteProject": { projectId: ids.projectId }, "library.setPoster": { versionId: ids.versionId, url: "https://wrangler-review-stills.b-cdn.net/stills/2026/10/a.jpg" }, "views.forVideo": { videoId: ids.videoId }, "views.beat": { versionId: ids.versionId, session: "abcdefgh12345678", watchedSec: 1, posSec: 1, lengthSec: 10 }, "library.deleteVideo": { videoId: ids.videoId }, "library.deleteVideos": { videoIds: [ids.videoId] },
    "library.deleteClient": { client: "X", typed: "X" }, "library.approveFinal": { videoId: ids.videoId, keep: 1 }, "library.clearFinal": { videoId: ids.videoId },
    "notes.forVersion": { versionId: ids.versionId }, "notes.create": { versionId: ids.versionId, kind: "general", text: "x" }, "notes.editText": { noteId: ids.noteId, text: "y" },
    "notes.setStatus": { noteId: ids.noteId, status: "done" }, "notes.setVisibility": { noteId: ids.noteId, visibility: "shared" }, "notes.setReplyHidden": { replyId: ids.replyId, hidden: false }, "notes.remove": { noteId: ids.noteId }, "notes.reply": { noteId: ids.noteId, text: "r" },
    "notes.voiceUploadUrl": {}, "notes.discardVoice": { storageId: ids.storageId },
    "phase0.saveRun": { label: "l", device: "d", browser: "b", source: "s", engine: "e", pass: true, userAgent: "ua", results: {}, misses: [] }, "phase0.listRuns": {},
    "player.log": { versionId: ids.versionId, kind: "error" }, "player.fileFailed": { versionId: ids.versionId },
    "prefs.mine": {}, "prefs.set": { key: "details", value: [] },
    "r1results.report": { k: "wrong", device: "d", rows: "r" },
    "shares.create": { target: { kind: "video", videoId: ids.videoId }, access: "view", who: "link", allVersions: true, downloads: false, emailNewVersions: false },
    "shares.update": { shareId: ids.shareId, access: "comment" }, "shares.setOff": { shareId: ids.shareId, off: true }, "shares.remove": { shareId: ids.shareId },
    "shares.addMember": { shareId: ids.shareId, email: "x@example.com" }, "shares.removeMember": { shareId: ids.shareId, email: "x@example.com" }, "shares.resendInvite": { shareId: ids.shareId, email: "x@example.com" },
    "shares.list": {}, "shares.forTarget": { target: { kind: "video", videoId: ids.videoId } }, "shares.coveringVideo": { videoId: ids.videoId }, "shares.activity": { shareId: ids.shareId },
    "shares.open": { token: "nope" }, "shares.touch": { token: "nope", kind: "opened" }, "shares.unlock": { token: "nope", passcode: "x" }, "shares.mine": {},
    "register.list": {}, "register.nextName": { videoId: ids.videoId }, "register.newVideo": { title: "X", shortTitle: "X", projectName: "P" }, "register.setShortTitle": { videoId: ids.videoId, shortTitle: "X" },
    "register.addToRegister": { videoId: ids.videoId, shortTitle: "X" }, "register.makeSheetKey": {}, "register.sheetKey": {}, "register.removeSheetKey": {},
    "stills.upload": { dataBase64: "AA==", contentType: "image/jpeg" },
    "transcribe.voiceWords": { storageId: ids.storageId, mime: "audio/webm" },
    "transcripts.retry": { versionId: ids.versionId }, "transcripts.forVersion": { versionId: ids.versionId },
    "uploads.startUpload": { videoId: ids.videoId, fileName: "a.mp4", fileSize: 1 }, "uploads.uploadFinished": { versionId: ids.versionId }, "uploads.uploadFailed": { versionId: ids.versionId, error: "x" },
    "users.me": {}, "users.setName": { name: "N" },
    "waveforms.forVersion": { versionId: ids.versionId },
    "sign.list": {}, "sign.get": { documentId: ids.docId }, "sign.ownerSignature": {}, "sign.uploadUrl": {},
    "sign.create": { storageId: ids.storageId, fileName: "a.pdf" }, "sign.replaceFile": { documentId: ids.docId, storageId: ids.storageId, fileName: "a.pdf" },
    "sign.saveLayout": { versionId: ids.wsVersionId, title: "T", signers: [], boxes: [], signingOrder: "any", payment: null },
    "sign.approve": { versionId: ids.wsVersionId }, "sign.revise": { documentId: ids.docId }, "sign.remove": { documentId: ids.docId },
    "sign.adoptSignature": { name: "N", title: "T", method: "typed", signatureStorageId: ids.storageId, initialsStorageId: ids.storageId },
    "sign.preview": { versionId: ids.wsVersionId },
    "sign.send": { versionId: ids.wsVersionId }, "sign.voidDocument": { documentId: ids.docId }, "sign.resend": { documentId: ids.docId, signerKey: "client" },
    "sign.extendExpiry": { documentId: ids.docId, days: 7 },
    "sign.requestsFor": { documentId: ids.docId }, "sign.setHidden": { documentId: ids.docId, hidden: true }, "sign.pendingRequests": {}, "sign.decideRequest": { requestId: ids.requestId, confirm: false },
    "signDone.retry": { documentId: ids.docId, step: "copies" }, "signDone.downloadAudit": { documentId: ids.docId },
    "wsArchive.status": {}, "wsArchive.authUrl": {}, "wsArchive.disconnect": {},
    "builder.getProfile": {}, "builder.saveProfile": { business: { name: "", legalName: "", contact: "", title: "", email: "", phone: "", address: "" } },
    "builder.listBuilds": {}, "builder.getBuild": { buildId: ids.buildId }, "builder.createBuild": {}, "builder.saveBuild": { buildId: ids.buildId, title: "T", blocks: [], fields: {}, signers: [], style: {} },
    "builder.deleteBuild": { buildId: ids.buildId }, "builder.toSigning": { buildId: ids.buildId, storageId: ids.storageId },
    "builder.listTemplates": {}, "builder.getTemplate": { templateId: ids.templateId }, "builder.saveAsTemplate": { name: "N", title: "T", blocks: [], fields: {}, signers: [], style: {} },
    "builder.updateTemplate": { templateId: ids.templateId, name: "N", blocks: [], fields: {}, style: {} }, "builder.duplicateTemplate": { templateId: ids.templateId }, "builder.deleteTemplate": { templateId: ids.templateId }, "builder.ensureStarter": {},
    "builder.listClauses": {}, "builder.saveClause": { title: "C", body: {}, initials: false }, "builder.duplicateClause": { clauseId: ids.clauseId }, "builder.deleteClause": { clauseId: ids.clauseId },
    "builder.listStyles": {}, "builder.saveStyle": { name: "S", style: {} }, "builder.setDefaultStyle": { styleId: ids.styleId }, "builder.deleteStyle": { styleId: ids.styleId },
    "builder.uploadUrl": {}, "builder.fileUrls": { ids: [ids.storageId] }, "builder.checkImage": { storageId: ids.storageId },
    "builder.listFonts": {}, "builder.addFont": { storageId: ids.storageId, family: "F", weight: 400, italic: false, fileName: "f.ttf", source: "upload" }, "builder.deleteFont": { family: "F" }, "builder.ensureGoogleFont": { family: "Lora" }, "builder.importPdf": { storageId: ids.storageId },
    "wsConnector.createKey": {}, "wsConnector.listKeys": {}, "wsConnector.revokeKey": { keyId: ids.wsKeyId },
    // Phase 1 (Oct 29)
    "inbox.mine": {}, "inbox.unreadCount": {}, "inbox.markRead": { itemId: ids.inboxItemId }, "inbox.markAllRead": {},
    "inbox.forClient": { clientId: ids.clientRecId }, "inbox.noteRecipients": { clientId: ids.clientRecId }, "inbox.notes": {},
    "inbox.saveNote": { clientId: ids.clientRecId, title: "T", text: "x" }, "inbox.sendNote": { noteId: ids.inboxNoteId }, "inbox.noteDetail": { noteId: ids.inboxNoteId }, "inbox.sent": {}, "inbox.discardNote": { noteId: ids.inboxNoteId },
    "clients.people": { clientId: ids.clientRecId }, "clients.addPerson": { clientId: ids.clientRecId, email: "p@example.com", role: "contact" },
    "clients.updatePerson": { personId: ids.personId, role: "signer" }, "clients.removePerson": { personId: ids.personId }, "clients.invitePerson": { personId: ids.personId },
    "clients.page": { clientId: ids.clientRecId }, "clients.directory": {},
    "documents.mine": {}, "portal.waiting": {}, "emails.myPrefs": {}, "emails.setMine": { on: true }, "notifications.owner": {}, "notifications.setOwner": { key: "client_paid", on: true },
    "notifications.client": {}, "notifications.setClient": { key: "versions", on: true }, "vendorPortal.notifications": {}, "vendorPortal.setNotification": { businessId: ids.businessId, key: "bookings", on: true }, "documents.signedCopy": { documentId: ids.docId },
    "business.settings": {}, "business.updateSettings": { accent: "#112233" }, "business.logoUploadUrl": {}, "business.setLogo": { storageId: null }, "business.brand": {},
    "activity.recent": {}, "home.needs": {},
    "approvals.approve": { versionId: ids.versionId }, "approvals.forVideo": { videoId: ids.videoId },
    // Phase 2 Part A (Oct 29)
    "clients.setSettings": { clientId: ids.clientRecId, rounds: 3 },
    "projects.page": { projectId: ids.projectId }, "projects.setStage": { projectId: ids.projectId, stage: "polish", post: false }, "projects.setNextStep": { projectId: ids.projectId, text: "x" },
    "projects.setKeyDates": { projectId: ids.projectId, dates: [] }, "projects.setRounds": { projectId: ids.projectId, rounds: 2 }, "projects.nextRound": { videoId: ids.videoId },
    "projects.addDeliveryFile": { projectId: ids.projectId, file: { kind: "version", versionId: ids.versionId } }, "projects.removeDeliveryFile": { fileId: ids.deliveryFileId },
    "projects.setDelivery": { projectId: ids.projectId, unlocked: false }, "projects.dropboxFiles": { projectId: ids.projectId },
    "projects.mine": {}, "projects.forClient": { projectId: ids.projectId }, "projects.deliveryLink": { fileId: ids.deliveryFileId },
    "payments.settings": {}, "payments.connect": {}, "payments.refresh": {}, "payments.disconnect": {},
    "invoices.list": {}, "invoices.overview": {}, "invoices.finalOptions": { projectId: ids.projectId }, "invoices.draftFinal": { projectId: ids.projectId, documentId: ids.docId }, "invoices.forProject": { projectId: ids.projectId }, "invoices.get": { invoiceId: ids.invoiceId }, "invoices.options": {},
    "invoices.saveDraft": { kind: "other", title: "T", billTo: { name: "A", email: "a@b.co" }, lines: [], dueDate: "2030-01-01" }, "invoices.deleteDraft": { invoiceId: ids.invoiceId },
    "subscriptions.start": { clientId: ids.clientRecId, planId: ids.planId, billTo: { name: "A", email: "a@b.co" }, startDate: "2030-01-01", firstInvoice: "now", postInbox: false },
    "subscriptions.list": {}, "subscriptions.get": { subscriptionId: "nope" }, "subscriptions.page": { token: "nope-nope-nope-nope" }, "subscriptions.mine": {},
    "subscriptions.setupStart": { token: "nope-nope-nope-nope" }, "subscriptions.setupDone": { token: "nope-nope-nope-nope", setupIntentId: "seti_x" },
    "subscriptions.changePreview": { subscriptionId: ids.subscriptionId, planId: ids.planId }, "subscriptions.changePlan": { subscriptionId: ids.subscriptionId, planId: ids.planId },
    "subscriptions.pause": { subscriptionId: ids.subscriptionId }, "subscriptions.resume": { subscriptionId: ids.subscriptionId }, "subscriptions.cancel": { subscriptionId: ids.subscriptionId, when: "now" },
    "subscriptions.setFailRule": { rule: "cancel" }, "subscriptions.setClientFailRule": { clientId: ids.clientRecId, rule: "cancel" }, "subscriptions.failRules": {},
    "quotes.list": {}, "quotes.get": { quoteId: "nope" }, "quotes.options": {}, "quotes.save": { who: { name: "M", email: "m@x.example" }, title: "T", lines: [], deposit: { kind: "percent", value: 25 } },
    "quotes.deleteDraft": { quoteId: ids.quoteId }, "quotes.send": { quoteId: ids.quoteId }, "quotes.voidQuote": { quoteId: ids.quoteId }, "quotes.answerMove": { quoteId: ids.quoteId, yes: false },
    "quotes.later": { quoteId: ids.quoteId, what: "seen" }, "quotes.draftFrom": { quoteId: ids.quoteId, contract: true },
    "quotes.page": { token: "x".repeat(24) }, "quotes.markViewed": { token: "x".repeat(24) },
    "quotes.stopLink": { quoteId: ids.quoteId, personId: ids.offerPersonId }, "quotes.newLink": { quoteId: ids.quoteId }, // D149
    "proposals.stopLink": { proposalId: ids.proposalId, personId: ids.offerPersonId }, "proposals.newLink": { proposalId: ids.proposalId },
    "proposals.list": {}, "proposals.get": { proposalId: "nope" }, "proposals.create": {}, "proposals.copy": { proposalId: ids.proposalId }, "proposals.deleteDraft": { proposalId: ids.proposalId },
    "proposals.templates": {}, "proposals.newTemplate": {}, "proposals.send": { proposalId: ids.proposalId }, "proposals.withdraw": { proposalId: ids.proposalId },
    "proposals.later": { proposalId: ids.proposalId, what: "seen" }, "proposals.startContract": { proposalId: ids.proposalId },
    "proposals.page": { token: "x".repeat(24) }, "proposals.markViewed": { token: "x".repeat(24) },
    "proposals.questionnaire": {}, "proposals.saveQuestionnaire": { questionnaire: {} }, "proposals.resetQuestionnaire": {}, "proposals.startQuestionnaire": {},
    "proposals.saveAnswers": { proposalId: ids.proposalId, answers: {} }, "proposals.answerUploadUrl": {}, "proposals.addAnswerFile": { proposalId: ids.proposalId, storageId: ids.storageId, name: "f" },
    "proposals.fileUrls": { proposalId: ids.proposalId }, "proposals.finish": { proposalId: ids.proposalId, how: "self" }, "proposals.fillInstead": { proposalId: ids.proposalId },
    "proposals.dismissDrafted": { proposalId: ids.proposalId }, "proposals.forCompany": { clientId: ids.clientRecId },
    "vendors.list": {}, "vendors.get": { vendorId: "nope" }, "vendors.add": { name: "V", email: "v@x.example", roles: [], rates: [], invite: false },
    "vendors.update": { vendorId: ids.vendorId, name: "V", email: "v@x.example", roles: [], rates: [] }, "vendors.archive": { vendorId: ids.vendorId, archived: true },
    "bookings.form": {}, "bookings.list": {}, "bookings.forProject": { projectId: "nope" }, "bookings.forVendor": { vendorId: "nope" }, "bookings.get": { bookingId: "nope" },
    "bookings.create": { vendorId: ids.vendorId, projectId: ids.projectId, role: "Shooter", start: "2030-01-01", end: "2030-01-02", cents: 100000, unit: "day" }, "bookings.cancel": { bookingId: ids.bookingId },
    "briefings.templates": {}, "briefings.list": {}, "briefings.forVendor": { vendorId: "nope" }, "briefings.get": { briefingId: "nope" }, "briefings.create": { bookingId: ids.bookingId },
    "briefings.deleteDraft": { briefingId: ids.briefingId }, "briefings.copy": { briefingId: ids.briefingId },
    // D147 (Nov 4): briefings sent freely: Send to, Share (email 58 and Copy link), the link switch, and the no-login page
    "briefings.setDetails": { briefingId: ids.briefingId, projectId: null, sendTo: [{ email: "pat@example.com" }] }, "briefings.setLinkOff": { briefingId: ids.briefingId, off: true },
    "briefings.share": { briefingId: ids.briefingId, to: [{ email: "pat@example.com" }], copyLink: true },
    "briefings.page": { token: "nope-nope-nope-nope" }, "briefings.opened": { token: "nope-nope-nope-nope" }, "briefings.markRead": { token: "nope-nope-nope-nope" }, "signCopies.page": { token: "nope-nope-nope-nope" }, "signCopies.opened": { token: "nope-nope-nope-nope" },
    "vendors.invite": { vendorId: ids.vendorId },
    "vendorPortal.businesses": {}, "vendorPortal.counts": { businessId: ids.businessId }, "vendorPortal.home": {}, "vendorPortal.bookings": {}, "vendorPortal.booking": { bookingId: "nope" },
    "vendorPortal.accept": { bookingId: ids.bookingId }, "vendorPortal.decline": { bookingId: ids.bookingId, reason: "Too far" }, "vendorPortal.briefings": {},
    "vendorPortal.briefing": { briefingId: "nope" }, "vendorPortal.markRead": { briefingId: ids.briefingId },
    "vendorPortal.reviews": {}, "vendorPortal.invoices": {}, "vendorPortal.invoiceForm": {}, "vendorPortal.invoice": { invoiceId: "nope" },
    "vendorPortal.saveInvoice": { bookingId: ids.bookingId, mode: "hours", hours: [], lines: [], send: false }, "vendorPortal.deleteInvoice": { invoiceId: ids.vendorInvoiceId },
    "vendorPortal.settings": {}, "vendorPortal.saveDetails": { businessId: ids.businessId, name: "V" }, "vendorPortal.w9UploadUrl": { businessId: ids.businessId },
    "vendorPortal.setW9": { businessId: ids.businessId, storageId: ids.storageId, name: "w9.pdf" }, "vendors.invoices": { vendorId: "nope" },
    "vendorPayments.list": {}, "vendorPayments.totals1099": {}, "vendorPayments.get": { invoiceId: "nope" }, "vendorPayments.approve": { invoiceId: ids.vendorInvoiceId },
    "vendorPayments.decline": { invoiceId: ids.vendorInvoiceId, reason: "No" }, "vendorPayments.markPaid": { invoiceId: ids.vendorInvoiceId, paidOn: "2026-01-02", method: "ACH" },
    "calendar.settings": {}, "calendar.authUrl": {}, "calendar.calendars": {}, "calendar.save": { calendarId: "x", calendarName: "x", inviteVendors: false, inviteClient: false }, "calendar.disconnect": {}, "calendar.finish": { code: "c", state: "s" },
    "fileRequests.forProject": { projectId: "nope" }, "fileRequests.create": { projectId: ids.projectId, title: "X", due: "2030-01-02", remind: false }, "fileRequests.setStatus": { requestId: ids.fileRequestId, status: "closed" },
    "users.switchSide": { side: "vendor" }, "users.setTools": { tools: {} }, "briefs.settings": {}, "briefs.saveSettings": { questionnaire: { steps: [] } }, "briefs.resetSettings": {}, "briefs.forProject": { projectId: "nope" }, "briefs.send": { projectId: ids.projectId },
    "briefs.remind": { briefId: ids.briefId }, "briefs.forEstimate": { briefId: "nope" }, "briefs.forClientProject": { projectId: "nope" }, "briefs.page": { briefId: "nope" },
    "briefs.save": { briefId: ids.briefId, changes: {}, step: 0 }, "briefs.submit": { briefId: ids.briefId, changes: {} },
    "fileRequests.forClientProject": { projectId: "nope" }, "fileRequests.page": { requestId: "nope" }, "fileRequests.start": { requestId: ids.fileRequestId, name: "x.pdf", size: 10 }, "fileRequests.finishDirect": { uploadId: ids.fileUploadId },
    "calls.page": { slug: "matrix" }, "calls.refresh": { slug: "matrix" }, "calls.book": { slug: "matrix", start: 0, name: "N", email: "n@x.example", tz: "America/Chicago" },
    // The private link is the lead's own key (like a quote link): the matrix uses a made-up one; calls.test.ts uses real ones.
    "calls.manage": { token: ids.callToken }, "calls.cancel": { token: "x".repeat(24) }, "calls.reschedule": { token: "x".repeat(24), start: 0 }, // manage is read-only, so it gets the real link (review L7)
    "calls.settings": {}, "calls.saveSettings": { lengthMin: 30, bufferMin: 10, aheadDays: 30, noticeHours: 4, hours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ on: d < 5, start: "09:00", end: "17:00" })) },
    "calls.forDeal": { dealId: "nope" }, "calls.done": { callId: ids.callId },
    "calls.verify": { token: "x".repeat(24), code: "123456" }, "calls.resendCode": { token: "x".repeat(24) }, "calls.release": { token: "x".repeat(24) }, "calls.setPaused": { paused: false },
    "messages.threads": {}, "messages.thread": { threadId: ids.threadId }, "messages.send": { threadId: ids.threadId, text: "x" }, "messages.unread": {},
    "messages.mine": {}, "messages.clientThreadPage": { threadId: ids.threadId }, "messages.clientSend": { threadId: ids.threadId, text: "x" },
    "messages.leadPage": { token: "x".repeat(24) }, "messages.leadSend": { token: "x".repeat(24), text: "x" }, "messages.leadRead": { token: "x".repeat(24) }, "messages.leadUploadUrl": { token: "x".repeat(24) },
    "messages.uploadUrl": {}, "messages.read": { threadId: ids.threadId }, "messages.startOptions": {}, "messages.start": { projectId: ids.projectId }, "messages.setLeadLink": { threadId: ids.threadId, off: true },
    "help.list": {}, "help.guide": { slug: "signing-in" }, "help.edit": { slug: "signing-in" }, "help.reset": { slug: "signing-in" },
    "gear.list": {}, "gear.get": { gearId: "nope" }, "gear.add": { name: "G", kind: "lens" }, "gear.update": { gearId: ids.gearId, name: "G", kind: "lens" }, "gear.setStatus": { gearId: ids.gearId, status: "in_repair" },
    "gear.uploadUrl": {}, "gear.setPhoto": { gearId: ids.gearId, storageId: ids.storageId }, "gear.removePhoto": { gearId: ids.gearId },
    "gear.logMaintenance": { gearId: ids.gearId, date: "2030-02-01", what: "Serviced" }, "gear.exportCsv": {},
    "gear.forShoot": { shootId: "nope" }, "gear.addToShoot": { shootId: ids.shootId, gearId: ids.gearId }, "gear.removeFromShoot": { shootId: ids.shootId, gearId: ids.gearId },
    "shoots.forProject": { projectId: "nope" }, "shoots.schedule": { projectId: ids.projectId, ...{ date: "2030-01-02", call: "07:00", location: "X", prepare: [], withOwner: true, bookingIds: [], calendar: false } }, "shoots.update": { shootId: ids.shootId, ...{ date: "2030-01-02", call: "07:00", location: "X", prepare: [], withOwner: true, bookingIds: [], calendar: false } }, "shoots.cancel": { shootId: ids.shootId },
    "shoots.forClientProject": { projectId: "nope" }, "shoots.page": { shootId: "nope" }, "shoots.confirm": { shootId: ids.shootId },
    "vendorPayouts.status": {}, "vendorPayouts.balance": {}, "vendorPayouts.forInvoice": { invoiceId: "nope" }, "vendorPayouts.pay": { invoiceId: ids.vendorInvoiceId }, "vendorPayouts.checkNow": { invoiceId: ids.vendorInvoiceId },
    "vendorPayouts.askSetup": { vendorId: ids.vendorId }, "vendorPayouts.nothingWentOut": { invoiceId: ids.vendorInvoiceId }, "vendorPayouts.mine": { businessId: ids.businessId }, "vendorPayouts.setupLink": { businessId: ids.businessId }, "vendorPayouts.refreshMine": { businessId: ids.businessId }, "proposals.setDeck": { proposalId: ids.proposalId, kit: "business" },
    "brandKit.get": {}, "brandKit.save": { colors: [], fonts: {}, links: [], tone: [] }, "brandKit.uploadUrl": {}, "brandKit.addFile": { storageId: ids.storageId, name: "x.pdf" }, "brandKit.removeFile": { fileId: ids.storageId },
    "crm.rates": {}, "crm.saveRates": { rates: {} }, "crm.board": {}, "crm.addDeal": { title: "X" }, "crm.moveDeal": { dealId: ids.dealId, stage: "quoted" }, "crm.closeDeal": { dealId: ids.dealId },
    "crm.deal": { dealId: "nope" }, "crm.companies": {}, "crm.company": { clientId: "nope" }, "crm.contact": { personId: "nope" }, "crm.followUps": {},
    "crm.addFollowUp": { who: "A", about: "B", due: "2030-01-01" }, "crm.doneFollowUp": { followUpId: ids.followUpId }, "crm.getEstimate": { estimateId: "nope" },
    "crm.saveEstimate": { title: "E", scope: "S", input: { unit: "days", amount: 1 } }, "crm.makeContract": { estimateId: ids.estimateId }, "crm.ledger": { projectId: "nope" },
    "crm.logEntry": { projectId: ids.projectId, kind: "hours", hours: 1, date: "2030-01-01" }, "crm.entryAction": { entryId: ids.entryId, action: "confirm" },
    "crm.setLedgerExport": { projectId: ids.projectId, on: true }, "crm.setLedgerExportAll": {}, "crm.due": {}, "crm.linkProject": { dealId: ids.dealId, projectId: ids.projectId },
    "plans.list": {}, "plans.get": { planId: ids.planId }, "plans.save": { name: "P", amountCents: 1000, interval: "month", intervalCount: 1 }, "plans.setArchived": { planId: ids.planId, archived: true },
    "invoices.send": { invoiceId: ids.invoiceId }, "invoices.voidInvoice": { invoiceId: ids.invoiceId },
    "invoicePay.page": { token: "nope-nope-nope-nope" }, "invoicePay.mine": {}, "invoicePay.markViewed": { token: "nope-nope-nope-nope" },
    "invoicePay.start": { token: "nope-nope-nope-nope" }, "invoicePay.refresh": { token: "nope-nope-nope-nope" }, "invoicePay.ownerLink": { invoiceId: ids.invoiceId },
    "invoiceReminders.setReminders": { on: true, beforeDays: 3, afterDays: 1, everyDays: 7, stopAfter: 3 }, "invoiceReminders.sendReminder": { invoiceId: ids.invoiceId },
    // Phase 5 (Nov 3): raw footage storage and testimonials
    "footage.settings": {}, "footage.saveSettings": { on: true, priceCents: 10000, keepDays: 30 }, "footage.forProject": { projectId: "nope" },
    "footage.recordDrive": { projectId: ids.projectId }, "footage.stop": { projectId: ids.projectId }, "footage.markDone": { projectId: ids.projectId },
    "footage.reinstate": { projectId: ids.projectId }, "footage.dismissLatePaid": { projectId: ids.projectId },
    "footage.forClientProject": { projectId: "nope" }, "footage.keep": { projectId: ids.projectId }, "footage.decline": { projectId: ids.projectId },
    "testimonials.projectsFor": { clientId: ids.clientRecId }, "testimonials.ask": { noteId: "nope" }, "testimonials.send": { noteId: ids.inboxNoteId, working: "x", film: "", permission: false },
    "production.overview": {}, "production.shoots": {}, "production.projectsForShoot": {},
    "overviews.clients": {}, "overviews.review": {}, "overviews.docs": {}, "overviews.proposals": {}, "overviews.vendors": {}, "home.dashboard": {}, // Phase 5b step 2
    "siteWatch.report": {}, "siteWatch.run": { id: "nope" }, "siteWatch.summary": {}, "siteWatch.markDone": { id: "nope" },
    "siteWatch.finding": { id: "nope" }, "siteWatch.setPaused": { paused: true }, // Phase 5c screens (Nov 4)
    "testimonials.list": {}, "testimonials.markRead": { testimonialId: ids.testimonialId }, "testimonials.saveAgain": { testimonialId: ids.testimonialId },
    // Phase 5b step 3: call sheets (the owner's; the client's reader; the vendor's reader in vendorPortal)
    "callSheets.ensureStarters": {}, "callSheets.list": {}, "callSheets.newOptions": {}, "callSheets.get": { callSheetId: ids.callSheetId },
    "callSheets.create": { shootId: ids.shootId, how: "blank" }, "callSheets.make": { callSheetId: ids.callSheetId }, "callSheets.deleteDraft": { callSheetId: ids.callSheetId },
    "callSheets.saveAnswers": { callSheetId: ids.callSheetId, step: 0, answers: { crewCall: "07:00", talentCall: "", wrap: "", locationName: "X", address: "", parking: "", weather: false, schedule: [], notes: "" } },
    "callSheets.toggle": { callSheetId: ids.callSheetId, id: "client:client@example.com", on: false }, "callSheets.addGuest": { callSheetId: ids.callSheetId, name: "G", email: "g@x.example", role: "Talent" },
    "callSheets.removeGuest": { callSheetId: ids.callSheetId, id: "guest:x" }, "callSheets.send": { callSheetId: ids.callSheetId, crew: true, client: true },
    "callSheets.sendUpdate": { callSheetId: ids.callSheetId, changed: "Talent call moved" }, "callSheets.remind": { callSheetId: ids.callSheetId },
    "callSheets.forClient": { callSheetId: ids.callSheetId }, "callSheets.forClientProject": { projectId: ids.projectId }, "callSheets.opened": { callSheetId: ids.callSheetId },
    "vendorPortal.callSheet": { callSheetId: ids.callSheetId }, "vendorPortal.callSheets": { businessId: ids.businessId }, "vendorPortal.openCallSheet": { callSheetId: ids.callSheetId },
    // Phase 5b step 5: Production › Calendar (owner only)
    "calendarSync.range": { from: "2030-01-01", to: "2030-01-31" }, "calendarSync.linkOptions": {}, "calendarSync.setShown": { calendarId: "cal@x", on: false },
    "calendarSync.create": { title: "T", date: "2030-01-02", endDate: "2030-01-02", start: "10:00", end: "11:00", guests: [] },
    "calendarSync.update": { eventId: ids.calendarEventId, title: "T", date: "2030-01-02", endDate: "2030-01-02", start: "10:00", end: "11:00", guests: [], notify: false },
    "calendarSync.move": { eventId: ids.calendarEventId, date: "2030-01-03", endDate: "2030-01-03", start: "10:00", end: "11:00", notify: false },
    "calendarSync.undoMove": { eventId: ids.calendarEventId }, "calendarSync.remove": { eventId: ids.calendarEventId },
    "calendarSync.moveShoot": { shootId: ids.shootId, date: "2030-01-03", call: "08:00", notify: false }, "calendarSync.undoShoot": { shootId: ids.shootId },
    "calendarSync.moveDate": { projectId: ids.projectId, label: "Cut 1 due", from: "2030-01-05", to: "2030-01-06" },
    "calendarSync.shootMoveDone": { shootId: ids.shootId }, "calendarSync.askConfirmAgain": { shootId: ids.shootId }, "calendarSync.syncNow": {},
    // Phase 5b step 4: call-sheet guests (the owner's End access; the guest's link, code and pages)
    "callSheets.endGuest": { callSheetId: ids.callSheetId, id: "guest:matrix" }, "callSheets.restoreGuest": { callSheetId: ids.callSheetId, id: "guest:matrix" },
    // D148: Refresh forecast (owner only; looks the forecast up again for one of the owner's own sheets).
    "callSheets.refreshWeather": { callSheetId: ids.callSheetId },
    "guests.intro": { token: ids.guestToken }, "guests.sendCode": { token: "nope-nope-nope-nope" },
    "guests.home": {}, "guests.sheet": { token: ids.guestToken }, "guests.opened": { token: ids.guestToken },
    // Phase 5e step 1: the team
    "team.page": {}, "team.member": { membershipId: ids.teamMemberId }, "team.invite": { email: "new@x.example", role: "editor" }, "team.resendInvite": { inviteId: ids.teamInviteId },
    "team.cancelInvite": { inviteId: ids.teamInviteId }, "team.remove": { membershipId: ids.teamMemberId }, "team.setRole": { membershipId: ids.teamMemberId, role: "editor" },
    "team.setPerm": { membershipId: ids.teamMemberId, perm: "docs", on: false }, "team.resetToRole": { membershipId: ids.teamMemberId }, "team.setRolePerm": { role: "editor", perm: "docs", on: false },
    "auditLog.list": {}, // Phase 5e step 3: Settings › Activity (owner only)
    // Phase 5e step 4: the bell (each caller's own; markRead refuses another person's item)
    // Phase 5e step 5: Payments › Reports
    "reports.page": { from: "2026-01-01", to: "2026-03-31", tz: "America/Chicago" }, "reports.widgets": { tz: "America/Chicago" }, "reports.logExport": { from: "2026-01-01", to: "2026-03-31", reports: ["revenue"] },
    // Phase 5e step 6: Settings › Your data (owner only; the safety-net export is the portal admins' only)
    "yourData.state": {}, "yourData.requestExport": {}, "yourData.cancelExport": { exportId: ids.dataExportId }, "yourData.exportLink": { exportId: ids.dataExportId },
    "yourData.scheduleDeletion": { typedName: "Matrix" }, "yourData.cancelDeletion": {}, "yourData.finalExportLink": { deletionId: ids.deletionId },
    "bell.feed": {}, "bell.unread": {}, "bell.markRead": { itemId: ids.bellItemId }, "bell.markAllRead": {}, "bell.prefs": {}, "bell.setPref": { kind: "notes", bell: false },
    "bell.phoneAllOff": {}, "bell.subscribe": { endpoint: "https://push.example/matrixmatrix", p256dh: "p", auth: "a", label: "Test" }, "bell.unsubscribe": { endpoint: "https://push.example/matrixmatrix" },
    "bell.pushKey": {}, "push.ensureKey": {},
    // Phase 5e step 2: Security (one's own account)
    "security.state": {}, "security.changePassword": { current: "x", next: "yyyyyyyyyyyy" }, "security.signInLocked": { email: "x@example.com" },
    "security.startEmailChange": { newEmail: "brand.new@example.com" }, "security.confirmEmailChange": { code: "000000" }, "security.cancelEmailChange": {},
    "security.seenDevice": { deviceKey: "matrixdevicekey0000000", label: "Test" }, "security.signOutDevice": { sessionId: ids.ownerSub.split("|")[1] },
        "team.resetRoles": {}, "team.projectPeople": { projectId: ids.projectId }, "team.assign": { projectId: ids.projectId, userIds: [] }, "team.joinPage": { token: "nope" },
  };
}

// Every public function in convex/*.ts (read from the source, since the generated `api` is a proxy with no keys).
export function publicFunctions(): Array<{ key: string; ref: any }> {
  const dir = join(__dirname, "..", "convex");
  const out: Array<{ key: string; ref: any }> = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts")).sort()) {
    const mod = file.slice(0, -3);
    if (mod === "auth") continue; // Convex Auth's own signIn/signOut, exercised in the sign-up tests
    const src = readFileSync(join(dir, file), "utf8");
    for (const m of src.matchAll(/^export const (\w+) = (query|mutation|action)\(/gm)) out.push({ key: `${mod}.${m[1]}`, ref: (anyApi as any)[mod][m[1]] });
  }
  return out;
}

export async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston", role: "owner" });
    const stranger = await ctx.db.insert("users", { email: "nobody@example.com", name: "Nobody" });
    const client = await ctx.db.insert("users", { email: "client@example.com", name: "Client", role: "client" });
    const sess = async (userId: Id<"users">) => `${userId}|${await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 })}`;
    const projectId = await ctx.db.insert("projects", { name: "P", createdAt: 0, keyDates: [{ label: "Cut 1 due", date: "2030-01-05" }] });
    const videoId = await ctx.db.insert("videos", { projectId, title: "V", createdAt: 0, updatedAt: 0 });
    const versionId = await ctx.db.insert("versions", { videoId, number: 1, status: "ready", bunnyGuid: "g", fileName: "a.mp4", startTimecode: "01:00:00:00", createdAt: 0 } as never);
    const noteId = await ctx.db.insert("notes", { versionId, videoId, kind: "general", text: "n", status: "open", authorName: "Heston", createdAt: 0, updatedAt: 0 } as never);
    const replyId = await ctx.db.insert("replies", { noteId, text: "r", authorName: "Claude", createdAt: 0, hidden: true });
    const fileId = await ctx.db.insert("dropFiles", { pathLower: "/x.mp4", pathDisplay: "/x.mp4", rev: "r", size: 1, status: "flagged", firstSeenAt: 0, lastChangeAt: 0, checks: 0 } as never);
    const inviteId = await ctx.db.insert("invites", { email: "client@example.com", createdAt: 0, acceptedAt: 0, userId: client });
    const keyId = await ctx.db.insert("connectorKeys", { hash: "h", prefix: "wr_x", label: "k", createdAt: 0 } as never);
    const shareId = await ctx.db.insert("shares", { token: "tok", kind: "video", videoId, access: "view", who: "link", allVersions: true, downloads: false, emailNewVersions: false, createdAt: 0, createdBy: owner });
    const storageId = await ctx.storage.store(new Blob(["x"]));
    const docId = await ctx.db.insert("wsDocuments", { number: 1, title: "D", status: "draft", currentVersion: 1, createdAt: 0, updatedAt: 0 });
    const wsKeyId = await ctx.db.insert("wsConnectorKeys", { hash: "x", prefix: "ws_x", label: "t", createdAt: 0 });
    const wsVersionId = await ctx.db.insert("wsVersions", { documentId: docId, number: 1, fileId: storageId, fileName: "a.pdf", fileSha256: "0", fileBytes: 1, pages: [{ width: 612, height: 792, rotate: 0 }], signers: [], boxes: [], signingOrder: "any", createdAt: 0, updatedAt: 0 });
    const clientRecId = await ctx.db.insert("clients", { name: "Harbor", createdAt: 0 });
    const personId = await ctx.db.insert("clientPeople", { clientId: clientRecId, email: "client@example.com", role: "signer", createdAt: 0 });
    const inboxItemId = await ctx.db.insert("inboxItems", { clientId: clientRecId, email: "client@example.com", kind: "note", title: "Hello", text: "x", source: { module: "inbox", id: "n" }, key: "note:n:client@example.com", createdAt: 0 });
    const inboxNoteId = await ctx.db.insert("inboxNotes", { clientId: clientRecId, title: "Hello", text: "x", status: "draft", draftedBy: "owner", createdAt: 0, updatedAt: 0 });
    const requestId = await ctx.db.insert("wsRequests", { documentId: docId, what: "approve", versionNumber: 1, said: "x", status: "pending", createdAt: Date.now() });
    const buildId = await ctx.db.insert("wsBuilds", { title: "B", blocks: [], fields: {}, style: {}, signers: [], createdAt: 0, updatedAt: 0 });
    const templateId = await ctx.db.insert("wsTemplates", { name: "T", blocks: [], fields: {}, style: {}, createdAt: 0, updatedAt: 0 });
    const clauseId = await ctx.db.insert("wsClauses", { title: "C", body: {}, initials: false, createdAt: 0, updatedAt: 0 });
    const styleId = await ctx.db.insert("wsStyles", { name: "S", style: {}, isDefault: false, createdAt: 0, updatedAt: 0 });
    const deliveryFileId = await ctx.db.insert("deliveryFiles", { projectId, name: "F.mov", kind: "dropbox", dropboxPath: "/f.mov", createdAt: 0 });
    const invoiceId = await ctx.db.insert("invoices", { projectId, kind: "other", title: "T", billTo: { name: "A", email: "a@b.co" }, lines: [], dueDate: "2030-01-01", status: "draft", totalCents: 0, amountPaidCents: 0, amountRemainingCents: 0, history: [], createdAt: 0, updatedAt: 0 });
    const planId = await ctx.db.insert("plans", { name: "P", amountCents: 1000, interval: "month", intervalCount: 1, stripe: { accountId: "acct_x", productId: "prod_x", priceId: "price_x", livemode: false }, createdAt: 0, updatedAt: 0 });
    const subscriptionId = await ctx.db.insert("subscriptions", { planId, priceId: "price_x", planName: "P", amountCents: 1000, interval: "month", intervalCount: 1, billTo: { name: "A", email: "a@b.co" }, status: "incomplete", startDate: "2030-01-01", firstInvoice: "now", payToken: "subtokensubtoken01", stripe: { accountId: "acct_x", customerId: "cus_x", subscriptionId: "sub_x", livemode: false }, history: [], createdAt: 0, updatedAt: 0 });
    const dealId = await ctx.db.insert("deals", { title: "D", stage: "lead", source: "hand", history: [], createdAt: 0, updatedAt: 0 });
    const followUpId = await ctx.db.insert("followUps", { who: "A", about: "B", due: "2030-01-01", createdAt: 0 });
    const estimateId = await ctx.db.insert("estimates", { title: "E", scope: "", input: {}, rates: {}, result: { lines: [] }, createdAt: 0, updatedAt: 0 });
    const entryId = await ctx.db.insert("ledgerEntries", { projectId, kind: "hours", hours: 1, date: "2030-01-01", createdAt: 0 });
    const quoteId = await ctx.db.insert("quotes", { number: "X-Q-0001", seq: 1, status: "draft", contact: { name: "A", email: "a@b.co" }, title: "T", lines: [], deposit: { kind: "percent", value: 25 }, validUntil: "2030-01-01", totalCents: 0, history: [], createdAt: 0, updatedAt: 0 });
    const proposalId = await ctx.db.insert("proposals", { buildId, number: "X-P-0001", seq: 1, status: "draft", history: [], createdAt: 0, updatedAt: 0 });
    const offerPersonId = await ctx.db.insert("offerRecipients", { quoteId, email: "p@x.example", token: "matrixmatrixmatrixmatrix", sentAt: 0, opens: 0 }); // D149
    const vendorId = await ctx.db.insert("vendors", { name: "V", email: "v@x.example", roles: [], rates: [], createdAt: 0, updatedAt: 0 });
    const bookingId = await ctx.db.insert("vendorBookings", { vendorId, projectId, role: "Shooter", start: "2030-01-01", end: "2030-01-02", rate: { cents: 100000, unit: "day" }, status: "offered", offeredAt: 0, createdAt: 0, updatedAt: 0 });
    const businessId = (await ctx.db.query("businesses").first())?._id ?? await ctx.db.insert("businesses", { slug: "matrix", name: "Matrix Co", createdAt: 0 });
    const briefingId = await ctx.db.insert("briefings", { buildId, projectId, bookingId, status: "draft", history: [], createdAt: 0, updatedAt: 0 });
    const vendorInvoiceId = await ctx.db.insert("vendorInvoices", { vendorId, bookingId, projectId, number: "INV-0001", mode: "hours", hours: [], lines: [], rate: { cents: 1, unit: "day" }, totalCents: 0, status: "draft", createdAt: 0, updatedAt: 0 });
    const shootId = await ctx.db.insert("shoots", { projectId, date: "2030-01-02", call: "07:00", location: "X", prepare: [], crew: [], status: "scheduled", history: [], createdAt: 0, updatedAt: 0 });
    const gearId = await ctx.db.insert("gear", { name: "Matrix camera", kind: "camera", serial: "SN-1234567", status: "in_service", insuredCents: 100000, createdAt: 0, updatedAt: 0 });
    await ctx.db.insert("gearMaintenance", { gearId, date: "2030-01-01", what: "Cleaned", nextDue: "2030-06-01", createdAt: 0 });
    await ctx.db.insert("gearBookings", { gearId, shootId, createdAt: 0 });
    // Phase 5d step 1: booking calls: the settings and one booked call (its private link's token).
    await ctx.db.insert("callSettings", { lengthMin: 30, bufferMin: 10, aheadDays: 30, noticeHours: 4, hours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ on: d < 5, start: "09:00", end: "17:00" })), updatedAt: 0 });
    const callToken = "matrixcalltoken0123456789";
    const callId = await ctx.db.insert("calls", { name: "Lead", email: "lead@x.example", start: Date.now() + 5 * 86_400_000, end: Date.now() + 5 * 86_400_000 + 1_800_000, tz: "America/Chicago", status: "booked", token: callToken, notice: { kind: "booked", at: 0 }, history: [], createdAt: 0, updatedAt: 0 });
    // Phase 5d step 2: a project's message thread with a message and a read, and a lead's thread.
    const threadId = await ctx.db.insert("msgThreads", { kind: "project", projectId, lastAt: 1, lastText: "Hi", lastSide: "client", lastName: "Client", createdAt: 0 });
    await ctx.db.insert("messages", { threadId, side: "client", name: "Client", email: "client@example.com", text: "Hi", files: [], createdAt: 1 });
    await ctx.db.insert("msgReads", { threadId, who: "client@example.com", name: "Client", readAt: 1 });
    await ctx.db.insert("msgThreads", { kind: "lead", token: "matrixleadthreadtoken0123", leadName: "Lead", leadEmail: "lead@x.example", lastAt: 1, lastText: "", createdAt: 0 });
    const fileRequestId = await ctx.db.insert("fileRequests", { projectId, title: "X", due: "2030-01-02", folder: "/File requests/X/P/X", remind: false, status: "open", files: [], history: [], createdAt: 0, updatedAt: 0 });
    const fileUploadId = await ctx.db.insert("fileUploads", { requestId: fileRequestId, email: "client@example.com", name: "x.pdf", size: 10, path: "/File requests/X/P/X/x.pdf", mode: "direct", offset: 0, status: "uploading", expiresAt: Date.now() + 3_600_000, createdAt: 0 });
    const briefId = await ctx.db.insert("briefs", { projectId, questions: { steps: [] }, answers: {}, step: 0, status: "sent", sentAt: 0, submits: 0, history: [], createdAt: 0, updatedAt: 0 });
    // Phase 5: a testimonial, and a raw footage offer on the project.
    const testimonialId = await ctx.db.insert("testimonials", { noteId: inboxNoteId, projectId, email: "client@example.com", name: "Client", working: "w", film: "f", permission: false, createdAt: 0, updatedAt: 0 });
    await ctx.db.insert("footageStorage", { projectId, priceCents: 10000, offeredAt: 0, keepUntil: "2030-01-01", status: "offered", history: [], createdAt: 0, updatedAt: 0 });
    // D133 (Phase 5): a vendor login with its own vendor record in this business (not booked on anything), the matrix's
    // fourth caller. It proves a vendor is refused everything outside the vendor side; vendor-against-vendor checks are in
    // vendorPortal.test.ts.
    const vendorUser = await ctx.db.insert("users", { email: "vee@x.example", name: "Vee", role: "vendor" });
    await ctx.db.insert("memberships", { businessId, email: "vee@x.example", userId: vendorUser, role: "vendor", createdAt: 0 });
    await ctx.db.insert("vendors", { businessId, name: "Vee", email: "vee@x.example", roles: [], rates: [], createdAt: 0, updatedAt: 0 });
    // Phase 5b step 3: a call sheet for the shoot, sent to the invited client (who isn't on the project's shares, so the
    // client reader still answers null for them: the matrix proves nobody else gets it; callSheets.test.ts proves who does).
    const csBuild = await ctx.db.insert("wsBuilds", { title: "CS", blocks: { type: "doc", content: [] }, fields: {}, style: {}, signers: [], kind: "callsheet", createdAt: 0, updatedAt: 0 });
    const callSheetId = await ctx.db.insert("callSheets", { shootId, projectId, buildId: csBuild, how: "blank", status: "sent", sentAt: 0, updates: 0,
      recipients: [{ id: "client:client@example.com", kind: "client", name: "Client", email: "client@example.com", on: true, sentAt: 0, addedAt: 0 }, { id: `crew:${bookingId}`, kind: "crew", name: "V", email: "v@x.example", vendorId, bookingId, on: true, sentAt: 0, addedAt: 0 },
        { id: "guest:matrix", kind: "guest", name: "Gail", email: "gail@x.example", role: "Talent", on: true, sentAt: 0, addedAt: 0 },
        { id: "guest:invited", kind: "guest", name: "Ivy", email: "ivy@x.example", role: "Talent", on: true, sentAt: 1, addedAt: 0 }],
      sent: { title: "CS", page: { type: "doc", content: [] }, fields: {}, style: {}, at: 0, round: 0 }, history: [], createdAt: 0, updatedAt: 0 });
    // Phase 5b step 5: a Google Calendar connection with one event, and the shoot moved in Google (its Dashboard note).
    await ctx.db.insert("calendars", { businessId, email: "heston@gmail.example", refreshToken: "rt", calendarId: "cal@x", calendarName: "Wrangler", inviteVendors: true, inviteClient: false, connectedAt: 0,
      list: [{ id: "cal@x", name: "Wrangler", color: 0, on: true, writable: true, primary: true }] });
    const calendarEventId = await ctx.db.insert("calendarEvents", { businessId, kind: "google", calendarId: "cal@x", googleId: "pevabc123", title: "Team call", date: "2030-01-02", endDate: "2030-01-02", start: "10:00", end: "11:00",
      guests: [{ email: "g@x.example" }], gUpdated: 1, syncedAt: 0, createdAt: 0, prev: { date: "2030-01-01", endDate: "2030-01-01", start: "10:00", end: "11:00", at: Date.now(), notify: false } });
    await ctx.db.patch(shootId, { googleMove: { at: 0, was: { date: "2030-01-01", call: "07:00", location: "X" } }, dragUndo: { at: Date.now(), was: { date: "2030-01-01", call: "07:00", wrap: null, moved: null, confirmed: null, notify: false } } });
    // Phase 5b step 4 (D127): a call-sheet guest, signed in, on that sheet: the matrix's fifth caller. It proves a guest login
    // is refused everything but its own three guest functions; callSheetGuests.test.ts proves what those answer.
    const guestToken = "matrixguesttoken0123456789";
    await ctx.db.insert("guestPasses", { businessId, callSheetId, personId: "guest:matrix", email: "gail@x.example", token: guestToken, createdAt: 0 });
    const guestUser = await ctx.db.insert("users", { email: "gail@x.example", name: "Gail", role: "guest" });
    // Review test gap: a guest whose email also has a client invite (not yet accepted: no membership, no password). The
    // invite gives the guest login no client powers; it stays a guest until the email signs up and is proved.
    await ctx.db.insert("guestPasses", { businessId, callSheetId, personId: "guest:invited", email: "ivy@x.example", token: "matrixinvitedtoken01234567", createdAt: 0, sentAt: 1 });
    const invitedGuest = await ctx.db.insert("users", { email: "ivy@x.example", name: "Ivy", role: "guest" });
    await ctx.db.insert("invites", { email: "ivy@x.example", createdAt: 0 });
    // Phase 5e step 1: the team. A pending invite, and one team member of each role (the role's suggested switches; the
    // Editor assigned to no project). The access test calls every function as each of them.
    const { SUGGESTED } = await import("../convex/lib/perms");
    // The default business (untagged records are its records), made here if the setup has none, so the team sees what the owner sees.
    const teamBiz = (await ctx.db.query("businesses").withIndex("by_slug", (q) => q.eq("slug", "wrangler")).unique())?._id
      ?? await ctx.db.insert("businesses", { slug: "wrangler", name: "Wrangler Productions", createdAt: 0 });
    const teamInviteId = await ctx.db.insert("teamInvites", { businessId: teamBiz, email: "jules@x.example", teamRole: "editor", tokenHash: "h", invitedBy: "Heston", createdAt: 0, sentAt: 0, expiresAt: Date.now() + 86_400_000 });
    const teamUser = async (email: string, teamRole: "producer" | "editor" | "bookkeeper") => {
      const u = await ctx.db.insert("users", { email, name: teamRole, role: "team", emailVerificationTime: 0 });
      const m = await ctx.db.insert("memberships", { businessId: teamBiz, email, userId: u, role: "team", teamRole, perms: { ...SUGGESTED[teamRole] }, createdAt: 0 });
      return { sub: await sess(u), m };
    };
    const producer = await teamUser("team-producer@x.example", "producer");
    const editor = await teamUser("team-editor@x.example", "editor");
    const bookkeeper = await teamUser("team-bookkeeper@x.example", "bookkeeper");
    const bellItemId = await ctx.db.insert("bellItems", { businessId: teamBiz, userId: owner, kind: "notes", title: "Matrix", key: "matrix", at: 0 });
    // Phase 5e step 6: an export ready to download, and a finished deletion whose safety-net export the admins keep
    const dataExportId = await ctx.db.insert("dataExports", { businessId: teamBiz, status: "ready", requestedAt: 0, requestedBy: owner, fileId: storageId, bytes: 1, readyAt: 0, expiresAt: Date.now() + 86_400_000 });
    const deletionId = await ctx.db.insert("businessDeletions", { businessId: teamBiz, name: "Gone Films", ownerEmail: "gone@x.example", requestedBy: "Gone", requestedAt: 0, deleteAt: 0, status: "done", finalExportId: storageId, finalBytes: 1, purgeAt: Date.now() + 86_400_000 });
    return { teamInviteId, bellItemId, dataExportId, deletionId, teamMemberId: producer.m, producerSub: producer.sub, editorSub: editor.sub, bookkeeperSub: bookkeeper.sub, threadId, callId, callToken, gearId, offerPersonId, calendarEventId, guestToken, guestInvitedSub: await sess(invitedGuest), guestSub: await sess(guestUser), callSheetId, testimonialId, vendorSub: await sess(vendorUser), briefId, fileRequestId, fileUploadId, shootId, vendorInvoiceId, businessId, briefingId, bookingId, vendorId, proposalId, quoteId, dealId, followUpId, estimateId, entryId, subscriptionId, planId, invoiceId, deliveryFileId, clientRecId, personId, inboxItemId, inboxNoteId, requestId, buildId, templateId, clauseId, styleId, docId, wsVersionId, wsKeyId, projectId, videoId, versionId, noteId, fileId, inviteId, keyId, storageId, shareId, replyId, ownerSub: await sess(owner), strangerSub: await sess(stranger), clientSub: await sess(client) };
  });
  return { t, ids };
}

// Call a function of any kind the way the page would.
export async function call(t: ReturnType<typeof convexTest>, ref: any, args: Record<string, unknown>, kind: string) {
  const path = `${ref[Symbol.for("functionName")] ?? ""}`;
  void path;
  // convex-test picks the runner by the registered function's kind; try each.
  try { return await (t as any).query(ref, args); } catch (e) { if (!/not a query|is a (mutation|action)/i.test(String(e))) throw e; }
  try { return await (t as any).mutation(ref, args); } catch (e) { if (!/not a mutation|is an? (query|action)/i.test(String(e))) throw e; }
  return await (t as any).action(ref, args);
  void kind;
}

