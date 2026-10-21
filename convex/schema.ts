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
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_project", ["projectId"]),

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
    createdAt: v.number(),
    readyAt: v.optional(v.number()),
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
