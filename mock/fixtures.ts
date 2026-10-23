// Sample data for the screenshot harness and the demo artifact. Mutations change it so the pages react like the real thing.
// Every client, project and note here is made up.
import { mediaUrl } from "../src/config";
/* eslint-disable @typescript-eslint/no-explicit-any */
const now = Date.now();
const min = 60_000, hr = 3_600_000, day = 86_400_000;

type Ver = any;
const fps = { fpsNum: 24000, fpsDen: 1001 };
const mk = (o: any): Ver => {
  const v = {
    status: "ready", encodeProgress: 100, ...fps, frameCountExact: true, width: 1920, height: 1080, startTimecode: "01:00:00:00",
    mp4Heights: [240, 360, 480, 720, 1080], error: null, description: null, uploaderName: "Heston", fileSize: 812_000_000, storageBytes: 1_240_000_000,
    source: "stream", fileUrl: null, scrub: null, scrubStatus: null, ...o,
  };
  // R3: a review render plays its own file; its thumbnail comes with the scrub copy.
  return { ...v, thumbUrl: v.source === "file" ? (v.scrub ? mediaUrl(v.bunnyGuid || "g-fire", "thumbnail.jpg") : null) : mediaUrl(v.bunnyGuid, "thumbnail.jpg") };
};

const projects = [
  { _id: "p1", name: "Harbor Coffee Launch", jobNumber: "26201", client: "Harbor Coffee", createdAt: now - 20 * day },
  { _id: "p2", name: "Northline Fall Campaign", jobNumber: "26205", client: "Northline Outfitters", createdAt: now - 9 * day },
  { _id: "p3", name: "Wrangler Reel 2026", jobNumber: null, client: null, createdAt: now - 40 * day },
];
const videos: any[] = [
  { _id: "v1", projectId: "p1", title: "Brand Film", number: 1, shortTitle: "BrandFilm", createdAt: now - 3 * day, updatedAt: now - 12 * min, lastOpenedAt: now - 3 * min },
  { _id: "v2", projectId: "p1", title: "Opening Weekend Recap", number: 2, shortTitle: "OpeningRecap", createdAt: now - 2 * day, updatedAt: now - 10 * hr, lastOpenedAt: now - 10 * hr },
  { _id: "v3", projectId: "p2", title: "Fall Teaser", number: 3, shortTitle: "FallTeaser", createdAt: now - 20 * min, updatedAt: now - 20 * min, lastOpenedAt: null },
  { _id: "v4", projectId: "p3", title: "Barcode frame test", createdAt: now - 6 * day, updatedAt: now - 6 * day, lastOpenedAt: now - 5 * day },
  { _id: "v5", projectId: "p3", title: "Reel cutdown 9x16", createdAt: now - 12 * day, updatedAt: now - 12 * day, lastOpenedAt: null },
];
const versions: Record<string, Ver[]> = {
  v1: [
    mk({ _id: "ver1a", number: 1, bunnyGuid: "g-river", fileName: "26201_BrandFilm_v1.mov", frameCount: 3149, createdAt: now - 3 * day, description: null }),
    mk({ _id: "ver1b", number: 2, bunnyGuid: "g-river", fileName: "26201_BrandFilm_v2_Final.mov", frameCount: 3149, createdAt: now - 12 * min, description: "Tighter open, new music bed, fixed the lower third." }),
  ],
  v2: [
    mk({ _id: "ver2a", number: 1, bunnyGuid: "g-fire", fileName: "26201_OpeningWeekend_v1.mp4", frameCount: 2280, createdAt: now - 10 * hr }),
    // R3: a review render from Dropbox, played as rendered, with its 360p scrub copy.
    mk({ _id: "ver2b", number: 2, bunnyGuid: "", source: "file", fileUrl: mediaUrl("g-fire", "play_1080p.mp4"), scrub: { mp4: mediaUrl("g-fire", "play_360p.mp4"), hls: mediaUrl("g-fire", "playlist.m3u8") }, scrubStatus: "ready", mp4Heights: [], fileName: "00002_OpeningRecap_v2.mp4", frameCount: 2280, createdAt: now - 25 * min, dropboxPath: "/Harbor Coffee/00002_OpeningRecap_v2.mp4", fileSize: 182_000_000, storageBytes: 188_000_000 }),
  ],
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
      const vs = versions[x._id] ?? [];
      return {
        ...x, shortTitle: x.shortTitle ?? null, number: x.number ?? null, final: x.final ?? null,
        firstUploadAt: vs.length ? Math.min(...vs.map((v: any) => v.createdAt)) : null,
        storageBytes: vs.length ? vs.reduce((m: number, v: any) => m + (v.storageBytes ?? 0), 0) : null,
        source: l ? (l.dropboxPath ? "Dropbox" : "Browser") : null,
        versionCount: vs.length, noteCount: notes.filter((n) => n.videoId === x._id).length,
        openNotes: l ? notes.filter((n) => n.versionId === l._id && n.status === "open").length : 0,
        latest: l && { number: l.number, status: l.status, bunnyGuid: l.bunnyGuid, thumbUrl: l.thumbUrl, isFile: l.source === "file", encodeProgress: l.encodeProgress, frameCount: l.frameCount, fpsNum: l.fpsNum, fpsDen: l.fpsDen, startTimecode: l.startTimecode, width: l.width, height: l.height, transcript: l.number === 2 ? "running" : "done" },
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
    _id: v._id, title: v.title, number: v.number ?? null, shortTitle: v.shortTitle ?? null, nextFileName: nextName(v), final: v.final ?? null,
    project: { _id: p._id, name: p.name, jobNumber: p.jobNumber },
    versions: (versions[id] ?? []).map((x) => ({ ...x, noteCount: notes.filter((n) => n.versionId === x._id).length, openCount: notes.filter((n) => n.versionId === x._id && n.status === "open").length })),
  };
}
const pad5 = (n: number) => String(n).padStart(5, "0");
function nextName(v: any) {
  if (!v.number) return null;
  const top = (versions[v._id] ?? []).reduce((m: number, x: any) => Math.max(m, x.number), 0);
  return `${pad5(v.number)}_${v.shortTitle}_v${top + 1}`;
}
let nextNumber = 4;
let prefs: Record<string, unknown> = {};
let invites: any[] = [
  { _id: "i1", email: "maya@harborcoffee.example", name: "Maya Chen", createdAt: Date.now() - 3 * 86_400_000, revokedAt: null, acceptedAt: Date.now() - 2 * 86_400_000, lastSignInAt: Date.now() - 5 * 3_600_000 },
  { _id: "i2", email: "dan@fairgroundsfit.example", name: null, createdAt: Date.now() - 3_600_000, revokedAt: null, acceptedAt: null, lastSignInAt: null },
];
let sheet: any = null;
function registerList() {
  const rows = videos.filter((v) => v.number).map((v) => {
    const p = projects.find((x) => x._id === v.projectId)!;
    const l = latestOf(v._id);
    const open = l ? notes.filter((n) => n.versionId === l._id && n.status === "open").length : 0;
    return {
      videoId: v._id, number: v.number, numberText: pad5(v.number), shortTitle: v.shortTitle, title: v.title, client: p.client, project: p.name, projectId: p._id, jobNumber: p.jobNumber,
      versions: (versions[v._id] ?? []).length, latest: l?.number ?? null, status: !l ? "Waiting for v1" : l.status === "ready" ? (open ? "Open notes" : "Ready") : "Converting",
      openNotes: open, createdAt: v.createdAt, lastActivity: v.updatedAt, nextFileName: nextName(v), link: "",
    };
  }).sort((a, b) => b.number - a.number);
  return { rows, unnumbered: videos.filter((v) => !v.number).length };
}
function feed() {
  const info = (verId: string) => {
    for (const [vid, vs] of Object.entries(versions)) for (const x of vs) if (x._id === verId) {
      const v = videos.find((y) => y._id === vid)!;
      return { versionId: x._id, videoId: vid, videoTitle: v.title, projectName: projects.find((p) => p._id === v.projectId)!.name, number: x.number, bunnyGuid: x.bunnyGuid, thumbUrl: x.thumbUrl, status: x.status, frameCount: x.frameCount, fpsNum: x.fpsNum, fpsDen: x.fpsDen, startTimecode: x.startTimecode };
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

let flagged: any[] = [
  { _id: "d3", path: "/loose render.mp4", reason: "Not a register name. Name it like 00002_Title_v1 (Register › New video gives the name), then save it again.", at: now - 2 * hr },
  { _id: "d5", path: "/Northline/00009_FallTeaser_v1.mp4", reason: "There's no video 00009 in the register. Add it with Register › New video, then save the render again with the name it gives.", at: now - 6 * min },
];
let keys: any[] = [{ _id: "k1", prefix: "wr_Q2xhdWR", label: "Claude", createdAt: Date.now() - 86_400_000 * 2, lastUsedAt: Date.now() - 3_600_000 }];

export const store = {
  subscribe: (l: () => void) => { subs.add(l); return () => subs.delete(l); },
  version: () => ver,
  query(name: string, args: any): any {
    switch (name) {
      case "users:me": return new URLSearchParams(location.search).has("asclient")
        ? { id: "u2", email: "maya@harborcoffee.example", name: "Maya Chen", allowed: false, role: "client" }
        : { id: "u1", email: "heston@wranglerproductions.com", name: "Heston", allowed: true, role: "owner" };
      case "clients:listInvites": return invites;
      case "clients:account": return { email: "heston@wranglerproductions.com", name: "Heston", kind: "owner" };
      case "library:overview": return overview();
      case "library:video": return video(args.videoId);
      case "notes:forVersion": return notes.filter((n) => n.versionId === args.versionId).map((n) => (n.voice ? { ...n, voiceUrl: null } : n));
      case "activity:feed": return feed().slice(0, args.limit ?? 60);
      case "connector:listKeys": return keys;
      case "register:list": return registerList();
      case "prefs:mine": return { ...prefs };
      case "register:sheetKey": return sheet;
      case "register:nextName": { const v = videos.find((x) => x._id === args.videoId); return v?.number ? { number: pad5(v.number), shortTitle: v.shortTitle, fileName: nextName(v) } : null; }
      case "dropbox:status": return { configured: true, transcripts: true, connected: true, email: "heston@wranglerproductions.com", name: "Heston Hill", connectedAt: Date.now() - 86_400_000, lastSyncAt: Date.now() - 40_000, lastError: null,
        recent: [
          { _id: "d1", path: "/Harbor Coffee/26201 Harbor Coffee Launch/Brand Film/26201_BrandFilm_v3.mov", status: "waiting", reason: "Waiting for the file to finish.", at: Date.now() - 30_000, size: 1, videoId: null, versionNumber: null, linkGone: true },
          { _id: "d2", path: "/Harbor Coffee/26201 Harbor Coffee Launch/Brand Film/26201_BrandFilm_v2_Final.mov", status: "imported", reason: null, at: Date.now() - 3_600_000, size: 1, videoId: videos[0]?._id ?? null, versionNumber: 2, linkGone: true },
          { _id: "d4", path: "/Harbor Coffee/00002_OpeningRecap_v2.mp4", status: "imported", reason: null, at: Date.now() - 25 * min, size: 1, videoId: "v2", versionNumber: 2, linkGone: true },
          { _id: "d3", path: "/loose render.mp4", status: "flagged", reason: "Not a register name. Name it like 00002_Title_v1 (Register › New video gives the name), then save it again.", at: Date.now() - 7_200_000, size: 1, videoId: null, versionNumber: null, linkGone: true },
        ] };
      case "dropbox:flagged": return flagged;
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
    if (name === "prefs:set") { prefs = { ...prefs, [args.key]: args.value }; bump(); return; }
    if (name === "library:approveFinal") {
      const vs = versions[args.videoId] ?? []; const deleted = vs.filter((x: any) => x.number !== args.keep).map((x: any) => x.number);
      const freed = vs.filter((x: any) => x.number !== args.keep).reduce((m: number, x: any) => m + (x.storageBytes ?? 0), 0);
      versions[args.videoId] = vs.filter((x: any) => x.number === args.keep);
      notes = notes.filter((n) => n.videoId !== args.videoId || versions[args.videoId].some((x: any) => x._id === n.versionId));
      const v = videos.find((x) => x._id === args.videoId); v.final = { version: args.keep, at: Date.now() }; v.updatedAt = Date.now(); bump();
      return { kept: args.keep, deleted, freedBytes: freed };
    }
    if (name === "library:clearFinal") { const v = videos.find((x) => x._id === args.videoId); v.final = null; bump(); return; }
    if (name === "register:newVideo") {
      let pid = args.projectId;
      if (!pid) { pid = "p" + Date.now(); projects.push({ _id: pid, name: args.projectName, jobNumber: args.jobNumber ?? null, client: args.client ?? null, createdAt: Date.now() }); }
      const id = "v" + Date.now(); const number = nextNumber++;
      videos.push({ _id: id, projectId: pid, title: args.title, number, shortTitle: args.shortTitle, createdAt: Date.now(), updatedAt: Date.now(), lastOpenedAt: null });
      bump();
      const p = projects.find((x) => x._id === pid)!;
      return { videoId: id, number, numberText: pad5(number), shortTitle: args.shortTitle, fileName: `${pad5(number)}_${args.shortTitle}_v1`, project: p.name, client: p.client, link: "" };
    }
    if (name === "register:addToRegister") { const v = videos.find((x) => x._id === args.videoId); const n = args.number ?? nextNumber++; v.number = n; v.shortTitle = args.shortTitle; bump(); return { number: pad5(n), title: v.title, next: nextName(v) }; }
    if (name === "register:setShortTitle") { const v = videos.find((x) => x._id === args.videoId); if (v) v.shortTitle = args.shortTitle; bump(); return; }
    if (name === "register:removeSheetKey") { sheet = null; bump(); return; }
    if (name === "dropbox:retryFlagged") { flagged = flagged.filter((f) => f._id !== args.fileId); bump(); return true; }
    if (name === "clients:invite") {
      const email = String(args.email).trim().toLowerCase();
      const ex = invites.find((i) => i.email === email && !i.revokedAt);
      if (ex) return { inviteId: ex._id, already: true };
      invites = [{ _id: "i" + Date.now(), email, name: args.name ?? null, createdAt: Date.now(), revokedAt: null, acceptedAt: null, lastSignInAt: null }, ...invites]; bump();
      return { inviteId: "x", already: false };
    }
    if (name === "clients:revokeInvite") { invites = invites.map((i) => (i._id === args.inviteId ? { ...i, revokedAt: Date.now() } : i)); bump(); return; }
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
    if (name === "register:makeSheetKey") { sheet = { prefix: "wrs_demo0", createdAt: Date.now(), lastUsedAt: null }; bump(); return { key: "wrs_demo0000000000000000000000000000" }; }
    if (name === "connector:createKey") {
      const key = "wr_" + "MockKeyForScreenshotsOnly0123456789abcdefgh";
      keys = [{ _id: "k" + Date.now(), prefix: key.slice(0, 10), label: "Claude", createdAt: Date.now(), lastUsedAt: null }, ...keys]; bump();
      return { key, prefix: key.slice(0, 10) };
    }
    return null;
  },
};
