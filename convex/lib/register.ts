// The video register (Phase R2, Oct 22): every video made from now on gets a five-digit number that is never
// reused, and a short title. Together they make the file name for the next render:
//   00001_LCArizona_v4.mp4   (Heston, Oct 22: no client in the name; numbering starts at 00001)
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

export const pad5 = (n: number) => String(n).padStart(5, "0");

// "LC Arizona" → "LCArizona", "spirit days intro" → "SpiritDaysIntro", "4M LC_26 (v2)" → "4MLC26V2".
// Words keep their own capitals; only each word's first letter is raised. Letters, digits and hyphens only.
export function shortTitleFrom(title: string) {
  const ascii = title.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const words = ascii.split(/[^A-Za-z0-9-]+/).filter(Boolean);
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join("").replace(/^-+|-+$/g, "").slice(0, 40);
}

export function shortTitleError(s: string): string | null {
  if (!s) return "Give the video a short title for its file name, e.g. LCArizona.";
  if (s.length > 40) return "Keep the short title to 40 characters or fewer.";
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(s)) return "Use letters, digits and hyphens only in the short title (no spaces or underscores).";
  return null;
}

// The name for the next render: one past the highest version so far.
export function nextFileName(video: Pick<Doc<"videos">, "number" | "shortTitle">, highestVersion: number) {
  if (!video.number || !video.shortTitle) return null;
  return `${pad5(video.number)}_${video.shortTitle}_v${highestVersion + 1}`;
}

// "00001_LCArizona_v4.mp4" → { number: 1, shortTitle: "LCArizona", version: 4 }. Loose on the extension and case.
export function parseRegisterName(fileName: string): { number: number; shortTitle: string; version: number | null } | null {
  const base = fileName.replace(/\.[A-Za-z0-9]{2,4}$/, "");
  const m = /^(\d{5})_([A-Za-z0-9-]+?)(?:_[vV](\d{1,4}))?$/.exec(base);
  if (m) return { number: Number(m[1]), shortTitle: m[2], version: m[3] ? Number(m[3]) : null };
  const n = /^(\d{5})_/.exec(base);
  return n ? { number: Number(n[1]), shortTitle: "", version: null } : null;
}

export async function highestVersion(ctx: QueryCtx, videoId: Id<"videos">) {
  const versions = await ctx.db.query("versions").withIndex("by_video", (q) => q.eq("videoId", videoId)).collect();
  return versions.reduce((m, x) => Math.max(m, x.number), 0);
}

export async function videoByNumber(ctx: QueryCtx, number: number) {
  return await ctx.db.query("videos").withIndex("by_number", (q) => q.eq("number", number)).first();
}

// Hands out the next number. The counter only goes up, so a deleted video's number is never given out again.
export async function takeNumber(ctx: MutationCtx): Promise<number> {
  const row = await ctx.db.query("counters").withIndex("by_key", (q) => q.eq("key", "videoNumber")).first();
  let next = row?.value ?? 1;
  // Never hand out a number that's already on a video (e.g. one numbered by hand).
  while (await videoByNumber(ctx, next)) next++;
  if (row) await ctx.db.patch(row._id, { value: next + 1 });
  else await ctx.db.insert("counters", { key: "videoNumber", value: next + 1 });
  return next;
}

// Every new video goes through here, so every video from now on is in the register.
export async function insertVideo(ctx: MutationCtx, a: { projectId: Id<"projects">; title: string; shortTitle?: string }) {
  const now = Date.now();
  const shortTitle = (a.shortTitle?.trim() || shortTitleFrom(a.title)) || "Video";
  const number = await takeNumber(ctx);
  const videoId = await ctx.db.insert("videos", { projectId: a.projectId, title: a.title, number, shortTitle, createdAt: now, updatedAt: now });
  return { videoId, number, shortTitle, fileName: `${pad5(number)}_${shortTitle}_v1` };
}
