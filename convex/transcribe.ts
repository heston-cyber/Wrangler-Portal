"use node";
// Transcribes a version with ElevenLabs Scribe. Runs in Node (512 MB) because it downloads Bunny's smallest MP4
// copy of the cut and sends it on. Words come back in seconds and are pinned to frames of the version.
import { action } from "./_generated/server";
import { forBusiness, internalAction } from "./lib/functions";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { buildTranscript } from "./lib/transcript";
import { mp4FrameCount } from "./lib/mp4";
import { shareArg } from "./lib/viewer";
import { signUrl } from "./lib/media";
import { SITE_SLASH } from "./lib/site";

const MAX_BYTES = 900_000_000;
const WAIT_MS = 15_000;
const MAX_WAITS = 40;
const streamCdn = () => process.env.BUNNY_STREAM_CDN || "vz-3ba0610b-f90.b-cdn.net";
const MODELS = ["scribe_v2", "scribe_v1"];

export const run = internalAction({
  args: { versionId: v.id("versions"), attempt: v.number() },
  handler: async (ctx, { versionId, attempt }): Promise<{ result: string }> => {
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) return { result: "no ElevenLabs key" };
    const row = await ctx.runQuery(internal.library.getVersionInternal, { versionId });
    if (!row || row.version.status !== "ready") return { result: "version not ready" };
    // This starts the moment the version is ready (Oct 21: no more fixed 1-minute wait). Bunny can make its MP4 copy
    // a little after that, so until the copy is there, check again every 15 seconds (for up to 10 minutes).
    const waitForMp4 = async (why: string): Promise<{ result: string }> => {
      if (attempt < MAX_WAITS) {
        await ctx.runMutation(internal.transcripts.markPending, { versionId, note: "Waiting for Bunny's MP4 copy." });
        await ctx.scheduler.runAfter(WAIT_MS, internal.transcribe.run, { versionId, attempt: attempt + 1 });
        return { result: `waiting for MP4 (${why})` };
      }
      await ctx.runMutation(internal.transcripts.fail, { versionId, error: "Bunny never made an MP4 copy to transcribe." });
      return { result: "no MP4" };
    };
    // A review render (R3): ElevenLabs reads it straight from Bunny Storage by URL, so nothing is downloaded here.
    if (row.version.source === "file" && row.version.fileUrl) {
      const tries = await ctx.runMutation(internal.transcripts.begin, { versionId });
      try {
        const { stt, model } = await sttFromUrl(key, await signUrl(row.version.fileUrl));
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
        if (tries < 3 && !/ 40[13]:|invalid_api_key|authentication_error|missing_permissions/.test(msg)) await ctx.scheduler.runAfter(5 * 60_000, internal.transcribe.run, { versionId, attempt: attempt + 1 });
        return { result: `failed: ${msg}` };
      }
    }
    const heights = [...(row.version.mp4Heights ?? [])].sort((a, b) => a - b);
    if (!heights.length) return await waitForMp4("none listed yet");
    const site = SITE_SLASH();
    const url = await signUrl(`https://${streamCdn()}/${row.version.bunnyGuid}/play_${heights[0]}p.mp4`);
    let media: Response;
    try {
      media = await fetch(url, { headers: { Referer: site, Origin: new URL(site).origin } });
    } catch {
      return await waitForMp4("network");
    }
    if (media.status === 404) return await waitForMp4("not made yet");
    const tries = await ctx.runMutation(internal.transcripts.begin, { versionId });
    try {
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
      // Words are kept inside the last frame. The exact count is read alongside this and is usually saved by now;
      // if it isn't, count the frames in the copy just downloaded.
      const fresh = await ctx.runQuery(internal.library.getVersionInternal, { versionId });
      const exact = fresh?.version.frameCountFrom === "file" ? fresh.version.frameCount ?? null : null;
      const counted = exact ?? (await mp4FrameCount(async (s, e) => buf.subarray(s, e + 1)).catch(() => null));
      const file = buildTranscript(stt, fps, counted ?? fresh?.version.frameCount ?? null);
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

// ElevenLabs fetches the file itself. source_url is the current name; cloud_storage_url is the older one
// (deprecated, Oct 2026), tried only if the newer name is refused.
async function sttFromUrl(key: string, url: string): Promise<{ stt: any; model: string }> {
  let lastErr = "";
  for (const field of ["source_url", "cloud_storage_url"]) {
    for (const m of MODELS) {
      const form = new FormData();
      form.append("model_id", m);
      form.append(field, url);
      form.append("timestamps_granularity", "word");
      form.append("diarize", "true");
      form.append("tag_audio_events", "false");
      const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": key }, body: form });
      const text = await res.text();
      if (res.ok) return { stt: JSON.parse(text), model: m };
      lastErr = `ElevenLabs ${res.status}: ${text.slice(0, 200)}`;
      if (res.status === 400 || res.status === 422) {
        if (/model/i.test(text)) continue; // try the older model
        if (field === "source_url" && /source_url|file/i.test(text)) break; // try the older field
      }
      throw new Error(lastErr);
    }
  }
  throw new Error(lastErr || "ElevenLabs didn't answer.");
}

// Voice notes: transcribe a recording the browser just uploaded. Returns words with seconds; the page pins them to frames.
export const voiceWords = action({
  args: { storageId: v.id("_storage"), mime: v.string(), versionId: v.optional(v.id("versions")), share: shareArg },
  handler: async (ctx, { storageId, mime, versionId, share }): Promise<{ language: string | null; words: Array<{ text: string; start: number; end: number; type?: string }> }> => {
    const biz = versionId ? await ctx.runMutation(internal.shares.assertCanComment, { versionId, share, count: "voice" }) : (await ctx.runQuery(internal.users.assertAllowed, {})).businessId;
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) throw new Error("Transcription isn't set up (no ElevenLabs key).");
    const blob = await ctx.storage.get(storageId);
    // Security review (Oct 27): only a recording (an audio upload) is sent off, never another stored file.
    if (!blob || !/^(audio|video)\//i.test(blob.type)) throw new Error("The recording didn't upload.");
    await forBusiness(ctx, biz).runMutation(internal.notes.registerVoice, { storageId, versionId });
    return await sttWords(key, blob, mime);
  },
});

async function sttWords(key: string, blob: Blob, mime: string): Promise<{ language: string | null; words: Array<{ text: string; start: number; end: number }> }> {
    if (blob.size > 100_000_000) throw new Error("That recording is too long.");
    const ext = /mp4|m4a|aac/.test(mime) ? "m4a" : /ogg/.test(mime) ? "ogg" : "webm";
    let lastErr = "";
    for (const m of MODELS) {
      const form = new FormData();
      form.append("model_id", m);
      form.append("file", new Blob([await blob.arrayBuffer()], { type: mime.split(";")[0] }), `note.${ext}`);
      form.append("timestamps_granularity", "word");
      form.append("tag_audio_events", "false");
      const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": key }, body: form });
      const text = await res.text();
      if (res.ok) {
        const j = JSON.parse(text);
        return { language: j.language_code ?? null, words: (j.words ?? []).filter((w: { type?: string }) => !w.type || w.type === "word").map((w: { text: string; start: number; end: number }) => ({ text: w.text, start: w.start, end: w.end })) };
      }
      lastErr = `ElevenLabs ${res.status}: ${text.slice(0, 160)}`;
      if (!(res.status === 400 || res.status === 422) || !/model/i.test(text)) break;
    }
    throw new Error(lastErr || "Transcription didn't work.");
}

// Live check for CI: runs the voice-note path (storage → ElevenLabs → words) on the newest ready version's smallest
// MP4, then deletes the temporary file. Returns counts and timing only.
export const voiceSelfTest = internalAction({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean; step?: string; words?: number; language?: string | null; seconds?: number; firstWordStarts?: number | null }> => {
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) return { ok: false, step: "no key" };
    const src: { guid: string; height: number } | null = await ctx.runQuery(internal.dropbox.anyReadyMp4, {});
    if (!src) return { ok: false, step: "no ready version" };
    const site = SITE_SLASH();
    const media: Response = await fetch(await signUrl(`https://${streamCdn()}/${src.guid}/play_${src.height}p.mp4`), { headers: { Referer: site, Origin: new URL(site).origin } });
    if (!media.ok) return { ok: false, step: `media ${media.status}` };
    const storageId = await ctx.storage.store(new Blob([await media.arrayBuffer()], { type: "audio/mp4" }));
    try {
      const t = Date.now();
      const blob = (await ctx.storage.get(storageId))!;
      const r = await sttWords(key, blob, "audio/mp4");
      return { ok: r.words.length > 0, words: r.words.length, language: r.language, seconds: Math.round((Date.now() - t) / 100) / 10, firstWordStarts: r.words[0]?.start ?? null };
    } finally {
      await ctx.storage.delete(storageId);
    }
  },
});
