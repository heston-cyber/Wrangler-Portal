// Background jobs. The Dropbox webhook makes imports near-instant; this minute-by-minute check is the backstop
// (and the only trigger until the webhook address is added in the Dropbox app).
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("dropbox drop folder", { minutes: 1 }, internal.dropbox.sync, {});
// Bunny storage per version, for the "Storage" detail and Approve final (R2b).
crons.interval("bunny storage sizes", { hours: 12 }, internal.uploads.refreshStorage, {});
// Phase 2 Part B step 4 (D51): automatic invoice reminders, for businesses that turned them on.
crons.interval("invoice reminders", { hours: 1 }, internal.invoiceReminders.runDue, {});
// Phase 2b (D62): the upcoming-charge email, 7 days before each subscription charge.
crons.interval("subscription upcoming charges", { hours: 1 }, internal.subscriptions.runUpcoming, {});
// Pay in portal (Nov 2): vendor payouts still on their way (or recently posted, in case the bank returns one).
// Phase 4: email 32, the day before files are due (nothing uploaded yet).
crons.interval("file request reminders", { hours: 1 }, internal.fileRequests.remindDue, {});
// Phase 5 (Nov 3): raw footage keep days (email 36) and storage renewals (D140). Never deletes anything.
crons.interval("raw footage keep days", { hours: 1 }, internal.footage.runDue, {});
crons.interval("vendor payouts", { minutes: 15 }, internal.vendorPayouts.poll, {});
// Phase 5c (Nov 3, D128): Site watch's own daily look (8 am Central in winter). The agent runs its own schedule too.
crons.daily("site watch", { hourUTC: 14, minuteUTC: 7 }, internal.siteWatch.check, {});
// Phase 5b step 5 (Nov 3, D143): Production › Calendar, two-way with Google Calendar (incremental pull; edit dates written).
crons.interval("google calendar sync", { minutes: 5 }, internal.calendarSync.pullAll, {});
// D148 (Nov 4): call sheets' Weather blocks: the forecast fills within a week of the shoot and refreshes the day before
// (about 5 PM Central; NWS and the Census geocoder, no key).
crons.daily("call sheet weather", { hourUTC: 23, minuteUTC: 13 }, internal.callSheets.weatherAll, {});
export default crons;
