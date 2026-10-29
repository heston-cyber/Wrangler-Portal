// Dev only: the real app's pages, fed from src/dev/fixtures.json instead of the backend (made by
// tests/kitFixtures.test.ts). Open any page with ?kit=owner or ?kit=client; the choice sticks for the tab.
// Mutations and actions do nothing. Nothing here is in the live build.
import { useMemo } from "react";
import { ConvexProvider } from "convex/react";
import { getFunctionName } from "convex/server";
import fixtures from "./fixtures.json";
import { installSignerKit } from "./signerKit";
import stadium from "./stills/stadium.jpg";
import aerial from "./stills/aerial.jpg";
import premiere from "./stills/premiere.jpg";
import bts from "./stills/bts.jpg";
import landscape from "./stills/landscape.jpg";
import pdf from "./stills/sample.pdf?url";

// The signing pages talk to the server over HTTP, not Convex queries: a pretend signer answers instead.
if (/^\/x\//.test(location.pathname)) installSignerKit();

const STILLS: Record<string, string> = { stadium, aerial, premiere, bts, landscape, pdf };
type Side = "owner" | "client";

// Point every sample thumbnail at a local still.
function localStills<T>(v: T): T {
  return JSON.parse(JSON.stringify(v), (_k, x) => (typeof x === "string" && /\/kit-([a-z]+)\//.test(x) ? STILLS[/\/kit-([a-z]+)\//.exec(x)![1]] ?? null : x));
}


function mockClient(side: Side) {
  const data = localStills((fixtures as unknown as Record<Side, Record<string, unknown>>)[side]);
  // A sample made for particular arguments is stored as "module.fn#<first argument>" (e.g. one per document).
  const answer = (name: string, args?: Record<string, unknown>) => {
    const key = name.replace(":", ".").replace(/\//g, ".");
    const first = args && Object.values(args)[0];
    if (typeof first === "string" && `${key}#${first}` in data) return data[`${key}#${first}`];
    if (key in data) return data[key];
    console.info(`[kit] no sample for ${key}`);
    return null;
  };
  return {
    watchQuery: (query: unknown, args?: Record<string, unknown>) => {
      const name = getFunctionName(query as never);
      return { onUpdate: () => () => {}, localQueryResult: () => answer(name, args), localQueryLogs: () => undefined, journal: () => undefined };
    },
    query: async (query: unknown, args?: Record<string, unknown>) => answer(getFunctionName(query as never), args),
    mutation: async () => null,
    action: async () => null,
    connectionState: () => ({ hasInflightRequests: false, isWebSocketConnected: true, timeOfOldestInflightRequest: null, hasEverConnected: true, connectionCount: 1, connectionRetries: 0, inflightMutations: 0, inflightActions: 0 }),
    subscribeToConnectionState: () => () => {},
    prewarmQuery: () => {},
    setAuth: () => {}, clearAuth: () => {}, close: async () => {},
  };
}

export default function KitApp({ side, children }: { side: Side; children: React.ReactNode }) {
  const client = useMemo(() => mockClient(side), [side]);
  return <ConvexProvider client={client as never}>{children}</ConvexProvider>;
}
