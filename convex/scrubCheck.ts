import { internalAction } from "./lib/functions";
// R3 setup check (Oct 22): is the 360p scrub library connected? Statuses only, never keys or names (public CI log).

export const run = internalAction({
  args: {},
  handler: async () => {
    const lib = process.env.BUNNY_SCRUB_LIBRARY_ID ?? "", key = process.env.BUNNY_SCRUB_API_KEY ?? "", cdn = process.env.BUNNY_SCRUB_CDN ?? "";
    const out: Record<string, unknown> = {
      libraryIdSet: !!lib, libraryIdIsNumber: /^\d{3,9}$/.test(lib.trim()), libraryIdHasSpaces: lib !== lib.trim(),
      apiKeySet: !!key, apiKeyHasSpaces: key !== key.trim(),
      cdnSet: !!cdn, cdnLooksRight: /^vz-[a-z0-9-]+\.b-cdn\.net$/.test(cdn.trim()), cdnHasScheme: /^https?:\/\//.test(cdn),
      differentFromMainLibrary: lib.trim() !== (process.env.BUNNY_STREAM_LIBRARY_ID ?? "").trim(),
    };
    if (lib && key) {
      const r = await fetch(`https://video.bunnycdn.com/library/${encodeURIComponent(lib.trim())}/videos?page=1&itemsPerPage=1`, { headers: { AccessKey: key.trim(), accept: "application/json" } });
      out.listStatus = r.status;
      try { const j = await r.json() as { totalItems?: number }; out.videosInLibrary = j.totalItems ?? null; } catch { out.videosInLibrary = null; }
    }
    return out;
  },
});
