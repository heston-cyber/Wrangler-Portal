// Phase 8f (Nov 19): tests that used the old Review (wr_) or Sign (ws_) connector keys use the one Wrangler Portal
// connector instead. Its keys belong to a business's owner, so this makes sure the signed-in user owns a business
// (making one if they have none), then makes a key for them.
import type { convexTest } from "convex-test";
import { anyApi } from "convex/server";

type T = ReturnType<typeof convexTest>;
type Who = { action: T["action"] };

export async function portalKeyFor(t: T, who: Who, email = "heston@wranglerproductions.com"): Promise<string> {
  await t.run(async (ctx) => {
    const user = (await ctx.db.query("users").collect()).find((u) => u.email === email);
    if (!user) throw new Error(`No user ${email}`);
    // 8f review L6: an owner membership may carry only the email (ensureDefaultBusiness makes those).
    const members = await ctx.db.query("memberships").collect();
    if (members.some((m) => m.role === "owner" && (m.userId === user._id || m.email === email))) return;
    // Join the default business if there is one (so the user's records never move); otherwise make it, as on the live site.
    const existing = (await ctx.db.query("businesses").collect()).find((b) => b.slug === "wrangler");
    const businessId = existing?._id ?? await ctx.db.insert("businesses", { slug: "wrangler", name: "Wrangler Productions", createdAt: 0 });
    await ctx.db.insert("memberships", { businessId, email, userId: user._id, role: "owner", createdAt: 0 });
  });
  return ((await who.action(anyApi.portalKeys.createKey, {})) as { key: string }).key;
}
