// Public settings (not secrets).
export const BUNNY_CDN_HOST: string = (import.meta.env.VITE_BUNNY_CDN_HOST as string | undefined) || "vz-3ba0610b-f90.b-cdn.net";

// Where a version's video files and thumbnail live (Bunny Stream). The demo build swaps this for local files.
export const mediaUrl = (guid: string, file: string) => `https://${BUNNY_CDN_HOST}/${guid}/${file}`;
// Files in public/ (brand marks), relative to wherever the site is served from.
export const asset = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;
// The sample-data demo build (an artifact in Claude) sets this to turn off things that can't work there.
export const DEMO = false;
