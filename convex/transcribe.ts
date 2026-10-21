"use node";
// Transcribes a version with ElevenLabs Scribe. Runs in Node (512 MB) because it downloads Bunny's smallest MP4
// copy of the cut and sends it on. Words come back in seconds and are pinned to frames of the version.
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { buildTranscript } from "./lib/transcript";

const MAX_BYTES = 900_000_000;
const streamCdn = () => process.env.BUNNY_STREAM_CDN || "vz-3ba0610b-f90.b-cdn.net";
const MODELS = ["scribe_v2", "scribe_v1"];

export const run = internalAction({
  args: { versionId: v.id("versions"), attempt: v.number() },
  handler: async (ctx, { versionId, attempt }): Promise<{ result: string }> => {
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) return { result: "no ElevenLabs key" };
    const row = await ctx.runQuery(internal.library.getVersionInternal, { versionId });
    if (!row || row.version.status !== "ready") return { result: "version not ready" };
    const heights = [...(row.version.mp4Heights ?? [])].sort((a, b) => a - b);
    if (!heights.length) {
      // Bunny makes its MP4 copies a little after the stream is ready.
      if (attempt < 20) {
        await ctx.runMutation(internal.transcripts.markPending, { versionId, note: "Waiting for Bunny's MP4 copy." });
        await ctx.scheduler.runAfter(30_000, internal.transcribe.run, { versionId, attempt: attempt + 1 });
        return { result: "waiting for MP4" };
      }
      await ctx.runMutation(internal.transcripts.fail, { versionId, error: "Bunny never made an MP4 copy to transcribe." });
      return { result: "no MP4" };
    }
    const tries = await ctx.runMutation(internal.transcripts.begin, { versionId });
    try {
      const site = (process.env.SITE_URL || "https://review.wranglerportal.com").replace(/\/?$/, "/");
      const url = `https://${streamCdn()}/${row.version.bunnyGuid}/play_${heights[0]}p.mp4`;
      const media = await fetch(url, { headers: { Referer: site, Origin: new URL(site).origin } });
      if (!media.ok) throw new Error(`Couldn't read Bunny's MP4 (${media.status}).`);
      const buf = Buffer.from(await media.arrayBuffer());
      if (buf.length > MAX_BYTES) throw new Error("The cut is too big to transcribe in one go.");

      let stt: any = null, model = "";
      let lastErr = "";
      for (const m of MODELS) {
        const form = new FormData();
        form.append("model_id", m);
        form.append("file", new Blob([buf], { type: "video/mp4" }), "cut.mp4");
        form.append("timestamps_granularity", "word");
        form.append("diarize", "true");
        form.append("tag_audio_events", "false");
        const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": key }, body: form });
        const text = await res.text();
        if (res.ok) { stt = JSON.parse(text); model = m; break; }
        lastErr = `ElevenLabs ${res.status}: ${text.slice(0, 200)}`;
        // Only fall back to the older model when the newer one is the problem.
        if (!(res.status === 400 || res.status === 422) || !/model/i.test(text)) break;
      }
      if (!stt) throw new Error(lastErr || "ElevenLabs didn't answer.");

      const fps = { num: row.version.fpsNum ?? 24000, den: row.version.fpsDen ?? 1001 };
      const file = buildTranscript(stt, fps, row.version.frameCount ?? null);
      const storageId = await ctx.storage.store(new Blob([JSON.stringify(file)], { type: "application/json" }));
      await ctx.runMutation(internal.transcripts.finish, {
        versionId, storageId, language: file.language ?? undefined, wordCount: file.words.length, segmentCount: file.segments.length, model,
      });
      return { result: `done: ${file.words.length} words` };
    } catch (e) {
      const msg = ((e as Error).message || String(e)).slice(0, 300);
      await ctx.runMutation(internal.transcripts.fail, { versionId, error: msg });
      // Network blips and ElevenLabs hiccups get two more tries, 5 minutes apart. Key or permission problems don't.
      if (tries < 3 && !/ 40[13]:|invalid_api_key|authentication_error|missing_permissions/.test(msg)) await ctx.scheduler.runAfter(5 * 60_000, internal.transcribe.run, { versionId, attempt: attempt + 1 });
      return { result: `failed: ${msg}` };
    }
  },
});
