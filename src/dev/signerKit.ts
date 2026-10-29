// Dev only (never in the live build): a pretend signer for the kit, so the signing pages can be checked without a
// real link. ?kit=client&sign=<step> on /x/kittokenkittokenkit1: step is code, consent, read, finish, done or a notice
// (missing, voided, expired, superseded, signed, waiting).
import pdf from "./stills/sample.pdf?url";

type R = Record<string, unknown>;
export function installSignerKit() {
  const step = new URLSearchParams(location.search).get("sign") ?? "read";
  const notice = ["missing", "voided", "expired", "superseded", "signed", "waiting"].includes(step) ? step : null;
  const sig = "data:image/svg+xml," + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='300' height='80'><text x='4' y='56' font-size='46' font-family='Georgia' font-style='italic'>Maya Brooks</text></svg>");
  const ini = "data:image/svg+xml," + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='90' height='60'><text x='4' y='44' font-size='40' font-family='Georgia' font-style='italic'>MB</text></svg>");
  const hsig = "data:image/svg+xml," + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='300' height='80'><text x='4' y='56' font-size='46' font-family='Georgia' font-style='italic'>Heston Hill</text></svg>");
  const adopted = step === "finish" || step === "done" ? { name: "Maya Brooks", title: "Marketing Lead", method: "typed", signatureUrl: sig, initialsUrl: ini } : null;
  const box = (id: string, kind: string, x: number, y: number, w: number, h: number, who: string, otherName: string | null = null) => ({ id, kind, page: 1, x, y, w, h, cover: null, who, otherName, otherSigned: false });
  const doc = {
    label: "WS-00012", title: "Service Agreement — Harbor Coffee Launch", versionNumber: 1, fileSha256: "4b7e0d92aa13f6c1".padEnd(64, "0"), lockHash: "0".repeat(64), fileUrl: pdf, fileName: "WS-00012.pdf",
    pages: [{ width: 612, height: 792, rotate: 0 }, { width: 612, height: 792, rotate: 0 }],
    boxes: [box("b1", "sign", .12, .62, .36, .06, "me"), box("b2", "name", .12, .7, .36, .04, "me"), box("b3", "date", .12, .75, .36, .04, "me"),
      box("b4", "sign", .55, .62, .36, .06, "heston"), box("b5", "name", .55, .7, .36, .04, "heston"), box("b6", "date", .55, .75, .36, .04, "heston"),
      box("b7", "sign", .12, .82, .36, .06, "other", "Dan Price")],
    expiresAt: Date.now() + 29 * 86_400_000,
    me: { name: "Maya Brooks", title: "Marketing Lead", email: "maya@harborcoffee.com", consentAt: step === "consent" ? null : 1, initialed: [], adopted, signedAt: step === "done" ? Date.now() : null, signedDate: null },
    heston: { name: "Heston Hill", title: "Founder", signedDate: "Oct 28, 2026", signatureUrl: hsig, initialsUrl: hsig },
    consent: { id: "c1", lines: [
      "Wrangler Productions, a DBA of Hill Creative LLC would like you to review and sign this document electronically.",
      "By agreeing, you consent to receive, review and sign this document and its records electronically, and you agree that your electronic signature and initials have the same legal effect as signing by hand.",
      "You may ask for a paper copy at any time, at no charge, by emailing heston@wranglerproductions.com.",
    ] },
    statement: "By clicking Sign, I agree that my electronic signature and initials on this document are the legal equivalent of my handwritten signature and initials, and that I intend to sign it.",
    today: "Oct 29, 2026",
  };
  (globalThis as { __wsKit?: (op: string, body: R) => R }).__wsKit = (op) => {
    if (op === "open") {
      if (notice) return { state: notice, label: "WS-00012", title: doc.title, message: notice === "waiting" ? "Dan Price signs first. We'll email you when it's your turn." : "Ask Wrangler Productions for a new link." };
      return { state: "ready", label: "WS-00012", title: doc.title, from: "Heston Hill at Wrangler Productions", signer: "Maya Brooks", email: "m•••@harborcoffee.com", verified: step !== "code", expiresAt: doc.expiresAt };
    }
    if (op === "code") return { to: "m•••@harborcoffee.com" };
    if (op === "verify") return { session: "kit" };
    if (op === "doc") return doc;
    return {};
  };
  if (step !== "code") { try { sessionStorage.setItem("ws:session:kittokenkittokenkit1", "kit"); } catch { /* */ } }
  else { try { sessionStorage.removeItem("ws:session:kittokenkittokenkit1"); } catch { /* */ } }
}
