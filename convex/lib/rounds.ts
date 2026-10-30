// Phase 2 Part A (Oct 29): revision rounds. Each version the owner uploads is a round (D23: v1 is round 1, v2 is
// round 2); a project includes a number of rounds per video, set on the project, else on its client, else on the
// business (D23b: 2 by default). A version past the included rounds needs a change order.
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

export const ROUNDS_DEFAULT = 2;
export type RoundsFrom = "project" | "client" | "business";

/** The rounds a project includes per video. 0 on the project or its client means "no rounds" (switched off there);
 *  the business can switch rounds off for everything (roundsOff). When off, there are no round chips, no last-round
 *  notice and no change-order prompt. */
export async function roundsFor(ctx: QueryCtx | MutationCtx, project: Doc<"projects"> | null): Promise<{ included: number; off: boolean; from: RoundsFrom; clientRounds: number | null; businessRounds: number; businessOff: boolean }> {
  const biz = project?.businessId ? await ctx.db.get(project.businessId) : null;
  const businessRounds = biz?.roundsDefault ?? ROUNDS_DEFAULT;
  const businessOff = !!biz?.roundsOff;
  const client = project?.clientId ? await ctx.db.get(project.clientId) : null;
  const clientRounds = client?.rounds ?? null;
  const base = { clientRounds, businessRounds, businessOff };
  if (businessOff) return { included: 0, off: true, from: "business", ...base };
  if (project?.rounds !== undefined && project?.rounds !== null) return { included: project.rounds, off: project.rounds === 0, from: "project", ...base };
  if (clientRounds !== null) return { included: clientRounds, off: clientRounds === 0, from: "client", ...base };
  return { included: businessRounds, off: false, from: "business", ...base };
}

/** "Round 2 of 2" with its state: within the rounds, the last included one, or past them (a change order). */
export function roundOf(versionNumber: number, included: number) {
  const state = versionNumber < included ? "within" : versionNumber === included ? "last" : "over";
  const label = state === "over" ? `Round ${versionNumber} · change order` : `Round ${versionNumber} of ${included}`;
  return { round: versionNumber, included, state, label } as const;
}

/** 1–20 rounds, or 0 for "no rounds" on a client or a project. */
export const clampRounds = (n: number) => (Math.round(n) <= 0 ? 0 : Math.max(1, Math.min(20, Math.round(n))));
