// Phase 3c step 4 · the vendor side's current business (the "Working for" switcher, D94).
import { createContext } from "react";
import type { Id } from "../../../convex/_generated/dataModel";

export type Biz = { businessId: Id<"businesses">; name: string; accent: string | null; background: string | null; logoUrl: string | null };
export type VCtx = { biz: Id<"businesses"> | null; setBiz: (b: Id<"businesses">) => void; list: Biz[] };
export const Ctx = createContext<VCtx>({ biz: null, setBiz: () => {}, list: [] });
