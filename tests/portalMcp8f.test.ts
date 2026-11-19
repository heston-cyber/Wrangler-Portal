// Phase 8f (Heston, Nov 19, 12:30: "There should only be one main one for everything"; 12:31: "approved"):
//   T8f.1 the old Review (/mcp) and Sign (/ws-mcp) addresses are gone (tests/connector.test.ts)
//   T8f.2 the one connector does everything the old two did: every old tool is on it, and a Review and a Sign tool
//         answer with the owner's key
//   T8f.3 Settings › Claude connectors shows only Wrangler Portal; the old panels and their key functions are gone
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import { world } from "./payHarness";
import { TOOLS as REVIEW_TOOLS } from "../convex/mcp";
import { TOOLS as SIGN_TOOLS } from "../convex/wsMcp";

const api = anyApi;
const root = join(__dirname, "..");
beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("Phase 8f · one connector", () => {
  test("T8f.2 every old Review and Sign tool is on the one connector, and both kinds answer with the owner's key", async () => {
    const w = await world();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    const key = (await w.heston.action(api.portalKeys.createKey, {})).key as string;
    const rpc = async (body: unknown) => (await (await w.t.fetch("/portal-mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(body) })).json()) as any;
    const names = (await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" })).result.tools.map((t: { name: string }) => t.name);
    for (const t of [...REVIEW_TOOLS, ...SIGN_TOOLS]) expect(names, t.name).toContain(t.name);
    for (const [name, args] of [["find_videos", {}], ["list_documents", {}], ["list_templates", {}], ["next_render_name", { video: "Launch" }]] as const) {
      const r = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } });
      expect(r.result, name).toBeDefined();
      expect(r.result.content[0].text, name).not.toMatch(/Unknown tool|Unauthorized/);
    }
  });

  test("T8f.3 Settings › Claude connectors shows only Wrangler Portal", () => {
    const settings = readFileSync(join(root, "src/modules/settings/Settings.tsx"), "utf8");
    const section = settings.slice(settings.indexOf('{key === "connectors" && <>'), settings.indexOf("</>}", settings.indexOf('{key === "connectors" && <>')));
    expect(section).toContain("<PortalConnectorPanel");
    expect(section).not.toMatch(/Older connectors|<Connector |SignConnectorPanel/);
    expect(settings).not.toMatch(/api\.connector\.|api\.wsConnector\./);
    expect(existsSync(join(root, "src/modules/docs/pages/SignConnector.tsx"))).toBe(false);
    expect(settings).toMatch(/PORTAL_MCP_URL = .*"\/portal-mcp"/);
    // The backend has no way left to make, list or revoke the old keys.
    for (const f of ["convex/connector.ts", "convex/wsConnector.ts"]) {
      expect(readFileSync(join(root, f), "utf8"), f).not.toMatch(/export const (createKey|listKeys|revokeKey|checkKey)\b/);
    }
    expect(readFileSync(join(root, "convex/http.ts"), "utf8")).not.toMatch(/path: "\/mcp"|"\/ws-mcp"/);
  });
});
