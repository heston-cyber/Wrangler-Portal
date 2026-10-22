"use node";
// Phase R1 (Oct 22): copy the export-format test renders from Dropbox (Apps/Wrangler Review/_tests/r1/) to Bunny
// Storage (r1-test/) so they can be played from the CDN in Chrome and on a phone. Streams, never buffers the file.
// Run from CI only; results carry sizes, timings and status codes (the test file names aren't private).
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import https from "node:https";
import { Readable } from "node:stream";

function storage() {
  const password = process.env.BUNNY_STORAGE_PASSWORD, host = process.env.BUNNY_STORAGE_HOST;
  const zone = process.env.BUNNY_STORAGE_ZONE, cdn = process.env.BUNNY_STILLS_CDN;
  if (!password || !host || !zone || !cdn) throw new Error("Bunny Storage isn't configured.");
  return { password, host, zone, cdn };
}

export const list = internalAction({
  args: { folder: v.string() },
  handler: async (ctx, { folder }) => {
    const token: string = await ctx.runAction(internal.dropbox.freshToken, {});
    const r = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ path: folder }),
    });
    if (!r.ok) return { status: r.status, files: [] };
    const j: any = await r.json();
    return { status: r.status, files: j.entries.filter((e: any) => e[".tag"] === "file").map((e: any) => ({ name: e.name, size: e.size })) };
  },
});

export const copy = internalAction({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, { from, to }) => {
    if (!to.startsWith("r1-test/")) throw new Error("Test copies go under r1-test/ only.");
    const bs = storage();
    const t0 = Date.now();
    const token: string = await ctx.runAction(internal.dropbox.freshToken, {});
    const dl = await fetch("https://content.dropboxapi.com/2/files/download", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Dropbox-API-Arg": JSON.stringify({ path: from }) },
    });
    if (!dl.ok || !dl.body) return { step: "download", status: dl.status };
    const size = Number(dl.headers.get("content-length") ?? JSON.parse(dl.headers.get("dropbox-api-result") ?? "{}").size ?? 0);
    const status: number = await new Promise((resolve, reject) => {
      const req = https.request(
        { method: "PUT", host: bs.host, path: `/${bs.zone}/${to.split("/").map(encodeURIComponent).join("/")}`,
          headers: { AccessKey: bs.password, "content-type": "application/octet-stream", "content-length": String(size) } },
        (res) => { res.resume(); res.on("end", () => resolve(res.statusCode ?? 0)); },
      );
      req.on("error", reject);
      Readable.fromWeb(dl.body as any).pipe(req);
    });
    const ms = Date.now() - t0;
    let cdn = 0, range = 0, type = "";
    if (status >= 200 && status < 300) {
      const url = `https://${bs.cdn}/${to.split("/").map(encodeURIComponent).join("/")}`;
      const h = await fetch(url, { headers: { Range: "bytes=0-1" } });
      cdn = h.status; range = Number(h.headers.get("content-range")?.split("/")[1] ?? 0); type = h.headers.get("content-type") ?? "";
      await h.arrayBuffer();
    }
    return { size, put: status, seconds: Math.round(ms / 100) / 10, mbps: Math.round((size * 8) / (ms / 1000) / 1e6), cdn, cdnSize: range, type };
  },
});

export const remove = internalAction({
  args: { path: v.string() },
  handler: async (_ctx, { path }) => {
    if (!path.startsWith("r1-test/")) throw new Error("Only r1-test/ files can be removed here.");
    const bs = storage();
    const r = await fetch(`https://${bs.host}/${bs.zone}/${path.split("/").map(encodeURIComponent).join("/")}`, { method: "DELETE", headers: { AccessKey: bs.password } });
    return { status: r.status };
  },
});
