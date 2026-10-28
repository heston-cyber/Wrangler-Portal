// The MCP protocol side, shared by the two Claude connectors (Wrangler Review at /mcp, Wrangler Sign at /ws-mcp).
// Streamable HTTP, plain JSON replies, no sessions. Dual-era: 2026-07-28 clients statelessly (per-request _meta,
// server/discover) and older clients that open with `initialize` (2025-03-26 … 2025-11-25). Moved here from mcp.ts
// unchanged when Wrangler Sign got its own connector (S4, Oct 27).
import type { ActionCtx } from "../_generated/server";
import { forBusiness } from "./functions";
import type { Id } from "../_generated/dataModel";

export const MODERN = ["2026-07-28"];
export const LEGACY = ["2025-11-25", "2025-06-18", "2025-03-26"];
export const SUPPORTED = [...MODERN, ...LEGACY];

export type Json = Record<string, unknown>;
export type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string } | { type: "resource"; resource: { uri: string; mimeType: string; blob: string } };
export type ToolResult = { content: Content[]; structuredContent?: Json; isError?: boolean };
export type Tool = { name: string; title: string; description: string; inputSchema: Json; annotations?: Json };

export const text = (t: string): Content => ({ type: "text", text: t });
export const ok = (data: Json | Json[]): ToolResult => ({
  content: [text(JSON.stringify(data, null, 1))],
  structuredContent: Array.isArray(data) ? { items: data } : data,
});
export const fail = (msg: string, extra?: Json): ToolResult => ({ content: [text(extra ? `${msg}\n${JSON.stringify(extra, null, 1)}` : msg)], isError: true });

export type McpConfig = {
  serverInfo: { name: string; title: string; version: string };
  instructions: string;
  tools: Tool[];
  callTool: (ctx: ActionCtx, name: string, args: Json) => Promise<ToolResult>;
  /** Is this request's key live? (The key comes from Authorization: Bearer, X-API-Key, or the address.) */
  // A live key: false, or the business it belongs to (Phase 0.5d step 4: the connector then acts only for it).
  authorized: (ctx: ActionCtx, key: string) => Promise<false | { businessId: Id<"businesses"> | null }>;
  keyPrefix: string;          // "wr_" or "ws_"
  pathPrefix: string;         // "/mcp" or "/ws-mcp": the key can also ride in the address as <pathPrefix>/<key>
  unauthorized: string;       // what a request without a working key is told
};


type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Json };
export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const rpcError = (id: Rpc["id"], code: number, message: string, data?: unknown, status = 200) =>
  json({ jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data !== undefined ? { data } : {}) } }, status);

export const ALLOWED_ORIGINS = [/^https:\/\/([a-z0-9-]+\.)*claude\.ai$/, /^https:\/\/([a-z0-9-]+\.)*anthropic\.com$/, /^https:\/\/(review|app)\.wranglerportal\.com$/];

function decodeHeader(v: string | null) {
  if (!v) return v;
  const m = /^=\?base64\?(.*)\?=$/.exec(v);
  if (!m) return v;
  try { return new TextDecoder().decode(Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0))); } catch { return null; }
}

async function authorized(ctx: ActionCtx, req: Request, cfg: McpConfig) {
  const auth = req.headers.get("authorization") || "";
  // The key goes in a header when Claude offers "Request headers"; otherwise it can ride in the address (<path>/<key>).
  const path = new URL(req.url).pathname;
  const inPath = path.startsWith(cfg.pathPrefix + "/") ? path.slice(cfg.pathPrefix.length + 1).replace(/\/$/, "") : "";
  const key = (/^Bearer\s+(\S+)$/i.exec(auth)?.[1] || req.headers.get("x-api-key") || inPath || "").trim();
  if (!key.startsWith(cfg.keyPrefix) || key.length < 20 || !/^[A-Za-z0-9_-]+$/.test(key)) return false;
  return await cfg.authorized(ctx, key);
}

async function handle(ctx: ActionCtx, req: Request, msg: Rpc, cfg: McpConfig): Promise<{ body: unknown; status: number } | null> {
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
  const reply = (result: Json) => ({ body: { jsonrpc: "2.0", id: msg.id, result: modern ? { resultType: "complete", ...result, _meta: { "io.modelcontextprotocol/serverInfo": cfg.serverInfo } } : result }, status: 200 });
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
        serverInfo: cfg.serverInfo,
        instructions: cfg.instructions,
      });
    }
    case "server/discover":
      return reply({ supportedVersions: SUPPORTED, capabilities: { tools: {} }, instructions: cfg.instructions, ttlMs: 3_600_000, cacheScope: "private" });
    case "ping":
      return reply({});
    case "tools/list":
      return reply(modern ? { tools: cfg.tools, ttlMs: 300_000, cacheScope: "private" } : { tools: cfg.tools });
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      if (!cfg.tools.some((t) => t.name === name)) return err(-32602, `Unknown tool: ${name}`);
      const result = await cfg.callTool(ctx, name, (params.arguments ?? {}) as Json);
      return reply(result as unknown as Json);
    }
    default:
      return err(-32601, `Method not found: ${msg.method}`, undefined, modern ? 404 : 200);
  }
}

export async function servePost(ctx: ActionCtx, req: Request, cfg: McpConfig): Promise<Response> {
  const origin = req.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.some((r) => r.test(origin))) return rpcError(null, -32000, "Origin not allowed", undefined, 403);
  const who = await authorized(ctx, req, cfg);
  if (!who) {
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message: cfg.unauthorized } }), {
      status: 401, headers: { "content-type": "application/json" },
    });
  }
  ctx = forBusiness(ctx, who.businessId); // every tool call from here on sees only the key's business
  let body: unknown;
  try { body = await req.json(); } catch { return rpcError(null, -32700, "Parse error", undefined, 400); }

  if (Array.isArray(body)) {
    // Legacy JSON-RPC batch (2025-03-26).
    const out = [];
    for (const m of body) { const r = await handle(ctx, req, m as Rpc, cfg); if (r) out.push(r.body); }
    return out.length ? json(out) : new Response(null, { status: 202 });
  }
  const r = await handle(ctx, req, body as Rpc, cfg);
  if (!r) return new Response(null, { status: 202 });
  return json(r.body, r.status);
}

// No standalone streams or sessions: GET and DELETE aren't supported.
export const serveOther = () => new Response(null, { status: 405, headers: { allow: "POST" } });
