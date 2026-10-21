// Background jobs. The Dropbox webhook makes imports near-instant; this minute-by-minute check is the backstop
// (and the only trigger until the webhook address is added in the Dropbox app).
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("dropbox drop folder", { minutes: 1 }, internal.dropbox.sync, {});
export default crons;
