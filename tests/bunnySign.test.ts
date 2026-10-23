// Bunny's own test vectors (BunnyWay/BunnyCDN.TokenAuthentication e2e/, Jul 2026) against our Web Crypto signer.
import { describe, expect, test } from "vitest";
import { signBunnyUrl } from "../convex/lib/bunnySign";

const KEY = "SecurityKey", EXP = 1598024587, HOST = "https://token-tester.b-cdn.net";
const PATH_ONLY = "HS256-uVZvT3SbEoVKYJyDJgbcsDmSFf73cv-uNUVaJiKWpbQ";

describe("Bunny HS256 signed links", () => {
  test("plain file", async () => {
    expect(await signBunnyUrl(`${HOST}/300kb.jpg`, KEY, { ttlSeconds: 0, expiresAt: EXP })).toBe(`${HOST}/300kb.jpg?token=HS256-o10JRWlsAItyAsdKS6jJKjabHN4FrFsplDHPV1idcX4&expires=${EXP}`);
  });
  test("whole folder (token_path)", async () => {
    const got = await signBunnyUrl(`${HOST}/abc/300kb.jpg`, KEY, { ttlSeconds: 0, expiresAt: EXP, folder: "/abc" });
    expect(got).toBe(`${HOST}/abc/300kb.jpg?token=${PATH_ONLY}&token_path=%2Fabc&expires=${EXP}`);
  });
  test("directory form for HLS", async () => {
    const got = await signBunnyUrl(`${HOST}/abc/300kb.jpg`, KEY, { ttlSeconds: 0, expiresAt: EXP, folder: "/abc", directory: true });
    expect(got).toBe(`${HOST}/bcdn_token=${PATH_ONLY}&token_path=%2Fabc&expires=${EXP}/abc/300kb.jpg`);
  });
  test("a changed path or expiry changes the token", async () => {
    const a = await signBunnyUrl(`${HOST}/x.mp4`, KEY, { ttlSeconds: 0, expiresAt: EXP });
    const b = await signBunnyUrl(`${HOST}/y.mp4`, KEY, { ttlSeconds: 0, expiresAt: EXP });
    const c = await signBunnyUrl(`${HOST}/x.mp4`, KEY, { ttlSeconds: 0, expiresAt: EXP + 1 });
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

