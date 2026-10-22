// Where review renders live (R3). Their own storage zone when BUNNY_REVIEW_* are set (Heston may add one, Oct 22);
// otherwise the stills zone, under review/. Read by the copy, the cleanup and the checks.
export type ZoneConfig = { password: string; host: string; zone: string; cdn: string; own: boolean };

export function reviewStorage(): ZoneConfig | null {
  const e = process.env;
  if (e.BUNNY_REVIEW_STORAGE_ZONE && e.BUNNY_REVIEW_STORAGE_PASSWORD && e.BUNNY_REVIEW_STORAGE_HOST && e.BUNNY_REVIEW_CDN) {
    return { password: e.BUNNY_REVIEW_STORAGE_PASSWORD, host: e.BUNNY_REVIEW_STORAGE_HOST, zone: e.BUNNY_REVIEW_STORAGE_ZONE, cdn: e.BUNNY_REVIEW_CDN, own: true };
  }
  if (e.BUNNY_STORAGE_PASSWORD && e.BUNNY_STORAGE_HOST && e.BUNNY_STORAGE_ZONE && e.BUNNY_STILLS_CDN) {
    return { password: e.BUNNY_STORAGE_PASSWORD, host: e.BUNNY_STORAGE_HOST, zone: e.BUNNY_STORAGE_ZONE, cdn: e.BUNNY_STILLS_CDN, own: false };
  }
  return null;
}

// Every zone a review render might be in (the zone can change later; old files stay where they were put).
export function reviewZones(): ZoneConfig[] {
  const e = process.env;
  const out: ZoneConfig[] = [];
  const own = reviewStorage();
  if (own) out.push(own);
  if (own?.own && e.BUNNY_STORAGE_PASSWORD && e.BUNNY_STORAGE_HOST && e.BUNNY_STORAGE_ZONE && e.BUNNY_STILLS_CDN) {
    out.push({ password: e.BUNNY_STORAGE_PASSWORD, host: e.BUNNY_STORAGE_HOST, zone: e.BUNNY_STORAGE_ZONE, cdn: e.BUNNY_STILLS_CDN, own: false });
  }
  return out;
}

export const encPath = (p: string) => p.split("/").map(encodeURIComponent).join("/");
