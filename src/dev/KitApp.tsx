// Dev only: the real app's pages, fed from src/dev/fixtures.json instead of the backend (made by
// tests/kitFixtures.test.ts). Open any page with ?kit=owner or ?kit=client; the choice sticks for the tab.
// Mutations and actions do nothing. Nothing here is in the live build.
import { useMemo } from "react";
import { ConvexProvider, ConvexProviderWithAuth } from "convex/react";
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
// vendor: Phase 3c (tests/kitVendorFixtures.test.ts). Phone pass (Nov 4): guest / guestout (a call-sheet guest, signed in or
// out), empty (an owner with nothing yet) and loading (an owner whose queries never answer).
type Side = "owner" | "client" | "vendor" | "guest" | "guestout" | "empty" | "loading";
const DATA: Record<Side, "owner" | "client" | "vendor" | "guest" | "empty"> = { owner: "owner", client: "client", vendor: "vendor", guest: "guest", guestout: "guest", empty: "empty", loading: "owner" };

// Point every sample thumbnail at a local still.
function localStills<T>(v: T): T {
  return JSON.parse(JSON.stringify(v), (_k, x) => (typeof x === "string" && /\/kit-([a-z]+)\//.test(x) ? STILLS[/\/kit-([a-z]+)\//.exec(x)![1]] ?? null : x));
}


function mockClient(side: Side) {
  const data = localStills((fixtures as unknown as Record<string, Record<string, unknown>>)[DATA[side]]);
  // A sample made for particular arguments is stored as "module.fn#<first argument>" (e.g. one per document).
  const answer = (name: string, args?: Record<string, unknown>) => {
    const key = name.replace(":", ".").replace(/\//g, ".");
    const first = args && Object.values(args)[0];
    if (typeof first === "string" && `${key}#${first}` in data) return data[`${key}#${first}`];
    if (key in data) return data[key];
    console.info(`[kit] no sample for ${key}`);
    return null;
  };
  // "loading": only the signed-in user and the brand answer, so the shell opens and each page waits for the rest.
  const answerFor = (name: string, args?: Record<string, unknown>) => (side === "loading" && !/^(users[.:]me|business[.:]brand)$/.test(name) ? undefined : answer(name, args));
  return {
    watchQuery: (query: unknown, args?: Record<string, unknown>) => {
      const name = getFunctionName(query as never);
      return { onUpdate: () => () => {}, localQueryResult: () => answerFor(name, args), localQueryLogs: () => undefined, journal: () => undefined };
    },
    query: async (query: unknown, args?: Record<string, unknown>) => answer(getFunctionName(query as never), args),
    mutation: async () => null,
    // A call-sheet guest's "Email me a code" answers as the server does (guests.sendCode).
    action: async (a: unknown) => (getFunctionName(a as never) === "guests:sendCode" ? { to: "r•••@example.com", minutes: 10 } : null),
    connectionState: () => ({ hasInflightRequests: false, isWebSocketConnected: true, timeOfOldestInflightRequest: null, hasEverConnected: true, connectionCount: 1, connectionRetries: 0, inflightMutations: 0, inflightActions: 0 }),
    subscribeToConnectionState: () => () => {},
    prewarmQuery: () => {},
    setAuth: (_f?: unknown, onChange?: (ok: boolean) => void) => { onChange?.(true); }, clearAuth: () => {}, close: async () => {},
  };
}

export default function KitApp({ side, children }: { side: Side; children: React.ReactNode }) {
  const client = useMemo(() => mockClient(side), [side]);
  // The guest pages ask whether anyone is signed in (useConvexAuth): "guest" is, "guestout" isn't.
  if (side === "guest" || side === "guestout") {
    const auth = { isLoading: false, isAuthenticated: side === "guest", fetchAccessToken: async () => "kit" };
    return <ConvexProviderWithAuth client={client as never} useAuth={() => auth}>{children}</ConvexProviderWithAuth>;
  }
  return <ConvexProvider client={client as never}>{children}</ConvexProvider>;
}
