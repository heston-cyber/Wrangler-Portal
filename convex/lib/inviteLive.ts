// Phase 7 (D134) and its reviews (Nov 18): whether an invite still works. Shared by the sign-up check (lib/invites.ts)
// and the sign-in syncs (lib/business.ts), so an invite past its 14 days can't come back to life at a later sign-in
// (for example when another business invites the same person). An accepted or joined invite always works.
import type { Doc } from "../_generated/dataModel";

export const clientLive = (i: Doc<"invites">, now = Date.now()) => !i.revokedAt && (!!i.acceptedAt || i.expiresAt === undefined || i.expiresAt > now);
export const vendorLive = (x: Doc<"vendors">, now = Date.now()) => !x.archivedAt && !!x.invitedAt && (!!x.joinedAt || x.inviteExpiresAt === undefined || x.inviteExpiresAt > now);
