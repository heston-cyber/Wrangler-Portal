// Dev only: writes every email as an HTML file for a look in a browser. MAIL_PREVIEW=<folder> npx vitest run tests/mailPreview.test.ts
import { describe, test } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { brandFrom } from "../convex/lib/mail";
import * as M from "../convex/lib/mails";

describe.skipIf(!process.env.MAIL_PREVIEW)("mail preview", () => {
  test("write", () => {
    const out = process.env.MAIL_PREVIEW!;
    mkdirSync(out, { recursive: true });
    const w = brandFrom({ name: "Wrangler Productions", legalName: "Hill Creative LLC", ownerName: "Heston Hill" }, { ownerEmail: "heston@wranglerproductions.com", logoUrl: "http://localhost:5179/brand/wp-logo-email.png", isDefault: true });
    const j = brandFrom({ name: "Juniper & Ash", ownerName: "Jules Park", accent: "#3D8BFF", replyTo: "hello@juniperandash.com" }, { ownerEmail: "jules@juniperandash.com", logoUrl: "http://localhost:5179/brand/wp-logo-email.png", isDefault: false });
    const link = "https://app.wranglerportal.com/s/q8Hf2kLmZx91/v/k57abc?version=4";
    const mails: Record<string, M.Mail> = {
      "01": M.signInCodeMail(w, { code: "418207", minutes: 10 }),
      "02": M.resetMail(w, { code: "552019", minutes: 10 }),
      "03": M.shareInviteMail(w, { kind: "project", label: "Harbor Coffee Launch", sub: null, access: "comment", hasAccount: false, name: "Maya Brooks", link }),
      "03j": M.shareInviteMail(j, { kind: "project", label: "Harbor Coffee Launch", sub: null, access: "comment", hasAccount: false, name: "Maya Brooks", link }),
      "04": M.newVersionMail(w, { title: "Spirit Days Intro", number: 4, description: "Logo earlier, new music edit.", project: "26122 Spirit Days", name: "Maya Brooks", link, unsub: "https://x/email/stop", thumbUrl: "http://localhost:5179/light-elbow.jpg" }),
      "05": M.replyMail(w, { name: "Maya", replyAuthor: "Heston Hill", replyText: "Yes, moved it to the downbeat in v4.", noteText: "Can the logo land a beat earlier?", when: "01:00:12:08", title: "Spirit Days Intro", number: 4, project: "26122 Spirit Days", link: link + "&note=n1", unsub: "https://x" }),
      "06": M.ownerAlertMail(w, { title: "Spirit Days Intro", project: "26122 Spirit Days", rows: [{ version: 4, author: "Maya Brooks", text: "Can the logo land a beat earlier?", drawing: false, voice: false, when: "01:00:12:08", link }, { version: 4, author: "Dan Ortiz", text: "", drawing: false, voice: true, when: "Whole video", link }] }),
      "07": M.pleaseSignMail(w, { name: "Maya Brooks", title: "Spirit Days Service Agreement", label: "WS-00018", link: "https://sign.wranglerportal.com/kqB1x8f7d6s5a4", until: "Nov 27, 2026", reminder: false }),
      "07j": M.pleaseSignMail(j, { name: "Maya Brooks", title: "Spirit Days Service Agreement", label: "WS-00018", link: "https://sign.wranglerportal.com/kqB1x8f7d6s5a4", until: "Nov 27, 2026", reminder: false }),
      "08": M.cancelledMail(w, { name: "Maya Brooks", title: "Spirit Days Service Agreement", label: "WS-00018", reason: "Updated the dates" }),
      "09": M.signerCodeMail(w, { code: "418207", title: "Spirit Days Service Agreement", label: "WS-00018" }),
      "10": M.ownerSignedMail(w, { signer: "Maya Brooks", title: "Spirit Days Service Agreement", label: "WS-00018", left: ["Dan Ortiz"], link: "https://app.wranglerportal.com/sign/d/abc" }),
      "12": M.ownerLockedMail(w, { signer: "Maya Brooks", title: "Spirit Days Service Agreement", label: "WS-00018", link: "https://app.wranglerportal.com/sign/d/abc" }),
      "13": M.signedCopyMail(w, { owner: false, name: "Maya Brooks", title: "Spirit Days Service Agreement", label: "WS-00018", fileName: "Spirit-Days-Service-Agreement-WS-00018-signed.pdf", fileMeta: "PDF · 412 KB", signedBy: ["Maya Brooks, Oct 28, 2026", "Heston Hill, Founder, Wrangler Productions, Oct 27, 2026"], sha256: "4b7e0d92aa13f6c1e8d02b77c3a91f05d6e4b2a8c19f03e7d5b61a0c4f28e93b", verifyUrl: "https://sign.wranglerportal.com/verify", link: "x", invoice: null }),
      "13b": M.signedCopyMail(w, { owner: true, name: "Heston", title: "Spirit Days Service Agreement", label: "WS-00018", fileName: "Spirit-Days-Service-Agreement-WS-00018-signed.pdf", fileMeta: "PDF · 412 KB", signedBy: ["Maya Brooks, Oct 28, 2026"], sha256: "4b7e0d92aa13f6c1e8d02b77c3a91f05d6e4b2a8c19f03e7d5b61a0c4f28e93b", verifyUrl: "https://sign.wranglerportal.com/verify", link: "https://app.wranglerportal.com/sign/d/abc", invoice: { kind: "created", amount: "$1,200.00", testMode: false, url: "https://dashboard.stripe.com/invoices/in_1" } }),
      "note": M.noteMail(w, { title: "Shoot moved to Thursday, Nov 6", text: "The shoot moves to Thursday, Nov 6, same call time. Nothing else changes. If Thursday doesn't work for your team, reply to this email and we'll sort it out.", link: null, linkLabel: null }),
      "notej": M.noteMail(j, { title: "Final colour pass booked", text: "We're grading on Monday, Nov 2. You'll get the new cut the same week.", link: null, linkLabel: null }),
      "invite": M.portalInviteMail(w, { name: "Maya Brooks", email: "maya@harborcoffee.com", hasAccount: false }),
    };
    for (const [k, m] of Object.entries(mails)) { writeFileSync(join(out, `${k}.html`), m.html); writeFileSync(join(out, `${k}.txt`), `From: ${m.from}\nSubject: ${m.subject}\n\n${m.text}`); }
  });
});
