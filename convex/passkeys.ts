"use node";
// Q2 (Heston, Nov 17): Face ID or the phone's passcode hands the phone back (a passkey on the owner's device). Adding one
// needs the owner signed in and not handed over; unlocking needs this sign-in's own lock (handBack.ts). The checks run
// here (Node) with @simplewebauthn/server; every read and write goes through handBack.ts with the caller's sign-in.
import { action } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/types";
import { SITE } from "./lib/site";

/** Where the portal runs (SITE_URL: the live site, or the preview's own) and local development only. The passkey
 *  belongs to the site's parent domain, so one works on the live site and the preview alike. */
function site(origin: string) {
  const ok = [new URL(SITE()).origin, "http://localhost:5173", "http://localhost:5199"];
  if (!ok.includes(origin)) throw new ConvexError("Passkeys work on the portal's own address.");
  const host = new URL(origin).hostname;
  return { origin, rpID: host === "localhost" ? "localhost" : host.split(".").slice(-2).join(".") };
}
const transports = (t?: string[]) => t as AuthenticatorTransportFuture[] | undefined;

export const registerOptions = action({
  args: { origin: v.string() },
  handler: async (ctx, a) => {
    const { rpID } = site(a.origin);
    const me = await ctx.runQuery(internal.handBack.forRegister, {});
    const opts = await generateRegistrationOptions({
      rpName: "Wrangler Portal", rpID, userID: me.userId, userName: me.email, userDisplayName: me.name,
      attestationType: "none",
      excludeCredentials: me.have.map((k) => ({ id: isoBase64URL.toBuffer(k.id), type: "public-key" as const, transports: transports(k.transports) })),
      authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "preferred", userVerification: "required" },
    });
    await ctx.runMutation(internal.handBack.saveChallenge, { value: opts.challenge });
    return opts;
  },
});

export const register = action({
  args: { origin: v.string(), response: v.any(), device: v.string() },
  handler: async (ctx, a) => {
    const { origin, rpID } = site(a.origin);
    const challenge = await ctx.runMutation(internal.handBack.takeChallenge, {});
    if (!challenge) throw new ConvexError("That took too long. Try again.");
    let out;
    try { out = await verifyRegistrationResponse({ response: a.response, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true }); }
    catch { throw new ConvexError("That passkey didn't check out. Try again."); }
    if (!out.verified || !out.registrationInfo) throw new ConvexError("That passkey didn't check out. Try again.");
    const info = out.registrationInfo;
    await ctx.runMutation(internal.handBack.addPasskey, {
      id: isoBase64URL.fromBuffer(info.credentialID), publicKey: isoBase64URL.fromBuffer(info.credentialPublicKey), counter: info.counter,
      ...(Array.isArray(a.response?.response?.transports) ? { transports: (a.response.response.transports as unknown[]).filter((x): x is string => typeof x === "string") } : {}),
      device: String(a.device ?? "This device"),
    });
    return { ok: true as const };
  },
});

export const unlockOptions = action({
  args: { origin: v.string() },
  handler: async (ctx, a) => {
    const { rpID } = site(a.origin);
    const keys = await ctx.runQuery(internal.handBack.lockKeys, {});
    if (!keys.length) throw new ConvexError("No passkey yet: use your PIN.");
    const opts = await generateAuthenticationOptions({ rpID, userVerification: "required", allowCredentials: keys.map((k) => ({ id: isoBase64URL.toBuffer(k.id), type: "public-key" as const, transports: transports(k.transports) })) });
    await ctx.runMutation(internal.handBack.lockChallenge, { value: opts.challenge });
    return opts;
  },
});

export const unlock = action({
  args: { origin: v.string(), response: v.any() },
  handler: async (ctx, a): Promise<{ ok: boolean }> => {
    const { origin, rpID } = site(a.origin);
    const keys = await ctx.runQuery(internal.handBack.lockKeys, {});
    const challenge = await ctx.runMutation(internal.handBack.takeLockChallenge, {});
    if (!challenge) throw new ConvexError("That took too long. Try again.");
    const key = keys.find((k) => k.id === a.response?.id);
    if (!key) return { ok: false };
    let out;
    try {
      out = await verifyAuthenticationResponse({
        response: a.response, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
        authenticator: { credentialID: isoBase64URL.toBuffer(key.id), credentialPublicKey: isoBase64URL.toBuffer(key.publicKey), counter: key.counter, transports: transports(key.transports) },
      });
    } catch { return { ok: false }; }
    if (!out.verified) return { ok: false };
    await ctx.runMutation(internal.handBack.unlockedByPasskey, { id: key.id, counter: out.authenticationInfo.newCounter });
    return { ok: true };
  },
});
