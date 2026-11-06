import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

// Frames are always stored as integers counted from the first frame of the version (frame 0).
// Timecode is derived from frames + the version's start timecode, never from seconds.
// D149: an answer to a quote or proposal. Name always; email and company when given (a copied link asks for both).
const responseV = v.object({
  kind: v.union(v.literal("accepted"), v.literal("declined")), name: v.string(), email: v.optional(v.string()), company: v.optional(v.string()),
  reason: v.optional(v.string()), at: v.number(), ip: v.optional(v.string()), userAgent: v.optional(v.string()), via: v.optional(v.union(v.literal("email"), v.literal("link"))),
});

export default defineSchema({
  ...authTables,
  // Client side (C1, Oct 23): the auth users table with a role. Owners are the ALLOWED_EMAILS list (Heston);
  // clients are people he invited. Anyone else can't make an account.
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    role: v.optional(v.union(v.literal("owner"), v.literal("client"), v.literal("vendor"), v.literal("guest"), v.literal("team"))), // Phase 5e (Nov 5): "team", a team member (lib/perms.ts) // Phase 3c: vendors (D94). Nov 2: for a client-and-vendor login, the side it's on now (users.switchSide). Phase 5b step 4 (D127): "guest", a call-sheet guest's code-only login: never an owner, client or vendor (lib/access.ts)
    lastSignInAt: v.optional(v.number()),
    tools: v.optional(v.any()),                // Nov 2: an owner's Settings › Tools (menu order, tools off the menu, Dashboard widgets; lib/tools.ts)
    passwordChangedAt: v.optional(v.number()),  // Phase 5e step 2: Settings › Security's "Last changed"
  }).index("email", ["email"]).index("phone", ["phone"]),
  // Emails allowed to make a client account. Made by the owner (the Share dialog in C2, or Settings › Clients).
  invites: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    email: v.string(),            // lower-case
    name: v.optional(v.string()), // what Heston calls them, shown until they set their own
    createdAt: v.number(),
    revokedAt: v.optional(v.number()),
    acceptedAt: v.optional(v.number()),
    userId: v.optional(v.id("users")),
  }).index("by_email", ["email"]),

  // Shares (client side C2, Oct 23): a link that lets someone outside see a client, a project or one video.
  // "link" shares open for anyone with the address (optionally behind a passcode); "invited" shares open only for
  // signed-in accounts whose email is on the share (shareMembers) and still invited. Off and expired are refused
  // the moment they happen. What a share covers is computed live (a new video under a shared project is covered).
  shares: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    token: v.string(), // the random part of review.wranglerportal.com/s/<token>
    kind: v.union(v.literal("client"), v.literal("project"), v.literal("video")),
    client: v.optional(v.string()),        // kind "client": the client name as filed on its projects
    clientId: v.optional(v.id("clients")),  // Phase 0.5d step 5: that client's record
    projectId: v.optional(v.id("projects")),
    videoId: v.optional(v.id("videos")),
    access: v.union(v.literal("view"), v.literal("comment")),
    who: v.union(v.literal("link"), v.literal("invited")),
    allVersions: v.boolean(),    // off = only the latest version
    downloads: v.boolean(),      // allow downloading the full-resolution file (C3; D152: the render or the original)
    emailNewVersions: v.boolean(), // email the people on it when a new version lands (C4)
    expiresAt: v.optional(v.number()),
    passcodeHash: v.optional(v.string()), // link shares only; SHA-256 of token + passcode
    createdAt: v.number(),
    createdBy: v.id("users"),
    offAt: v.optional(v.number()),
    lastOpenedAt: v.optional(v.number()),
    openCount: v.optional(v.number()),
    passFails: v.optional(v.number()),       // wrong passcodes in a row (security review, Oct 23)
    passLockedUntil: v.optional(v.number()), // no more tries until then
  }).index("by_token", ["token"]).index("by_video", ["videoId"]).index("by_project", ["projectId"]),

  // The emails on an invited share.
  shareMembers: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    shareId: v.id("shares"),
    email: v.string(), // lower-case
    addedAt: v.number(),
    emailedAt: v.optional(v.number()),
  }).index("by_share", ["shareId"]).index("by_email", ["email"]),

  // What happened on a share: opened, a video viewed, a note left (C3). `who` is a name or email, or "guest".
  shareActivity: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    shareId: v.id("shares"),
    kind: v.union(v.literal("opened"), v.literal("viewed"), v.literal("note")),
    who: v.string(),
    whoKey: v.optional(v.string()), // who, for telling people apart (guest browser key / user id); never shown
    videoId: v.optional(v.id("videos")),
    noteId: v.optional(v.id("notes")),
    at: v.number(),
  }).index("by_share", ["shareId", "at"]).index("by_at", ["at"]),

  // C9 (Oct 26): views. One row per sitting (a page load of a version by one person): how far they got and how much
  // they watched, from the player's heartbeat. The owner's own sittings are kept but never counted.
  views: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    videoId: v.id("videos"),
    versionId: v.id("versions"),
    shareId: v.optional(v.id("shares")),
    session: v.string(),          // random per page load, from the browser
    kind: v.union(v.literal("owner"), v.literal("client"), v.literal("guest")),
    who: v.string(),              // the name shown ("Pat (guest)")
    whoKey: v.string(),           // for telling people apart; never shown
    startedAt: v.number(),
    lastAt: v.number(),
    watchedSec: v.number(),       // seconds of playback seen (rewatching counts again)
    maxSec: v.number(),           // the furthest point reached
    lengthSec: v.number(),        // the version's length as the player saw it
    completed: v.boolean(),       // got within a few seconds of the end
  }).index("by_video", ["videoId", "lastAt"]).index("by_version", ["versionId", "lastAt"]).index("by_share", ["shareId", "lastAt"]).index("by_session", ["versionId", "session"]),

  // Emails (client side C4, Oct 23). Each address's "stop these" choices, with the random key its unsubscribe
  // links carry; and a log so each email goes out once (key = what it was about + who got it).
  emailPrefs: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    email: v.string(), // lower-case
    key: v.string(),
    versionsOff: v.optional(v.boolean()),
    repliesOff: v.optional(v.boolean()),
    notesOff: v.optional(v.boolean()), // Phase 1: notes from the business (missing = on unless both others are off)
    off: v.optional(v.array(v.string())), // Nov 2: every other switch this person turned off here (lib/notify.ts keys)
    updatedAt: v.number(),
  }).index("by_email", ["email"]).index("by_key", ["key"]),
  emailLog: defineTable({
    key: v.string(),
    kind: v.string(),
    to: v.string(),
    at: v.number(),
    resendId: v.optional(v.string()),
  }).index("by_key", ["key"]).index("by_at", ["at"]),

  // Per-hour counters for what commenters may do (security review, Oct 23).
  rateLimits: defineTable({ key: v.string(), count: v.number(), hour: v.number() }).index("by_key", ["key"]).index("by_hour", ["hour"]),

  projects: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    name: v.string(),
    ledgerExportedAt: v.optional(v.number()),   // Phase 3 (D58): included in the Settings Sheet's "Job ledger" tab
    jobNumber: v.optional(v.string()),
    client: v.optional(v.string()),
    clientId: v.optional(v.id("clients")), // Phase 0.5d step 5: the client's record (kept in step with `client`)
    createdAt: v.number(),
    // C7: the Dropbox folder that made or matched this project (path_lower, e.g. /clients/floor trader/backrooms).
    // A renamed folder renames the project; a deleted folder only clears this.
    dropboxFolder: v.optional(v.string()),
    // Phase 2 Part A (Oct 29): the project hub. Stage is the Wrangler Way (Discovery → Delivery); missing = Discovery.
    stage: v.optional(v.union(v.literal("discovery"), v.literal("strategy"), v.literal("production"), v.literal("polish"), v.literal("delivery"))),
    nextStep: v.optional(v.string()),
    keyDates: v.optional(v.array(v.object({ label: v.string(), date: v.string() }))), // date: YYYY-MM-DD
    rounds: v.optional(v.number()),              // rounds per video on this project (missing: the client's, then the business's)
    deliveryUnlockedAt: v.optional(v.number()),  // final files open to the client from here (Part B: when the final invoice is paid)
    deliveryFirstOpenedAt: v.optional(v.number()), // Phase 5 (D142): set the first time the files open, never cleared (Lock again doesn't reset it)
    deliveryLinkDays: v.optional(v.number()),    // how long download links work after unlock (missing: 7)
    updatedAt: v.optional(v.number()),
  }).index("by_name", ["name"]).index("by_dropbox_folder", ["dropboxFolder"]).index("by_client", ["clientId"]),

  // Phase 2 Part A (Oct 29): the final files of a project. Locked until the project's delivery is unlocked; then each
  // opens as a link that expires. A file is either in Dropbox (by path) or a version on the site.
  deliveryFiles: defineTable({
    businessId: v.optional(v.id("businesses")),
    projectId: v.id("projects"),
    name: v.string(),
    size: v.optional(v.number()),
    kind: v.union(v.literal("dropbox"), v.literal("version")),
    dropboxPath: v.optional(v.string()),   // path_lower
    versionId: v.optional(v.id("versions")),
    note: v.optional(v.string()),          // "ProRes 422 HQ", "From the site"
    createdAt: v.number(),
  }).index("by_project", ["projectId", "createdAt"]),

  videos: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
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
  counters: defineTable({ businessId: v.optional(v.id("businesses")), key: v.string(), value: v.number() }).index("by_key", ["key"]),

  // Read-only keys for the Google Sheet copy of the register. Only the hash is kept.
  sheetKeys: defineTable({ businessId: v.optional(v.id("businesses")), hash: v.string(), prefix: v.string(), createdAt: v.number(), lastUsedAt: v.optional(v.number()) }).index("by_hash", ["hash"]),

  versions: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
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
    // C8 (Oct 26): the preview picture — first non-black frame with the Wrangler wordmark, made in Heston's browser.
    // Used for link previews, the player's poster and list thumbnails.
    posterUrl: v.optional(v.string()),
    posterAt: v.optional(v.number()),
    // Oct 22 (R2b): space this version uses on Bunny (Bunny's storageSize: the original plus its copies).
    storageBytes: v.optional(v.number()),
    storageCheckedAt: v.optional(v.number()),
    // Render-to-review (R3, Oct 22): a review export is stored and played as it is ("file"); anything else is converted
    // by Bunny Stream as before ("stream", or missing). File versions have no bunnyGuid ("").
    source: v.optional(v.union(v.literal("stream"), v.literal("file"))),
    storagePath: v.optional(v.string()), // path in the Bunny Storage zone, e.g. review/<video>/<version>.mp4
    fileUrl: v.optional(v.string()), // the CDN address the player uses
    copyError: v.optional(v.string()),
    // The 360p scrub copy, made by the separate scrub library (BUNNY_SCRUB_*).
    scrubGuid: v.optional(v.string()),
    scrubStatus: v.optional(v.union(v.literal("pending"), v.literal("ready"), v.literal("failed"))),
    scrubPolls: v.optional(v.number()),
    scrubReadyAt: v.optional(v.number()),
    copyMs: v.optional(v.number()), // R3: how long the Dropbox → Bunny Storage copy took
    // Nov 4 (Heston): versions made since the 1080p / 4K quality choice. Older versions (no flag) play exactly as before.
    qualityMenu: v.optional(v.boolean()),
    // Nov 4: the MP4 copies the scrub library has made that answer on its CDN (360 for dragging; 1080 for a render
    // bigger than 1080p, which plays by default). File versions with qualityMenu only.
    scrubHeights: v.optional(v.array(v.number())),
  })
    .index("by_video", ["videoId", "number"])
    .index("by_guid", ["bunnyGuid"]),

  // Security review (Oct 27): recordings uploaded for voice notes. Only these storage ids can be attached to a note
  // or thrown away from the page, so a guest can't reach any other stored file (Sign PDFs, signatures).
  voiceUploads: defineTable({ businessId: v.optional(v.id("businesses")), storageId: v.id("_storage"), versionId: v.optional(v.id("versions")), createdAt: v.number() }).index("by_storage", ["storageId"]),
  notes: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
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
    // Client side (C3, Oct 23): who may see the note. Heston's notes are private unless he marks them Shared;
    // notes left through a share are shared. Missing = private (every note from before C3).
    visibility: v.optional(v.union(v.literal("private"), v.literal("shared"))),
    guestKey: v.optional(v.string()),       // a guest's browser id, so they can edit their own notes
    shareId: v.optional(v.id("shares")),    // the share the note came through
    alertedAt: v.optional(v.number()),      // C4: when Heston's email about this client/guest note went out
    authorKind: v.optional(v.union(v.literal("owner"), v.literal("client"), v.literal("guest"))), // set by the server, never the name
  })
    .index("by_version", ["versionId"])
    .index("by_video", ["videoId"]),

  replies: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    noteId: v.id("notes"),
    text: v.string(),
    authorName: v.string(),
    authorId: v.optional(v.id("users")),
    createdAt: v.number(),
    // C3: a reply others can't see even when the note is shared (Claude's connector replies, until Heston shows one).
    hidden: v.optional(v.boolean()),
    guestKey: v.optional(v.string()),
    authorKind: v.optional(v.union(v.literal("owner"), v.literal("client"), v.literal("guest"))),
  }).index("by_note", ["noteId"]),

  // When each person last opened each video (Home's "Last opened", the sidebar list).
  opens: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    userId: v.id("users"),
    videoId: v.id("videos"),
    openedAt: v.number(),
  })
    .index("by_user", ["userId", "openedAt"])
    .index("by_user_video", ["userId", "videoId"]),

  // Keys for the Claude connector. Only a SHA-256 hash is stored; the key itself is shown once.
  connectorKeys: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    hash: v.string(),
    prefix: v.string(), // first characters, to tell keys apart in Settings
    label: v.string(),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  }).index("by_hash", ["hash"]),

  // The connected Dropbox account (one row). Tokens never leave the backend.
  dropbox: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
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
    kind: v.optional(v.string()),              // Phase 4: "calendar" (Google); Dropbox's have none
    createdAt: v.number(),
  }).index("by_state", ["state"]),

  // Every file seen in the drop folder, by path. A new revision of the same path is a new render.
  dropFiles: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
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
      v.literal("flagged"),   // R3: its name needs fixing (unknown number, version already there, not a register name)
    ),
    reason: v.optional(v.string()),
    // C7: "Register & import" on a flagged file: the name the site gives it (the Dropbox file isn't renamed).
    registerAs: v.optional(v.object({ number: v.number(), shortTitle: v.string(), version: v.number() })),
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
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
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
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
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
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    name: v.string(),
    createdAt: v.number(),
    dropboxFolder: v.optional(v.string()), // C7: /clients/<name> when a folder made or matched it
    // Phase 0.5d step 5: made automatically because a project or share named this client (not shown as a
    // "New client" on its own); every client a project names now has a record, and projects link to it by id.
    fromProjects: v.optional(v.boolean()),
    rounds: v.optional(v.number()),          // Phase 2: rounds per video for this client's projects (missing: the business's)
    watermarkOff: v.optional(v.boolean()),   // Phase 2 (D24): review copies are watermarked unless switched off here
    subFailRule: v.optional(v.union(v.literal("past_due"), v.literal("cancel"))), // Phase 2b (D64): overrides the business's choice
    brandKit: v.optional(v.any()),           // Phase 3b (D71): the company's brand kit (convex/brandKit.ts)
  }).index("by_name", ["name"]).index("by_dropbox_folder", ["dropboxFolder"]),

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
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    storageId: v.id("_storage"),
    createdAt: v.number(),
  }),

  // ---------- Wrangler Sign (Phase S1, Oct 27) ----------
  // A document is a finished PDF Heston uploads to be signed. Every change after approval makes a new version; old
  // versions are kept, never overwritten. Boxes are where signatures, initials, names, dates and titles go, in
  // fractions of the page as displayed (see convex/lib/wsPdf.ts). Signer "heston" is Heston himself: his boxes are
  // filled with his adopted signature when the document is sent (S2).
  wsDocuments: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    number: v.number(),                 // WS-00001 …, from counters "wsNumber", never reused
    title: v.string(),
    status: v.union(v.literal("draft"), v.literal("approved"), v.literal("sent"), v.literal("completed"), v.literal("voided")),
    currentVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    // S2: sending
    sentAt: v.optional(v.number()),
    sentVersion: v.optional(v.number()),
    expiresAt: v.optional(v.number()),   // links stop working after this
    voidedAt: v.optional(v.number()),
    voidReason: v.optional(v.string()),
    completedAt: v.optional(v.number()), // every client signer has signed
    // S3: after everyone signs. Each step records its own result, so one failing doesn't stop the others and each
    // can be retried on its own.
    final: v.optional(v.object({ fileId: v.id("_storage"), sha256: v.string(), bytes: v.number(), fileName: v.string(), at: v.number() })),
    copies: v.optional(v.object({ status: v.union(v.literal("sent"), v.literal("partial"), v.literal("failed")), at: v.number(), sent: v.array(v.string()), failed: v.array(v.string()) })),
    invoice: v.optional(v.object({
      status: v.union(v.literal("created"), v.literal("none"), v.literal("failed")),
      at: v.number(), id: v.optional(v.string()), url: v.optional(v.string()), amountCents: v.optional(v.number()), livemode: v.optional(v.boolean()), error: v.optional(v.string()),
    })),
    archive: v.optional(v.object({
      status: v.union(v.literal("archived"), v.literal("waiting"), v.literal("failed")),
      at: v.number(), pdfPath: v.optional(v.string()), auditPath: v.optional(v.string()), verified: v.optional(v.boolean()), error: v.optional(v.string()),
    })),
    finishError: v.optional(v.string()), // the signed copy couldn't be made (shown to Heston with a Retry)
    hiddenAt: v.optional(v.number()),   // removed from the Docs list (Oct 27); the record is kept
    buildId: v.optional(v.id("wsBuilds")), // B2: made in the builder
    look: v.optional(v.object({ backdrop: v.string(), backdropImageId: v.optional(v.id("_storage")) })), // the signing page's background
  }).index("by_number", ["number"]).index("by_updated", ["updatedAt"]).index("by_final_sha", ["final.sha256"]),
  // B2–B3 (Oct 27): the doc builder. A build is the editable source of a document made from blocks (the blocks, the
  // fill-in fields and the style); "Continue to signing" renders it to a PDF, which becomes the document's version.
  // Blocks, fields and style are JSON shaped by src/builder/model.ts and checked there and in convex/builder.ts.
  wsBuilds: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    title: v.string(),
    blocks: v.any(),
    fields: v.any(),
    style: v.any(),
    signers: v.any(),                       // client signers (name, email, title) for when it's sent
    templateId: v.optional(v.id("wsTemplates")),
    kind: v.optional(v.union(v.literal("proposal"), v.literal("briefing"), v.literal("callsheet"))),  // Phase 3b: a proposal (Proposals); 3c: a briefing (D97); 5b: a call sheet. Never a contract; kept out of Docs
    documentId: v.optional(v.id("wsDocuments")), // set once it has gone to signing
    renderedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_updated", ["updatedAt"]).index("by_document", ["documentId"]),
  wsTemplates: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    name: v.string(),
    description: v.optional(v.string()),
    kind: v.optional(v.union(v.literal("proposal"), v.literal("briefing"), v.literal("callsheet"), v.literal("guide"))),  // a proposal, briefing, call-sheet or Help-guide template, kept apart from contract templates
    guideSlug: v.optional(v.string()),       // Phase 5d step 4: which of Wrangler's Help guides this business has edited
    blocks: v.any(),
    fields: v.any(),
    style: v.any(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_updated", ["updatedAt"]),
  wsClauses: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    title: v.string(),
    body: v.any(),                          // rich text (the builder's text JSON)
    initials: v.boolean(),                  // ask the client to initial it
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_updated", ["updatedAt"]),
  // Styles, like craft.do's: named looks (fonts, colours, background colour or image, logo, page layout), one marked
  // default for new docs; a doc or template keeps its own copy, so changing a style later doesn't change sent PDFs.
  wsStyles: defineTable({ businessId: v.optional(v.id("businesses")), name: v.string(), style: v.any(), isDefault: v.boolean(), createdAt: v.number(), updatedAt: v.number() }).index("by_updated", ["updatedAt"]),
  wsProfile: defineTable({ businessId: v.optional(v.id("businesses")), business: v.any(), updatedAt: v.number() }), // the business details documents start with
  wsFonts: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    family: v.string(),
    weight: v.number(),                     // 400, 700 …
    italic: v.boolean(),
    fileId: v.id("_storage"),
    fileName: v.string(),
    source: v.union(v.literal("upload"), v.literal("local"), v.literal("google")),
    createdAt: v.number(),
  }).index("by_family", ["family"]),
  // S4: keys for Wrangler Sign's own Claude connector (/ws-mcp), separate from Wrangler Review's. Hash only.
  wsConnectorKeys: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    hash: v.string(),
    prefix: v.string(),
    label: v.string(),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  }).index("by_hash", ["hash"]),
  // S3: the archive's own Dropbox app ("Wrangler Sign", App folder), separate from Wrangler Review's.
  wsDropbox: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    accountId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    refreshToken: v.string(),
    accessToken: v.optional(v.string()),
    accessExpiresAt: v.optional(v.number()),
    connectedAt: v.number(),
    lastError: v.optional(v.string()),
  }),
  // S2: one row per client signer of a sent version. The link is sign.wranglerportal.com/<token>; the email code
  // proves the signer controls the address it was sent to; a session (hash only) lets the page act after that.
  wsSignings: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    documentId: v.id("wsDocuments"),
    versionNumber: v.number(),
    signerKey: v.string(),
    name: v.string(),
    email: v.string(),
    title: v.optional(v.string()),
    order: v.number(),
    token: v.string(),
    status: v.union(v.literal("waiting"), v.literal("sent"), v.literal("signed"), v.literal("closed")),
    sentAt: v.optional(v.number()),
    lastEmailAt: v.optional(v.number()),
    openedAt: v.optional(v.number()),
    lastOpenEventAt: v.optional(v.number()),
    codeHash: v.optional(v.string()),
    codeExpiresAt: v.optional(v.number()),
    codeAttempts: v.optional(v.number()),
    codeSends: v.optional(v.array(v.number())),  // recent send times, for the rate limit
    failures: v.optional(v.array(v.number())),   // recent wrong codes
    failTotal: v.optional(v.number()),           // wrong codes over the link's whole life
    lockedUntil: v.optional(v.number()),
    verifiedAt: v.optional(v.number()),
    sessionHash: v.optional(v.string()),
    sessionExpiresAt: v.optional(v.number()),
    consentAt: v.optional(v.number()),
    consentVersion: v.optional(v.string()),
    viewedPages: v.optional(v.array(v.number())),
    adopted: v.optional(v.object({
      name: v.string(), title: v.optional(v.string()), method: v.union(v.literal("typed"), v.literal("drawn")),
      signatureFileId: v.id("_storage"), initialsFileId: v.id("_storage"), signatureSha256: v.string(), initialsSha256: v.string(), at: v.number(),
    })),
    initialed: v.optional(v.array(v.string())), // box ids
    signedAt: v.optional(v.number()),
    signedDate: v.optional(v.string()),           // the date written into date boxes, Central time
    signIp: v.optional(v.string()),
    signUserAgent: v.optional(v.string()),
  }).index("by_token", ["token"]).index("by_document", ["documentId", "versionNumber"]).index("by_email", ["email"]), // by_email: Phase 1, the client's Documents
  wsVersions: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    documentId: v.id("wsDocuments"),
    number: v.number(),
    fileId: v.id("_storage"),           // the PDF exactly as uploaded; never modified
    fileName: v.string(),
    fileSha256: v.string(),
    fileBytes: v.number(),
    pages: v.array(v.object({ width: v.number(), height: v.number(), rotate: v.number() })),
    hasTextLayer: v.optional(v.boolean()), // false: probably a scan, markers can't be found
    signers: v.array(v.object({
      key: v.string(),                  // "heston" or a client key ("client", "client2", …), as used in markers
      name: v.string(),
      email: v.string(),
      title: v.optional(v.string()),
      order: v.number(),                // 1, 2, … (used when signingOrder is "sequence")
    })),
    boxes: v.array(v.object({
      id: v.string(),
      signer: v.string(),
      kind: v.union(v.literal("sign"), v.literal("initials"), v.literal("name"), v.literal("date"), v.literal("title")),
      page: v.number(), x: v.number(), y: v.number(), w: v.number(), h: v.number(),
      cover: v.optional(v.object({ page: v.number(), x: v.number(), y: v.number(), w: v.number(), h: v.number() })),
      fromMarker: v.optional(v.boolean()),
    })),
    signingOrder: v.union(v.literal("any"), v.literal("sequence")),
    payment: v.optional(v.object({ amountCents: v.number(), description: v.string() })), // draft invoice on completion (S3)
    approvedAt: v.optional(v.number()),
    lockHash: v.optional(v.string()),   // SHA-256 over the file hash + layout + signers + payment, at approval
    ownerSignedAt: v.optional(v.number()),
    ownerSignatureId: v.optional(v.id("wsOwnerSignatures")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_document", ["documentId", "number"]),
  // The audit trail: append-only, one chain per document. hash = SHA-256(prevHash + this event's canonical JSON).
  wsEvents: defineTable({
    documentId: v.id("wsDocuments"),
    seq: v.number(),
    at: v.number(),
    kind: v.string(),
    actor: v.string(),                  // "heston", "claude", "signer:<key>", "system"
    versionNumber: v.optional(v.number()),
    email: v.optional(v.string()),
    ip: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    detail: v.optional(v.string()),
    prevHash: v.string(),
    hash: v.string(),
  }).index("by_document", ["documentId", "seq"]),
  // Security review (Oct 27): what Claude asked to do through the connector (approve, send, cancel). Nothing happens
  // until Heston confirms it on the document page, signed in; a request lasts a day.
  wsRequests: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    documentId: v.id("wsDocuments"),
    what: v.union(v.literal("approve"), v.literal("send"), v.literal("cancel")),
    versionNumber: v.number(),
    expiresInDays: v.optional(v.number()),
    reason: v.optional(v.string()),
    said: v.string(),                      // what Claude said Heston told it in chat
    status: v.union(v.literal("pending"), v.literal("done"), v.literal("declined"), v.literal("expired"), v.literal("replaced"), v.literal("failed"), v.literal("overtaken")),  // overtaken: Heston did it himself with the page's own buttons
    error: v.optional(v.string()),
    createdAt: v.number(),
    decidedAt: v.optional(v.number()),
  }).index("by_document", ["documentId", "status"]).index("by_status", ["status", "createdAt"]),
  // Heston's adopted signature. A new adoption replaces the old one (replacedAt); old ones are kept for the record.
  wsOwnerSignatures: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    name: v.string(),
    title: v.string(),
    method: v.union(v.literal("typed"), v.literal("drawn")),
    signatureFileId: v.id("_storage"),
    initialsFileId: v.id("_storage"),
    signatureSha256: v.string(),
    initialsSha256: v.string(),
    adoptedAt: v.number(),
    replacedAt: v.optional(v.number()),
  }).index("by_adopted", ["adoptedAt"]),

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

  // Wrangler Portal, Phase 0.5d step 1 (Oct 28): more than one business. Wrangler Productions is business #1
  // (slug "wrangler"). A membership ties a person (by email; their account once they have one) to a business with a
  // role. Step 1 only adds these; nothing reads a business yet except the access helpers, which pass it along.
  businesses: defineTable({
    slug: v.string(),               // short, unique, lower-case ("wrangler")
    name: v.string(),               // "Wrangler Productions"
    legalName: v.optional(v.string()), // "Wrangler Productions, a DBA of Hill Creative LLC"
    createdAt: v.number(),
    // Phase 1 (Oct 29): Business settings. The portal, its emails and the signing pages wear these.
    ownerName: v.optional(v.string()),     // "Heston Hill": who the emails say sent things
    emailFromName: v.optional(v.string()), // the From name on emails ("Wrangler Productions")
    replyTo: v.optional(v.string()),       // where clients' replies go (defaults to the owner's email)
    address: v.optional(v.string()),       // Oct 30: shown on invoices, receipts and email footers (Stripe requires it on receipts)
    privacyUrl: v.optional(v.string()),    // the privacy policy link, same places
    logoFileId: v.optional(v.id("_storage")), // shown in the portal and on emails
    logoLightFileId: v.optional(v.id("_storage")), // the same logo for light backgrounds (emails, PDFs); Settings › Business, Oct 29
    accent: v.optional(v.string()),        // #rrggbb
    background: v.optional(v.string()),    // #rrggbb
    // Which modules the business uses. Menu items only show when on (and only once something is in them).
    modules: v.optional(v.object({ review: v.boolean(), docs: v.boolean(), payments: v.boolean(), projects: v.optional(v.boolean()) })),
    teamRoles: v.optional(v.any()), // Phase 5e: each role's switches (Settings › Team › Roles; lib/perms.ts rolePerms)
    updatedAt: v.optional(v.number()),
    // Phase 2 Part A (Oct 29): revision rounds (each version is a round, D23; default 2, D23b) and the watermark look
    // on review copies (D24: on for every client unless switched off on the client).
    roundsDefault: v.optional(v.number()),
    roundsOff: v.optional(v.boolean()), // revision rounds switched off for the whole business
    watermark: v.optional(v.object({ corner: v.union(v.literal("tl"), v.literal("tr"), v.literal("bl"), v.literal("br"), v.literal("c")), size: v.union(v.literal("small"), v.literal("large")), opacity: v.number(), mark: v.optional(v.union(v.literal("logo"), v.literal("text"), v.literal("both"))), text: v.optional(v.string()) })), // Nov 2: center, and your own text
    // Phase 2 Part B (D45): the business's own Stripe account, connected to the portal's platform account. Money goes
    // straight to it; the portal only mirrors what Stripe holds.
    stripe: v.optional(v.object({
      accountId: v.string(),
      status: v.union(v.literal("pending"), v.literal("needs_info"), v.literal("connected"), v.literal("disconnected")),
      chargesEnabled: v.boolean(), payoutsEnabled: v.boolean(), detailsSubmitted: v.boolean(),
      displayName: v.optional(v.string()), bankLast4: v.optional(v.string()), livemode: v.boolean(),
      due: v.optional(v.array(v.string())), disabledReason: v.optional(v.string()), verifying: v.optional(v.boolean()),
      methods: v.optional(v.array(v.string())),           // what clients can pay with: card, us_bank_account, link
      // Apple Pay, Google Pay and Link in the portal's Pay page need the portal's address registered on the business's
      // own account (direct charges). Done once per address, when the account is connected or on the first Pay.
      domain: v.optional(v.object({ name: v.string(), at: v.number(), ok: v.boolean(), applePay: v.optional(v.string()), error: v.optional(v.string()) })),
      startedAt: v.number(), connectedAt: v.optional(v.number()), disconnectedAt: v.optional(v.number()), checkedAt: v.number(),
    })),
    // Phase 3: Settings › Estimate rates (lib/estimate.ts Rates). Missing: Wrangler's from me-wrangler § 4, others empty.
    estimateRates: v.optional(v.any()),
    brandKit: v.optional(v.any()),           // Phase 3b (D71): Settings › Brand kit (convex/brandKit.ts)
    quoteSeq: v.optional(v.number()),        // Phase 3b: the last quote number used (D74)
    proposalSeq: v.optional(v.number()),     // Phase 3b: the last proposal number used (D85)
    kickoff: v.optional(v.any()),            // Phase 4 (Nov 2): the business's own kickoff brief questions (lib/kickoff.ts)
    questionnaire: v.optional(v.any()),      // Phase 3b (D70): the business's own proposal questionnaire (lib/questionnaire.ts)
    // Phase 2b (D64): when Stripe's last retry of a subscription payment fails: keep it past due (default) or cancel it.
    subFailRule: v.optional(v.union(v.literal("past_due"), v.literal("cancel"))),
    // Phase 5 (D98): Settings › Payments › Footage storage. Missing: Wrangler on, $100/year, kept 30 days; others off.
    footage: v.optional(v.object({ on: v.boolean(), priceCents: v.number(), keepDays: v.number() })),
    // Phase 2 Part B step 4 (D51): automatic invoice reminders, off until the owner turns them on (that's their OK).
    reminders: v.optional(v.object({
      on: v.boolean(),
      beforeDays: v.number(),   // days before the due date (0 = none before)
      afterDays: v.number(),    // the first overdue reminder, days after the due date (0 = on the day)
      everyDays: v.number(),    // then every n days while overdue
      stopAfter: v.number(),    // at most this many overdue reminders
    })),
  }).index("by_slug", ["slug"]).index("by_stripe_account", ["stripe.accountId"]),

  // Phase 3 (Oct 31): the pipeline. A deal is one card: a lead from the website or added by hand, or the job an estimate
  // is for. Seven fixed stages (D59); events only ever move a card forward, a card dragged by hand stays until a later
  // event moves it further (D60). Back office only.
  deals: defineTable({
    businessId: v.optional(v.id("businesses")),
    title: v.string(),
    clientId: v.optional(v.id("clients")),       // the company (made at the first estimate for a website lead, D56)
    contactEmail: v.optional(v.string()),
    projectId: v.optional(v.id("projects")),
    documentId: v.optional(v.id("wsDocuments")), // the contract drafted from its estimate
    estimateId: v.optional(v.id("estimates")),
    valueCents: v.optional(v.number()),
    stage: v.union(v.literal("lead"), v.literal("quoted"), v.literal("contract_sent"), v.literal("signed"), v.literal("in_production"), v.literal("delivered"), v.literal("paid")),
    source: v.union(v.literal("website"), v.literal("hand"), v.literal("estimate"), v.literal("accepted"), v.literal("call")), // accepted: D149's quiet lead; call: booked a call (5d)
    quiet: v.optional(v.boolean()),               // D149: someone who isn't a client accepted; kept off the Pipeline board until "Move to Quoted?"
    lead: v.optional(v.object({ name: v.string(), email: v.string(), company: v.optional(v.string()), phone: v.optional(v.string()), message: v.optional(v.string()),
      fields: v.array(v.object({ label: v.string(), value: v.string() })), at: v.number() })),
    closedAt: v.optional(v.number()),            // "Not a lead", or taken off the board
    history: v.array(v.object({ kind: v.string(), at: v.number(), by: v.optional(v.string()), detail: v.optional(v.string()) })),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_project", ["projectId"]).index("by_document", ["documentId"]).index("by_client", ["clientId"]),

  estimates: defineTable({
    businessId: v.optional(v.id("businesses")),
    dealId: v.optional(v.id("deals")),
    clientId: v.optional(v.id("clients")),
    projectId: v.optional(v.id("projects")),
    title: v.string(),
    scope: v.string(),
    input: v.any(),                              // EstimateInput (lib/estimate.ts) plus the shooting unit
    rates: v.any(),                              // the rates as they were when it was saved
    result: v.any(),                             // Estimate (lib/estimate.ts)
    documentId: v.optional(v.id("wsDocuments")),
    buildId: v.optional(v.id("wsBuilds")),
    contractAt: v.optional(v.number()),         // when Make contract draft last wrote the draft (its numbers are from this save)
    contractClaimAt: v.optional(v.number()),    // a Make contract draft in progress (one at a time)
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_deal", ["dealId"]).index("by_project", ["projectId"]),

  followUps: defineTable({
    businessId: v.optional(v.id("businesses")),
    dealId: v.optional(v.id("deals")),
    clientId: v.optional(v.id("clients")),
    who: v.string(),
    email: v.optional(v.string()),
    about: v.string(),
    due: v.string(),                             // yyyy-mm-dd
    note: v.optional(v.string()),
    remind: v.optional(v.union(v.literal("morning_of"), v.literal("day_before"))), // "Remind me" (Add follow-up dialog)
    doneAt: v.optional(v.number()),
    draft: v.optional(v.boolean()),              // made by Claude: does nothing until confirmed (D67)
    createdBy: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_client", ["clientId"]).index("by_deal", ["dealId"]),

  // Phase 3b (Oct 31): Quick quotes (Payments › Quotes). A quote has its own number (WRNGLR-Q-0001, D74), lines like an
  // invoice's, a deposit and a valid-until date. Sent, it gets a long random token: the client's page at /q/<token>
  // (no account, D81) where they accept or decline, recorded with name, time, IP and device. Nothing converts or moves
  // on its own (D84): the owner answers each prompt.
  quotes: defineTable({
    businessId: v.optional(v.id("businesses")),
    number: v.string(),
    seq: v.number(),
    status: v.union(v.literal("draft"), v.literal("sent"), v.literal("accepted"), v.literal("declined"), v.literal("void")),
    clientId: v.optional(v.id("clients")),
    dealId: v.optional(v.id("deals")),
    projectId: v.optional(v.id("projects")),
    contact: v.optional(v.object({ name: v.string(), email: v.string(), company: v.optional(v.string()) })), // D149: optional ("No client yet"); whoever accepts once accepted
    title: v.string(),
    lines: v.array(v.object({ id: v.string(), description: v.string(), qty: v.number(), unitCents: v.number(), suggestedCents: v.optional(v.number()), note: v.optional(v.string()) })),
    discountCents: v.optional(v.number()),
    taxPercent: v.optional(v.number()),
    deposit: v.object({ kind: v.union(v.literal("percent"), v.literal("amount")), value: v.number() }),
    validUntil: v.string(),                       // yyyy-mm-dd
    terms: v.optional(v.string()),
    questions: v.optional(v.any()),               // the quick questions' answers (what's the job, days, level)
    totalCents: v.number(),
    token: v.optional(v.string()),                // the one link of a quote sent before D149
    linkToken: v.optional(v.string()),            // D149: Copy link (anyone with it)
    linkOpens: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    viewedAt: v.optional(v.number()),
    response: v.optional(responseV), // D149: who answered (name, and email and company when given)
    asked: v.optional(v.object({ move: v.optional(v.union(v.literal("yes"), v.literal("no"))), draft: v.optional(v.union(v.literal("done"), v.literal("later"))), seen: v.optional(v.boolean()) })),
    made: v.optional(v.object({ buildId: v.optional(v.id("wsBuilds")), invoiceId: v.optional(v.id("invoices")) })),
    voidedAt: v.optional(v.number()),
    history: v.array(v.object({ kind: v.string(), at: v.number(), by: v.optional(v.string()), detail: v.optional(v.string()) })),
    createdBy: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_token", ["token"]).index("by_client", ["clientId"]).index("by_deal", ["dealId"]).index("by_updated", ["updatedAt"]).index("by_link_token", ["linkToken"]),

  // Phase 3b · Proposals (D69): a written pitch made in the builder (its wsBuilds row, kind "proposal"), numbered
  // {prefix}-P-0001 (D85). Sending freezes the PDF, the contact and the totals; the client reads it at /p/<token> and
  // accepts or declines (D73, D86), recorded like quotes. Nothing moves or converts on its own (D84).
  proposals: defineTable({
    businessId: v.optional(v.id("businesses")),
    buildId: v.id("wsBuilds"),
    number: v.string(),
    seq: v.number(),
    status: v.union(v.literal("draft"), v.literal("waiting"), v.literal("ready"), v.literal("sent"), v.literal("accepted"), v.literal("declined"), v.literal("void")),
    templateId: v.optional(v.id("wsTemplates")),
    clientId: v.optional(v.id("clients")),
    dealId: v.optional(v.id("deals")),
    contact: v.optional(v.object({ name: v.string(), email: v.string(), company: v.optional(v.string()) })), // frozen when sent
    fromName: v.optional(v.string()),            // who replies go to (the business contact), frozen when sent
    totalCents: v.optional(v.number()),          // frozen when sent
    depositCents: v.optional(v.number()),
    depositPct: v.optional(v.number()),
    lineCount: v.optional(v.number()),
    pdfId: v.optional(v.id("_storage")),         // the PDF as sent
    message: v.optional(v.string()),
    drafted: v.optional(v.literal("claude")),    // Claude wrote the draft through the connector (the review banner)
    source: v.optional(v.union(v.literal("template"), v.literal("blank"), v.literal("questionnaire"), v.literal("copy"))),
    filling: v.optional(v.boolean()),            // the questionnaire is still being answered
    answers: v.optional(v.any()),                // the questionnaire's answers, by question id (and __lines, the priced lines)
    qStep: v.optional(v.number()),               // the step they were on ("Save and finish later")
    deck: v.optional(v.object({ kit: v.union(v.literal("business"), v.literal("client")), note: v.optional(v.string()), askedAt: v.optional(v.number()) })), // D72
    token: v.optional(v.string()),                // the one link of a proposal sent before D149
    linkToken: v.optional(v.string()),            // D149: Copy link (anyone with it)
    linkOpens: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    viewedAt: v.optional(v.number()),
    response: v.optional(responseV), // D149: who answered (name, and email and company when given)
    asked: v.optional(v.object({ move: v.optional(v.union(v.literal("yes"), v.literal("no"))), contract: v.optional(v.union(v.literal("done"), v.literal("later"))), seen: v.optional(v.boolean()) })),
    made: v.optional(v.object({ buildId: v.optional(v.id("wsBuilds")) })),
    voidedAt: v.optional(v.number()),
    history: v.array(v.object({ kind: v.string(), at: v.number(), by: v.optional(v.string()), detail: v.optional(v.string()) })),
    createdBy: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_token", ["token"]).index("by_build", ["buildId"]).index("by_client", ["clientId"]).index("by_deal", ["dealId"]).index("by_updated", ["updatedAt"]).index("by_link_token", ["linkToken"]),
  // D149 (Nov 4): each person a quote or proposal was emailed to, with their own link: opens, and their accept or
  // decline. One person accepting closes every other link ("Already accepted on {date}", never who).
  offerRecipients: defineTable({
    businessId: v.optional(v.id("businesses")),
    quoteId: v.optional(v.id("quotes")),
    proposalId: v.optional(v.id("proposals")),
    email: v.string(),                             // lower-case
    name: v.optional(v.string()),
    token: v.string(),
    sentAt: v.number(),
    openedAt: v.optional(v.number()),
    opens: v.number(),
    stoppedAt: v.optional(v.number()),             // "Stop this person's link"
    response: v.optional(responseV),
  }).index("by_quote", ["quoteId"]).index("by_proposal", ["proposalId"]).index("by_token", ["token"]),

  // Phase 3c · Vendors (D91–D104): the subcontractors a business hires. One row per business per vendor (D94: the same
  // person working for two businesses has two rows, each seen only by its business). W-9 per business (D100); payment
  // details are the method and a note only, never bank numbers (D101).
  vendors: defineTable({
    businessId: v.optional(v.id("businesses")),
    name: v.string(),
    email: v.string(),                                   // lower-case; the vendor portal login (step 4)
    roles: v.array(v.string()),                          // Shooter, Editor, Drone pilot…
    rates: v.array(v.object({ role: v.string(), unit: v.union(v.literal("day"), v.literal("hour")), cents: v.number() })),
    basedIn: v.optional(v.string()),
    phone: v.optional(v.string()),
    portfolio: v.optional(v.string()),
    gear: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    invitedAt: v.optional(v.number()),                   // invited to the vendor portal
    joinedAt: v.optional(v.number()),                    // signed in to it
    w9: v.optional(v.object({ fileId: v.id("_storage"), name: v.string(), uploadedAt: v.number() })),
    payMethod: v.optional(v.object({ method: v.string(), note: v.optional(v.string()) })),
    businessName: v.optional(v.string()),               // step 4: their own business name, if they have one
    // Pay in portal (Nov 2): their Stripe recipient on the business's own Stripe account (vendorPayouts.ts). Bank
    // details live at Stripe; the portal keeps only the bank's name and last 4 to show.
    payout: v.optional(v.object({ recipientId: v.string(), mode: v.string(), ready: v.boolean(), needsInfo: v.optional(v.boolean()),
      payoutMethodId: v.optional(v.string()), last4: v.optional(v.string()), bankName: v.optional(v.string()), checkedAt: v.number() })),
    address: v.optional(v.string()),                    // step 4: mailing address, for 1099s
    archivedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_email", ["email"]),

  // Phase 3c step 3 · briefings (D97, S5 · Phase 3c 730:4522, 731:3904): a shoot or edit brief made in the builder (its
  // wsBuilds row, kind "briefing"), sent to a vendor booked on the project (email 25). The vendor reads the PDF that was
  // sent and presses "I've read it" in their portal (step 4). Never signed.
  // D147 (Nov 3, built Nov 4): a briefing no longer needs a booked vendor. The project is optional; "Send to" holds
  // vendors (booked or not) and typed emails; Share emails each of them their own link (briefingRecipients), and a
  // copied link (linkToken) counts opens without names. linkOff turns every link off (and back on).
  briefings: defineTable({
    businessId: v.optional(v.id("businesses")),
    buildId: v.id("wsBuilds"),
    projectId: v.optional(v.id("projects")),
    bookingId: v.optional(v.id("vendorBookings")),      // who it's for (a booking on this project)
    starter: v.optional(v.union(v.literal("shoot"), v.literal("edit"))),
    status: v.union(v.literal("draft"), v.literal("sent")),
    pdfId: v.optional(v.id("_storage")),                // frozen at send: what the vendor reads
    sentAt: v.optional(v.number()),
    sentTo: v.optional(v.object({ vendorId: v.id("vendors"), name: v.string(), email: v.string() })),
    readAt: v.optional(v.number()),                     // "I've read it" (the vendor side, step 4; briefings sent before D147)
    sendTo: v.optional(v.array(v.object({ vendorId: v.optional(v.id("vendors")), email: v.string(), name: v.optional(v.string()) }))), // the draft's Send to
    linkToken: v.optional(v.string()),                  // Copy link: anyone with it can read; opens counted, not named
    linkOff: v.optional(v.boolean()),                   // Q91 (a)(b): off stops every link, emailed ones too; can be turned back on
    linkOpens: v.optional(v.number()),
    linkReads: v.optional(v.number()),                  // "I've read it" pressed on the copied link (no name)
    history: v.array(v.object({ kind: v.string(), at: v.number(), by: v.optional(v.string()), detail: v.optional(v.string()) })),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_build", ["buildId"]).index("by_project", ["projectId"]).index("by_booking", ["bookingId"]).index("by_link_token", ["linkToken"]),
  // D147 (Q91 d): each person a briefing was emailed to, with their own link (/b/<token>): who opened it and who read it.
  briefingRecipients: defineTable({
    businessId: v.optional(v.id("businesses")),
    briefingId: v.id("briefings"),
    email: v.string(),                                  // lower-case
    name: v.optional(v.string()),
    vendorId: v.optional(v.id("vendors")),              // picked from the vendor list (also shows in their vendor portal)
    token: v.string(),
    sentAt: v.number(),
    openedAt: v.optional(v.number()),
    opens: v.number(),
    readAt: v.optional(v.number()),
  }).index("by_briefing", ["briefingId"]).index("by_token", ["token"]).index("by_vendor", ["vendorId"]),

  // Phase 3c step 2 · bookings (S5 · Phase 3c 732:3051 Book a vendor, 730:2326 Crew card, 730:3942 Vendors › Bookings).
  // A vendor offered work on a project: role, dates, the agreed rate. Offered and accepted bookings show on the
  // project's Crew card and as expected costs in its Ledger; approving the vendor's invoice (step 5) makes it actual.
  vendorBookings: defineTable({
    businessId: v.optional(v.id("businesses")),
    vendorId: v.id("vendors"),
    projectId: v.id("projects"),
    role: v.string(),
    start: v.string(), end: v.string(),                     // YYYY-MM-DD, inclusive
    rate: v.object({ cents: v.number(), unit: v.union(v.literal("day"), v.literal("hour")) }),
    hours: v.optional(v.number()),                          // an hourly booking's expected hours (the expected cost)
    suggestedCents: v.optional(v.number()),                 // what Pricing (or their own rate) suggested, when one did
    location: v.optional(v.string()),
    note: v.optional(v.string()),
    status: v.union(v.literal("offered"), v.literal("accepted"), v.literal("declined"), v.literal("cancelled")),
    declineReason: v.optional(v.string()),
    offeredAt: v.number(),
    answeredAt: v.optional(v.number()),                     // accepted or declined (the vendor side, step 4)
    cancelledAt: v.optional(v.number()),
    reviewShareId: v.optional(v.id("shares")),              // step 4: a booked editor's Review access (D93, D103)
    createdBy: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_vendor", ["vendorId"]).index("by_project", ["projectId"]),

  // Phase 3c step 4 · a vendor's invoice for a booking (S5 · Phase 3c 734:3527, 734:3958): hours × the agreed rate, or
  // line items. Sent to the owner (email 26 and a Home alert); approved and marked paid by the owner in step 5. Nothing
  // here moves money (D92).
  vendorInvoices: defineTable({
    businessId: v.optional(v.id("businesses")),
    vendorId: v.id("vendors"),
    bookingId: v.id("vendorBookings"),
    projectId: v.id("projects"),
    number: v.string(),                                   // theirs, or one made for them ("INV-0003")
    mode: v.union(v.literal("hours"), v.literal("lines")),
    hours: v.array(v.object({ label: v.string(), qty: v.number() })),  // mode "hours": each day or part, in the booking's unit
    lines: v.array(v.object({ description: v.string(), cents: v.number() })), // mode "lines"
    rate: v.object({ cents: v.number(), unit: v.union(v.literal("day"), v.literal("hour")) }), // the booking's agreed rate when sent
    totalCents: v.number(),
    note: v.optional(v.string()),
    status: v.union(v.literal("draft"), v.literal("sent"), v.literal("approved"), v.literal("paid"), v.literal("declined")),
    sentAt: v.optional(v.number()),
    approvedAt: v.optional(v.number()),
    approvedBy: v.optional(v.string()),
    ledgerEntryId: v.optional(v.id("ledgerEntries")),     // step 5: the actual cost Approve added to the project's Ledger
    declinedAt: v.optional(v.number()),                   // step 5: the owner declined it (with a reason); the vendor can fix and resend
    declineReason: v.optional(v.string()),
    paidAt: v.optional(v.number()),                       // when Mark paid was pressed
    paidOn: v.optional(v.string()),                       // step 5: the day they say they paid (YYYY-MM-DD): the 1099 year
    paidCents: v.optional(v.number()),                    // what they say they paid (the total unless changed)
    paidMethod: v.optional(v.string()),
    paidRef: v.optional(v.string()),                      // "Confirmation 000000" (optional)
    history: v.optional(v.array(v.object({ at: v.number(), text: v.string() }))),
    // Pay in portal (Nov 2): the Stripe payout for this invoice (states in vendorPayouts.ts: starting, unknown,
    // processing, posted, failed, returned, canceled, refused). Posted → paid; failed / returned / canceled → approved.
    payout: v.optional(v.object({ id: v.optional(v.string()), status: v.string(), attempt: v.number(), mode: v.string(), startedAt: v.number(), by: v.optional(v.string()),
      expectedArrival: v.optional(v.string()), receiptUrl: v.optional(v.string()), reason: v.optional(v.string()), checkedAt: v.optional(v.number()),
      // the exact request sent to Stripe (re-sent with the same idempotency key when its answer is lost)
      request: v.optional(v.object({ key: v.string(), cents: v.number(), recipient: v.string(), payoutMethod: v.string(), financialAccount: v.string(), last4: v.optional(v.string()), description: v.string() })) })),
    seenAt: v.optional(v.number()),                       // the owner opened it (the Home alert stays until approved)
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_vendor", ["vendorId"]).index("by_booking", ["bookingId"]).index("by_status", ["status"]),

  // Phase 3b (review fix): the files uploaded for a proposal's questionnaire answers. Only these are served or copied.
  proposalFiles: defineTable({
    businessId: v.optional(v.id("businesses")),
    proposalId: v.id("proposals"),
    storageId: v.id("_storage"),
    name: v.string(), size: v.number(), type: v.string(),
    createdAt: v.number(),
  }).index("by_proposal", ["proposalId"]).index("by_storage", ["storageId"]),

  // The job ledger (a project tab): hours and costs logged against the project, compared with its estimate.
  ledgerEntries: defineTable({
    businessId: v.optional(v.id("businesses")),
    projectId: v.id("projects"),
    kind: v.union(v.literal("hours"), v.literal("cost")),
    workId: v.optional(v.string()),              // the kind of work (rates) the hours or cost is for
    costId: v.optional(v.string()),              // which subcontractor cost (rates) the hours are paid at
    hours: v.optional(v.number()),               // hours, or days for a kind billed per day
    cents: v.optional(v.number()),
    who: v.optional(v.string()),                 // "Heston", a subcontractor
    note: v.optional(v.string()),
    date: v.string(),
    draft: v.optional(v.boolean()),              // drafted by Claude from notes: counts once confirmed (D67)
    vendorInvoiceId: v.optional(v.id("vendorInvoices")), // Phase 3c step 5: added by approving a vendor's invoice
    createdBy: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_project", ["projectId"]),

  // Phase 2b (Oct 30): plans. A plan is a price the owner reuses for subscriptions; it lives as a product with a price
  // in the business's own Stripe account (direct charges). Changing the price makes a new Stripe price; subscriptions
  // already on the old one keep it (as drawn: "changing a plan's price later doesn't change subscriptions").
  plans: defineTable({
    businessId: v.optional(v.id("businesses")),
    name: v.string(),
    description: v.optional(v.string()),
    amountCents: v.number(),
    interval: v.union(v.literal("day"), v.literal("week"), v.literal("month"), v.literal("year")),
    intervalCount: v.number(),
    stripe: v.object({ accountId: v.string(), productId: v.string(), priceId: v.string(), livemode: v.boolean() }),
    archivedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_price", ["stripe.priceId"]),

  // Phase 2b: subscriptions, the portal's copy of each one in the business's Stripe (kept in step by Stripe's events).
  subscriptions: defineTable({
    businessId: v.optional(v.id("businesses")),
    clientId: v.optional(v.id("clients")),
    projectId: v.optional(v.id("projects")),
    planId: v.id("plans"),
    priceId: v.string(),                // the Stripe price as it was when the owner started it
    planName: v.string(),
    planDescription: v.optional(v.string()),
    amountCents: v.number(),
    interval: v.union(v.literal("day"), v.literal("week"), v.literal("month"), v.literal("year")),
    intervalCount: v.number(),
    billTo: v.object({ name: v.string(), email: v.string() }),
    // incomplete: waiting on the first payment; scheduled: starts on a later date
    status: v.union(v.literal("starting"), v.literal("scheduled"), v.literal("incomplete"), v.literal("trialing"), v.literal("active"), v.literal("past_due"),
      v.literal("paused"), v.literal("unpaid"), v.literal("canceled"), v.literal("incomplete_expired")),
    startDate: v.string(),              // yyyy-mm-dd, as the owner picked it
    trialDays: v.optional(v.number()),
    firstInvoice: v.union(v.literal("now"), v.literal("start")),
    payToken: v.string(),               // the client's page for this subscription (/sub/<token>), with or without an account
    stripe: v.optional(v.object({ accountId: v.string(), customerId: v.string(), subscriptionId: v.optional(v.string()), scheduleId: v.optional(v.string()), livemode: v.boolean() })),
    currentPeriodStart: v.optional(v.number()),
    currentPeriodEnd: v.optional(v.number()),
    trialEnd: v.optional(v.number()),
    cancelAtPeriodEnd: v.optional(v.boolean()),
    canceledAt: v.optional(v.number()),
    pause: v.optional(v.object({ at: v.number(), resumesAt: v.optional(v.number()) })),
    method: v.optional(v.string()),     // "Visa •••• 4242"
    lastFailure: v.optional(v.object({ at: v.number(), message: v.string(), invoice: v.optional(v.string()), nextTry: v.optional(v.number()) })),
    history: v.array(v.object({ kind: v.string(), at: v.number(), by: v.optional(v.string()), detail: v.optional(v.string()) })),
    createdBy: v.optional(v.string()),
    syncedAt: v.optional(v.number()),
    claimAt: v.optional(v.number()),    // review fix: one start in Stripe at a time (status "starting" while it's being made)
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_stripe_sub", ["stripe.subscriptionId"]).index("by_pay_token", ["payToken"]).index("by_client", ["clientId"]).index("by_bill_email", ["billTo.email"]),

  // Phase 2 Part B, step 2: invoices. A draft lives only in the portal; Send (the owner's confirm) makes it in the
  // business's own Stripe account, gives it its number (D52) and finalizes it. From then on Stripe holds the money
  // and the webhook keeps this copy in step: open, processing, paid, partly paid, failed, void, uncollectible.
  invoices: defineTable({
    businessId: v.optional(v.id("businesses")),
    clientId: v.optional(v.id("clients")),
    projectId: v.optional(v.id("projects")),
    kind: v.union(v.literal("deposit"), v.literal("final"), v.literal("other"), v.literal("subscription")),
    subscriptionId: v.optional(v.id("subscriptions")), // Phase 2b: an invoice Stripe made for a subscription (charged automatically)
    title: v.string(),                                   // "Final invoice", "Deposit · WS-00018", "Extra shoot day"
    number: v.optional(v.string()),                      // D52: WRNGLR-0042, given when it's first sent
    billTo: v.object({ name: v.string(), email: v.string(), company: v.optional(v.string()) }),
    lines: v.array(v.object({ id: v.string(), description: v.string(), qty: v.number(), unitCents: v.number() })),
    discountCents: v.optional(v.number()),
    taxPercent: v.optional(v.number()),                 // e.g. 8.25
    dueDate: v.string(),                                // YYYY-MM-DD
    memo: v.optional(v.string()),
    status: v.union(v.literal("draft"), v.literal("sending"), v.literal("open"), v.literal("paid"), v.literal("void"), v.literal("uncollectible")),
    // What Stripe says about the money, kept from the webhook (cents).
    totalCents: v.number(), amountPaidCents: v.number(), amountRemainingCents: v.number(),
    processing: v.optional(v.boolean()),                // a bank payment is on its way
    lastFailure: v.optional(v.object({ at: v.number(), message: v.string(), key: v.optional(v.string()) })), // key: "<payment intent>:<charge>"
    // Step 3: the client's link to their invoice page (/i/<token>, in the invoice email) and the payments Stripe has
    // on the invoice (method shown as "Visa •••• 4242" or "Bank •••• 6789"; never full numbers).
    fromContract: v.optional(v.string()),                // "contract:<document>:v<n>": the deposit drafted when a contract was signed
    storageId: v.optional(v.id("footageStorage")),       // Phase 5: a year of raw footage storage (D33), first year or a renewal (D140)
    payToken: v.optional(v.string()),
    // Review fixes (Oct 30): a send in progress keeps what it has made in Stripe so far, so a failed send cleans up
    // and a retry neither duplicates nor gets stuck; syncedAt spaces out reads from Stripe.
    sendAttempt: v.optional(v.number()),
    pending: v.optional(v.object({ customerId: v.optional(v.string()), draftId: v.optional(v.string()), taxRateId: v.optional(v.string()) })),
    syncedAt: v.optional(v.number()),
    // Step 4: reminders sent (by hand or automatically), so the next one is worked out from what already went.
    reminders: v.optional(v.array(v.object({ at: v.number(), kind: v.union(v.literal("before"), v.literal("overdue")), auto: v.boolean() }))),
    payments: v.optional(v.array(v.object({ id: v.string(), at: v.number(), method: v.string(), cents: v.number(), status: v.union(v.literal("paid"), v.literal("processing"), v.literal("failed")), refundedCents: v.optional(v.number()) }))),
    refundedCents: v.optional(v.number()),
    disputed: v.optional(v.object({ at: v.number(), status: v.string(), cents: v.optional(v.number()), reason: v.optional(v.string()) })),
    stripe: v.optional(v.object({
      accountId: v.string(), invoiceId: v.string(), customerId: v.string(),
      number: v.optional(v.string()), hostedUrl: v.optional(v.string()), pdfUrl: v.optional(v.string()), livemode: v.boolean(),
    })),
    sendError: v.optional(v.string()),
    history: v.array(v.object({ kind: v.string(), at: v.number(), by: v.optional(v.string()), detail: v.optional(v.string()) })),
    createdBy: v.optional(v.string()),
    sentAt: v.optional(v.number()), viewedAt: v.optional(v.number()), paidAt: v.optional(v.number()), voidedAt: v.optional(v.number()),
    createdAt: v.number(), updatedAt: v.number(),
  }).index("by_project", ["projectId"]).index("by_client", ["clientId"]).index("by_stripe", ["stripe.invoiceId"]).index("by_updated", ["updatedAt"]).index("by_pay_token", ["payToken"]).index("by_bill_email", ["billTo.email"]),

  // Phase 2 Part B: every Stripe webhook event, once (a repeat delivery changes nothing).
  // Phase 5c (Nov 3): Site watch. Global (the portal's own health, not a business's records): one row per problem,
  // seen by the portal's admins only (ALLOWED_EMAILS). Holds counts and error text with email addresses masked.
  siteWatchFindings: defineTable({
    key: v.string(),                       // e.g. "email:footage_offer", "job:footage.mailOffer", "stored:versions.failed"
    area: v.string(),                      // email · job · stored · tests · page
    title: v.string(),
    detail: v.optional(v.string()),
    count: v.number(),                     // events seen, or rows in the problem state now
    hits: v.optional(v.number()),          // businesses affected
    firstAt: v.number(), lastAt: v.number(),
    status: v.union(v.literal("found"), v.literal("fix_ready"), v.literal("fixed"), v.literal("needs_you"), v.literal("cleared")),
    urgent: v.optional(v.boolean()),
    branch: v.optional(v.string()),        // the fix's branch (watch/...), never main
    commit: v.optional(v.string()),        // the fix's exact commit: Heston's "go" refers to it (review H1)
    quietAt: v.optional(v.number()),       // a fix waiting for Heston whose problem went quiet: stays open (review M3)
    doneAt: v.optional(v.number()),        // Heston marked it done; reopens only if it gets worse or fails again (L1)
    doneCount: v.optional(v.number()),
    note: v.optional(v.string()),
    alertedAt: v.optional(v.number()),     // D151: when its urgent email went to the support address (once per opening)
    updatedAt: v.number(),
  }).index("by_key", ["key"]).index("by_status", ["status"]),
  siteWatchRuns: defineTable({
    at: v.number(),
    by: v.union(v.literal("app"), v.literal("agent")),
    found: v.number(), cleared: v.number(),
    summary: v.optional(v.string()),
    // Q47 (Heston, Nov 3): what was open at this run, so a history row opens that day's list. Cleared after 30 days.
    open: v.optional(v.array(v.object({ key: v.string(), area: v.string(), title: v.string(), status: v.string(), urgent: v.boolean(), count: v.number() }))),
  }).index("by_at", ["at"]),
  // Phase 5c screens (Nov 4): the "Run the checks" switch on Settings › Site watch. One row, global. Off = the daily
  // look doesn't run (findings stay as they are).
  siteWatchSettings: defineTable({ paused: v.boolean(), updatedAt: v.number() }),

  stripeEvents: defineTable({
    eventId: v.string(), type: v.string(), account: v.optional(v.string()), livemode: v.boolean(), receivedAt: v.number(),
  }).index("by_event", ["eventId"]),

  // Phase 1 (Oct 29): the people at a client. Each one has a role, and portal access comes from their invite
  // (invites table): invited on a date, active once they made an account, or not invited.
  clientPeople: defineTable({
    businessId: v.optional(v.id("businesses")),
    clientId: v.id("clients"),
    email: v.string(),                 // lower-case
    name: v.optional(v.string()),
    role: v.union(v.literal("signer"), v.literal("contact")), // "Signs documents" / "Contact"
    createdAt: v.number(),
    removedAt: v.optional(v.number()),
  }).index("by_client", ["clientId"]).index("by_email", ["email"]),

  // Phase 1 (Oct 29): the Inbox. One row per person per event, so each person's read status is their own.
  // Every module posts through lib/inbox.ts; `key` makes each event post once per person, however often it runs.
  // Client approval (Phase 1): a signed-in client approved a version through a share. Deletes nothing; separate from
  // the owner's Approve final (videos.final).
  clientApprovals: defineTable({
    businessId: v.optional(v.id("businesses")),
    videoId: v.id("videos"),
    versionId: v.id("versions"),
    versionNumber: v.number(),
    userId: v.id("users"),
    name: v.string(),
    email: v.string(),
    shareId: v.id("shares"),
    at: v.number(),
  }).index("by_video", ["videoId", "at"]).index("by_version_user", ["versionId", "userId"]).index("by_at", ["at"]),
  // Phase 4 (Nov 2): Settings › Calendar. One Google Calendar connection per business (D32); tokens stay here.
  calendars: defineTable({
    businessId: v.optional(v.id("businesses")),
    email: v.string(),
    refreshToken: v.string(),
    accessToken: v.optional(v.string()),
    accessExpiresAt: v.optional(v.number()),
    calendarId: v.optional(v.string()),
    calendarName: v.optional(v.string()),
    inviteVendors: v.boolean(),
    inviteClient: v.boolean(),
    lastError: v.optional(v.string()),
    connectedAt: v.number(),
    // Phase 5b step 5 (Nov 3, D143): Production › Calendar. Every Google Calendar on the account, with whether it's
    // shown (only the picked one at first) and its incremental-sync token; the picked one is always pulled (shoots and
    // edit dates live there). disconnectedAt: Google stopped letting the portal in (Reconnect Google).
    list: v.optional(v.array(v.object({
      id: v.string(), name: v.string(), color: v.number(), on: v.boolean(), writable: v.boolean(), primary: v.boolean(),
      syncToken: v.optional(v.string()), syncedAt: v.optional(v.number()),
      // Review fix M6: a read cut short at the page cap carries on from here with the next pull (same query, same run).
      page: v.optional(v.object({ token: v.string(), run: v.number(), timeMin: v.optional(v.string()), timeMax: v.optional(v.string()) })),
    }))),
    lastSyncedAt: v.optional(v.number()),
    pullingSince: v.optional(v.number()),
    pullRun: v.optional(v.string()),          // review fix M4: whose lock it is (only that pull releases it)
    disconnectedAt: v.optional(v.number()),
  }),

  // Phase 5b step 5 (Nov 3, D143): Google Calendar events kept in step with the portal. kind "google": an event on a
  // shown Google Calendar (made in Google or in the portal); kind "date": a project's edit date the portal wrote to
  // Google as an all-day event (portal → Google only). Shoots aren't rows here: they stay on `shoots` (calendarEvent).
  // Times are the business's wall clock (America/Chicago); end/endDate are inclusive of the last day.
  calendarEvents: defineTable({
    businessId: v.optional(v.id("businesses")),
    kind: v.union(v.literal("google"), v.literal("date")),
    calendarId: v.string(),
    googleId: v.string(),
    title: v.string(),
    location: v.optional(v.string()),
    date: v.string(),                         // YYYY-MM-DD, first day
    endDate: v.string(),                      // YYYY-MM-DD, last day (inclusive)
    start: v.optional(v.string()),            // HH:MM; absent: all day
    end: v.optional(v.string()),              // HH:MM
    guests: v.array(v.object({ email: v.string(), name: v.optional(v.string()) })),
    recurring: v.optional(v.boolean()),       // one occurrence of a repeating event (edited as that occurrence only)
    readOnly: v.optional(v.boolean()),        // someone else's invite, or a calendar the account can only read
    htmlLink: v.optional(v.string()),
    gUpdated: v.number(),                     // Google's `updated` for the version this row matches (echo check)
    pending: v.optional(v.union(v.literal("create"), v.literal("update"), v.literal("delete"))),
    pendingAt: v.optional(v.number()),
    pushError: v.optional(v.string()),
    sendUpdates: v.optional(v.union(v.literal("all"), v.literal("none"))),
    guestsDirty: v.optional(v.boolean()),     // the guest list changed: send it with the next write
    prev: v.optional(v.object({ date: v.string(), endDate: v.string(), start: v.optional(v.string()), end: v.optional(v.string()), at: v.number(), notify: v.boolean() })),
    // Review fix M2: what Google had when the portal's edit (still waiting to go) started, so a later Google change only
    // wins over it when it changed the same things.
    base: v.optional(v.object({ title: v.string(), location: v.optional(v.string()), date: v.string(), endDate: v.string(), start: v.optional(v.string()), end: v.optional(v.string()), guests: v.array(v.string()) })),
    shootId: v.optional(v.id("shoots")),      // "Link to a shoot or project"
    projectId: v.optional(v.id("projects")),  // the link, or (kind "date") the project the date belongs to
    dateKey: v.optional(v.string()),          // kind "date": which of the project's dates
    sig: v.optional(v.string()),              // kind "date": what was written ("" after a change in Google: write it again)
    seen: v.optional(v.number()),             // the full sync that last saw it
    syncedAt: v.number(),
    createdAt: v.number(),
  }) // review fix M7: every index starts with the business
    .index("by_biz_google", ["businessId", "calendarId", "googleId"]).index("by_biz_date", ["businessId", "date"])
    .index("by_biz_kind", ["businessId", "kind", "projectId"]).index("by_biz_pending", ["businessId", "pending"]),

  // Phase 4 (Nov 2): shoots on a project (frames S5 · Phase 4). The client confirms one in their portal; moving its date,
  // call time or place clears the confirmation and asks again (email 30). Times are the business's local wall clock.
  shoots: defineTable({
    businessId: v.optional(v.id("businesses")),
    projectId: v.id("projects"),
    date: v.string(),                         // YYYY-MM-DD
    call: v.string(),                         // HH:MM, 24-hour
    wrap: v.optional(v.string()),             // HH:MM
    location: v.string(),
    parking: v.optional(v.string()),
    prepare: v.array(v.string()),             // "what to prepare", one line each
    crew: v.array(v.object({ name: v.string(), role: v.string(), vendorId: v.optional(v.id("vendors")), bookingId: v.optional(v.id("vendorBookings")), owner: v.optional(v.boolean()) })),
    status: v.union(v.literal("scheduled"), v.literal("cancelled")),
    confirmed: v.optional(v.object({ name: v.string(), email: v.string(), at: v.number() })),
    moved: v.optional(v.object({ date: v.string(), call: v.string(), location: v.string(), at: v.number() })), // what it was before the last move
    calendar: v.optional(v.boolean()),        // "Add to {calendar}" was ticked (the event itself arrives with Settings › Calendar)
    calendarEvent: v.optional(v.object({ id: v.string(), calendarId: v.string(), updated: v.optional(v.number()), at: v.optional(v.number()) })), // Phase 5b step 5: Google's `updated` for the version the portal wrote or took
    // Phase 5b step 5 (D143): moved in Google Calendar. The shoot moved with it; nobody was emailed; the owner gets a
    // Dashboard note (until Done, or Ask to confirm again).
    // kept (review fix H2): the other way round: a change made in Google was written over by the portal's newer one;
    // `was` is then what Google had.
    googleMove: v.optional(v.object({ at: v.number(), was: v.object({ date: v.string(), call: v.string(), wrap: v.optional(v.string()), location: v.string() }), doneAt: v.optional(v.number()), told: v.optional(v.boolean()), kept: v.optional(v.boolean()) })),
    // Review fix H2: when the portal last changed what's on the calendar event (date, call, wrap, place, crew, what to
    // prepare, the calendar tick). A client confirming doesn't change it, so it never beats a newer change made in Google.
    calAt: v.optional(v.number()),
    calError: v.optional(v.string()),         // the last write to Google Calendar failed (cleared by the next good one)
    // Phase 5b step 5: a move made by dragging it on the calendar, for Undo (about 8 seconds).
    dragUndo: v.optional(v.object({ at: v.number(), was: v.any() })),
    history: v.array(v.object({ at: v.number(), text: v.string() })),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_project", ["projectId", "date"]).index("by_date", ["date"]),

  // Phase 5d step 1 (Nov 4, D119/D144): booking calls. One settings row per business (Settings › Booking calls), with the
  // busy times last read from the calendar it checks (read again when a lead opens the page, at most once a minute).
  callSettings: defineTable({
    businessId: v.optional(v.id("businesses")),
    lengthMin: v.number(), bufferMin: v.number(), aheadDays: v.number(), noticeHours: v.number(),
    hours: v.array(v.object({ on: v.boolean(), start: v.string(), end: v.string() })), // Monday first; the business's wall clock
    calendarId: v.optional(v.string()),          // the calendar checked for busy times (default: the one shoots go on)
    paused: v.optional(v.boolean()),             // Heston (Nov 4, 21:57): the owner switched the booking page off
    busy: v.optional(v.object({ at: v.number(), s: v.number(), e: v.number(), spans: v.array(v.object({ s: v.number(), e: v.number() })), error: v.optional(v.string()) })),
    readingAt: v.optional(v.number()),           // a read of the calendar is on its way
    updatedAt: v.number(),
  }),
  // A booked call. "holding": just picked; the calendar is read again for that time before it's booked (or "taken").
  // The lead manages it from a private link (token) in email 43. notice: the owner's Dashboard row until Done.
  calls: defineTable({
    businessId: v.optional(v.id("businesses")),
    dealId: v.optional(v.id("deals")),
    name: v.string(), email: v.string(), note: v.optional(v.string()),
    start: v.number(), end: v.number(),
    tz: v.string(),                              // the lead's time zone, for their emails
    // "verifying" (Heston, Nov 4, 21:57): the time is held while the lead types the 6-digit code emailed to them; nothing
    // else happens (no card, no calendar event, no other email) until it's right. "lapsed": the code never came back.
    status: v.union(v.literal("verifying"), v.literal("holding"), v.literal("booked"), v.literal("taken"), v.literal("cancelled"), v.literal("lapsed")),
    token: v.string(),
    code: v.optional(v.object({ hash: v.string(), tries: v.number(), resends: v.optional(v.number()), sent: v.number(), until: v.number() })),
    noHold: v.optional(v.boolean()),             // review M1: past five picks waiting for a code, a new one doesn't hold its time
    heldAt: v.optional(v.number()),               // when the code was right and the time was held for Google's check
    moving: v.optional(v.object({ start: v.number(), end: v.number(), at: v.number() })), // a new time, being checked
    moveTaken: v.optional(v.number()),           // the last new time picked was taken meanwhile (shown once)
    moveFailed: v.optional(v.number()),          // review M3: the move couldn't be made on the calendar; the call stayed put
    was: v.optional(v.object({ start: v.number(), end: v.number() })), // before the last move
    event: v.optional(v.object({ id: v.string(), calendarId: v.string() })),
    meet: v.optional(v.string()),
    calError: v.optional(v.string()),
    notice: v.optional(v.object({ kind: v.union(v.literal("booked"), v.literal("moved"), v.literal("cancelled")), at: v.number(), doneAt: v.optional(v.number()) })),
    cancelledBy: v.optional(v.union(v.literal("lead"), v.literal("owner"))),
    history: v.array(v.object({ at: v.number(), text: v.string() })),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_token", ["token"]).index("by_start", ["start"]).index("by_deal", ["dealId", "start"]).index("by_email", ["email", "start"]),

  // Phase 5d step 2 (Nov 4, D121, D144/58): Messages. One thread per project (the business and the client's people who
  // can open the project) and one per lead (deal). A lead has no login: they read and reply from a private link (token).
  // Booked vendors are never in a thread. A booked call is a line in its lead's thread (side "system").
  msgThreads: defineTable({
    businessId: v.optional(v.id("businesses")),
    kind: v.union(v.literal("project"), v.literal("lead")),
    projectId: v.optional(v.id("projects")),
    dealId: v.optional(v.id("deals")),
    token: v.optional(v.string()),               // a lead's private link
    leadName: v.optional(v.string()), leadEmail: v.optional(v.string()),
    lastAt: v.number(), lastText: v.string(), lastSide: v.optional(v.string()), lastName: v.optional(v.string()),
    inAt: v.optional(v.number()),                // review L1: the latest message from the client's people or the lead
    outAt: v.optional(v.number()),               // and from the business (call lines are neither)
    linkOff: v.optional(v.boolean()),            // review M3: the owner turned the lead's link off
    createdAt: v.number(),
  }).index("by_project", ["projectId"]).index("by_deal", ["dealId"]).index("by_token", ["token"]).index("by_last", ["lastAt"]),
  messages: defineTable({
    businessId: v.optional(v.id("businesses")),
    threadId: v.id("msgThreads"),
    side: v.union(v.literal("owner"), v.literal("client"), v.literal("lead"), v.literal("system")),
    name: v.string(),
    email: v.optional(v.string()),
    text: v.string(),
    files: v.array(v.object({ storageId: v.id("_storage"), name: v.string(), size: v.number(), type: v.string() })),
    call: v.optional(v.object({ callId: v.id("calls"), what: v.union(v.literal("booked"), v.literal("moved"), v.literal("cancelled")), start: v.number(), end: v.number(), meet: v.optional(v.boolean()) })),
    createdAt: v.number(),
  }).index("by_thread", ["threadId", "createdAt"]),
  // Review H1: a file attached to a message is claimed here once: only a fresh upload nobody has claimed can be attached.
  msgUploads: defineTable({
    businessId: v.optional(v.id("businesses")),
    storageId: v.id("_storage"),
    by: v.string(),                              // "user:<id>" or "lead:<thread id>"
    at: v.number(),
  }).index("by_storage", ["storageId"]),
  // Who read a thread up to when: "owner" for the business, or the client's / lead's email.
  msgReads: defineTable({
    businessId: v.optional(v.id("businesses")),
    threadId: v.id("msgThreads"),
    who: v.string(), name: v.string(), readAt: v.number(),
  }).index("by_thread", ["threadId"]).index("by_who", ["who", "threadId"]),

  // Phase 5d step 3 (Nov 4): gear (Q57). Owner-only. The full serial is stored; screens show the last 4.
  gear: defineTable({
    businessId: v.optional(v.id("businesses")),
    name: v.string(),
    kind: v.union(v.literal("camera"), v.literal("lens"), v.literal("audio"), v.literal("lighting"), v.literal("grip"), v.literal("drone"), v.literal("computer"), v.literal("other")),
    serial: v.optional(v.string()),
    boughtOn: v.optional(v.string()),            // YYYY-MM-DD
    priceCents: v.optional(v.number()),
    insuredCents: v.optional(v.number()),
    photoId: v.optional(v.id("_storage")),
    notes: v.optional(v.string()),
    status: v.union(v.literal("in_service"), v.literal("in_repair"), v.literal("retired")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_status", ["status", "name"]),
  gearMaintenance: defineTable({
    businessId: v.optional(v.id("businesses")),
    gearId: v.id("gear"),
    date: v.string(),                            // YYYY-MM-DD
    what: v.string(),
    costCents: v.optional(v.number()),
    nextDue: v.optional(v.string()),             // YYYY-MM-DD
    createdAt: v.number(),
  }).index("by_gear", ["gearId", "date"]),
  // Gear on a shoot. A same-day clash is named on the shoot page and never blocks.
  gearBookings: defineTable({
    businessId: v.optional(v.id("businesses")),
    gearId: v.id("gear"),
    shootId: v.id("shoots"),
    createdAt: v.number(),
  }).index("by_shoot", ["shootId"]).index("by_gear", ["gearId"]),

  // Phase 5b step 3 (Nov 3): call sheets (D126, S5 · Phase 5b 765:2852 …). One per shoot. The page is a builder document
  // (its wsBuilds row, kind "callsheet"); until the quick questionnaire is finished there's no build yet, only answers.
  // `sent` is the copy everyone on it reads: frozen at Send, replaced by each Send an update. Each person on it has
  // their own sent / opened times; crew are vendors booked on the project, client people are the client's portal people,
  // guests (D127) are stored here and get their login in step 4.
  callSheets: defineTable({
    businessId: v.optional(v.id("businesses")),
    shootId: v.id("shoots"),
    projectId: v.id("projects"),
    buildId: v.optional(v.id("wsBuilds")),
    templateId: v.optional(v.id("wsTemplates")),
    how: v.union(v.literal("questions"), v.literal("template"), v.literal("blank")),
    status: v.union(v.literal("draft"), v.literal("sent")),
    answers: v.optional(v.any()),                       // the questionnaire (lib/callSheet.ts Answers), until it's made
    step: v.optional(v.number()),
    recipients: v.array(v.object({
      id: v.string(),                                   // crew:<bookingId> · client:<email> · guest:<random>
      kind: v.union(v.literal("crew"), v.literal("client"), v.literal("guest")),
      name: v.string(), email: v.string(), role: v.optional(v.string()),
      vendorId: v.optional(v.id("vendors")), bookingId: v.optional(v.id("vendorBookings")),
      on: v.boolean(),                                  // ticked: gets it
      sentAt: v.optional(v.number()),                   // email 40 went (or was queued) to them
      round: v.optional(v.number()),                    // the last update (42) they were sent
      openedAt: v.optional(v.number()), lastOpenedAt: v.optional(v.number()),
      remindedAt: v.optional(v.number()), reminders: v.optional(v.number()),
      endedAt: v.optional(v.number()),                  // Phase 5b step 4: a guest whose access the owner ended by hand
      grant: v.optional(v.number()),                    // review L3: how many times a guest's access was restored (a new email 41 each time)
      addedAt: v.number(),
    })),
    // review L6: heading ("Launch · Harbor Coffee") and date as they were when it was sent, for readers and Remind.
    sent: v.optional(v.object({ title: v.string(), page: v.any(), fields: v.any(), style: v.any(), at: v.number(), round: v.number(), heading: v.optional(v.string()), date: v.optional(v.string()) })),
    sentAt: v.optional(v.number()),
    updates: v.optional(v.number()),                    // how many updates have gone out
    // D148 (Nov 4): the Weather block's forecast (lib/callSheet.ts SheetWeather), for one address and shoot day, and the
    // geocode of that address (kept so the address goes to the Census geocoder once; lat/lon left out = not found).
    weather: v.optional(v.object({ address: v.string(), date: v.string(), state: v.union(v.literal("forecast"), v.literal("early"), v.literal("none")), line: v.string(), at: v.number(), dayBefore: v.optional(v.boolean()) })),
    weatherTriedAt: v.optional(v.number()),   // review L11: the last lookup asked for (Refresh pressed or tried), even one that failed
    geo: v.optional(v.object({ address: v.string(), lat: v.optional(v.number()), lon: v.optional(v.number()), at: v.number() })),
    history: v.array(v.object({ at: v.number(), kind: v.string(), by: v.optional(v.string()), detail: v.optional(v.string()) })),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_shoot", ["shootId"]).index("by_project", ["projectId"]).index("by_build", ["buildId"]).index("by_status", ["status"]),

  // Phase 4 (Nov 2): file requests. The client uploads straight into the business's Dropbox, under
  // Apps/Wrangler Review/File requests/<Client>/<Project>/<Request> (Heston, Nov 2), which the render watcher ignores.
  fileRequests: defineTable({
    businessId: v.optional(v.id("businesses")),
    projectId: v.id("projects"),
    title: v.string(),
    details: v.optional(v.string()),
    due: v.string(),                          // YYYY-MM-DD
    folder: v.string(),                       // in the app folder, as shown: "/File requests/Harbor Coffee/26127 Launch/Logo and brand guide"
    remind: v.boolean(),                      // email 32 the day before, if nothing's uploaded
    remindedAt: v.optional(v.number()),
    status: v.union(v.literal("open"), v.literal("closed"), v.literal("cancelled")),
    files: v.array(v.object({ name: v.string(), size: v.number(), path: v.string(), at: v.number(), by: v.string() })),
    lastUploadAt: v.optional(v.number()),
    ownerMailedAt: v.optional(v.number()),      // the owner's last "files arrived" email covered files up to here
    history: v.array(v.object({ at: v.number(), text: v.string() })),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_project", ["projectId"]).index("by_status_due", ["status", "due"]),

  // One file on its way into a request's folder: straight to Dropbox (up to 150 MB, a one-time link) or in pieces
  // through the portal (/upload/chunk, with this row's random token). Rows are kept as the upload log.
  fileUploads: defineTable({
    businessId: v.optional(v.id("businesses")),
    requestId: v.id("fileRequests"),
    email: v.string(),
    name: v.string(),
    size: v.number(),
    path: v.string(),                         // where it's going (Dropbox may add " (1)" to the name)
    mode: v.union(v.literal("direct"), v.literal("chunks")),
    token: v.optional(v.string()),            // chunks: the upload's own key for /upload/chunk
    sessionId: v.optional(v.string()),        // chunks: Dropbox's upload session
    offset: v.number(),
    status: v.union(v.literal("uploading"), v.literal("done"), v.literal("failed")),
    expiresAt: v.number(),
    createdAt: v.number(),
  }).index("by_token", ["token"]).index("by_request", ["requestId"]),

  // Phase 4 (Nov 2): the kickoff brief, one per project (option B). The questions are copied in when it's sent, so
  // editing Settings › Kickoff brief later doesn't change a brief already out. Every portal person on the project
  // answers the same one; answers save as they're typed.
  briefs: defineTable({
    businessId: v.optional(v.id("businesses")),
    projectId: v.id("projects"),
    questions: v.any(),                       // the Questionnaire as sent (lib/questionnaire.ts)
    answers: v.any(),                         // { [questionId]: value }
    step: v.number(),                         // where they left off
    status: v.union(v.literal("sent"), v.literal("submitted")),
    sentAt: v.number(),
    remindedAt: v.optional(v.number()),
    startedAt: v.optional(v.number()),        // first answer saved
    submittedAt: v.optional(v.number()),      // the first time it was sent back
    submittedBy: v.optional(v.string()),      // email
    updatedBy: v.optional(v.string()),
    submits: v.number(),
    history: v.array(v.object({ at: v.number(), text: v.string() })),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_project", ["projectId"]),

  // Phase 5 (Nov 3): raw footage after delivery (D33, D98, D140). One per project, made when its final files first open.
  // The portal never deletes files: it only keeps the offer, the invoices and the dates, and reminds the owner.
  footageStorage: defineTable({
    businessId: v.optional(v.id("businesses")),
    projectId: v.id("projects"),
    clientId: v.optional(v.id("clients")),
    priceCents: v.number(),                    // the yearly price when it was offered
    offeredAt: v.number(),
    keepUntil: v.string(),                     // YYYY-MM-DD (Central): kept until this day unless they keep it (D98)
    status: v.union(
      v.literal("offered"),   // no answer yet
      v.literal("declined"),  // No thanks (Keep it still works until keepUntil)
      v.literal("kept"),      // Keep it pressed: the first year's invoice is drafted / sent, not paid yet
      v.literal("paid"),      // a year paid: kept until paidUntil
      v.literal("drive"),     // the owner copied it to the client's own drive (D98)
      v.literal("ended"),     // the keep day (or the paid year) passed: the owner was reminded to delete or offload it
      v.literal("stopped"),   // the owner stopped storing it
    ),
    answeredBy: v.optional(v.object({ email: v.string(), name: v.string(), at: v.number() })),
    invoiceId: v.optional(v.id("invoices")),   // the year being paid now (first year, or the renewal)
    paidUntil: v.optional(v.string()),         // YYYY-MM-DD: the paid year runs to here
    renewalFor: v.optional(v.string()),        // the paidUntil a renewal draft was made for (D140): once per year
    endedAt: v.optional(v.number()),           // the owner was told (email 36), once
    doneAt: v.optional(v.number()),            // the owner marked it deleted or moved (clears the Dashboard alert)
    // Review fixes (Nov 3): a storage invoice paid after it ended or was stopped changes nothing by itself: the owner
    // is told and decides (reinstate a year, or refund it); and Keep it pressed but never paid alerts the owner, once.
    latePaid: v.optional(v.object({ invoiceId: v.id("invoices"), at: v.number(), was: v.string() })),
    unpaidAt: v.optional(v.number()),
    // Nov 4 (Q93, Q94): the owner's answer to a late payment, kept for the card's banner. "kept": a year from the day it
    // was paid (until). "refund": marked to refund in Stripe; the box closes once Stripe reports a refund on that invoice
    // (invoices.refundedCents, from the charge.refunded webhook). The portal never refunds anything itself.
    lateChoice: v.optional(v.object({
      kind: v.union(v.literal("kept"), v.literal("refund")), invoiceId: v.id("invoices"), paidAt: v.number(), at: v.number(), by: v.string(),
      until: v.optional(v.string()), was: v.optional(v.string()), wasUntil: v.optional(v.string()),
      // Review L6: the owner closed the "Marked to refund" box by hand (a refund Stripe never reports, e.g. paid from
      // the customer's credit balance, so no charge to refund).
      closedAt: v.optional(v.number()), closedBy: v.optional(v.string()),
    })),
    history: v.array(v.object({ at: v.number(), text: v.string() })),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_project", ["projectId"]).index("by_status", ["status"]).index("by_invoice", ["invoiceId"]),

  // Phase 5 (Nov 3): a client's answers to "Ask for a testimonial" (D34, D139, D141). One per person per ask; saved as
  // a Markdown note in Dropbox (Apps/Wrangler Review/Testimonials/) for Heston's vault. Nothing is published.
  testimonials: defineTable({
    businessId: v.optional(v.id("businesses")),
    noteId: v.id("inboxNotes"),
    projectId: v.id("projects"),
    clientId: v.optional(v.id("clients")),
    email: v.string(),
    name: v.string(),
    company: v.optional(v.string()),
    working: v.string(),                       // "What was it like working with us?"
    film: v.string(),                          // "What did the film do for you?"
    permission: v.boolean(),                   // "You can use my words and name on your website."
    readAt: v.optional(v.number()),
    dropboxPath: v.optional(v.string()),       // where the note was saved
    savedAt: v.optional(v.number()),
    saveError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_note_email", ["noteId", "email"]).index("by_created", ["createdAt"]),

  inboxItems: defineTable({
    businessId: v.optional(v.id("businesses")),
    clientId: v.optional(v.id("clients")),
    email: v.string(),                 // the recipient, lower-case (a person with a live invite in this business)
    kind: v.union(v.literal("cut_ready"), v.literal("reply"), v.literal("to_sign"), v.literal("signed"), v.literal("cancelled"), v.literal("note"), v.literal("stage"), v.literal("final_files"), v.literal("invoice"), v.literal("payment"), v.literal("subscription"), v.literal("shoot"), v.literal("files"), v.literal("brief"), v.literal("message")),
    title: v.string(),
    text: v.string(),                  // a short line, shown under the title
    link: v.optional(v.string()),      // a path in the portal or a signing link
    linkLabel: v.optional(v.string()), // a note's link button ("Watch Harbor Coffee 30s v2")
    source: v.object({ module: v.union(v.literal("review"), v.literal("sign"), v.literal("inbox"), v.literal("projects"), v.literal("payments"), v.literal("schedule"), v.literal("messages")), id: v.string() }),
    key: v.string(),
    noteId: v.optional(v.id("inboxNotes")),
    createdAt: v.number(),
    readAt: v.optional(v.number()),
    emailedAt: v.optional(v.number()),
  }).index("by_email", ["email", "createdAt"]).index("by_key", ["key"]).index("by_client", ["clientId", "createdAt"]).index("by_note", ["noteId"]),

  // Phase 1 (Oct 29): notes the owner posts to a client's Inbox. A draft (the owner's, or one Claude wrote through
  // the connector) does nothing until the owner sends it on the site. The Sent list reads this table.
  inboxNotes: defineTable({
    businessId: v.optional(v.id("businesses")),
    clientId: v.id("clients"),
    title: v.string(),
    text: v.string(),
    link: v.optional(v.string()),
    status: v.union(v.literal("draft"), v.literal("sent"), v.literal("discarded")),
    draftedBy: v.union(v.literal("owner"), v.literal("claude")),
    said: v.optional(v.string()),      // for a Claude draft: what Claude said Heston asked for
    to: v.optional(v.array(v.string())), // picked people (emails); missing = everyone at the client with portal access
    emailThem: v.optional(v.boolean()),  // "Also email them" (on by default; the emails arrive with the one-email switch)
    linkLabel: v.optional(v.string()),
    testimonialProjectId: v.optional(v.id("projects")), // Phase 5 (D139): "Ask for a testimonial": the note links to the form for this project
    createdAt: v.number(),
    updatedAt: v.number(),
    sentAt: v.optional(v.number()),
    recipients: v.optional(v.number()),
  }).index("by_status", ["status", "createdAt"]).index("by_client", ["clientId", "createdAt"]),

  // Phase 5b step 4 (D127): a call-sheet guest's pass: one per guest per sheet. Global (like memberships), so a guest's
  // sheets can be found by email before any business is known; it holds ids and the link token only, never sheet content.
  // The call sheet's recipient row stays the truth (on, sent, ended); every guest function re-checks it and the sheet.
  guestPasses: defineTable({
    businessId: v.id("businesses"),
    callSheetId: v.id("callSheets"),
    personId: v.string(),                     // the recipient's id on the sheet: guest:<random>
    email: v.string(),                        // lower-case
    token: v.string(),                        // the link in email 41: /guest/<token>
    createdAt: v.number(),
    codeHash: v.optional(v.string()),         // the 6-digit sign-in code, hashed with the pass id; one at a time
    codeExpiresAt: v.optional(v.number()),
    codeTries: v.optional(v.number()),        // wrong tries on this code (5 and it's gone)
    codeSentAt: v.optional(v.number()),
    wrongDay: v.optional(v.string()),         // review L5: wrong codes today (Central), 15 locks the pass…
    wrongCount: v.optional(v.number()),
    lockedAt: v.optional(v.number()),         // …until the owner sends it to them again (Send an update or Remind)
    sentAt: v.optional(v.number()),           // review L2: the sheet went to them (Q88: kept when access ends); a hint for /guest's
    date: v.optional(v.string()),             //   business list only, never for access (lib/guests.ts sheetState decides that)
    openedAt: v.optional(v.number()),         // Q88: the guest opened it (the switcher's "N new"); a hint like sentAt
    // Review L12: they can't open it until it's sent to them again (access ended by hand, unticked, or restored and not
    // sent yet) or ever (the shoot was cancelled). Set and cleared with the sheet; a hint for "N new" only.
    offAt: v.optional(v.number()),
    // Review L13: the heading and day as last sent to this guest, for their Ended row (never a later update's).
    heading: v.optional(v.object({ title: v.string(), date: v.string() })),
  }).index("by_token", ["token"]).index("by_email", ["email"]).index("by_sheet", ["callSheetId"]),

  memberships: defineTable({
    businessId: v.id("businesses"),
    email: v.string(),              // lower-case
    userId: v.optional(v.id("users")),
    role: v.union(v.literal("owner"), v.literal("client"), v.literal("vendor"), v.literal("team")), // vendor: Phase 3c, one per business they work for (D94); team: Phase 5e
    createdAt: v.number(),
    revokedAt: v.optional(v.number()),
    // Phase 5e (Nov 5): a team member's role and switches (lib/perms.ts). Made only by team.ts when their invite is accepted.
    teamRole: v.optional(v.union(v.literal("producer"), v.literal("editor"), v.literal("bookkeeper"))),
    perms: v.optional(v.any()),
    invitedBy: v.optional(v.string()),
  }).index("by_email", ["email"]).index("by_business_email", ["businessId", "email"]).index("by_user", ["userId"]),

  // Phase 5e (Nov 5): an invite to join a business's team (Settings › Team, email 46). The link carries a long random
  // token; only its hash is kept. Lasts 14 days (D146). Accepting makes a team membership (team.ts, auth.ts).
  teamInvites: defineTable({
    businessId: v.optional(v.id("businesses")),
    email: v.string(),              // lower-case
    name: v.optional(v.string()),
    teamRole: v.union(v.literal("producer"), v.literal("editor"), v.literal("bookkeeper")),
    tokenHash: v.string(),
    invitedBy: v.string(),          // the owner's name, for the email and the Join page
    createdAt: v.number(),
    sentAt: v.number(),
    expiresAt: v.number(),
    revokedAt: v.optional(v.number()),
    acceptedAt: v.optional(v.number()),
    userId: v.optional(v.id("users")),
  }).index("by_email", ["email"]).index("by_token", ["tokenHash"]).index("by_business", ["businessId"]),

  // Phase 5e step 4 (Nov 5): the notification centre. One row per person (the owner, and team members whose switches cover
  // the kind), kept 90 days (D146). Made from the owner emails (lib/bell.ts EMAIL_TO_BELL).
  bellItems: defineTable({
    businessId: v.optional(v.id("businesses")),
    userId: v.id("users"),
    kind: v.string(),          // lib/bell.ts BellKind
    title: v.string(),
    link: v.optional(v.string()),
    key: v.string(),           // one item per event per person
    at: v.number(),
    readAt: v.optional(v.number()),
  }).index("by_user_at", ["userId", "at"]).index("by_user_key", ["userId", "key"]).index("by_at", ["at"]),
  // A person's bell and phone switches (Settings › Notifications): kinds off in the bell, and kinds on for the phone
  // (unset: lib/bell.ts PHONE_DEFAULT).
  alertPrefs: defineTable({
    userId: v.id("users"),
    bellOff: v.array(v.string()),
    phoneOn: v.optional(v.array(v.string())),
  }).index("by_user", ["userId"]),
  // A phone (or browser) that turned alerts on: its Web Push address and keys (D146: every device a person turns on).
  pushSubs: defineTable({
    userId: v.id("users"),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    label: v.string(),
    createdAt: v.number(),
    fails: v.optional(v.number()),
  }).index("by_user", ["userId"]).index("by_endpoint", ["endpoint"]),
  // The portal's own Web Push key pair (VAPID), made on the server the first time it's needed; never in chat or the repo.
  pushKeys: defineTable({ publicKey: v.string(), privateKey: v.string(), createdAt: v.number() }),

  // Phase 5e step 3 (Nov 5): Settings › Activity, the owner's log of who changed what (D146: new-device sign-ins, anything
  // sent, signatures, marked paid, voids and deletions, settings, team changes, exports). Kept 1 year (crons.ts).
  auditLog: defineTable({
    businessId: v.optional(v.id("businesses")),
    at: v.number(),
    kind: v.union(v.literal("sent"), v.literal("signed"), v.literal("paid"), v.literal("deleted"), v.literal("settings"), v.literal("signin"), v.literal("team"), v.literal("export")),
    who: v.string(),            // "Heston Hill", "Maya Brooks", "Stripe"
    role: v.string(),           // "Owner", "Producer", "Client", "System"
    userId: v.optional(v.id("users")),
    text: v.string(),           // after the name: "sent proposal WRNGLR-P-0007"
    where: v.optional(v.string()), // "Harbor Coffee › Proposals"
    link: v.optional(v.string()),  // the page that opens it
    device: v.optional(v.string()), // "Mac · Chrome"
  }).index("by_business_at", ["businessId", "at"]).index("by_at", ["at"]),

  // Phase 5e step 2 (Nov 5): Settings › Security. A signed-in browser (one per session): its label ("Mac · Chrome"), and a
  // random key the browser keeps, so a sign-in from a browser not seen before sends email 47 (owner and team).
  sessionDevices: defineTable({
    userId: v.id("users"),
    sessionId: v.id("authSessions"),
    deviceKey: v.string(),
    label: v.string(),
    firstSeen: v.number(),
    lastSeen: v.number(),
  }).index("by_user", ["userId"]).index("by_session", ["sessionId"]),
  // A change of sign-in email waiting for its 6-digit code (sent to the new address; 10 minutes; 5 tries).
  emailChanges: defineTable({
    userId: v.id("users"),
    newEmail: v.string(),
    codeHash: v.string(),
    tries: v.number(),
    sentAt: v.number(),
    until: v.number(),
  }).index("by_user", ["userId"]),

  // Phase 5e (Nov 5): who is assigned to a project (Project page › Assigned people). Team members only (D146).
  projectTeam: defineTable({
    businessId: v.optional(v.id("businesses")),
    projectId: v.id("projects"),
    userId: v.id("users"),
    createdAt: v.number(),
  }).index("by_project", ["projectId"]).index("by_user", ["userId"]),
});
