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
  // R3: a review render plays its own file; its thumbnail comes with the scrub copy. C3: every link under `media`.
  const thumbUrl = v.source === "file" ? (v.scrub ? mediaUrl(v.bunnyGuid || "g-fire", "thumbnail.jpg") : null) : mediaUrl(v.bunnyGuid, "thumbnail.jpg");
  const media = v.source === "file"
    ? { hls: null, mp4: {}, file: v.fileUrl, scrub: v.scrub, thumb: thumbUrl }
    : { hls: mediaUrl(v.bunnyGuid, "playlist.m3u8"), mp4: Object.fromEntries((v.mp4Heights as number[]).map((h) => [h, mediaUrl(v.bunnyGuid, `play_${h}p.mp4`)])), file: null, scrub: null, thumb: thumbUrl };
  return { ...v, thumbUrl, media };
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
  { _id: "n2", versionId: "ver1b", videoId: "v1", kind: "frame", inFrame: 400, drawFrame: 400, drawing, text: "Light in the top right pulls the eye. Can we knock it down in the grade?", status: "open", authorName: "Heston", visibility: "shared", createdAt: now - 8 * min, replies: [{ _id: "r1", noteId: "n2", text: "Pulled the window down 0.6 stops in the grade; the eye stays on her now.", authorName: "Claude", createdAt: now - 5 * min, hidden: true }], still: mediaUrl("g-river", "thumbnail.jpg") },
  { _id: "n6", versionId: "ver1b", videoId: "v1", kind: "frame", inFrame: 980, text: "Love this shot. Can it hold a beat longer before the cut?", status: "open", authorName: "Maya Chen", visibility: "shared", createdAt: now - 3 * min, replies: [{ _id: "r2", noteId: "n6", text: "Yes, I'll give it 8 more frames in v3.", authorName: "Heston", createdAt: now - 2 * min }] },
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
        latest: l && { number: l.number, status: l.status, bunnyGuid: l.bunnyGuid, thumbUrl: l.thumbUrl, isFile: l.source === "file", encodeProgress: l.encodeProgress, frameCount: l.frameCount, fpsNum: l.fpsNum, fpsDen: l.fpsDen, startTimecode: l.startTimecode, width: l.width, height: l.height, transcript: l.number === 2 ? "running" : "done",
          download: l.status === "ready" ? { url: l.media.file ?? l.media.mp4[1080] ?? null, name: l.fileName.replace(/\.[^.]+$/, ".mp4"), bytes: l.fileSize ?? null } : null },
      };
    }),
    clients: [...madeClients].sort((a, b) => a.localeCompare(b)),
  };
}
function video(id: string, share?: { token: string; guestName?: string }) {
  const v = videos.find((x) => x._id === id);
  if (!v) return null;
  const p = projects.find((x) => x._id === v.projectId)!;
  const sh = share ? demoShare(share.token) : null;
  const can = sh ? sh.access : "owner";
  return {
    _id: v._id, title: v.title, number: v.number ?? null, shortTitle: sh ? null : v.shortTitle ?? null, nextFileName: sh ? null : nextName(v), final: v.final ?? null,
    project: { _id: p._id, name: p.name, jobNumber: p.jobNumber },
    versions: (versions[id] ?? []).filter((x) => !sh || x.status === "ready").map((x) => ({ ...x, noteCount: notes.filter((n) => n.versionId === x._id).length, openCount: notes.filter((n) => n.versionId === x._id && n.status === "open").length })),
    can, viewer: sh ? (sh.who === "invited" ? { kind: "client", name: "Maya Chen" } : { kind: "guest", name: share?.guestName ?? "Someone" }) : { kind: "owner", name: "Heston" }, downloads: sh ? sh.downloads : true,
  };
}
// Demo share links: ?view / ?comment / ?invited / ?passcode in the token pick the kind; anything else is a plain comment link.
function demoShare(token: string) {
  const t = token.toLowerCase();
  if (t === "off") return null;
  return { access: t.includes("view") ? "view" : "comment", who: t.includes("invited") ? "invited" : "link", downloads: t.includes("dl"), passcode: t.includes("pass") };
}
let demoPasscodeOk = false;
function openShare(token: string, passcode?: string) {
  const t = token.toLowerCase();
  if (t === "missing") return { state: "missing", label: null };
  if (t === "off") return { state: "off", label: "Brand Film" };
  if (t === "expired") return { state: "expired", label: "Harbor Coffee" };
  if (t === "signin") return { state: "signin", label: "Harbor Coffee" };
  if (t === "notinvited") return { state: "notInvited", label: "Harbor Coffee" };
  const sh = demoShare(token)!;
  if (sh.passcode && !demoPasscodeOk) { if (!passcode) return { state: "passcode", label: "Brand Film" }; if (passcode !== "coffee") return { state: "wrongPasscode", label: "Brand Film" }; demoPasscodeOk = true; }
  const kind = t.includes("client") ? "client" : t.includes("project") ? "project" : "video";
  const ps = kind === "client" ? projects.filter((p) => p.client === "Harbor Coffee") : kind === "project" ? projects.filter((p) => p._id === "p1") : projects.filter((p) => p._id === "p1");
  const vids = videos.filter((v) => (kind === "video" ? v._id === "v1" : ps.some((p) => p._id === v.projectId))).map((v) => ({
    _id: v._id, title: v.title, number: v.number ?? null, projectId: v.projectId, updatedAt: v.updatedAt,
    versions: (versions[v._id] ?? []).filter((x) => x.status === "ready").map((x) => ({ _id: x._id, number: x.number, frameCount: x.frameCount, fpsNum: x.fpsNum, fpsDen: x.fpsDen, startTimecode: x.startTimecode, width: x.width, height: x.height, createdAt: x.createdAt, description: x.description, thumbUrl: x.thumbUrl,
      download: sh.downloads ? { url: x.media.file ?? x.media.mp4[1080] ?? null, name: x.fileName.replace(/\.[^.]+$/, ".mp4"), bytes: x.fileSize ?? null } : null })),
  })).filter((v) => v.versions.length);
  return { state: "ok", token, kind, label: kind === "client" ? "Harbor Coffee" : kind === "project" ? "26201 Harbor Coffee Launch" : "Brand Film", sub: kind === "video" ? "26201 Harbor Coffee Launch" : null, access: sh.access, who: sh.who, allVersions: true, downloads: sh.downloads, expiresAt: null,
    guest: sh.who !== "invited", viewer: sh.who === "invited" ? { kind: "client", name: "Maya Chen", email: "maya@harborcoffee.example" } : null, client: "Harbor Coffee",
    projects: ps.map((p) => ({ _id: p._id, name: p.name, jobNumber: p.jobNumber, client: p.client })), videos: vids };
}
const pad5 = (n: number) => String(n).padStart(5, "0");
function nextName(v: any) {
  if (!v.number) return null;
  const top = (versions[v._id] ?? []).reduce((m: number, x: any) => Math.max(m, x.number), 0);
  return `${pad5(v.number)}_${v.shortTitle}_v${top + 1}`;
}
let nextNumber = 4;
let prefs: Record<string, unknown> = {};
const mkShare = (o: Partial<any>) => ({
  _id: "s" + Math.random().toString(36).slice(2, 8), token: "demo" + Math.random().toString(36).slice(2, 10), kind: "video", client: null, projectId: null, videoId: null,
  label: "Brand Film", sub: "26201 Harbor Coffee Launch", gone: false, access: "comment", who: "link", allVersions: true, downloads: false, emailNewVersions: true,
  expiresAt: null, hasPasscode: false, createdAt: Date.now(), offAt: null, state: "on", lastOpenedAt: null, openCount: 0, people: [], ...o,
  get url() { return `https://review.wranglerportal.com/s/${this.token}`; },
});
let shares: any[] = [
  mkShare({ _id: "s1", kind: "client", client: "Harbor Coffee", label: "Harbor Coffee", sub: null, who: "invited", people: [{ email: "maya@harborcoffee.example", name: "Maya Chen", hasAccount: true, invited: true, emailedAt: Date.now() - 3 * 86_400_000 }], createdAt: Date.now() - 3 * 86_400_000, lastOpenedAt: Date.now() - 5 * 3_600_000, openCount: 4 }),
  mkShare({ _id: "s2", kind: "video", videoId: "v1", label: "Brand Film", sub: "26201 Harbor Coffee Launch", access: "view", hasPasscode: true, expiresAt: Date.now() + 9 * 86_400_000, createdAt: Date.now() - 86_400_000, lastOpenedAt: Date.now() - 40 * 60_000, openCount: 1 }),
  mkShare({ _id: "s3", kind: "project", projectId: "p2", label: "26205 Northline Fall Campaign", sub: "Northline Outfitters", who: "invited", people: [{ email: "dan@fairgroundsfit.example", name: null, hasAccount: false, invited: true, emailedAt: Date.now() - 3_600_000 }], createdAt: Date.now() - 3_600_000, state: "off", offAt: Date.now() - 600_000 }),
];
let shareActivity: any[] = [
  { _id: "a1", kind: "viewed", who: "Maya Chen · maya@harborcoffee.example", at: Date.now() - 5 * 3_600_000, videoId: "v1", videoTitle: "Brand Film", noteId: null },
  { _id: "a2", kind: "opened", who: "Maya Chen · maya@harborcoffee.example", at: Date.now() - 5 * 3_600_000 - 60_000, videoId: null, videoTitle: null, noteId: null },
  { _id: "a3", kind: "opened", who: "Pat (guest)", at: Date.now() - 40 * 60_000, videoId: null, videoTitle: null, noteId: null },
];
let invites: any[] = [
  { _id: "i1", email: "maya@harborcoffee.example", name: "Maya Chen", createdAt: Date.now() - 3 * 86_400_000, revokedAt: null, acceptedAt: Date.now() - 2 * 86_400_000, lastSignInAt: Date.now() - 5 * 3_600_000, emails: { versionsOff: false, repliesOff: true } },
  { _id: "i2", email: "dan@fairgroundsfit.example", name: null, createdAt: Date.now() - 3_600_000, revokedAt: null, acceptedAt: null, lastSignInAt: null, emails: { versionsOff: false, repliesOff: false } },
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

// ---------- Wrangler Sign (S1) ----------
// One draft with no boxes yet (the page finds the markers in mock/sign-sample.pdf) and one approved document.
const signSvg = (t: string, size: number) => "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${t.length * size * 0.5}" height="${size * 1.4}"><text x="4" y="${size}" font-family="cursive" font-size="${size}" fill="#121e5a">${t}</text></svg>`);
let signSig: any = new URLSearchParams(location.search).has("nosig") ? null : { name: "Heston Hill", title: "Founder", method: "typed", adoptedAt: now - 2 * 86_400_000, signatureSha256: "9f2c4b1e7a6d3c5b8e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d", signatureUrl: signSvg("Heston Hill", 48), initialsUrl: signSvg("HH", 40) };
let signDocs: any[] = [
  { _id: "wd1", number: 1, title: "Sample Service Agreement", status: "draft", currentVersion: 1, createdAt: now - 20 * min, updatedAt: now - 20 * min },
  { _id: "wd2", number: 2, title: "Harbor Coffee — Brand Film", status: "approved", currentVersion: 1, createdAt: now - 2 * 86_400_000, updatedAt: now - 3 * hr },
];
const pages2 = [{ width: 612, height: 792, rotate: 0 }, { width: 612, height: 792, rotate: 0 }];
let signVers: any[] = [
  { _id: "wv1", documentId: "wd1", number: 1, fileName: "Sample_Service_Agreement.pdf", fileSha256: "4c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d", fileBytes: 4073, pages: pages2, signers: [{ key: "client", name: "", email: "", order: 1 }], boxes: [], signingOrder: "any", createdAt: now - 20 * min, updatedAt: now - 20 * min },
  { _id: "wv2", documentId: "wd2", number: 1, fileName: "Harbor_Brand_Film_Agreement.pdf", fileSha256: "a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2", fileBytes: 4073, pages: pages2,
    signers: [{ key: "heston", name: "Heston Hill", email: "heston@wranglerproductions.com", title: "Founder", order: 1 }, { key: "client", name: "Maya Chen", email: "maya@harborcoffee.example", title: "Marketing Director", order: 1 }],
    boxes: [{ id: "x1", signer: "client", kind: "initials", page: 0, x: 0.17, y: 0.205, w: 0.09, h: 0.025 }, { id: "x2", signer: "client", kind: "sign", page: 1, x: 0.22, y: 0.62, w: 0.29, h: 0.04 }, { id: "x3", signer: "heston", kind: "sign", page: 1, x: 0.38, y: 0.68, w: 0.29, h: 0.04 }],
    signingOrder: "any", payment: { amountCents: 120000, description: "Deposit — Harbor Coffee brand film" }, approvedAt: now - 3 * hr, lockHash: "e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6", createdAt: now - 2 * 86_400_000, updatedAt: now - 3 * hr },
];
const signLabel = (n: number) => `WS-${String(n).padStart(5, "0")}`;
function signGet(documentId: string, versionNumber?: number) {
  const doc = signDocs.find((d) => d._id === documentId); if (!doc) return null;
  const vs = signVers.filter((v) => v.documentId === documentId);
  const v = vs.find((x) => x.number === (versionNumber ?? doc.currentVersion)) ?? vs.find((x) => x.number === doc.currentVersion);
  const events = [{ seq: 1, at: doc.createdAt, kind: "created", actor: "heston", versionNumber: 1, detail: `Uploaded "${v.fileName}" (2 pages), SHA-256 ${v.fileSha256}`, email: null, ip: null },
    ...(v.approvedAt ? [{ seq: 2, at: v.approvedAt, kind: "approved", actor: "heston", versionNumber: 1, detail: `Version 1 approved and locked. Lock hash ${v.lockHash}.`, email: null, ip: null }] : [])];
  const clients = v.signers.filter((s: any) => s.key !== "heston");
  const problems = v.approvedAt ? [] : [...(clients.some((s: any) => !s.name) ? ["Signer \"client\" needs a name."] : []), ...(clients.some((s: any) => !s.email) ? ["Signer \"client\" needs a valid email."] : [])];
  return {
    doc: { ...doc, label: signLabel(doc.number) },
    version: { ...v, fileUrl: "/mock/sign-sample.pdf", isCurrent: v.number === doc.currentVersion, editable: v.number === doc.currentVersion && !v.approvedAt && doc.status === "draft" },
    versions: vs.map((x) => ({ number: x.number, fileName: x.fileName, fileSha256: x.fileSha256, approvedAt: x.approvedAt ?? null, lockHash: x.lockHash ?? null, ownerSignedAt: null, createdAt: x.createdAt })),
    events, chain: { ok: true, count: events.length },
    owner: { email: "heston@wranglerproductions.com", name: signSig?.name ?? null, title: signSig?.title ?? null, adopted: !!signSig },
    problems,
  };
}

export const store = {
  subscribe: (l: () => void) => { subs.add(l); return () => subs.delete(l); },
  version: () => ver,
  query(name: string, args: any): any {
    switch (name) {
      case "users:me": return new URLSearchParams(location.search).has("asclient")
        ? { id: "u2", email: "maya@harborcoffee.example", name: "Maya Chen", allowed: false, role: "client" }
        : { id: "u1", email: "heston@wranglerproductions.com", name: "Heston", allowed: true, role: "owner" };
      case "clients:listInvites": return invites;
      case "shares:list": return shares;
      case "shares:forTarget": return shares.filter((x) => args.target.kind === x.kind && (x.kind === "client" ? x.client === args.target.client : x.kind === "project" ? x.projectId === args.target.projectId : x.videoId === args.target.videoId));
      case "shares:coveringVideo": return shares.filter((x) => x.videoId === args.videoId || x.kind === "client");
      case "shares:activity": return args.shareId === "s1" ? shareActivity : args.shareId === "s2" ? shareActivity.slice(2) : [];
      case "clients:account": return { email: "heston@wranglerproductions.com", name: "Heston", kind: "owner" };
      case "library:overview": return overview();
      case "sign:list": return signDocs.map((d) => { const v = signVers.find((x) => x.documentId === d._id && x.number === d.currentVersion); return { _id: d._id, label: signLabel(d.number), title: d.title, status: d.status, version: d.currentVersion, updatedAt: d.updatedAt, createdAt: d.createdAt, signers: v.signers.filter((s: any) => s.key !== "heston").map((s: any) => s.name || s.email || s.key), pages: v.pages.length, approved: !!v.approvedAt }; });
      case "sign:get": return signGet(args.documentId, args.versionNumber);
      case "sign:ownerSignature": return signSig ? { adopted: true, email: "heston@wranglerproductions.com", ...signSig } : { adopted: false, email: "heston@wranglerproductions.com" };
      case "library:video": return video(args.videoId, args.share);
      case "shares:open": return openShare(args.token, args.passcode);
      case "shares:mine": return [
        { token: "invitedclient", kind: "client", label: "Harbor Coffee", sub: null, access: "comment", client: "Harbor Coffee", createdAt: Date.now() - 86_400_000,
          videos: videos.filter((v) => v.projectId === "p1").map((v) => ({ _id: v._id, title: v.title, number: v.number ?? null, projectId: v.projectId, project: "26201 Harbor Coffee Launch", client: "Harbor Coffee", updatedAt: v.updatedAt, latest: (versions[v._id] ?? []).length, versions: (versions[v._id] ?? []).length, thumbUrl: (versions[v._id] ?? [])[0]?.thumbUrl ?? null })) },
      ];
      case "notes:forVersion": {
        const sh = args.share ? demoShare(args.share.token) : null;
        return notes.filter((n) => n.versionId === args.versionId).filter((n) => !sh || n.visibility === "shared").map((n) => ({ ...(n.voice ? { ...n, voiceUrl: null } : n), visibility: n.visibility ?? "private", mine: sh ? n.authorName?.includes("(guest)") || n.authorName === "Maya Chen" : true }));
      }
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
    if (name === "notes:create" && args.share) {
      const sh = demoShare(args.share.token)!;
      const id = "n" + Date.now();
      notes = [...notes, { _id: id, versionId: args.versionId, videoId: "v1", kind: args.kind, inFrame: args.inFrame, outFrame: args.outFrame, drawFrame: args.drawFrame, drawing: args.drawing, text: args.text, still: args.still, status: "open", authorName: sh.who === "invited" ? "Maya Chen" : `${args.share.guestName} (guest)`, visibility: "shared", createdAt: Date.now(), replies: [] }];
      bump(); return id;
    }
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
    if (name === "shares:create") {
      const t = args.target;
      const label = t.kind === "client" ? t.client : t.kind === "project" ? (projects.find((p) => p._id === t.projectId)?.name ?? "Project") : (videos.find((x) => x._id === t.videoId)?.title ?? "Video");
      const s = mkShare({ kind: t.kind, client: t.client ?? null, projectId: t.projectId ?? null, videoId: t.videoId ?? null, label, sub: null, access: args.access, who: args.who, allVersions: args.allVersions, downloads: args.downloads, emailNewVersions: args.emailNewVersions, expiresAt: args.expiresAt ?? null, hasPasscode: !!args.passcode,
        people: (args.emails ?? []).map((e: string) => ({ email: e.toLowerCase(), name: null, hasAccount: false, invited: true, emailedAt: Date.now() })) });
      shares = [s, ...shares]; bump();
      return { shareId: s._id, token: s.token, url: s.url, added: (args.emails ?? []).map((e: string) => e.toLowerCase()) };
    }
    if (name === "shares:touch") return { recorded: true, state: "ok" };
    if (name === "shares:unlock") { if (args.passcode === "coffee") { demoPasscodeOk = true; return { state: "ok", proof: "demo-proof" }; } return { state: "wrong" }; }
    if (name === "notes:setVisibility") { const n = notes.find((x) => x._id === args.noteId); if (n) n.visibility = args.visibility; bump(); return; }
    if (name === "notes:setReplyHidden") { for (const n of notes) for (const r of n.replies ?? []) if (r._id === args.replyId) r.hidden = args.hidden; bump(); return; }
    if (name === "shares:setOff") { shares = shares.map((x) => (x._id === args.shareId ? { ...x, state: args.off ? "off" : "on", offAt: args.off ? Date.now() : null, get url() { return `https://review.wranglerportal.com/s/${this.token}`; } } : x)); bump(); return; }
    if (name === "shares:remove") { shares = shares.filter((x) => x._id !== args.shareId); bump(); return; }
    if (name === "shares:update") { shares = shares.map((x) => (x._id === args.shareId ? { ...x, ...Object.fromEntries(Object.entries(args).filter(([k, v]) => k !== "shareId" && k !== "passcode" && v !== undefined)), hasPasscode: args.passcode === undefined ? x.hasPasscode : !!args.passcode, get url() { return `https://review.wranglerportal.com/s/${this.token}`; } } : x)); bump(); return; }
    if (name === "shares:addMember") { shares = shares.map((x) => (x._id === args.shareId ? { ...x, people: [...x.people, { email: args.email.toLowerCase(), name: null, hasAccount: false, invited: true, emailedAt: Date.now() }], get url() { return `https://review.wranglerportal.com/s/${this.token}`; } } : x)); bump(); return { email: args.email.toLowerCase() }; }
    if (name === "shares:removeMember") { shares = shares.map((x) => (x._id === args.shareId ? { ...x, people: x.people.filter((p: any) => p.email !== args.email), get url() { return `https://review.wranglerportal.com/s/${this.token}`; } } : x)); bump(); return; }
    if (name === "clients:invite") {
      const email = String(args.email).trim().toLowerCase();
      const ex = invites.find((i) => i.email === email && !i.revokedAt);
      if (ex) return { inviteId: ex._id, already: true };
      invites = [{ _id: "i" + Date.now(), email, name: args.name ?? null, createdAt: Date.now(), revokedAt: null, acceptedAt: null, lastSignInAt: null, emails: { versionsOff: false, repliesOff: false } }, ...invites]; bump();
      return { inviteId: "x", already: false };
    }
    if (name === "clients:revokeInvite") { invites = invites.map((i) => (i._id === args.inviteId ? { ...i, revokedAt: Date.now() } : i)); bump(); return; }
    if (name === "connector:revokeKey") { keys = keys.filter((k) => k._id !== args.keyId); bump(); return; }
    if (name === "library:createClient") {
      const n = String(args.name).trim();
      if (madeClients.concat(projects.map((p) => p.client ?? "")).some((c) => c.toLowerCase() === n.toLowerCase())) throw new Error(`There's already a client called ${n}.`);
      madeClients = [...madeClients, n]; bump(); return n;
    }
    if (name === "sign:saveLayout") { const v = signVers.find((x) => x._id === args.versionId); Object.assign(v, { signers: args.signers, boxes: args.boxes, signingOrder: args.signingOrder, payment: args.payment ?? undefined, updatedAt: Date.now() }); const d = signDocs.find((x) => x._id === v.documentId); d.title = args.title; d.updatedAt = Date.now(); bump(); return null; }
    if (name === "sign:approve") { const v = signVers.find((x) => x._id === args.versionId); v.approvedAt = Date.now(); v.lockHash = "1f2e3d4c5b6a79880716253443526170819a2b3c4d5e6f708192a3b4c5d6e7f8"; signDocs.find((x) => x._id === v.documentId).status = "approved"; bump(); return { lockHash: v.lockHash }; }
    if (name === "sign:uploadUrl") return "mock://upload";
    if (name === "library:deleteVideos") { for (const id of args.videoIds) { const i = videos.findIndex((v) => v._id === id); if (i >= 0) videos.splice(i, 1); } bump(); return { deleted: args.videoIds.length }; }
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
