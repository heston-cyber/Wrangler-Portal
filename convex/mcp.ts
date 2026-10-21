// The Claude connector: an MCP server on Streamable HTTP at <convex site>/mcp.
// Dual-era: serves 2026-07-28 clients statelessly (per-request _meta, server/discover) and older clients
// that open with `initialize` (2025-03-26 … 2025-11-25). Every request must carry a connector key
// (Authorization: Bearer wr_… or X-API-Key: wr_…, or as a last resort in the address: /mcp/wr_…). Replies always answer as plain JSON, never SSE.
import { httpAction, internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { sha256Hex } from "./connector";

const MODERN = ["2026-07-28"];
const LEGACY = ["2025-11-25", "2025-06-18", "2025-03-26"];
const SUPPORTED = [...MODERN, ...LEGACY];
const SERVER_INFO = { name: "wrangler-review", title: "Wrangler Review", version: "1.0.0" };

const INSTRUCTIONS = `Wrangler Review is Heston's video review site (Wrangler Productions). Notes are pinned to exact frames of a rendered version: frame 0 is the render's first frame; out_frame is inclusive. Timecodes use the version's start timecode (usually 01:00:00:00).
Typical flow when Heston says he left notes or revisions: find_videos (if you don't have the video) → get_notes (open notes on the latest version) → get_note_images for notes with drawings or when you need to see the frame → do the work → reply_to_note to say what you changed → mark_notes done.
To put notes into DaVinci Resolve as markers, use get_resolve_markers and follow its placement rules: confirm the timeline's frame rate, start timecode and length match the render before placing anything; if they don't, stop and tell Heston.`;

type Json = Record<string, unknown>;
type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
type ToolResult = { content: Content[]; structuredContent?: Json; isError?: boolean };

const videoArgs = {
  video_id: { type: "string", description: "The video's id from find_videos. Use this when you have it." },
  video: { type: "string", description: "Words from the video title, project name or job number, used when you don't have video_id." },
  version: { type: "integer", minimum: 1, description: "Version number, e.g. 2 for v2. Leave out for the latest version." },
  status: { type: "string", enum: ["open", "done", "all"], description: "Which notes: open (default), done, or all." },
};

const TOOLS = [
  {
    name: "find_videos", title: "Find videos",
    description: "Lists projects and videos on Wrangler Review with their versions and open/total note counts, newest activity first. Pass query to filter by words from the title, project name, job number or client.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Words to match, e.g. \"spirit intro\" or \"26122\"." } }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "get_notes", title: "Get notes",
    description: "Gets the review notes on a version (the latest unless you pass version): each note's text, type (frame, range or whole_video), exact in/out frames and timecodes, author, replies, drawing shapes (as positions on the picture) and a link. Also returns the version's frame rate, start timecode and frame count. Defaults to open notes.",
    inputSchema: { type: "object", properties: videoArgs, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "get_note_images", title: "Get note images",
    description: "Returns the saved frames for notes as images: the frame with the drawing on it, and for ranges the first and last frame. Use it for notes with drawings, or whenever you need to see what the note is about. Up to 8 notes per call.",
    inputSchema: { type: "object", properties: { note_ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 8, description: "note_id values from get_notes." } }, required: ["note_ids"], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "get_resolve_markers", title: "Get Resolve markers",
    description: "Gets the notes of a version as DaVinci Resolve timeline markers: frame (from the render's first frame), timecode, duration in frames, colour (Blue = frame, Yellow = range, Green = whole video), name, note text and custom_data (the note id). Also returns the render's frame rate, start timecode and frame count, placement rules to follow, and an EDL of the same markers for File › Import › Timeline Markers from EDL. Defaults to open notes.",
    inputSchema: { type: "object", properties: videoArgs, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "reply_to_note", title: "Reply to a note",
    description: "Adds a reply to a note on the site, signed \"Claude\". Use it to say what you changed for that note, or to ask Heston a question about it.",
    inputSchema: { type: "object", properties: { note_id: { type: "string" }, text: { type: "string", minLength: 1 } }, required: ["note_id", "text"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "mark_notes", title: "Mark notes done or open",
    description: "Sets notes to done (handled) or back to open. Only mark a note done once its change is actually made, or when Heston says so.",
    inputSchema: { type: "object", properties: { note_ids: { type: "array", items: { type: "string" }, minItems: 1 }, status: { type: "string", enum: ["done", "open"] } }, required: ["note_ids", "status"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

const text = (t: string): Content => ({ type: "text", text: t });
const ok = (data: Json | Json[]): ToolResult => ({
  content: [text(JSON.stringify(data, null, 1))],
  structuredContent: Array.isArray(data) ? { items: data } : data,
});
const fail = (msg: string, extra?: Json): ToolResult => ({ content: [text(extra ? `${msg}\n${JSON.stringify(extra, null, 1)}` : msg)], isError: true });

function bytesToBase64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function fetchImage(url: string): Promise<Content | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (!buf.length || buf.length > 4_000_000) return null;
    const mime = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
    return { type: "image", data: bytesToBase64(buf), mimeType: mime.startsWith("image/") ? mime : "image/jpeg" };
  } catch {
    return null;
  }
}

const str = (x: unknown) => (typeof x === "string" && x.trim() ? x : undefined);
const int = (x: unknown) => (typeof x === "number" && Number.isInteger(x) && x > 0 ? x : undefined);

async function callTool(ctx: ActionCtx, name: string, args: Json): Promise<ToolResult> {
  try {
    if (name === "find_videos") {
      const rows = await ctx.runQuery(internal.connector.findVideos, { query: str(args.query) });
      return ok(rows.length ? rows : [{ note: str(args.query) ? `Nothing matches "${args.query}".` : "No videos yet." }]);
    }
    if (name === "get_notes" || name === "get_resolve_markers") {
      const a = { videoId: str(args.video_id), video: str(args.video), version: int(args.version), status: str(args.status) };
      const res = name === "get_notes" ? await ctx.runQuery(internal.connector.notesFor, a) : await ctx.runQuery(internal.connector.markersFor, a);
      if ("error" in res) return fail(res.error as string, "candidates" in res && res.candidates ? { candidates: res.candidates } : undefined);
      return ok(res as Json);
    }
    if (name === "get_note_images") {
      const ids = Array.isArray(args.note_ids) ? (args.note_ids as unknown[]).filter((x): x is string => typeof x === "string") : [];
      if (!ids.length) return fail("Pass note_ids: the note_id values from get_notes.");
      const rows = await ctx.runQuery(internal.connector.notesForImages, { noteIds: ids });
      const content: Content[] = [];
      let images = 0;
      for (const r of rows) {
        if (r.missing) { content.push(text(`Note ${r.note_id}: not found.`)); continue; }
        const head = `Note ${r.note_id} · ${r.type}${r.in_timecode ? ` · ${r.in_timecode}` : ""}${r.out_timecode ? ` → ${r.out_timecode}` : ""}: ${r.text || "(drawing only)"}`;
        const shots: Array<[string, string | null]> = r.type === "range"
          ? [["Frame with the drawing", r.drawing_timecode && r.still !== r.stillIn ? r.still : null], ["First frame of the range", r.stillIn], ["Last frame of the range", r.stillOut]]
          : [[r.drawing_timecode ? `Frame ${r.drawing_timecode} with the drawing` : "The frame", r.still]];
        content.push(text(head));
        let any = false;
        for (const [label, url] of shots) {
          if (!url || images >= 12) continue;
          const img = await fetchImage(url);
          if (img) { content.push(text(label + ":"), img); images++; any = true; }
        }
        if (!any) content.push(text("(No saved image for this note.)"));
      }
      return { content };
    }
    if (name === "reply_to_note") {
      const noteId = str(args.note_id), t = str(args.text);
      if (!noteId || !t) return fail("Pass note_id and text.");
      return ok(await ctx.runMutation(internal.connector.replyAsClaude, { noteId, text: t }));
    }
    if (name === "mark_notes") {
      const ids = Array.isArray(args.note_ids) ? (args.note_ids as unknown[]).filter((x): x is string => typeof x === "string") : [];
      const status = args.status === "done" || args.status === "open" ? args.status : null;
      if (!ids.length || !status) return fail("Pass note_ids and status (done or open).");
      return ok(await ctx.runMutation(internal.connector.setStatuses, { noteIds: ids, status }));
    }
    return fail(`Unknown tool: ${name}`);
  } catch (e) {
    return fail(((e as Error).message || "Something went wrong.").replace(/^.*ConvexError: /, "").split("\n")[0]);
  }
}

// ---------- JSON-RPC over HTTP ----------

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Json };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const rpcError = (id: Rpc["id"], code: number, message: string, data?: unknown, status = 200) =>
  json({ jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data !== undefined ? { data } : {}) } }, status);

const ALLOWED_ORIGINS = [/^https:\/\/([a-z0-9-]+\.)*claude\.ai$/, /^https:\/\/([a-z0-9-]+\.)*anthropic\.com$/, /^https:\/\/review\.wranglerportal\.com$/];

function decodeHeader(v: string | null) {
  if (!v) return v;
  const m = /^=\?base64\?(.*)\?=$/.exec(v);
  if (!m) return v;
  try { return new TextDecoder().decode(Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0))); } catch { return null; }
}

async function authorized(ctx: ActionCtx, req: Request) {
  const auth = req.headers.get("authorization") || "";
  // The key goes in a header when Claude offers "Request headers"; otherwise it can ride in the address (/mcp/<key>).
  const inPath = /^\/mcp\/(wr_[A-Za-z0-9_-]+)\/?$/.exec(new URL(req.url).pathname)?.[1];
  const key = (/^Bearer\s+(\S+)$/i.exec(auth)?.[1] || req.headers.get("x-api-key") || inPath || "").trim();
  if (!key.startsWith("wr_") || key.length < 20) return false;
  return await ctx.runMutation(internal.connector.checkKey, { hash: await sha256Hex(key) });
}

async function handle(ctx: ActionCtx, req: Request, msg: Rpc): Promise<{ body: unknown; status: number } | null> {
  if (!msg || typeof msg !== "object" || typeof msg.method !== "string") {
    // A JSON-RPC response or junk: nothing to answer.
    return null;
  }
  const isRequest = msg.id !== undefined && msg.id !== null;
  if (!isRequest) return null; // notifications (e.g. notifications/initialized) are accepted silently
  const params = (msg.params ?? {}) as Json;
  const meta = (params._meta ?? {}) as Json;
  const metaVersion = typeof meta["io.modelcontextprotocol/protocolVersion"] === "string" ? (meta["io.modelcontextprotocol/protocolVersion"] as string) : null;
  const modern = msg.method !== "initialize" && metaVersion !== null;
  const reply = (result: Json) => ({ body: { jsonrpc: "2.0", id: msg.id, result: modern ? { resultType: "complete", ...result, _meta: { "io.modelcontextprotocol/serverInfo": SERVER_INFO } } : result }, status: 200 });
  const err = (code: number, message: string, data?: unknown, status = 200) => ({ body: { jsonrpc: "2.0", id: msg.id, error: { code, message, ...(data !== undefined ? { data } : {}) } }, status });

  if (modern) {
    if (!MODERN.includes(metaVersion!)) {
      if (LEGACY.includes(metaVersion!)) {
        // A legacy version sent the modern way: serve it anyway, it's the same data.
      } else return err(-32022, "Unsupported protocol version", { supported: SUPPORTED, requested: metaVersion }, 400);
    }
    // Header/body consistency (2026-07-28). Missing headers are tolerated; mismatches are refused.
    const hv = req.headers.get("mcp-protocol-version");
    if (hv && hv !== metaVersion) return err(-32020, `Header mismatch: MCP-Protocol-Version ${hv} does not match body ${metaVersion}`, undefined, 400);
    const hm = req.headers.get("mcp-method");
    if (hm && hm !== msg.method) return err(-32020, `Header mismatch: Mcp-Method ${hm} does not match body ${msg.method}`, undefined, 400);
    const hn = req.headers.get("mcp-name");
    if (hn && msg.method === "tools/call" && decodeHeader(hn) !== params.name) return err(-32020, "Header mismatch: Mcp-Name does not match the tool name", undefined, 400);
  }

  switch (msg.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : LEGACY[0];
      return reply({
        protocolVersion: LEGACY.includes(asked) ? asked : LEGACY[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "server/discover":
      return reply({ supportedVersions: SUPPORTED, capabilities: { tools: {} }, instructions: INSTRUCTIONS, ttlMs: 3_600_000, cacheScope: "private" });
    case "ping":
      return reply({});
    case "tools/list":
      return reply(modern ? { tools: TOOLS, ttlMs: 300_000, cacheScope: "private" } : { tools: TOOLS });
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      if (!TOOLS.some((t) => t.name === name)) return err(-32602, `Unknown tool: ${name}`);
      const result = await callTool(ctx, name, (params.arguments ?? {}) as Json);
      return reply(result as unknown as Json);
    }
    default:
      return err(-32601, `Method not found: ${msg.method}`, undefined, modern ? 404 : 200);
  }
}

export const mcpPost = httpAction(async (ctx, req) => {
  const origin = req.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.some((r) => r.test(origin))) return rpcError(null, -32000, "Origin not allowed", undefined, 403);
  if (!(await authorized(ctx, req))) {
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized: this connector needs its key (Authorization: Bearer wr_…). Create one on the review site under Settings → Claude connector." } }), {
      status: 401, headers: { "content-type": "application/json" },
    });
  }
  let body: unknown;
  try { body = await req.json(); } catch { return rpcError(null, -32700, "Parse error", undefined, 400); }

  if (Array.isArray(body)) {
    // Legacy JSON-RPC batch (2025-03-26).
    const out = [];
    for (const m of body) { const r = await handle(ctx, req, m as Rpc); if (r) out.push(r.body); }
    return out.length ? json(out) : new Response(null, { status: 202 });
  }
  const r = await handle(ctx, req, body as Rpc);
  if (!r) return new Response(null, { status: 202 });
  return json(r.body, r.status);
});

// No standalone streams or sessions: GET and DELETE aren't supported here.
export const mcpOther = httpAction(async () => new Response(null, { status: 405, headers: { allow: "POST" } }));


// ---------- live self-test (run from CI with `convex run mcp:selfTest`) ----------
// Makes a temporary key, calls this deployment's /mcp the way Claude would, then deletes the key.
// The CI logs are public, so it returns only pass/fail, status codes and counts: no key, no titles, no note text.
export const selfTest = internalAction({
  args: {},
  handler: async (ctx) => {
    const base = (process.env.CONVEX_SITE_URL || "").replace(/\/$/, "");
    if (!base) return { ok: false, error: "CONVEX_SITE_URL is not set" };
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const key = "wr_" + bytesToBase64(bytes).replace(/[+/=]/g, "x");
    const keyId = await ctx.runMutation(internal.connector.insertTestKey, { hash: await sha256Hex(key) });
    const checks: Array<{ check: string; pass: boolean; detail: string }> = [];
    const meta = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "selftest", version: "1" }, "io.modelcontextprotocol/clientCapabilities": {} };
    const post = async (body: unknown, headers: Record<string, string> = {}, auth: string | null = `Bearer ${key}`) => {
      const res = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(auth ? { authorization: auth } : {}), ...headers }, body: JSON.stringify(body) });
      const txt = await res.text();
      let j: any = null;
      try { j = txt ? JSON.parse(txt) : null; } catch { /* not json */ }
      return { status: res.status, j };
    };
    const add = (check: string, pass: boolean, detail: string) => checks.push({ check, pass, detail });
    try {
      let r = await post({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: meta } }, {}, null);
      add("no key is refused", r.status === 401, `HTTP ${r.status}`);
      r = await post({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: meta } }, {}, "Bearer wr_wrongwrongwrongwrongwrongwrong");
      add("wrong key is refused", r.status === 401, `HTTP ${r.status}`);
      r = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "selftest", version: "1" } } });
      add("legacy initialize", r.status === 200 && r.j?.result?.protocolVersion === "2025-06-18" && !!r.j?.result?.capabilities?.tools, `HTTP ${r.status} · version ${r.j?.result?.protocolVersion}`);
      const pk = await fetch(`${base}/mcp/${key}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) });
      const pj: any = await pk.json().catch(() => null);
      add("key in the address works", pk.status === 200 && pj?.result?.tools?.length === TOOLS.length, `HTTP ${pk.status}`);
      const pw = await fetch(`${base}/mcp/wr_wrongwrongwrongwrongwrongwrong`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) });
      add("wrong key in the address refused", pw.status === 401, `HTTP ${pw.status}`);
      r = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
      add("notification accepted", r.status === 202, `HTTP ${r.status}`);
      r = await post({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, { "mcp-protocol-version": "2025-06-18" });
      add("legacy tools/list", r.status === 200 && r.j?.result?.tools?.length === TOOLS.length, `HTTP ${r.status} · ${r.j?.result?.tools?.length} tools`);
      r = await post({ jsonrpc: "2.0", id: 3, method: "server/discover", params: { _meta: meta } }, { "mcp-protocol-version": "2026-07-28", "mcp-method": "server/discover" });
      add("modern server/discover", r.status === 200 && r.j?.result?.resultType === "complete" && (r.j?.result?.supportedVersions ?? []).includes("2026-07-28"), `HTTP ${r.status}`);
      r = await post({ jsonrpc: "2.0", id: 4, method: "tools/list", params: { _meta: meta } }, { "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/list" });
      add("modern tools/list", r.status === 200 && r.j?.result?.tools?.length === TOOLS.length && typeof r.j?.result?.ttlMs === "number", `HTTP ${r.status} · ${r.j?.result?.tools?.length} tools`);
      r = await post({ jsonrpc: "2.0", id: 5, method: "tools/list", params: { _meta: { ...meta, "io.modelcontextprotocol/protocolVersion": "2099-01-01" } } });
      add("unknown version refused", r.status === 400 && r.j?.error?.code === -32022, `HTTP ${r.status} · code ${r.j?.error?.code}`);
      r = await post({ jsonrpc: "2.0", id: 6, method: "tools/list", params: { _meta: meta } }, { "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/call" });
      add("header mismatch refused", r.status === 400 && r.j?.error?.code === -32020, `HTTP ${r.status} · code ${r.j?.error?.code}`);
      const call = (name: string, args: Json, id: number) => post({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args, _meta: meta } }, { "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/call", "mcp-name": name });
      r = await call("find_videos", {}, 7);
      const vids = (r.j?.result?.structuredContent?.items ?? []) as Array<{ video_id?: string }>;
      add("find_videos", r.status === 200 && !r.j?.result?.isError, `HTTP ${r.status} · ${vids.filter((x) => x.video_id).length} videos`);
      const first = vids.find((x) => x.video_id);
      if (first) {
        r = await call("get_notes", { video_id: first.video_id, status: "all" }, 8);
        const sc = r.j?.result?.structuredContent;
        add("get_notes", r.status === 200 && !r.j?.result?.isError && Array.isArray(sc?.notes), `HTTP ${r.status} · ${sc?.notes?.length} notes · fps ${sc?.version?.frame_rate} · ${sc?.version?.frame_count} frames`);
        r = await call("get_resolve_markers", { video_id: first.video_id, status: "all" }, 9);
        const mk = r.j?.result?.structuredContent;
        add("get_resolve_markers", r.status === 200 && !r.j?.result?.isError && Array.isArray(mk?.markers) && typeof mk?.edl === "string", `HTTP ${r.status} · ${mk?.markers?.length} markers`);
        const withImage = (sc?.notes ?? []).find((n: { has_images?: boolean }) => n.has_images);
        if (withImage) {
          r = await call("get_note_images", { note_ids: [withImage.note_id] }, 10);
          const imgs = (r.j?.result?.content ?? []).filter((c: { type: string }) => c.type === "image").length;
          add("get_note_images", r.status === 200 && imgs > 0, `HTTP ${r.status} · ${imgs} image(s)`);
        }
      }
      r = await call("reply_to_note", { note_id: "not-a-note", text: "test" }, 11);
      add("bad note id is a tool error", r.status === 200 && r.j?.result?.isError === true, `HTTP ${r.status}`);
      r = await post({ jsonrpc: "2.0", id: 12, method: "resources/list", params: { _meta: meta } });
      add("unknown method", r.status === 404 && r.j?.error?.code === -32601, `HTTP ${r.status}`);
      const g = await fetch(`${base}/mcp`, { method: "GET", headers: { authorization: `Bearer ${key}` } });
      add("GET not allowed", g.status === 405, `HTTP ${g.status}`);
      const o = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example", authorization: `Bearer ${key}` }, body: "{}" });
      add("foreign origin refused", o.status === 403, `HTTP ${o.status}`);
    } catch (e) {
      add("ran without crashing", false, (e as Error).message);
    } finally {
      await ctx.runMutation(internal.connector.deleteKey, { keyId });
    }
    return { ok: checks.every((c) => c.pass), passed: checks.filter((c) => c.pass).length, total: checks.length, checks };
  },
});
