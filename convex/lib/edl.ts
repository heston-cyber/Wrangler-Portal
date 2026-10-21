// Resolve timeline-marker EDL ("Import > Timeline Markers from EDL" on a timeline in the Media Pool).
import { framesToTc, nominal, tcToFrames, type Fps } from "./frames";

export type EdlNote = { kind: "frame" | "range" | "general"; inFrame?: number; outFrame?: number; text: string; status: "open" | "done"; authorName: string };

const COLOR = { frame: "ResolveColorBlue", range: "ResolveColorYellow", general: "ResolveColorGreen" } as const;

const clean = (s: string) => s.replace(/[|\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);

export function markersEdl(title: string, notes: EdlNote[], startTc: string, fps: Fps): string {
  const n = nominal(fps);
  const start = tcToFrames(startTc, n);
  const lines = [`TITLE: ${clean(title)}`, "FCM: NON-DROP FRAME", ""];
  let i = 1;
  const sorted = [...notes].sort((a, b) => (a.inFrame ?? 0) - (b.inFrame ?? 0));
  for (const note of sorted) {
    const f = note.kind === "general" ? 0 : note.inFrame ?? 0;
    const dur = note.kind === "range" ? Math.max(1, (note.outFrame ?? f) - f + 1) : 1;
    const tin = framesToTc(start + f, n);
    const tout = framesToTc(start + f + 1, n);
    const label = clean(`${note.kind === "general" ? "Whole video: " : ""}${note.text || "(drawing)"}${note.status === "done" ? " [done]" : ""}`);
    lines.push(`${String(i).padStart(3, "0")}  001      V     C        ${tin} ${tout} ${tin} ${tout}  `);
    lines.push(` |C:${COLOR[note.kind]} |M:${label} |D:${dur}`);
    lines.push("");
    i++;
  }
  return lines.join("\n");
}
