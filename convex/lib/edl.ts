// Resolve timeline-marker EDL ("Import > Timeline Markers from EDL" on a timeline in the Media Pool).
import { framesToTc, nominal, tcToFrames, type Fps } from "./frames";

export type EdlNote = { kind: "frame" | "range" | "general"; inFrame?: number; outFrame?: number; text: string; status: "open" | "done"; authorName: string };

const COLOR = { frame: "ResolveColorBlue", range: "ResolveColorYellow", general: "ResolveColorGreen" } as const;

const clean = (s: string) => s.replace(/[|\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);

// Resolve keeps one marker per frame, so notes that start on the same frame become one marker:
// longest duration, colour of the most specific note (range > frame > whole video), labels joined with " / ".
const RANK = { range: 3, frame: 2, general: 1 } as const;

export function markersEdl(title: string, notes: EdlNote[], startTc: string, fps: Fps): string {
  const n = nominal(fps);
  const start = tcToFrames(startTc, n);
  const lines = [`TITLE: ${clean(title)}`, "FCM: NON-DROP FRAME", ""];
  const groups = new Map<number, EdlNote[]>();
  for (const note of notes) {
    const f = note.kind === "general" ? 0 : note.inFrame ?? 0;
    groups.set(f, [...(groups.get(f) ?? []), note]);
  }
  let i = 1;
  for (const [f, group] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    const durOf = (x: EdlNote) => (x.kind === "range" ? Math.max(1, (x.outFrame ?? f) - f + 1) : 1);
    const lead = [...group].sort((a, b) => RANK[b.kind] - RANK[a.kind] || durOf(b) - durOf(a))[0];
    const dur = Math.max(...group.map(durOf));
    const tin = framesToTc(start + f, n);
    const tout = framesToTc(start + f + 1, n);
    const label = clean(group.map((x) => `${x.kind === "general" ? "Whole video: " : ""}${x.text || "(drawing)"}${x.status === "done" ? " [done]" : ""}`).join(" / "));
    lines.push(`${String(i).padStart(3, "0")}  001      V     C        ${tin} ${tout} ${tin} ${tout}  `);
    lines.push(` |C:${COLOR[lead.kind]} |M:${label} |D:${dur}`);
    lines.push("");
    i++;
  }
  return lines.join("\n");
}
