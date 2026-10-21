// The drop folder rule (Heston, Oct 20: one folder per video, inside the app's own folder):
//   /<Project>/<Video>/<any file name>  →  the next version of <Video> in <Project>.
// Paths here are relative to the app folder (Dropbox reports them that way for app-folder apps).

export const VIDEO_EXTS = ["mp4", "mov", "m4v", "mxf", "mkv", "webm", "avi"];
const INDEXED = ["mp4", "mov", "m4v"]; // formats whose finished state we can check (their index is written last)

export type DropPlace =
  | { ok: true; project: string; video: string; fileName: string; ext: string; checkIndex: boolean }
  | { ok: false; reason: string; ignore?: boolean };

export function placeFor(pathDisplay: string): DropPlace {
  const parts = pathDisplay.split("/").filter(Boolean);
  const fileName = parts[parts.length - 1] ?? "";
  if (!fileName || fileName.startsWith(".") || fileName.startsWith("~") || /\.(tmp|part|partial)$/i.test(fileName)) {
    return { ok: false, reason: "Hidden or temporary file.", ignore: true };
  }
  const ext = (fileName.split(".").pop() ?? "").toLowerCase();
  if (!VIDEO_EXTS.includes(ext)) return { ok: false, reason: `Not a video file (.${ext}).`, ignore: true };
  if (parts.length !== 3) {
    return { ok: false, reason: "Put renders in a <Project>/<Video>/ folder inside Apps/Wrangler Review, e.g. 26122 Spirit Days/Spirit Intro/." };
  }
  const project = parts[0].trim(), video = parts[1].trim();
  if (!project || !video) return { ok: false, reason: "The project and video folders need names." };
  return { ok: true, project, video, fileName, ext, checkIndex: INDEXED.includes(ext) };
}

// "26122 Spirit Days" → job 26122, name "Spirit Days". Anything else is just a name.
export function splitJob(folder: string): { jobNumber?: string; name: string } {
  const m = /^(\d{4,6})[\s_\-–—.]+(.+)$/.exec(folder.trim());
  return m ? { jobNumber: m[1], name: m[2].trim() } : { name: folder.trim() };
}

// Does a project folder name refer to this project? Matches "Name", "26122 Name", "26122_Name" or just "26122".
export function projectMatches(folder: string, p: { name: string; jobNumber?: string }) {
  const f = folder.trim().toLowerCase().replace(/[\s_\-–—.]+/g, " ");
  const n = p.name.trim().toLowerCase().replace(/[\s_\-–—.]+/g, " ");
  if (f === n) return true;
  if (p.jobNumber) {
    const j = p.jobNumber.toLowerCase();
    if (f === j || f === `${j} ${n}`) return true;
  }
  return false;
}

// Dropbox share link → direct download link (dl=1 keeps the rlkey on new-style links).
export function directLink(url: string) {
  const u = new URL(url);
  u.searchParams.set("dl", "1");
  return u.toString();
}
