// The drop folder rule (Heston, Oct 20: one folder per video, inside the app's own folder; Oct 21: an optional
// client level above the project):
//   /<Project>/<Video>/<any file name>           →  the next version of <Video> in <Project>
//   /<Client>/<Project>/<Video>/<any file name>  →  the same, with the project filed under <Client>
// Paths here are relative to the app folder (Dropbox reports them that way for app-folder apps).

export const VIDEO_EXTS = ["mp4", "mov", "m4v", "mxf", "mkv", "webm", "avi"];
const INDEXED = ["mp4", "mov", "m4v"]; // formats whose finished state we can check (their index is written last)

export type DropPlace =
  | { ok: true; client?: string; project: string; video: string; fileName: string; ext: string; checkIndex: boolean }
  | { ok: false; reason: string; ignore?: boolean };

export function placeFor(pathDisplay: string): DropPlace {
  const parts = pathDisplay.split("/").filter(Boolean);
  const fileName = parts[parts.length - 1] ?? "";
  if (!fileName || fileName.startsWith(".") || fileName.startsWith("~") || /\.(tmp|part|partial)$/i.test(fileName)) {
    return { ok: false, reason: "Hidden or temporary file.", ignore: true };
  }
  const ext = (fileName.split(".").pop() ?? "").toLowerCase();
  if (!VIDEO_EXTS.includes(ext)) return { ok: false, reason: `Not a video file (.${ext}).`, ignore: true };
  if (parts.length !== 3 && parts.length !== 4) {
    return { ok: false, reason: "Put renders in a <Client>/<Project>/<Video>/ or <Project>/<Video>/ folder inside Apps/Wrangler Review, e.g. ICG/26122 Spirit Days/Spirit Intro/." };
  }
  const [client, project, video] = parts.length === 4 ? [parts[0].trim(), parts[1].trim(), parts[2].trim()] : [undefined, parts[0].trim(), parts[1].trim()];
  if (!project || !video || client === "") return { ok: false, reason: "The client, project and video folders need names." };
  return { ok: true, ...(client ? { client } : {}), project, video, fileName, ext, checkIndex: INDEXED.includes(ext) };
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

// Picks the project for a drop. With a client folder: a matching project already filed under that client wins,
// then one with no client yet (it gets filed under this client); a same-named project under a different client
// doesn't count. Without a client folder: any matching project.
export function pickProject<P extends { name: string; jobNumber?: string; client?: string }>(projects: P[], folder: string, client?: string): { project: P; setClient: boolean } | null {
  const matches = projects.filter((p) => projectMatches(folder, p));
  if (!client) return matches[0] ? { project: matches[0], setClient: false } : null;
  const c = client.trim().toLowerCase();
  const same = matches.find((p) => (p.client ?? "").trim().toLowerCase() === c);
  if (same) return { project: same, setClient: false };
  const none = matches.find((p) => !p.client?.trim());
  if (none) return { project: none, setClient: true };
  return null;
}
