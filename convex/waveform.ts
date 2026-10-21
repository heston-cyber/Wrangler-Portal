"use node";
// Makes a version's waveform once Bunny has its MP4 copies: reads just the sound out of the smallest MP4
// (range reads, a few MB at a time) and stores peaks for the timeline.
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { peaksFromMp4 } from "./lib/waveformDecode";

const streamCdn = () => process.env.BUNNY_STREAM_CDN || "vz-3ba0610b-f90.b-cdn.net";

export const run = internalAction({
  args: { versionId: v.id("versions"), attempt: v.number() },
  handler: async (ctx, { versionId, attempt }): Promise<{ result: string }> => {
    const row = await ctx.runQuery(internal.library.getVersionInternal, { versionId });
    if (!row || row.version.status !== "ready") return { result: "version not ready" };
    const heights = [...(row.version.mp4Heights ?? [])].sort((a, b) => a - b);
    if (!heights.length) {
      // Bunny makes its MP4 copies a little after the stream is ready.
      if (attempt < 20) {
        await ctx.runMutation(internal.waveforms.markPending, { versionId, note: "Waiting for Bunny's MP4 copy." });
        await ctx.scheduler.runAfter(30_000, internal.waveform.run, { versionId, attempt: attempt + 1 });
        return { result: "waiting for MP4" };
      }
      await ctx.runMutation(internal.waveforms.fail, { versionId, error: "Bunny never made an MP4 copy." });
      return { result: "no MP4" };
    }
    const tries = await ctx.runMutation(internal.waveforms.begin, { versionId });
    try {
      const site = (process.env.SITE_URL || "https://review.wranglerportal.com").replace(/\/?$/, "/");
      const url = `https://${streamCdn()}/${row.version.bunnyGuid}/play_${heights[0]}p.mp4`;
      const read = async (a: number, b: number) => {
        const res = await fetch(url, { headers: { Range: `bytes=${a}-${b}`, Referer: site, Origin: new URL(site).origin } });
        if (res.status === 416) return new Uint8Array(0);
        if (res.status !== 206 && !(res.status === 200 && a === 0)) throw new Error(`Bunny's MP4 answered ${res.status}.`);
        const buf = new Uint8Array(await res.arrayBuffer());
        return res.status === 200 ? buf.subarray(0, b - a + 1) : buf;
      };
      const r = await peaksFromMp4(read);
      if (r.status === "none") {
        await ctx.runMutation(internal.waveforms.none, { versionId, reason: r.reason });
        return { result: `no waveform: ${r.reason}` };
      }
      const bytes = r.peaks.buffer.slice(r.peaks.byteOffset, r.peaks.byteOffset + r.peaks.byteLength) as ArrayBuffer;
      await ctx.runMutation(internal.waveforms.finish, { versionId, rate: r.rate, seconds: r.seconds, peaks: bytes });
      return { result: `done: ${r.peaks.length} peaks at ${r.rate}/s` };
    } catch (e) {
      const msg = ((e as Error).message || String(e)).slice(0, 300);
      await ctx.runMutation(internal.waveforms.fail, { versionId, error: msg });
      if (tries < 3) await ctx.scheduler.runAfter(5 * 60_000, internal.waveform.run, { versionId, attempt: attempt + 1 });
      return { result: `failed: ${msg}` };
    }
  },
});
