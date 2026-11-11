// Phase 5e step 3 (Nov 5): one line in Settings › Activity. Called where the thing happens (lib/audit callers listed in
// auditLog.ts). Who did it comes from the caller (the owner or a team member, with the device they're signed in on);
// server-side events (a signer signing, Stripe saying an invoice is paid) name the person themselves.
import { getAuthSessionId } from "@convex-dev/auth/server";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { viewerOf } from "./access";
import { ROLE_NAMES } from "./perms";

export type AuditKind = "sent" | "signed" | "paid" | "deleted" | "settings" | "signin" | "team" | "export";
export type AuditEvent = { kind: AuditKind; text: string; where?: string; link?: string; by?: { name: string; role: string }; businessId?: Id<"businesses"> | null };

export async function audit(ctx: MutationCtx, e: AuditEvent) {
  let who = e.by?.name, role = e.by?.role, userId: Id<"users"> | undefined, device: string | undefined;
  if (!e.by) {
    const v = await viewerOf(ctx);
    if (v.kind === "owner") { who = v.name; role = "Owner"; userId = v.userId; }
    else if (v.kind === "team") { who = v.name; role = ROLE_NAMES[v.team.role]; userId = v.userId; }
    else if (v.kind === "client" || v.kind === "vendor") { who = v.name; role = v.kind === "client" ? "Client" : "Vendor"; userId = v.userId; }
    else { who = "WranglerPortal"; role = "System"; }
    const sid = await getAuthSessionId(ctx).catch(() => null);
    if (sid) device = (await ctx.db.query("sessionDevices").withIndex("by_session", (q) => q.eq("sessionId", sid)).unique())?.label;
  }
  await ctx.db.insert("auditLog", {
    at: Date.now(), kind: e.kind, who: who ?? "Someone", role: role ?? "", text: e.text.slice(0, 200),
    ...(e.where ? { where: e.where.slice(0, 120) } : {}), ...(e.link ? { link: e.link } : {}), ...(userId ? { userId } : {}), ...(device ? { device } : {}),
    ...(e.businessId ? { businessId: e.businessId } : {}),
  });
}
