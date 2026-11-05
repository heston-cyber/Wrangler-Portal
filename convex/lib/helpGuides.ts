// Phase 5d step 4 (Nov 4, Q59): Help. Wrangler's starter set of short guides. Each business starts from these; the owner
// can edit any of them in the page editor (the edit is kept as a "guide" template for that business) and reset it.
import { bulletList, line, type Page, type PNode } from "./wsBuilder";

export type Audience = "client" | "vendor" | "both";
export type Part = { h: string } | { p: string } | { steps: string[] } | { bullets: string[] };
export type Guide = { slug: string; title: string; summary: string; audience: Audience; parts: Part[] };

const NEED_HAND = { p: "If something here doesn't match what you see, reply to the email that brought you here and we'll sort it out." };

export const GUIDES: Guide[] = [
  { slug: "signing-in", title: "Signing in", summary: "Get into your account, and what to do if you're locked out.", audience: "both", parts: [
    { p: "You sign in with your email address and a password. The first time, we send a six-digit code to that address to prove it's yours." },
    { h: "To sign in" },
    { steps: ["Open the link in your invitation, or go to the portal's address.", "Type your email and your password.", "If you forgot it, choose Forgot password. We email a six-digit code, and you pick a new password."] },
    { p: "Use the same email address the invitation went to. A different address won't find your account." },
    NEED_HAND] },
  { slug: "your-files", title: "Finding your files", summary: "Where your cuts, documents and delivered files live.", audience: "client", parts: [
    { p: "Everything we share with you is under your name in the portal, so you don't have to search old emails." },
    { bullets: ["Review: the cuts we've shared, newest first.", "Docs: contracts and documents waiting for you, and the ones you've signed.", "Inbox: every update, with a link to the thing it's about.", "A project's page: its cuts, documents and delivered files together."] },
    { p: "Delivered files appear on the project page once we've sent them. You'll get an Inbox message when they're ready." },
    NEED_HAND] },
  { slug: "leaving-notes", title: "Leaving notes on a cut", summary: "Pin a note to the exact moment you mean.", audience: "client", parts: [
    { p: "You can write notes right on the video. Each one is pinned to the moment you wrote it, so we know exactly what you mean." },
    { h: "To leave a note" },
    { steps: ["Open the cut from Review or from the link we sent.", "Play to the moment, or pause on it.", "Type your note and send it.", "Add as many as you like. We see them as you go."] },
    { p: "You can reply under a note to talk it through. When we've made a change, the note is marked done." },
    NEED_HAND] },
  { slug: "signing-a-document", title: "Signing a document", summary: "Read, sign and get your copy.", audience: "client", parts: [
    { p: "When a contract or other document is ready, you get an email and an Inbox message with a link to it." },
    { h: "To sign" },
    { steps: ["Open the document and read it through.", "Fill in each place marked for you: signature, initials, name and date.", "Press the button to finish. Your signature is saved with the time you signed.", "When everyone has signed, you get a copy by email."] },
    { p: "You can leave and come back. Nothing is signed until you press the final button." },
    NEED_HAND] },
  { slug: "paying-an-invoice", title: "Paying an invoice", summary: "Pay by card or bank account, and find your receipt.", audience: "client", parts: [
    { p: "An invoice arrives by email and in your Inbox. You can pay it right in the portal." },
    { h: "To pay" },
    { steps: ["Open the invoice from the email, your Inbox, or Payments.", "Check the amount and the due date.", "Choose how to pay and enter your details. They go straight to our payment provider; we never see your card number.", "You get a receipt by email, and the invoice shows as paid."] },
    { p: "If a payment doesn't go through, you'll see why on the invoice, and you can try another way." },
    NEED_HAND] },
  { slug: "uploading-files", title: "Uploading files", summary: "Send us logos, footage or anything we asked for.", audience: "client", parts: [
    { p: "Sometimes we ask you for files, like a logo or photos. The request shows up in your Inbox and on the project's page." },
    { h: "To upload" },
    { steps: ["Open the request.", "Choose your files or drag them in.", "Wait for each one to finish. You'll see it check off.", "Close the page when they're all done. We're told automatically."] },
    { p: "Large files take a while. Keep the page open until each one finishes." },
    NEED_HAND] },
  { slug: "your-shoot", title: "Your shoot and call sheet", summary: "Confirm the day, and read your call sheet.", audience: "client", parts: [
    { p: "When a shoot is scheduled, you get an email and an Inbox message with the date, call time and place." },
    { h: "To confirm" },
    { steps: ["Open the shoot from the email or your project's page.", "Check the date, call time and location.", "Press Confirm. If anything is wrong, tell us before you confirm."] },
    { p: "Closer to the day we send a call sheet: the schedule, who's coming, where to park and the weather. If the plan changes, we send an update, and the call sheet shows what changed." },
    NEED_HAND] },
  { slug: "accepting-a-booking", title: "Accepting a booking", summary: "Say yes or no to a job, and what happens next.", audience: "vendor", parts: [
    { p: "When a business books you, you get an email and the job shows under Bookings with the role, dates and rate." },
    { h: "To answer" },
    { steps: ["Open the booking and read the role, dates and rate.", "Press Accept if you can do it, or Decline if you can't.", "After you accept, the business can send you a briefing and, nearer the day, a call sheet."] },
    { p: "Answer as soon as you can. The business is waiting to confirm the crew." },
    NEED_HAND] },
  { slug: "vendor-briefings", title: "Reading a briefing", summary: "What the job is, and marking that you've read it.", audience: "vendor", parts: [
    { p: "A briefing tells you what the job needs: the plan, the look, who to ask. You find it under Briefings, and we email you when one is ready." },
    { steps: ["Open the briefing and read it through.", "Press the button to mark it read, so the business knows you've seen it.", "If anything is unclear, ask the business before the day."] },
    NEED_HAND] },
  { slug: "vendor-call-sheet", title: "Reading your call sheet", summary: "Your call time, where to be and who's there.", audience: "vendor", parts: [
    { p: "A few days before a shoot you get a call sheet by email, and it also shows in the portal." },
    { bullets: ["Your call time is at the top.", "The schedule shows the day's plan.", "The location includes parking and the weather forecast.", "The crew list shows who's there and how to reach the producer."] },
    { p: "If something changes, we send an update, and the sheet says what changed." },
    NEED_HAND] },
  { slug: "sending-an-invoice", title: "Sending an invoice", summary: "Bill for a job you've done.", audience: "vendor", parts: [
    { p: "After a job you can send the business an invoice from the portal." },
    { h: "To invoice" },
    { steps: ["Open Invoices and choose New invoice, or start one from the booking.", "Pick the booking. Your rate fills in.", "Add your days or hours, and any extras.", "Check the total, then send it."] },
    { p: "You can see each invoice's status, and when it's paid." },
    NEED_HAND] },
  { slug: "adding-a-w9", title: "Adding your W-9", summary: "The tax form the business needs before it can pay you.", audience: "vendor", parts: [
    { p: "A U.S. business asks each person it pays for a W-9, so it can report what it paid you at the end of the year." },
    { h: "To add yours" },
    { steps: ["Fill in and sign a W-9, and save it as a PDF.", "Open Settings from your menu.", "In the W-9 card, press Upload your W-9 (PDF) and choose the file.", "The card shows it as on file. To change it later, press Replace W-9."] },
    { p: "Each business you work for keeps its own copy, so upload it under each one. Only you and that business can see it." },
    NEED_HAND] },
];

export const guideOf = (slug: string) => GUIDES.find((g) => g.slug === slug);
export const forAudience = (side: "owner" | "client" | "vendor", g: Guide) => side === "owner" || g.audience === "both" || g.audience === side;

/** A guide as a page for the editor and the reader: headings, paragraphs and lists. */
export function guidePage(g: Guide): Page {
  const content: PNode[] = [line(g.title, { size: "title" })];
  for (const part of g.parts) {
    if ("h" in part) content.push(line(part.h, { size: "heading" }));
    else if ("p" in part) content.push(line(part.p));
    else if ("steps" in part) content.push(bulletList(part.steps, true));
    else content.push(bulletList(part.bullets));
  }
  return { type: "doc", content };
}
