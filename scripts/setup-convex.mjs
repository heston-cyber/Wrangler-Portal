// One-time and repeatable Convex setup, run by .github/workflows/convex-setup.yml.
// - Creates the login signing keys if they don't exist yet (never prints them).
// - Sets plain (non-secret) settings passed in SET="NAME=value;NAME2=value2".
import { execFileSync } from "node:child_process";
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";

const convex = (...args) => execFileSync("npx", ["convex", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function hasEnv(name) {
  try { return convex("env", "get", name).trim().length > 0; } catch { return false; }
}

if (!hasEnv("JWT_PRIVATE_KEY") || !hasEnv("JWKS")) {
  const keys = await generateKeyPair("RS256", { extractable: true });
  const privateKey = (await exportPKCS8(keys.privateKey)).trimEnd().replace(/\n/g, " ");
  const jwks = JSON.stringify({ keys: [{ use: "sig", ...(await exportJWK(keys.publicKey)) }] });
  convex("env", "set", "--", "JWT_PRIVATE_KEY", privateKey);
  convex("env", "set", "--", "JWKS", jwks);
  console.log("Login signing keys created.");
} else {
  console.log("Login signing keys already exist; left alone.");
}

const pairs = (process.env.SET || "").split(";").map((s) => s.trim()).filter(Boolean);
for (const pair of pairs) {
  const i = pair.indexOf("=");
  const name = pair.slice(0, i).trim();
  const value = pair.slice(i + 1).trim();
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(`Bad setting name: ${name}`);
  if (/(KEY|SECRET|PASSWORD|TOKEN|WEBHOOK)/.test(name)) throw new Error(`${name} looks secret: set it in the Convex dashboard instead.`);
  convex("env", "set", "--", name, value);
  console.log(`Set ${name}=${value}`);
}
