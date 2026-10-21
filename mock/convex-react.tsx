// Screenshot harness only (vite.mock.config.ts): stands in for convex/react with local sample data.
import { useMemo, useSyncExternalStore } from "react";
import { getFunctionName } from "convex/server";
import { store } from "./fixtures";

export class ConvexReactClient { constructor(_url: string) {} }
export function ConvexProvider({ children }: { children: React.ReactNode }) { return <>{children}</>; }
export function useConvexAuth() {
  const out = new URLSearchParams(location.search).has("signedout");
  return { isLoading: false, isAuthenticated: !out };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cache = new Map<string, { v: number; out: unknown }>();
export function useQuery(ref: any, args?: any) {
  const v = useSyncExternalStore(store.subscribe, store.version);
  if (args === "skip") return undefined;
  // Same answer object until the data changes, like the real client.
  const key = getFunctionName(ref) + JSON.stringify(args ?? {});
  const hit = cache.get(key);
  if (hit && hit.v === v) return hit.out;
  const out = store.query(getFunctionName(ref), args ?? {});
  cache.set(key, { v, out });
  return out;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useMutation(ref: any) {
  const name = getFunctionName(ref);
  return useMemo(() => async (args: unknown) => store.mutation(name, args ?? {}), [name]);
}
const client = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    action: async (ref: any, args: unknown) => store.action(getFunctionName(ref), args ?? {}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: async (ref: any, args: unknown) => store.query(getFunctionName(ref), args ?? {}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mutation: async (ref: any, args: unknown) => store.mutation(getFunctionName(ref), args ?? {}),
};
export function useConvex() { return client; }
