// Nov 25 (Heston, approved): after the connector asks Heston to confirm something on the site, Claude keeps watching so
// it notices his Confirm without him saying so in chat. One call watches for up to WATCH_MS and answers the moment
// the request moves on; Claude calls again (the instructions say for up to WATCH_FOR_MIN minutes in all).
export const WATCH_MS = 50_000;
export const POLL_MS = 2_000;
export const WATCH_FOR_MIN = 10;

/** Reads `read` until `busy` says it's settled or `maxMs` passes; returns the last read and whether it's still busy. */
export async function watchUntil<T>(
  read: () => Promise<T>,
  busy: (r: T) => boolean,
  { maxMs = WATCH_MS, everyMs = POLL_MS, now = () => Date.now(), sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) } = {},
): Promise<{ last: T; still: boolean }> {
  const until = now() + maxMs;
  let last = await read();
  while (busy(last)) {
    const left = until - now();
    if (left <= 0) return { last, still: true };
    await sleep(Math.min(everyMs, left));
    last = await read();
  }
  return { last, still: false };
}

/** What Claude is told after a watch that ended still waiting. */
export const keepWatching = (what: string) =>
  `Still ${what}. Call this again with wait: true to keep watching, for up to ${WATCH_FOR_MIN} minutes in all since you gave Heston the link. After that, stop and tell him you'll check when he messages you.`;

/** After any ask that makes a request (request_id): give Heston the link, then watch for his Confirm. */
export const WATCH_NEXT = `Give Heston the confirm_at link. It happens only when he presses Confirm on the site. Then call request_status with this request_id and wait: true, and keep calling it while it's still waiting (up to ${WATCH_FOR_MIN} minutes), so you see his Confirm without him telling you.`;
