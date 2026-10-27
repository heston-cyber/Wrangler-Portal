// The signing page's calls to the backend (POST /ws/<op> on the Convex site). Phase S2, Oct 27.
const cloud = (import.meta.env.VITE_CONVEX_URL as string | undefined) || "https://handsome-hummingbird-11.convex.cloud";
export const CONVEX_SITE = cloud.replace(/\.convex\.cloud\/?$/, ".convex.site");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WsResult = Record<string, any> & { error?: string; code?: string };

export async function ws(op: string, body: Record<string, unknown>): Promise<WsResult> {
  let r: Response;
  try {
    r = await fetch(`${CONVEX_SITE}/ws/${op}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    return { error: "Couldn't reach the server. Check your connection and try again.", code: "network" };
  }
  try { return (await r.json()) as WsResult; } catch { return { error: `The server answered ${r.status}. Try again.`, code: "bad" }; }
}

const KEY = (token: string) => `ws:session:${token}`;
export const getSession = (token: string) => { try { return sessionStorage.getItem(KEY(token)) ?? undefined; } catch { return undefined; } };
export const setSession = (token: string, s: string | null) => { try { if (s) sessionStorage.setItem(KEY(token), s); else sessionStorage.removeItem(KEY(token)); } catch { /* private mode: keep it in memory only */ } };
