import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

// Frames are always stored as integers counted from the first frame of the version (frame 0).
// Timecode is derived from frames + the version's start timecode, never from seconds.
export default defineSchema({
  ...authTables,

  projects: defineTable({
    name: v.string(),
    jobNumber: v.optional(v.string()),
    client: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_name", ["name"]),

  videos: defineTable({
    projectId: v.id("projects"),
    title: v.string(),
    // The register (Oct 22): every video made from now on gets a number (never reused) and a short title,
    // which make its file names: 00001_LCArizona_v4. Older videos may have neither.
    number: v.optional(v.number()),
    shortTitle: v.optional(v.string()),
    // Approve final (R2b): the version kept when the others were deleted. A later upload clears it.
    final: v.optional(v.object({ version: v.number(), at: v.number() })),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_project", ["projectId"]).index("by_number", ["number"]),

  // Settings that follow the account to every device (R2b: which details show in the library, Approve final on/off).
  userPrefs: defineTable({ userId: v.id("users"), key: v.string(), value: v.any(), updatedAt: v.number() }).index("by_user_key", ["userId", "key"]),

  // Counters that only go up (the next video number).
  counters: defineTable({ key: v.string(), value: v.number() }).index("by_key", ["key"]),

  // Read-only keys for the Google Sheet copy of the register. Only the hash is kept.
  sheetKeys: defineTable({ hash: v.string(), prefix: v.string(), createdAt: v.number(), lastUsedAt: v.optional(v.number()) }).index("by_hash", ["hash"]),

  versions: defineTable({
    videoId: v.id("videos"),
    number: v.number(), // 1, 2, 3...
    status: v.union(v.literal("uploading"), v.literal("processing"), v.literal("ready"), v.literal("failed")),
    bunnyGuid: v.string(),
    fileName: v.string(),
    fileSize: v.optional(v.number()),
    fpsNum: v.optional(v.number()), // 24000
    fpsDen: v.optional(v.number()), // 1001
    frameCount: v.optional(v.number()),
    frameCountFrom: v.optional(v.union(v.literal("file"), v.literal("player"))), // "file" = counted in the MP4, exact
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    lengthSeconds: v.optional(v.number()),
    startTimecode: v.string(), // "01:00:00:00" unless the render started elsewhere
    mp4Heights: v.optional(v.array(v.number())), // MP4 copies Bunny made, e.g. [240, 360, 720, 1080]
    encodeProgress: v.optional(v.number()),
    pollCount: v.optional(v.number()),
    error: v.optional(v.string()),
    description: v.optional(v.string()), // what changed in this version
    uploaderName: v.optional(v.string()),
    dropboxPath: v.optional(v.string()), // where the original lives, when it came from the Dropbox drop folder
    createdAt: v.number(),
    readyAt: v.optional(v.number()),
    // Oct 21 measurement: each change in what Bunny has made while converting (and for a few minutes after),
    // to see how much sooner the 1080p copy is usable than "ready". s = Bunny status, p = progress %,
    // res = the copies Bunny lists, mp4 = the MP4 copies that actually answer on the CDN.
    stages: v.optional(v.array(v.object({ t: v.number(), s: v.number(), p: v.number(), res: v.string(), mp4: v.array(v.number()) }))),
    // Oct 21: the 1080p file failed to play on some device, so every device opens this version on the stream.
    streamOnly: v.optional(v.boolean()),
    // Oct 22 (R2b): space this version uses on Bunny (Bunny's storageSize: the original plus its copies).
    storageBytes: v.optional(v.number()),
    storageCheckedAt: v.optional(v.number()),
  })
    .index("by_video", ["videoId", "number"])
    .index("by_guid", ["bunnyGuid"]),

  notes: defineTable({
    versionId: v.id("versions"),
    videoId: v.id("videos"),
    kind: v.union(v.literal("frame"), v.literal("range"), v.literal("general")),
    inFrame: v.optional(v.number()),
    outFrame: v.optional(v.number()), // inclusive last frame of a range
    drawFrame: v.optional(v.number()), // frame the drawing was made on
    text: v.string(),
    drawing: v.optional(v.any()), // { shapes: [...] } in 0-1 coordinates of the picture
    still: v.optional(v.string()), // URL: frame (with drawing if any)
    stillIn: v.optional(v.string()), // URL: first frame of a range
    stillOut: v.optional(v.string()), // URL: last frame of a range
    // Voice notes (Phase 3): the recording (private storage), each word pinned to the frame on screen when it was
    // said, and the pointing words ("this", "here"...) with a still of their frame.
    voice: v.optional(v.object({
      storageId: v.id("_storage"),
      mime: v.string(),
      durationMs: v.number(),
      language: v.optional(v.string()),
      played: v.boolean(), // the video was playing while you talked
      words: v.array(v.object({ t: v.string(), f: v.number(), s: v.number(), e: v.number() })),
      pointers: v.array(v.object({ word: v.string(), i: v.number(), f: v.number(), s: v.number(), still: v.optional(v.string()) })),
    })),
    status: v.union(v.literal("open"), v.literal("done")),
    authorName: v.string(),
    authorId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
    doneAt: v.optional(v.number()),
    notifiedAt: v.optional(v.number()),
  })
    .index("by_version", ["versionId"])
    .index("by_video", ["videoId"]),

  replies: defineTable({
    noteId: v.id("notes"),
    text: v.string(),
    authorName: v.string(),
    authorId: v.optional(v.id("users")),
    createdAt: v.number(),
  }).index("by_note", ["noteId"]),

  // When each person last opened each video (Home's "Last opened", the sidebar list).
  opens: defineTable({
    userId: v.id("users"),
    videoId: v.id("videos"),
    openedAt: v.number(),
  })
    .index("by_user", ["userId", "openedAt"])
    .index("by_user_video", ["userId", "videoId"]),

  // Keys for the Claude connector. Only a SHA-256 hash is stored; the key itself is shown once.
  connectorKeys: defineTable({
    hash: v.string(),
    prefix: v.string(), // first characters, to tell keys apart in Settings
    label: v.string(),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  }).index("by_hash", ["hash"]),

  // The connected Dropbox account (one row). Tokens never leave the backend.
  dropbox: defineTable({
    accountId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    refreshToken: v.string(),
    accessToken: v.optional(v.string()),
    accessExpiresAt: v.optional(v.number()),
    cursor: v.optional(v.string()),
    connectedAt: v.number(),
    lastSyncAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
  }),

  // One-time "state" values for the Connect Dropbox sign-in.
  oauthStates: defineTable({
    state: v.string(),
    userId: v.string(),
    createdAt: v.number(),
  }).index("by_state", ["state"]),

  // Every file seen in the drop folder, by path. A new revision of the same path is a new render.
  dropFiles: defineTable({
    pathLower: v.string(),
    pathDisplay: v.string(),
    rev: v.string(),
    size: v.number(),
    status: v.union(
      v.literal("waiting"),   // seen; waiting for it to finish uploading and stop changing
      v.literal("importing"), // being handed to Bunny
      v.literal("imported"),  // a version was made
      v.literal("skipped"),   // not a video, or not in <Project>/<Video>/
      v.literal("failed"),
      v.literal("existing"),  // was already there when Dropbox was connected
    ),
    reason: v.optional(v.string()),
    firstSeenAt: v.number(),
    lastChangeAt: v.number(),
    checks: v.number(),
    versionId: v.optional(v.id("versions")),
    shareUrl: v.optional(v.string()),
    linkRevokedAt: v.optional(v.number()),
    importedAt: v.optional(v.number()),
  })
    .index("by_path", ["pathLower"])
    .index("by_status", ["status"])
    .index("by_version", ["versionId"]),

  // What's said in each version, word by word, pinned to frames. The words themselves live in a JSON file in Convex storage.
  transcripts: defineTable({
    versionId: v.id("versions"),
    status: v.union(v.literal("pending"), v.literal("running"), v.literal("done"), v.literal("failed")),
    storageId: v.optional(v.id("_storage")),
    language: v.optional(v.string()),
    wordCount: v.optional(v.number()),
    segmentCount: v.optional(v.number()),
    model: v.optional(v.string()),
    error: v.optional(v.string()),
    attempts: v.number(),
    updatedAt: v.number(),
  }).index("by_version", ["versionId"]),

  // Each version's sound as waveform peaks (0–255, `rate` per second), for the timeline. Made from Bunny's smallest MP4.
  waveforms: defineTable({
    versionId: v.id("versions"),
    status: v.union(v.literal("pending"), v.literal("running"), v.literal("done"), v.literal("none"), v.literal("failed")),
    rate: v.optional(v.number()),
    seconds: v.optional(v.number()),
    peaks: v.optional(v.bytes()),
    error: v.optional(v.string()),
    attempts: v.number(),
    updatedAt: v.number(),
  }).index("by_version", ["versionId"]),

  // Clients made with "New client" before they have any projects. A client with projects is named on its projects.
  clients: defineTable({
    name: v.string(),
    createdAt: v.number(),
  }).index("by_name", ["name"]),

  // Playback problems the browser reported (Oct 21), so they can be diagnosed on devices Claude can't reach.
  playerLogs: defineTable({
    versionId: v.id("versions"),
    at: v.number(),
    kind: v.string(), // error, fallback, stall
    code: v.optional(v.number()),
    msg: v.optional(v.string()),
    t: v.optional(v.number()), // seconds into the video
    src: v.optional(v.string()), // file or stream
    ua: v.optional(v.string()),
  }).index("by_at", ["at"]),

  // Phase R1 (Oct 22): results from the review-format test page (lab/r1.html), posted with the test link's key.
  r1Results: defineTable({
    at: v.number(),
    device: v.string(),
    rows: v.string(), // JSON
  }),

  // Stills kept in Convex storage until Bunny Storage is set up.
  stillFiles: defineTable({
    storageId: v.id("_storage"),
    createdAt: v.number(),
  }),

  // Phase 0 only: results of the frame-accuracy test page (lab/frametest.html).
  phase0Runs: defineTable({
    createdAt: v.string(),
    label: v.string(),
    device: v.string(),
    browser: v.string(),
    source: v.string(),
    engine: v.string(),
    pass: v.boolean(),
    userAgent: v.string(),
    results: v.any(),
    misses: v.any(),
  }),
});
