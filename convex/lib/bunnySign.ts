// Signed, expiring Bunny CDN links (client-side phase C0, Oct 22 2026). Bunny's "HS256" token authentication, the
// same for a Storage pull zone (review renders, stills) and a Stream library's pull zone (streams, scrub copies,
// thumbnails). Checked against the test vectors in BunnyWay/BunnyCDN.TokenAuthentication (Jul 2026).
//
//   token = "HS256-" + base64url(HMAC-SHA256(key, signaturePath + expires + signingData))
//   signaturePath = token_path when given (a whole folder), otherwise the URL path
//   signingData = the other query parameters, sorted by name, "k=v" joined with "&" (token_path included)
//
// Two URL shapes: ?token=…&expires=… for a single file, and /bcdn_token=…&expires=…/<path> ("directory" form) for
// HLS, where the player's relative segment requests inherit the token. Web Crypto only, so it runs in any Convex
// function. No IP locking (phones change networks mid-review).

export type SignOptions = {
  /** Seconds the link stays valid. */
  ttlSeconds: number;
  /** Sign a whole folder (e.g. "/review/<videoId>/" or "/<guid>/") instead of the one file. */
  folder?: string;
  /** Put the token in the path (for HLS playlists and their segments). */
  directory?: boolean;
  /** Fixed expiry (unix seconds) instead of now + ttl. */
  expiresAt?: number;
};

const enc = new TextEncoder();

async function hmacBase64Url(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(message)));
  let bin = "";
  for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function signBunnyUrl(url: string, key: string, opts: SignOptions): Promise<string> {
  if (!key) throw new Error("No signing key.");
  const u = new URL(url);
  const params: Record<string, string> = {};
  for (const [k, v] of u.searchParams) params[k] = v;
  if (opts.folder) params.token_path = opts.folder;
  const expires = String(opts.expiresAt ?? Math.floor(Date.now() / 1000) + opts.ttlSeconds);
  const entries = Object.entries(params).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const signaturePath = opts.folder || u.pathname;
  const signingData = entries.map(([k, v]) => `${k}=${v}`).join("&");
  const urlData = entries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  const token = "HS256-" + (await hmacBase64Url(key, signaturePath + expires + signingData));
  const base = `${u.protocol}//${u.host}`;
  const tail = urlData ? `&${urlData}` : "";
  return opts.directory
    ? `${base}/bcdn_token=${token}${tail}&expires=${expires}${u.pathname}`
    : `${base}${u.pathname}?token=${token}${tail}&expires=${expires}`;
}

/** The folder a Stream video's files live in on its CDN: "/<guid>/". */
export const streamFolder = (guid: string) => `/${guid}/`;
/** The folder a review render lives in: "/review/<videoId>/<rand>/". */
export const renderFolder = (storagePath: string) => "/" + storagePath.split("/").slice(0, -1).join("/") + "/";
