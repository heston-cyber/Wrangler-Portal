// Wrangler Sign audit trail (Phase S1, Oct 27). Every event on a document is appended here and nowhere else.
// Each event's hash covers the previous event's hash and this event's fields, so editing or deleting any entry
// breaks every hash after it (verifyChain finds where).
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { sha256Hex } from "./hash";

export type EventInput = {
  kind: string;
  actor: string;
  versionNumber?: number;
  email?: string;
  ip?: string;
  userAgent?: string;
  detail?: string;
};

export const GENESIS = "0".repeat(64);

// Canonical JSON: fixed key order, absent fields left out, so the same event always hashes the same.
export function canonical(e: { documentId: string; seq: number; at: number } & EventInput): string {
  const keys = ["documentId", "seq", "at", "kind", "actor", "versionNumber", "email", "ip", "userAgent", "detail"] as const;
  const o: Record<string, unknown> = {};
  for (const k of keys) if ((e as Record<string, unknown>)[k] !== undefined) o[k] = (e as Record<string, unknown>)[k];
  return JSON.stringify(o);
}

export async function eventHash(prevHash: string, e: { documentId: string; seq: number; at: number } & EventInput): Promise<string> {
  return sha256Hex(prevHash + "\n" + canonical(e));
}

export async function appendEvent(ctx: MutationCtx, documentId: Id<"wsDocuments">, input: EventInput): Promise<Id<"wsEvents">> {
  const last = await ctx.db.query("wsEvents").withIndex("by_document", (q) => q.eq("documentId", documentId)).order("desc").first();
  const seq = (last?.seq ?? 0) + 1;
  const prevHash = last?.hash ?? GENESIS;
  const at = Date.now();
  const clean: EventInput = {
    kind: input.kind.slice(0, 60),
    actor: input.actor.slice(0, 60),
    ...(input.versionNumber !== undefined ? { versionNumber: input.versionNumber } : {}),
    ...(input.email ? { email: input.email.slice(0, 200) } : {}),
    ...(input.ip ? { ip: input.ip.slice(0, 80) } : {}),
    ...(input.userAgent ? { userAgent: input.userAgent.slice(0, 300) } : {}),
    ...(input.detail ? { detail: input.detail.slice(0, 500) } : {}),
  };
  const hash = await eventHash(prevHash, { documentId, seq, at, ...clean });
  return ctx.db.insert("wsEvents", { documentId, seq, at, ...clean, prevHash, hash });
}

/** Re-computes the chain. ok, or the first event (seq) where it breaks and why. */
export async function verifyChain(events: Doc<"wsEvents">[]): Promise<{ ok: true; count: number } | { ok: false; atSeq: number; reason: string }> {
  let prev = GENESIS;
  let expectSeq = 1;
  for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
    if (e.seq !== expectSeq) return { ok: false, atSeq: expectSeq, reason: "an event is missing" };
    if (e.prevHash !== prev) return { ok: false, atSeq: e.seq, reason: "linked to the wrong previous event" };
    const { documentId, seq, at, kind, actor, versionNumber, email, ip, userAgent, detail } = e;
    const h = await eventHash(prev, { documentId, seq, at, kind, actor, versionNumber, email, ip, userAgent, detail });
    if (h !== e.hash) return { ok: false, atSeq: e.seq, reason: "this event was changed" };
    prev = e.hash;
    expectSeq++;
  }
  return { ok: true, count: events.length };
}

export async function eventsOf(ctx: QueryCtx | MutationCtx, documentId: Id<"wsDocuments">) {
  return ctx.db.query("wsEvents").withIndex("by_document", (q) => q.eq("documentId", documentId)).order("asc").collect();
}
