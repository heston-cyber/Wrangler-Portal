"use node";
// Phase 5e step 4 (Nov 5): phone alerts (Web Push). The portal's push key pair is made here the first time someone turns
// alerts on and kept in the pushKeys table (approved pick #2: no key for Heston to paste). The private half never leaves
// the backend. Each alert goes to every phone the person turned on; a phone that's gone (404/410) is dropped.
import webpush from "web-push";
import { v, ConvexError } from "convex/values";
import { internalAction } from "./lib/functions";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { SUPPORT } from "./lib/email";

/** The public key a phone needs to turn alerts on (made once, on the first ask). Owner and team only. */
export const ensureKey = action({
  args: {},
  handler: async (ctx): Promise<string> => {
    if (!(await ctx.runQuery(internal.bell.canAlert, {}))) throw new ConvexError("Not allowed.");
    const have = await ctx.runQuery(internal.bell.keyPair, {});
    if (have) return have.publicKey;
    const k = webpush.generateVAPIDKeys();
    await ctx.runMutation(internal.bell.saveKeyPair, { publicKey: k.publicKey, privateKey: k.privateKey });
    return (await ctx.runQuery(internal.bell.keyPair, {}))!.publicKey; // another phone may have saved first
  },
});

export const send = internalAction({
  args: { userId: v.id("users"), head: v.string(), body: v.string(), url: v.string(), tag: v.string() },
  handler: async (ctx, a): Promise<number> => {
    const keys = await ctx.runQuery(internal.bell.keyPair, {});
    if (!keys) return 0;
    const subs = await ctx.runQuery(internal.bell.subsOf, { userId: a.userId });
    const body = JSON.stringify({ title: a.head, body: a.body, url: a.url, tag: a.tag });
    let sent = 0;
    for (const s of subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
          TTL: 24 * 3600, urgency: "normal",
          vapidDetails: { subject: `mailto:${SUPPORT()}`, publicKey: keys.publicKey, privateKey: keys.privateKey },
        });
        sent++;
        await ctx.runMutation(internal.bell.pushResult, { subId: s._id, gone: false, ok: true });
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        await ctx.runMutation(internal.bell.pushResult, { subId: s._id, gone: code === 404 || code === 410, ok: false });
      }
    }
    return sent;
  },
});
