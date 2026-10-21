// Sample data for the screenshot harness and the demo artifact. Mutations change it so the pages react like the real thing.
// Every client, project and note here is made up.
import { mediaUrl } from "../src/config";
/* eslint-disable @typescript-eslint/no-explicit-any */
const now = Date.now();
const min = 60_000, hr = 3_600_000, day = 86_400_000;

type Ver = any;
const fps = { fpsNum: 24000, fpsDen: 1001 };
const mk = (o: any): Ver => ({
  status: "ready", encodeProgress: 100, ...fps, frameCountExact: true, width: 1920, height: 1080, startTimecode: "01:00:00:00",
  mp4Heights: [240, 360, 480, 720, 1080], error: null, description: null, uploaderName: "Heston", fileSize: 812_000_000, ...o,
});

const projects = [
  { _id: "p1", name: "Harbor Coffee Launch", jobNumber: "26201", client: "Harbor Coffee", createdAt: now - 20 * day },
  { _id: "p2", name: "Northline Fall Campaign", jobNumber: "26205", client: "Northline Outfitters", createdAt: now - 9 * day },
  { _id: "p3", name: "Wrangler Reel 2026", jobNumber: null, client: null, createdAt: now - 40 * day },
];
const videos: any[] = [
  { _id: "v1", projectId: "p1", title: "Brand Film", createdAt: now - 3 * day, updatedAt: now - 12 * min, lastOpenedAt: now - 3 * min },
  { _id: "v2", projectId: "p1", title: "Opening Weekend Recap", createdAt: now - 2 * day, updatedAt: now - 10 * hr, lastOpenedAt: now - 10 * hr },
  { _id: "v3", projectId: "p2", title: "Fall Teaser", createdAt: now - 20 * min, updatedAt: now - 20 * min, lastOpenedAt: null },
  { _id: "v4", projectId: "p3", title: "Barcode frame test", createdAt: now - 6 * day, updatedAt: now - 6 * day, lastOpenedAt: now - 5 * day },
  { _id: "v5", projectId: "p3", title: "Reel cutdown 9x16", createdAt: now - 12 * day, updatedAt: now - 12 * day, lastOpenedAt: null },
];
const versions: Record<string, Ver[]> = {
  v1: [
    mk({ _id: "ver1a", number: 1, bunnyGuid: "g-river", fileName: "26201_BrandFilm_v1.mov", frameCount: 3149, createdAt: now - 3 * day, description: null }),
    mk({ _id: "ver1b", number: 2, bunnyGuid: "g-river", fileName: "26201_BrandFilm_v2_Final.mov", frameCount: 3149, createdAt: now - 12 * min, description: "Tighter open, new music bed, fixed the lower third." }),
  ],
  v2: [mk({ _id: "ver2a", number: 1, bunnyGuid: "g-fire", fileName: "26201_OpeningWeekend_v1.mp4", frameCount: 2280, createdAt: now - 10 * hr })],
  v3: [mk({ _id: "ver3a", number: 1, bunnyGuid: "g-int", fileName: "26205_FallTeaser_v1.mov", frameCount: null, status: "processing", encodeProgress: 45, createdAt: now - 20 * min })],
  v4: [mk({ _id: "ver4a", number: 1, bunnyGuid: "g-barcode", fileName: "frametest_23976_h264.mp4", frameCount: 480, createdAt: now - 6 * day, fileSize: 6_000_000 })],
  v5: [mk({ _id: "ver5a", number: 1, bunnyGuid: "g-int", fileName: "Reel_9x16.mp4", frameCount: 1440, createdAt: now - 12 * day, width: 1080, height: 1920 })],
};
const drawing = { shapes: [{ t: "ellipse", x1: 0.56, y1: 0.18, x2: 0.8, y2: 0.52, c: "#ff3b30", w: 0.006 }, { t: "arrow", x1: 0.34, y1: 0.7, x2: 0.54, y2: 0.45, c: "#ff3b30", w: 0.006 }] };
let notes: any[] = [
  { _id: "n1", versionId: "ver1b", videoId: "v1", kind: "general", text: "Music bed is a touch loud under the VO the whole way. Pull it 3 dB.", status: "open", authorName: "Heston", createdAt: now - 9 * min, replies: [] },
  { _id: "n2", versionId: "ver1b", videoId: "v1", kind: "frame", inFrame: 400, drawFrame: 400, drawing, text: "Light in the top right pulls the eye. Can we knock it down in the grade?", status: "open", authorName: "Heston", createdAt: now - 8 * min, replies: [], still: mediaUrl("g-river", "thumbnail.jpg") },
  { _id: "n3", versionId: "ver1b", videoId: "v1", kind: "range", inFrame: 626, outFrame: 932, text: "This section drags. Lose about a second and a half, keep the river shot.", status: "open", authorName: "Heston", createdAt: now - 7 * min, replies: [{ _id: "r1", noteId: "n3", text: "Trimmed in v3, trying it at 1:00:39.", authorName: "Heston", createdAt: now - 2 * min }] },
  { _id: "n4", versionId: "ver1b", videoId: "v1", kind: "frame", inFrame: 1712, text: "Lower third typo: Saturday.", status: "done", authorName: "Heston", createdAt: now - 6 * min, doneAt: now - 1 * min, replies: [] },
  { _id: "n5", versionId: "ver1a", videoId: "v1", kind: "frame", inFrame: 12, text: "Open on the wide, not the close-up.", status: "done", authorName: "Heston", createdAt: now - 2 * day, replies: [] },
];

let madeClients: string[] = ["Prairie Fitness"]; // made with "New client", no projects yet

// Made-up waveform peaks (20 a second): a music bed with talking over it in places.
const waves = new Map<string, ArrayBuffer>();
function fakeWave(id: string, frames: number) {
  if (waves.has(id)) return waves.get(id)!;
  const n = Math.max(1, Math.round((frames * 1001) / 24000 * 20));
  const out = new Uint8Array(n);
  let seed = id.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let i = 0; i < n; i++) {
    const t = i / 20, talk = Math.sin(t * 0.35) > 0.1;
    const bed = 0.25 + 0.08 * Math.sin(t * 1.3) + 0.1 * rnd();
    const v = talk ? Math.max(bed, Math.max(0, Math.sin(t * 13.5)) * (0.5 + 0.45 * rnd())) : bed;
    out[i] = Math.round(255 * Math.min(1, v * Math.min(1, t / 2, (n / 20 - t) / 3)));
  }
  waves.set(id, out.buffer);
  return out.buffer;
}

let ver = 0;
const subs = new Set<() => void>();
const bump = () => { ver++; subs.forEach((l) => l()); };

function latestOf(id: string) { const vs = versions[id] ?? []; return vs[vs.length - 1] ?? null; }
function overview() {
  return {
    projects: projects.map((p) => {
      const vs = videos.filter((x) => x.projectId === p._id);
      return { ...p, videoCount: vs.length, updatedAt: Math.max(p.createdAt, ...vs.map((x) => x.updatedAt)) };
    }),
    videos: videos.map((x) => {
      const l = latestOf(x._id);
      return {
        ...x, versionCount: (versions[x._id] ?? []).length, noteCount: notes.filter((n) => n.videoId === x._id).length,
        openNotes: l ? notes.filter((n) => n.versionId === l._id && n.status === "open").length : 0,
        latest: l && { number: l.number, status: l.status, bunnyGuid: l.bunnyGuid, encodeProgress: l.encodeProgress, frameCount: l.frameCount, fpsNum: l.fpsNum, fpsDen: l.fpsDen, startTimecode: l.startTimecode, width: l.width, height: l.height, transcript: l.number === 2 ? "running" : "done" },
      };
    }),
    clients: [...madeClients].sort((a, b) => a.localeCompare(b)),
  };
}
function video(id: string) {
  const v = videos.find((x) => x._id === id);
  if (!v) return null;
  const p = projects.find((x) => x._id === v.projectId)!;
  return {
    _id: v._id, title: v.title, project: { _id: p._id, name: p.name, jobNumber: p.jobNumber },
    versions: (versions[id] ?? []).map((x) => ({ ...x, noteCount: notes.filter((n) => n.versionId === x._id).length, openCount: notes.filter((n) => n.versionId === x._id && n.status === "open").length })),
  };
}
function feed() {
  const info = (verId: string) => {
    for (const [vid, vs] of Object.entries(versions)) for (const x of vs) if (x._id === verId) {
      const v = videos.find((y) => y._id === vid)!;
      return { versionId: x._id, videoId: vid, videoTitle: v.title, projectName: projects.find((p) => p._id === v.projectId)!.name, number: x.number, bunnyGuid: x.bunnyGuid, status: x.status, frameCount: x.frameCount, fpsNum: x.fpsNum, fpsDen: x.fpsDen, startTimecode: x.startTimecode };
    }
    return null;
  };
  const ev: any[] = [];
  for (const vs of Object.values(versions)) for (const x of vs) ev.push({ type: "version", at: x.createdAt, actor: x.uploaderName, version: info(x._id) });
  const groups = new Map<string, any>();
  for (const n of [...notes].sort((a, b) => b.createdAt - a.createdAt)) {
    const g = groups.get(n.versionId) ?? { type: "notes", at: n.createdAt, actor: n.authorName, version: info(n.versionId), notes: [] };
    g.notes.push({ _id: n._id, kind: n.kind, inFrame: n.inFrame ?? null, outFrame: n.outFrame ?? null, text: n.text, hasDrawing: !!n.drawing, still: n.still ?? null, status: n.status, createdAt: n.createdAt });
    groups.set(n.versionId, g);
  }
  for (const g of groups.values()) { g.notes.sort((a: any, b: any) => (a.inFrame ?? -1) - (b.inFrame ?? -1)); ev.push(g); }
  return ev.sort((a, b) => b.at - a.at);
}

let keys: any[] = [{ _id: "k1", prefix: "wr_Q2xhdWR", label: "Claude", createdAt: Date.now() - 86_400_000 * 2, lastUsedAt: Date.now() - 3_600_000 }];

export const store = {
  subscribe: (l: () => void) => { subs.add(l); return () => subs.delete(l); },
  version: () => ver,
  query(name: string, args: any): any {
    switch (name) {
      case "users:me": return { id: "u1", email: "heston@wranglerproductions.com", name: "Heston", allowed: true };
      case "library:overview": return overview();
      case "library:video": return video(args.videoId);
      case "notes:forVersion": return notes.filter((n) => n.versionId === args.versionId).map((n) => (n.voice ? { ...n, voiceUrl: null } : n));
      case "activity:feed": return feed().slice(0, args.limit ?? 60);
      case "connector:listKeys": return keys;
      case "dropbox:status": return { configured: true, transcripts: true, connected: true, email: "heston@wranglerproductions.com", name: "Heston Hill", connectedAt: Date.now() - 86_400_000, lastSyncAt: Date.now() - 40_000, lastError: null,
        recent: [
          { _id: "d1", path: "/Harbor Coffee/26201 Harbor Coffee Launch/Brand Film/26201_BrandFilm_v3.mov", status: "waiting", reason: "Waiting for the file to finish.", at: Date.now() - 30_000, size: 1, videoId: null, versionNumber: null, linkGone: true },
          { _id: "d2", path: "/Harbor Coffee/26201 Harbor Coffee Launch/Brand Film/26201_BrandFilm_v2_Final.mov", status: "imported", reason: null, at: Date.now() - 3_600_000, size: 1, videoId: videos[0]?._id ?? null, versionNumber: 2, linkGone: true },
          { _id: "d3", path: "/loose render.mp4", status: "skipped", reason: "Put renders in a <Project>/<Video>/ folder inside Apps/Wrangler Review, e.g. 26201 Harbor Coffee Launch/Brand Film/.", at: Date.now() - 7_200_000, size: 1, videoId: null, versionNumber: null, linkGone: true },
        ] };
      case "transcripts:forVersion": return { status: "done", language: "eng", wordCount: 40, error: null, updatedAt: Date.now(), url: "./mock-transcript.json" };
      case "waveforms:forVersion": {
        const v = Object.values(versions).flat().find((x) => x._id === args.versionId);
        if (!v || v.status !== "ready" || !v.frameCount) return { status: "pending", rate: null, seconds: null, peaks: null };
        if (v.bunnyGuid === "g-barcode") return { status: "none", rate: null, seconds: null, peaks: null };
        return { status: "done", rate: 20, seconds: (v.frameCount * 1001) / 24000, peaks: fakeWave(v._id, v.frameCount) };
      }
      default: console.warn("mock query", name); return null;
    }
  },
  async mutation(name: string, args: any): Promise<any> {
    if (name === "notes:create") {
      const id = "n" + Math.random().toString(36).slice(2, 7);
      const v = Object.entries(versions).find(([, vs]) => vs.some((x) => x._id === args.versionId))![0];
      notes = [...notes, { _id: id, videoId: v, status: "open", authorName: "Heston", createdAt: Date.now(), replies: [], ...args }];
      (window as any).__lastNote = notes[notes.length - 1];
      bump(); return id;
    }
    if (name === "notes:setStatus") { notes = notes.map((n) => n._id === args.noteId ? { ...n, status: args.status } : n); bump(); return; }
    if (name === "notes:remove") { notes = notes.filter((n) => n._id !== args.noteId); bump(); return; }
    if (name === "notes:reply") { notes = notes.map((n) => n._id === args.noteId ? { ...n, replies: [...n.replies, { _id: "r" + Date.now(), noteId: n._id, text: args.text, authorName: "Heston", createdAt: Date.now() }] } : n); bump(); return; }
    if (name === "notes:editText") { notes = notes.map((n) => n._id === args.noteId ? { ...n, text: args.text } : n); bump(); return; }
    if (name === "library:markOpened") { const v = videos.find((x) => x._id === args.videoId); if (v) v.lastOpenedAt = Date.now(); bump(); return; }
    if (name === "library:reportFrameCount") return;
    if (name === "notes:voiceUploadUrl") return "/mock-upload";
    if (name === "notes:discardVoice") { (window as any).__discarded = args.storageId; return; }
    if (name === "connector:revokeKey") { keys = keys.filter((k) => k._id !== args.keyId); bump(); return; }
    if (name === "library:createClient") {
      const n = String(args.name).trim();
      if (madeClients.concat(projects.map((p) => p.client ?? "")).some((c) => c.toLowerCase() === n.toLowerCase())) throw new Error(`There's already a client called ${n}.`);
      madeClients = [...madeClients, n]; bump(); return n;
    }
    if (name === "library:deleteClient") { madeClients = madeClients.filter((c) => c !== args.client); bump(); return { projects: 0, videos: 0 }; }
    bump();
  },
  async action(name: string, args: any): Promise<any> {
    if (name === "stills:upload") return `data:${args.contentType};base64,${args.dataBase64}`;
    if (name === "uploads:startUpload") throw new Error("Uploads are off in this demo.");
    if (name === "dropbox:authUrl") throw new Error("Connecting Dropbox is off in this demo.");
    if (name === "transcribe:voiceWords") {
      (window as any).__voiceMime = args.mime;
      return { language: "eng", words: [
        { text: "Make", start: 0.1, end: 0.3 }, { text: "this", start: 0.35, end: 0.6 }, { text: "brighter,", start: 0.65, end: 1.0 },
        { text: "and", start: 1.1, end: 1.2 }, { text: "trim", start: 1.25, end: 1.45 }, { text: "here.", start: 1.6, end: 1.9 },
      ] };
    }
    if (name === "connector:createKey") {
      const key = "wr_" + "MockKeyForScreenshotsOnly0123456789abcdefgh";
      keys = [{ _id: "k" + Date.now(), prefix: key.slice(0, 10), label: "Claude", createdAt: Date.now(), lastUsedAt: null }, ...keys]; bump();
      return { key, prefix: key.slice(0, 10) };
    }
    return null;
  },
};
