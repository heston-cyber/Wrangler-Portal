// Shot lists (Nov 16, D179–D182): the rules that don't need the database, so they can be tested on their own.

export const MAX_SHOTS = 500;      // in one list
export const MAX_SETUPS = 100;     // setups and gap lines in one list
export const MAX_PASTE = 200;      // lines in one paste
export const TEXT_MAX = 200;
export const NOTE_MAX = 400;

export const tidy = (s: string | undefined | null, max: number) => (s ?? "").trim().replace(/\s+/g, " ").slice(0, max);
export const isTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** "Heston Hill" → "HH"; one word → its first two letters. */
export function initialsOf(name: string): string {
  const w = name.trim().split(/\s+/).filter(Boolean);
  if (!w.length) return "?";
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
  return (w[0][0] + w[w.length - 1][0]).toUpperCase();
}

/**
 * The Paste shots rule (frame 1034-20542: "One shot per line. A number at the start of a line is kept."): blank lines
 * are skipped and list marks ("-", "•", "*", "[ ]") dropped. A number at the start ("12", "#12", "12.", "12)", "12 -")
 * is kept if no other shot in the list (or earlier in the paste) has it; every other line gets the next free number,
 * counting on from the highest number used so far.
 */
export function parsePaste(text: string, used: Iterable<number>): Array<{ number: number; text: string }> {
  const taken = new Set(used);
  let next = Math.max(0, ...taken) + 1;
  const out: Array<{ number: number; text: string; want: number | null }> = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim().replace(/^(?:[-•*·]|\[\s?[xX]?\s?\])\s+/, "");
    if (!line) continue;
    let want: number | null = null;
    const m = /^#?(\d{1,4})(?:[.):\-–]\s*|\s+)(.+)$/.exec(line);
    if (m && Number(m[1]) > 0) { want = Number(m[1]); line = m[2].replace(/^[-–:]\s*/, ""); }
    const t = tidy(line, TEXT_MAX);
    if (!t) continue;
    out.push({ number: 0, text: t, want });
  }
  // Numbers typed in the paste are claimed first (in order), then the rest count on from the highest.
  for (const r of out) if (r.want !== null && !taken.has(r.want)) { r.number = r.want; taken.add(r.want); }
  next = Math.max(next, Math.max(0, ...taken) + 1);
  for (const r of out) if (!r.number) { while (taken.has(next)) next++; r.number = next; taken.add(next); next++; }
  return out.map(({ number, text }) => ({ number, text }));
}

/** The next setup code: the last code's letters, one more ("M-02" after "M-01"); "S-01" for the first. */
export function nextCode(codes: string[]): string {
  const last = [...codes].reverse().find((c) => /^[A-Za-z]{1,4}-?\d{1,3}$/.test(c));
  if (!last) return "S-01";
  const m = /^([A-Za-z]{1,4})(-?)(\d{1,3})$/.exec(last)!;
  const n = Number(m[3]) + 1;
  return `${m[1].toUpperCase()}${m[2]}${String(n).padStart(m[3].length, "0")}`;
}

/**
 * D182: should a tick made at `at` (the phone's clock, maybe hours ago with no signal) land? Not when a newer tick or
 * untick of the same shot already landed, nor when the list was Reset after it was made. A time in the future (a phone
 * clock that's ahead) counts as now.
 */
export function tickLands(at: number, now: number, shotTickAt: number | undefined, resetAt: number | undefined): { lands: boolean; at: number } {
  const t = Math.min(at, now);
  if (shotTickAt !== undefined && t < shotTickAt) return { lands: false, at: t };
  if (resetAt !== undefined && t < resetAt) return { lands: false, at: t };
  return { lands: true, at: t };
}

/** The checklist's numbers for one list: shots and how many are done. */
export function progress(shots: Array<{ done?: unknown }>) {
  return { total: shots.length, done: shots.filter((s) => !!s.done).length };
}

/** The Shot list blocks on a builder page (JSON), with their settings: which list (null on a call sheet means the
 *  shoot's own list) and whether crew may tick it there (D180; on unless the owner turned it off). */
export function shotBlocks(page: unknown): Array<{ listId: string | null; crewTick: boolean }> {
  const out: Array<{ listId: string | null; crewTick: boolean }> = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    const node = n as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
    if (node.type === "shotlist") out.push({ listId: typeof node.attrs?.listId === "string" ? node.attrs.listId : null, crewTick: node.attrs?.crewTick !== false });
    if (Array.isArray(node.content)) node.content.forEach(walk);
  };
  walk(page);
  return out;
}
