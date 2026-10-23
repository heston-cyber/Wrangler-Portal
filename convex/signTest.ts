// Client side T-C0.1 (Oct 23): signed, expiring links on the test pull zone "wranglerreviewsigntest" (token
// authentication on, origin = the stills storage zone). Writes a small MP4-like file and a nested "folder", then
// checks: a signed single-file link works with a range read; a signed folder link (query and HLS-style directory
// forms) covers files under it; an unsigned, an expired and a tampered link are refused. Statuses only.
// Env: BUNNY_SIGN_TEST_KEY (the test zone's token key, pasted into the Convex dashboard by Heston),
// BUNNY_SIGN_TEST_CDN (e.g. wranglerreviewsigntest.b-cdn.net).
import { internalAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { signBunnyUrl } from "./lib/bunnySign";
import { reviewStorage } from "./lib/reviewStorage";
import { scrubCdn, signUrl, stillsCdn, streamCdn } from "./lib/media";

async function status(url: string, range = true): Promise<number> {
  const r = await fetch(url, { headers: range ? { Range: "bytes=0-1" } : {} });
  await r.arrayBuffer();
  return r.status;
}

export const run = internalAction({
  args: {},
  handler: async () => {
    const key = process.env.BUNNY_SIGN_TEST_KEY, cdn = process.env.BUNNY_SIGN_TEST_CDN;
    if (!key || !cdn) return { configured: false, keySet: !!key, cdnSet: !!cdn };
    const z = reviewStorage();
    if (!z) return { configured: false, storage: false };
    const dir = `review/_signtest/${Date.now()}`;
    const files = [`${dir}/a/file.mp4`, `${dir}/a/seg1.ts`, `${dir}/b/other.mp4`];
    const out: Record<string, unknown> = { configured: true };
    try {
      for (const p of files) {
        const put = await fetch(`https://${z.host}/${z.zone}/${p}`, { method: "PUT", headers: { AccessKey: z.password, "content-type": "application/octet-stream" }, body: new Uint8Array(4096).fill(1) });
        if (!put.ok) return { ...out, write: put.status, failedAt: "write" };
      }
      const base = `https://${cdn}`;
      const file = `${base}/${files[0]}`;
      out.unsigned = await status(file);
      out.signedFile = await status(await signBunnyUrl(file, key, { ttlSeconds: 300 }));
      out.signedFileNoRange = await status(await signBunnyUrl(file, key, { ttlSeconds: 300 }), false);
      out.expired = await status(await signBunnyUrl(file, key, { ttlSeconds: 0, expiresAt: Math.floor(Date.now() / 1000) - 60 }));
      const good = await signBunnyUrl(file, key, { ttlSeconds: 300 });
      out.tamperedToken = await status(good.replace(/token=HS256-(.)/, (_m, c) => `token=HS256-${c === "A" ? "B" : "A"}`));
      out.tamperedExpiry = await status(good.replace(/expires=(\d+)/, (_m, e) => `expires=${Number(e) + 3600}`));
      out.wrongKey = await status(await signBunnyUrl(file, key + "x", { ttlSeconds: 300 }));
      // A folder token covers the files under it (query form), and not a sibling folder.
      const folderA = `/${dir}/a/`;
      out.folderQueryFile = await status(await signBunnyUrl(file, key, { ttlSeconds: 300, folder: folderA }));
      out.folderQuerySibling = await status(await signBunnyUrl(`${base}/${files[1]}`, key, { ttlSeconds: 300, folder: folderA }));
      out.folderQueryOutside = await status(await signBunnyUrl(`${base}/${files[2]}`, key, { ttlSeconds: 300, folder: folderA }));
      // Directory (HLS) form: the token sits in the path, so a player's relative segment requests inherit it.
      const dirUrl = await signBunnyUrl(file, key, { ttlSeconds: 300, folder: folderA, directory: true });
      out.folderDirFile = await status(dirUrl);
      out.folderDirSegment = await status(dirUrl.replace(/file\.mp4$/, "seg1.ts"));
      out.folderDirOutside = await status(dirUrl.replace(/\/a\/file\.mp4$/, "/b/other.mp4"));
      // A Node-style range read the backend does (frame count, waveform): a larger range on the signed link.
      const r = await fetch(await signBunnyUrl(file, key, { ttlSeconds: 300 }), { headers: { Range: "bytes=100-199" } });
      out.backendRange = { status: r.status, bytes: (await r.arrayBuffer()).byteLength, cors: r.headers.get("access-control-allow-origin") };
      out.pass = out.unsigned === 403 && out.signedFile === 206 && out.signedFileNoRange === 200 && out.expired === 403 && out.tamperedToken === 403 && out.tamperedExpiry === 403 && out.wrongKey === 403
        && out.folderQueryFile === 206 && out.folderQuerySibling === 206 && out.folderQueryOutside === 403
        && out.folderDirFile === 206 && out.folderDirSegment === 206 && out.folderDirOutside === 403 && (out.backendRange as { status: number; bytes: number }).status === 206 && (out.backendRange as { bytes: number }).bytes === 100;
      return out;
    } finally {
      for (const p of files) await fetch(`https://${z.host}/${z.zone}/${p}`, { method: "DELETE", headers: { AccessKey: z.password } }).catch(() => null);
    }
  },
});

// Puts the public frame-test clip into the storage zone and returns a signed link on the test pull zone (valid 30
// minutes) for the lab frame-accuracy page. The clip is public already; the link carries a token, never the key.
export const playerLink = internalAction({
  args: {},
  handler: async () => {
    const key = process.env.BUNNY_SIGN_TEST_KEY, cdn = process.env.BUNNY_SIGN_TEST_CDN;
    const z = reviewStorage();
    if (!key || !cdn || !z) return { configured: false };
    const src = await fetch("https://review.wranglerportal.com/lab/frametest_23976_h264.mp4");
    if (!src.ok) return { fetch: src.status };
    const body = new Uint8Array(await src.arrayBuffer());
    const path = "review/_signtest/frametest_23976_h264.mp4";
    const put = await fetch(`https://${z.host}/${z.zone}/${path}`, { method: "PUT", headers: { AccessKey: z.password, "content-type": "video/mp4" }, body });
    if (!put.ok) return { write: put.status };
    return { bytes: body.length, url: await signBunnyUrl(`https://${cdn}/${path}`, key, { ttlSeconds: 1800 }), unsignedUrl: `https://${cdn}/${path}` };
  },
});

export const playerLinkCleanup = internalAction({
  args: {},
  handler: async () => {
    const z = reviewStorage();
    if (!z) return { removed: false };
    const r = await fetch(`https://${z.host}/${z.zone}/review/_signtest/frametest_23976_h264.mp4`, { method: "DELETE", headers: { AccessKey: z.password } });
    return { removed: r.ok, status: r.status };
  },
});

// C3: the live zones after token authentication is switched on. For each zone with a key: an unsigned link must be
// refused (403) and a signed one must answer. Statuses only. Zones without a key are reported, not failed.
export const live = internalAction({
  args: {},
  handler: async (ctx) => {
    const sample = await ctx.runQuery(internal.signTest.sampleUrls, {});
    const out: Record<string, unknown> = {};
    for (const [zone, url] of Object.entries(sample)) {
      if (!url) { out[zone] = { sample: false }; continue; }
      const signed = await signUrl(url);
      const keyed = signed !== url;
      out[zone] = { keyed, unsigned: await status(url), signed: await status(signed) };
    }
    const zones = Object.values(out) as Array<{ keyed?: boolean; unsigned?: number; signed?: number; sample?: boolean }>;
    return { ...out, pass: zones.every((z) => z.sample === false || !z.keyed || (z.unsigned === 403 && (z.signed === 200 || z.signed === 206))), allKeyed: zones.every((z) => z.sample === false || z.keyed) };
  },
});

export const sampleUrls = internalQuery({
  args: {},
  handler: async (ctx) => {
    const versions = await ctx.db.query("versions").collect();
    const stream = versions.find((v) => v.status === "ready" && v.bunnyGuid && v.source !== "file");
    const file = versions.find((v) => v.status === "ready" && v.source === "file" && v.fileUrl);
    const scrub = versions.find((v) => v.scrubStatus === "ready" && v.scrubGuid);
    const note = (await ctx.db.query("notes").collect()).find((n) => n.still && stillsCdn() && n.still.startsWith(`https://${stillsCdn()}/`));
    return {
      stream: stream ? `https://${streamCdn()}/${stream.bunnyGuid}/thumbnail.jpg` : null,
      render: file?.fileUrl ?? null,
      scrub: scrub && scrubCdn() ? `https://${scrubCdn()}/${scrub.scrubGuid}/thumbnail.jpg` : null,
      stills: note?.still ?? null,
    };
  },
});
