// Wrangler Portal, Phase 0.5d step 3 (Oct 28): two businesses. Business B's owner calls every public function with
// business A's record ids (the very same list and arguments as the access matrix). Nothing of A may come back, and
// nothing of A may change. Then the other way round for what B makes.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { argsFor, call, publicFunctions, setup } from "./matrix";
import { BUSINESS_TABLES } from "../convex/lib/tenancy";

const api = anyApi;

beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.DROPBOX_APP_KEY = "test-key";
  process.env.DROPBOX_APP_SECRET = "test-secret";
  process.env.BUNNY_STREAM_LIBRARY_ID = "785477";
  process.env.BUNNY_STREAM_API_KEY = "bunny-test";
  process.env.RESEND_API_KEY = "re_test";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.CONVEX_SITE_URL = "https://handsome-hummingbird-11.convex.site";
});
afterEach(() => vi.unstubAllGlobals());

// Settings that are still one per deployment until step 4 makes them per business (Dropbox connections, Sign's
// profile and archive, connector and Sheet keys). Their functions are checked again in step 4.
const STEP4 = new Set<string>([]);

async function twoBusinesses() {
  const { t, ids } = await setup();
  const extra = await t.run(async (ctx) => {
    const a = await ctx.db.insert("businesses", { slug: "wrangler", name: "Wrangler Productions", createdAt: 0 });
    await ctx.db.insert("memberships", { businessId: a, email: "heston@wranglerproductions.com", role: "owner", createdAt: 0 });
    const b = await ctx.db.insert("businesses", { slug: "other", name: "Other Films", createdAt: 1 });
    const bOwner = await ctx.db.insert("users", { email: "boss@otherfilms.example", name: "Boss", role: "owner" });
    await ctx.db.insert("memberships", { businessId: b, email: "boss@otherfilms.example", userId: bOwner, role: "owner", createdAt: 1 });
    const bSub = `${bOwner}|${await ctx.db.insert("authSessions", { userId: bOwner, expirationTime: Date.now() + 3_600_000 })}`;
    return { a, b, bSub };
  });
  return { t, ids, ...extra };
}

async function snapshot(t: Awaited<ReturnType<typeof setup>>["t"], biz: Id<"businesses">, isDefault: boolean) {
  return t.run(async (ctx) => {
    const out: Record<string, unknown[]> = {};
    for (const table of BUSINESS_TABLES) {
      const rows = (await ctx.db.query(table as never).collect()) as Array<{ businessId?: string }>;
      out[table] = rows.filter((r) => r.businessId === biz || (isDefault && r.businessId === undefined));
    }
    return out;
  });
}

describe("two businesses", () => {
  test("B's owner gets nothing of A from any function, and changes nothing of A", async () => {
    const { t, ids, a, bSub } = await twoBusinesses();
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 })); // nothing external may be reached
    const before = await snapshot(t, a, true);
    const b = t.withIdentity({ subject: bSub });
    const table = argsFor(ids);
    // File ids (Convex storage) aren't business records: they're long random capabilities, handed only to whoever
    // uploaded the file. Giving files a business is on the product-phase list; here only records are checked.
    const aIds = Object.entries(ids).filter(([k]) => !/Sub$/.test(k) && k !== "storageId").map(([, v]) => String(v));
    const leaks: string[] = [];
    for (const f of publicFunctions()) {
      if (STEP4.has(f.key)) continue;
      let out: unknown;
      try { out = await call(b, f.ref, table[f.key], ""); } catch { continue; } // refused or failed: nothing returned
      const json = JSON.stringify(out ?? null);
      const hit = aIds.find((id) => json.includes(id));
      if (hit) leaks.push(`${f.key} returned A's ${hit}`);
    }
    expect(leaks).toEqual([]);
    const after = await snapshot(t, a, true);
    const changed = Object.keys(before).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    expect(changed).toEqual([]);
  });

  test("each owner sees only their own projects; B's records are stamped with B", async () => {
    const { t, ids, b, bSub } = await twoBusinesses();
    const heston = t.withIdentity({ subject: ids.ownerSub });
    const boss = t.withIdentity({ subject: bSub });
    const bProject = await boss.mutation(api.library.createProject, { name: "Other Films Project" });
    const bRow = await t.run(async (ctx) => ctx.db.get(bProject as Id<"projects">));
    expect(bRow?.businessId).toBe(b);
    const names = (o: { projects?: Array<{ name: string }> }) => (o.projects ?? []).map((p) => p.name);
    expect(names(await boss.query(api.library.overview, {}))).toEqual(["Other Films Project"]);
    expect(names(await heston.query(api.library.overview, {}))).not.toContain("Other Films Project");
    // A's owner can't open, rename or delete B's project either.
    await expect(heston.mutation(api.library.renameProject, { projectId: bProject, name: "x" })).rejects.toThrow();
    expect((await t.run(async (ctx) => ctx.db.get(bProject as Id<"projects">)))?.name).toBe("Other Films Project");
  });

  test("a guest on A's share link sees A's video; B's owner on it sees nothing", async () => {
    const { t, bSub } = await twoBusinesses();
    const guest = await t.query(api.shares.open, { token: "tok" });
    expect(JSON.stringify(guest)).toContain('"title":"V"');
    const asB = await t.withIdentity({ subject: bSub }).query(api.shares.open, { token: "tok" });
    expect(JSON.stringify(asB)).not.toContain('"title":"V"');
  });
});
