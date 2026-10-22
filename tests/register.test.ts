// The register (Phase R2): numbers, file names, the import match, the connector tools and the Sheet feed.
import { convexTest } from "convex-test";
import { beforeAll, describe, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import { nextFileName, parseRegisterName, shortTitleError, shortTitleFrom } from "../convex/lib/register";

const modules = import.meta.glob("../convex/**/*.ts");
beforeAll(() => { process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com"; });

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston" });
    const sessionId = await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 });
    const projectId = await ctx.db.insert("projects", { name: "Harbor Coffee Launch", createdAt: Date.now() });
    // An older video from before numbering: three versions, no number.
    const oldId = await ctx.db.insert("videos", { projectId, title: "Brand Film", createdAt: Date.now(), updatedAt: Date.now() });
    for (const n of [1, 2, 3]) await ctx.db.insert("versions", { videoId: oldId, number: n, status: "ready", bunnyGuid: `g${n}`, fileName: `v${n}.mp4`, startTimecode: "01:00:00:00", createdAt: Date.now() });
    return { userId, sessionId, projectId, oldId };
  });
  return { t, ...ids, me: t.withIdentity({ subject: `${ids.userId}|${ids.sessionId}` }) };
}

describe("names", () => {
  test("short titles, checks and parsing", () => {
    expect(shortTitleFrom("Brand Film")).toBe("BrandFilm");
    expect(shortTitleFrom("spirit days intro")).toBe("SpiritDaysIntro");
    expect(shortTitleFrom("Café – Opening (v2)")).toBe("CafeOpeningV2");
    expect(shortTitleFrom("Safety-Video 2026")).toBe("Safety-Video2026");
    expect(shortTitleError("BrandFilm")).toBeNull();
    expect(shortTitleError("Brand Film")).toMatch(/letters, digits and hyphens/);
    expect(shortTitleError("LC_Arizona")).toMatch(/letters, digits and hyphens/);
    expect(shortTitleError("")).toMatch(/short title/);
    expect(nextFileName({ number: 1, shortTitle: "BrandFilm" }, 3)).toBe("00001_BrandFilm_v4");
    expect(nextFileName({ number: undefined, shortTitle: undefined }, 3)).toBeNull();
    expect(parseRegisterName("00001_BrandFilm_v4.mp4")).toEqual({ number: 1, shortTitle: "BrandFilm", version: 4 });
    expect(parseRegisterName("00012_Safety-Video_V10.MOV")).toEqual({ number: 12, shortTitle: "Safety-Video", version: 10 });
    expect(parseRegisterName("00003_Thing.mp4")).toEqual({ number: 3, shortTitle: "Thing", version: null });
    expect(parseRegisterName("26201_HC26_Promo_Step3_Main_v4d.mp4")).toEqual({ number: 26201, shortTitle: "", version: null });
    expect(parseRegisterName("4M_LC_AZ_Story_v11.mp4")).toBeNull();
  });
});

describe("numbers", () => {
  test("an older video numbered by hand moves the counter; new videos continue; numbers are never reused", async () => {
    const { t, me, oldId, projectId } = await setup();
    const r0 = await t.mutation(internal.register.numberExisting, { videoId: oldId, number: 1, shortTitle: "BrandFilm", client: "Harbor Coffee" });
    expect(r0).toMatchObject({ number: "00001", next: "00001_BrandFilm_v4" });
    await expect(t.mutation(internal.register.numberExisting, { videoId: oldId, number: 2, shortTitle: "X" })).rejects.toThrow(/already 00001/);
    expect((await t.run((ctx) => ctx.db.get(projectId)))!.client).toBe("Harbor Coffee");

    const a = await me.mutation(api.register.newVideo, { title: "Fall Teaser", projectName: "Northline Fall Campaign", client: "Northline Outfitters" });
    expect(a).toMatchObject({ number: 2, numberText: "00002", shortTitle: "FallTeaser", fileName: "00002_FallTeaser_v1", project: "Northline Fall Campaign", client: "Northline Outfitters" });
    const b = await me.mutation(api.library.createVideo, { projectId, title: "Brand Film Social" }); // the Upload dialog's path
    expect((await t.run((ctx) => ctx.db.get(b)))).toMatchObject({ number: 3, shortTitle: "BrandFilmSocial" });
    await me.mutation(api.library.deleteProject, { projectId: (await t.run((ctx) => ctx.db.get(a.videoId)))!.projectId });
    const c = await me.mutation(api.register.newVideo, { title: "Recap", shortTitle: "Recap", projectId });
    expect(c.number).toBe(4); // 00002 was deleted and stays retired

    await expect(me.mutation(api.register.newVideo, { title: "Bad", shortTitle: "Bad Name", projectId })).rejects.toThrow(/letters, digits and hyphens/);
    await expect(t.mutation(internal.register.numberExisting, { videoId: c.videoId, number: 9, shortTitle: "Y" })).rejects.toThrow(/already/);

    const list = await me.query(api.register.list, {});
    expect(list.unnumbered).toBe(0);
    expect(list.rows.map((x) => x.numberText)).toEqual(["00004", "00003", "00001"]);
    expect(list.rows.find((x) => x.number === 1)).toMatchObject({ nextFileName: "00001_BrandFilm_v4", latest: 3, versions: 3, client: "Harbor Coffee", status: "Ready" });
    expect(list.rows.find((x) => x.number === 4)).toMatchObject({ nextFileName: "00004_Recap_v1", latest: null, status: "Waiting for v1" });
    expect((await me.query(api.library.video, { videoId: oldId }))).toMatchObject({ number: 1, nextFileName: "00001_BrandFilm_v4" });

    await me.mutation(api.register.setShortTitle, { videoId: c.videoId, shortTitle: "RecapCut" });
    expect((await me.query(api.register.nextName, { videoId: c.videoId }))!.fileName).toBe("00004_RecapCut_v1");
  });
});

describe("dropbox import", () => {
  test("a register-named file goes to its video whatever the folder; others make a new numbered video", async () => {
    const { t, oldId } = await setup();
    await t.mutation(internal.register.numberExisting, { videoId: oldId, number: 1, shortTitle: "BrandFilm" });
    const hit = await t.mutation(internal.dropbox.findOrCreateTarget, { project: "Somewhere Else", video: "Any Folder", fileName: "00001_BrandFilm_v4.mp4" });
    expect(hit.videoId).toBe(oldId);
    const fresh = await t.mutation(internal.dropbox.findOrCreateTarget, { project: "26201 Spring Menu", video: "Menu Outro", fileName: "MenuOutro_v1.mp4" });
    expect(await t.run((ctx) => ctx.db.get(fresh.videoId))).toMatchObject({ number: 2, shortTitle: "MenuOutro", title: "Menu Outro" });
  });
});

describe("connector", () => {
  test("register_video, next_render_name, set_version_description and find_videos by number", async () => {
    const { t, oldId } = await setup();
    await t.mutation(internal.register.numberExisting, { videoId: oldId, number: 1, shortTitle: "BrandFilm" });
    const r = await t.mutation(internal.register.newVideoInternal, { title: "Menu Outro", projectName: "26201 Spring Menu", client: "Harbor Coffee" });
    expect(r).toMatchObject({ numberText: "00002", fileName: "00002_MenuOutro_v1", project: "Spring Menu", client: "Harbor Coffee" });
    expect(await t.run(async (ctx) => (await ctx.db.query("projects").collect()).find((p) => p.name === "Spring Menu"))).toMatchObject({ jobNumber: "26201" });
    // the same project name again reuses the project
    await t.mutation(internal.register.newVideoInternal, { title: "Menu Promo", projectName: "Spring Menu" });
    expect(await t.run(async (ctx) => (await ctx.db.query("projects").collect()).filter((p) => p.name === "Spring Menu").length)).toBe(1);

    expect(await t.query(internal.connector.nextRenderFor, { video: "00001" })).toMatchObject({ number: "00001", next_file_name: "00001_BrandFilm_v4.mp4", next_version: 4 });
    expect(await t.query(internal.connector.nextRenderFor, { video: "00001_BrandFilm_v3" })).toMatchObject({ number: "00001" });
    const d = await t.mutation(internal.connector.describeVersion, { video: "00001", description: "Step 3: VO and music" });
    expect(d).toMatchObject({ version: 3, description: "Step 3: VO and music" });
    // an older video joins the register through the connector with the next number
    const older = await t.run(async (ctx) => ctx.db.insert("videos", { projectId: (await ctx.db.get(oldId))!.projectId, title: "Behind the Scenes", createdAt: Date.now(), updatedAt: Date.now() }));
    expect(await t.mutation(internal.connector.addToRegisterFor, { videoId: older, shortTitle: "BTS" })).toMatchObject({ number: "00004", next_file_name: "00004_BTS_v1.mp4" });
    await expect(t.mutation(internal.connector.addToRegisterFor, { videoId: older, shortTitle: "BTS" })).rejects.toThrow(/already 00004/);
    const found = await t.query(internal.connector.findVideos, { query: "1" });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ number: "00001", next_render: "00001_BrandFilm_v4.mp4" });
  });
});

describe("sheet feed", () => {
  test("needs the key; returns the register as rows", async () => {
    const { t, me, oldId } = await setup();
    await t.mutation(internal.register.numberExisting, { videoId: oldId, number: 1, shortTitle: "BrandFilm", client: "Harbor Coffee" });
    expect((await t.fetch("/register-feed")).status).toBe(401);
    const key = "wrs_stand-in-key";
    await t.mutation(internal.register.replaceSheetKey, { hash: createHash("sha256").update(key).digest("hex"), prefix: key.slice(0, 9) });
    expect((await t.fetch("/register-feed", { headers: { "X-Key": "wrs_wrong" } })).status).toBe(401);
    const res = await t.fetch("/register-feed", { headers: { "X-Key": key } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.columns[0]).toBe("Number");
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({ Number: "00001", "Next render": "00001_BrandFilm_v4.mp4", Client: "Harbor Coffee", "Latest version": "v3" });
    expect(await me.query(api.register.sheetKey, {})).toMatchObject({ prefix: "wrs_stand" });
    await me.mutation(api.register.removeSheetKey, {});
    expect((await t.fetch("/register-feed", { headers: { "X-Key": key } })).status).toBe(401);
  });
});
