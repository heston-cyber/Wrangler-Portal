// Phase 2 Part A (Oct 29): revision rounds. Each version the owner uploads is a round (D23: v1 is round 1, v2 is
// round 2); a project includes a number of rounds per video, set on the project, else on its client, else on the
// business (D23b: 2 by default). A version past the included rounds needs a change order.
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

export const ROUNDS_DEFAULT = 2;
export type RoundsFrom = "project" | "client" | "business";

export async function roundsFor(ctx: QueryCtx | MutationCtx, project: Doc<"projects"> | null): Promise<{ included: number; from: RoundsFrom; clientRounds: number | null; businessRounds: number }> {
  const biz = project?.businessId ? await ctx.db.get(project.businessId) : null;
  const businessRounds = biz?.roundsDefault ?? ROUNDS_DEFAULT;
  const client = project?.clientId ? await ctx.db.get(project.clientId) : null;
  const clientRounds = client?.rounds ?? null;
  if (project?.rounds) return { included: project.rounds, from: "project", clientRounds, businessRounds };
  if (clientRounds) return { included: clientRounds, from: "client", clientRounds, businessRounds };
  return { included: businessRounds, from: "business", clientRounds, businessRounds };
}

/** "Round 2 of 2" with its state: within the rounds, the last included one, or past them (a change order). */
export function roundOf(versionNumber: number, included: number) {
  const state = versionNumber < included ? "within" : versionNumber === included ? "last" : "over";
  const label = state === "over" ? `Round ${versionNumber} · change order` : `Round ${versionNumber} of ${included}`;
  return { round: versionNumber, included, state, label } as const;
}

export const clampRounds = (n: number) => Math.max(1, Math.min(20, Math.round(n)));
