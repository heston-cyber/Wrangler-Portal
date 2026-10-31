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
export default crons;
