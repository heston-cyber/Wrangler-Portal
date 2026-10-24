// The drop folder rule. Since R3 (Oct 22) the file NAME decides the video: NNNNN_ShortTitle_vN.mp4 is version N of
// register number NNNNN, in any folder inside Apps/Wrangler Review. Any other name is flagged on the Register page,
// never guessed. (Before that, Oct 20–22, the folder decided: /<Client>/<Project>/<Video>/<any file name>.)
// Paths here are relative to the app folder (Dropbox reports them that way for app-folder apps).
// Top-level folders whose names start with "_" are ignored (scratch space, e.g. _tests/r1/ for format tests).
//
// C7 (Oct 24): folders make projects. Two fixed folders at the top:
//   Clients/<Client>/<Project>/   → the client and the project (made the minute the folder appears, even empty)
//   Projects/<Project>/           → a project with no client
// Anything deeper is the editor's own tidiness; anything else at the top level is left alone. A project folder named
// "26122 Spirit Days" gives job 26122. The file name still decides the video (the number wins over the folder).

export const VIDEO_EXTS = ["mp4", "mov", "m4v", "mxf", "mkv", "webm", "avi"];
const INDEXED = ["mp4", "mov", "m4v"]; // formats whose finished state we can check (their index is written last)

export type RegisterName = { number: number; shortTitle: string; version: number | null };
export type FolderPlace =
  | { kind: "client"; client: string; folder: string }
  | { kind: "project"; project: string; client?: string; folder: string; clientFolder?: string };

/** What a folder (or the folder a file sits in) means under the Clients/ and Projects/ rule, by its path_lower. */
export function folderPlace(pathLower: string, pathDisplay?: string): FolderPlace | null {
  const low = pathLower.split("/").filter(Boolean);
  const disp = (pathDisplay ?? pathLower).split("/").filter(Boolean);
  if (low.length < 2 || disp.length !== low.length) return null;
  const at = (n: number) => "/" + low.slice(0, n).join("/");
  if (low[0] === "clients") {
    if (low.length === 2) return { kind: "client", client: disp[1].trim(), folder: at(2) };
    return { kind: "project", client: disp[1].trim(), project: disp[2].trim(), folder: at(3), clientFolder: at(2) };
  }
  if (low[0] === "projects") return { kind: "project", project: disp[1].trim(), folder: at(2) };
  return null;
}

/** The project folder a file sits in (the folder's own place), or null when it isn't under Clients/ or Projects/. */
export function projectFolderOf(pathLower: string, pathDisplay?: string): Extract<FolderPlace, { kind: "project" }> | null {
  const low = pathLower.split("/").filter(Boolean);
  const want = low[0] === "clients" ? 3 : low[0] === "projects" ? 2 : 0;
  if (!want || low.length <= want) return null; // the file itself is one deeper than the project folder
  const disp = (pathDisplay ?? pathLower).split("/").filter(Boolean);
  const p = folderPlace("/" + low.slice(0, want).join("/"), "/" + disp.slice(0, want).join("/"));
  return p && p.kind === "project" ? p : null;
}
export type DropPlace =
  | { ok: true; client?: string; project: string; video: string; fileName: string; ext: string; checkIndex: boolean; register?: RegisterName }
  | { ok: false; reason: string; ignore?: boolean };

// "00001_LCArizona_v4.mp4" → { number: 1, shortTitle: "LCArizona", version: 4 } (R3: register names). Null otherwise.
export function registerName(fileName: string): RegisterName | null {
  const base = fileName.replace(/\.[A-Za-z0-9]{2,4}$/, "");
  const m = /^(\d{5})_([A-Za-z0-9][A-Za-z0-9-]*?)(?:_[vV](\d{1,4}))?$/.exec(base);
  return m ? { number: Number(m[1]), shortTitle: m[2], version: m[3] ? Number(m[3]) : null } : null;
}

export function placeFor(pathDisplay: string): DropPlace {
  const parts = pathDisplay.split("/").filter(Boolean);
  const fileName = parts[parts.length - 1] ?? "";
  if (!fileName || fileName.startsWith(".") || fileName.startsWith("~") || /\.(tmp|part|partial)$/i.test(fileName)) {
    return { ok: false, reason: "Hidden or temporary file.", ignore: true };
  }
  const ext = (fileName.split(".").pop() ?? "").toLowerCase();
  if (!VIDEO_EXTS.includes(ext)) return { ok: false, reason: `Not a video file (.${ext}).`, ignore: true };
  // A top-level folder starting with "_" (e.g. _tests) is scratch space the site leaves alone (Oct 22).
  if (parts.length > 1 && parts[0].trim().startsWith("_")) return { ok: false, reason: "Scratch folder (starts with _).", ignore: true };
  // R3: a register name (00001_Title_v4.mp4) decides the video by its number, in any folder.
  const reg = registerName(fileName);
  if (reg) {
    const folders = parts.slice(0, -1).map((x) => x.trim());
    const [client, project] = folders.length >= 2 ? [folders[0], folders[1]] : [undefined, folders[0] ?? ""];
    return { ok: true, ...(client ? { client } : {}), project, video: "", fileName, ext, checkIndex: INDEXED.includes(ext), register: reg };
  }
  // Not a register name: the import flags it (with how to fix it) instead of guessing a video from the folders.
  const folders = parts.slice(0, -1).map((x) => x.trim());
  return { ok: true, project: folders[folders.length - 1] ?? "", video: "", fileName, ext, checkIndex: INDEXED.includes(ext) };
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
