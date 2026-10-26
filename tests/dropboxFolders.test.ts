// C7 (Oct 24): folders make projects. Clients/<Client>/<Project>/ and Projects/<Project>/ in the drop folder make
// clients and projects the minute they appear; a renamed folder renames; a deleted folder deletes nothing. A flagged
// render in a project folder can be registered and imported in one go (the Dropbox file keeps its name).
import { convexTest } from "convex-test";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import { folderPlace, projectFolderOf } from "../convex/lib/dropboxPath";
import type { Id } from "../convex/_generated/dataModel";

const modules = import.meta.glob("../convex/**/*.ts");
beforeAll(() => { process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com"; });

const F = (display: string) => ({ pathLower: display.toLowerCase(), pathDisplay: display });

describe("what a folder means", () => {
  test("Clients/ and Projects/ are read; the rest of the top level is left alone", () => {
    expect(folderPlace("/clients/floor trader", "/Clients/Floor Trader")).toEqual({ kind: "client", client: "Floor Trader", folder: "/clients/floor trader" });
    expect(folderPlace("/clients/floor trader/backrooms", "/Clients/Floor Trader/Backrooms")).toEqual({ kind: "project", client: "Floor Trader", project: "Backrooms", folder: "/clients/floor trader/backrooms", clientFolder: "/clients/floor trader" });
    expect(folderPlace("/projects/26122 spirit days", "/Projects/26122 Spirit Days")).toEqual({ kind: "project", project: "26122 Spirit Days", folder: "/projects/26122 spirit days" });
    expect(folderPlace("/clients", "/Clients")).toBeNull();
    expect(folderPlace("/floor trader/backrooms", "/Floor Trader/Backrooms")).toBeNull();
    expect(folderPlace("/_tests/r1", "/_tests/r1")).toBeNull();
    // Deeper folders are the editor's own tidiness.
    expect(folderPlace("/clients/floor trader/backrooms/renders", "/Clients/Floor Trader/Backrooms/renders")).toEqual(expect.objectContaining({ kind: "project", project: "Backrooms" }));
  });
  test("the project folder a file sits in", () => {
    expect(projectFolderOf("/clients/floor trader/backrooms/renders/00009_Backrooms_v1.mp4", "/Clients/Floor Trader/Backrooms/renders/00009_Backrooms_v1.mp4")?.folder).toBe("/clients/floor trader/backrooms");
    expect(projectFolderOf("/projects/spirit days/00010_x_v1.mp4", "/Projects/Spirit Days/00010_x_v1.mp4")?.project).toBe("Spirit Days");
    expect(projectFolderOf("/projects/00010_x_v1.mp4", "/Projects/00010_x_v1.mp4")).toBeNull(); // not inside a project folder
    expect(projectFolderOf("/clients/floor trader/00010_x_v1.mp4", "/Clients/Floor Trader/00010_x_v1.mp4")).toBeNull();
    expect(projectFolderOf("/misc/x/00010_x_v1.mp4", "/misc/x/00010_x_v1.mp4")).toBeNull();
  });
});

async function setup() {
  const t = convexTest(schema, modules);
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 }));
  const ownerSub = await t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston", role: "owner" });
    return `${owner}|${await ctx.db.insert("authSessions", { userId: owner, expirationTime: Date.now() + 3_600_000 })}`;
  });
  const projects = () => t.run(async (ctx) => (await ctx.db.query("projects").collect()).map((p) => ({ name: p.name, client: p.client ?? null, jobNumber: p.jobNumber ?? null, folder: p.dropboxFolder ?? null })));
  const clients = () => t.run(async (ctx) => (await ctx.db.query("clients").collect()).map((c) => ({ name: c.name, folder: c.dropboxFolder ?? null })));
  const folders = (fs: string[], gone: string[] = []) => t.mutation(internal.dropbox.recordFolders, { folders: fs.map(F), gone: gone.map((g) => g.toLowerCase()) });
  return { t, me: t.withIdentity({ subject: ownerSub }), projects, clients, folders };
}

describe("folders make projects", () => {
  test("a client folder, a project inside it, a lone project with a job number; the rest ignored", async () => {
    const { projects, clients, folders } = await setup();
    const n = await folders(["/Clients", "/Projects", "/Clients/Floor Trader", "/Clients/Floor Trader/Backrooms", "/Projects/26122 Spirit Days", "/Random/Thing", "/_tests/r1", "/Clients/Floor Trader/Backrooms/renders"]);
    expect(n).toBe(3); // client, project, project
    expect(await clients()).toEqual([{ name: "Floor Trader", folder: "/clients/floor trader" }]);
    expect(await projects()).toEqual(expect.arrayContaining([
      { name: "Backrooms", client: "Floor Trader", jobNumber: null, folder: "/clients/floor trader/backrooms" },
      { name: "Spirit Days", client: null, jobNumber: "26122", folder: "/projects/26122 spirit days" },
    ]));
    expect((await projects()).length).toBe(2);
    // Seen again (a full re-list): nothing new.
    expect(await folders(["/Clients/Floor Trader", "/Clients/Floor Trader/Backrooms", "/Projects/26122 Spirit Days"])).toBe(0);
    expect((await projects()).length).toBe(2);
  });

  test("the project folder arrives without its client folder in the batch: the client is still made", async () => {
    const { projects, clients, folders } = await setup();
    await folders(["/Clients/Harbor/Launch"]);
    expect(await clients()).toEqual([{ name: "Harbor", folder: "/clients/harbor" }]);
    expect(await projects()).toEqual([{ name: "Launch", client: "Harbor", jobNumber: null, folder: "/clients/harbor/launch" }]);
  });

  test("a project already made on the site is matched, not duplicated", async () => {
    const { t, projects, folders } = await setup();
    await t.run((ctx) => ctx.db.insert("projects", { name: "Arizona", client: "4M LC", jobNumber: "26210", createdAt: 1 }));
    await folders(["/Clients/4M LC", "/Clients/4M LC/26210 Arizona"]);
    expect(await projects()).toEqual([{ name: "Arizona", client: "4M LC", jobNumber: "26210", folder: "/clients/4m lc/26210 arizona" }]);
    // And a same-named project under another client is NOT taken over.
    await folders(["/Clients/Prairie/26210 Arizona"]);
    expect((await projects()).map((p) => `${p.client}/${p.name}`).sort()).toEqual(["4M LC/Arizona", "Prairie/Arizona"]);
  });

  test("renaming a project folder renames the project (videos stay); renaming a client folder follows through its projects", async () => {
    const { t, projects, clients, folders } = await setup();
    await folders(["/Clients/Floor Trader", "/Clients/Floor Trader/Backrooms"]);
    const before = await projects();
    const pid = await t.run(async (ctx) => (await ctx.db.query("projects").first())!._id);
    await t.run((ctx) => ctx.db.insert("videos", { projectId: pid, title: "Teaser", createdAt: 1, updatedAt: 1 }));
    // Dropbox reports a rename as the old path deleted and the new one added.
    expect(await folders(["/Clients/Floor Trader/Backrooms Halloween"], ["/Clients/Floor Trader/Backrooms"])).toBe(1);
    expect(await projects()).toEqual([{ ...before[0], name: "Backrooms Halloween", folder: "/clients/floor trader/backrooms halloween" }]);
    expect((await t.run((ctx) => ctx.db.query("videos").collect())).length).toBe(1);
    // Client rename: its project folders come along as new paths in the same batch.
    expect(await folders(["/Clients/Floor Trader Inc", "/Clients/Floor Trader Inc/Backrooms Halloween"], ["/Clients/Floor Trader"])).toBe(1);
    expect(await clients()).toEqual([{ name: "Floor Trader Inc", folder: "/clients/floor trader inc" }]);
    expect(await projects()).toEqual([{ name: "Backrooms Halloween", client: "Floor Trader Inc", jobNumber: null, folder: "/clients/floor trader inc/backrooms halloween" }]);
  });

  test("a job number from the folder name leaves with it on a rename; one set on the site stays", async () => {
    const { t, projects, folders } = await setup();
    await folders(["/Projects/00002 CG Safety Video"]);
    expect(await projects()).toEqual([{ name: "CG Safety Video", client: null, jobNumber: "00002", folder: "/projects/00002 cg safety video" }]);
    await folders(["/Projects/CG Safety Video"], ["/Projects/00002 CG Safety Video"]);
    expect(await projects()).toEqual([{ name: "CG Safety Video", client: null, jobNumber: null, folder: "/projects/cg safety video" }]);
    // Set on the site: a folder rename without a number keeps it.
    const pid = await t.run(async (ctx) => (await ctx.db.query("projects").first())!._id);
    await t.run((ctx) => ctx.db.patch(pid, { jobNumber: "26300" }));
    await folders(["/Projects/Safety Video"], ["/Projects/CG Safety Video"]);
    expect(await projects()).toEqual([{ name: "Safety Video", client: null, jobNumber: "26300", folder: "/projects/safety video" }]);
  });

  test("deleting a folder deletes nothing on the site; it only forgets the link", async () => {
    const { projects, folders } = await setup();
    await folders(["/Projects/Spirit Days"]);
    expect(await folders([], ["/Projects/Spirit Days"])).toBe(0);
    expect(await projects()).toEqual([{ name: "Spirit Days", client: null, jobNumber: null, folder: null }]);
    // The folder coming back links up again by name instead of making a second project.
    await folders(["/Projects/Spirit Days"]);
    expect(await projects()).toEqual([{ name: "Spirit Days", client: null, jobNumber: null, folder: "/projects/spirit days" }]);
  });
});

describe("a flagged render in a project folder", () => {
  async function flaggedIn(path: string) {
    const s = await setup();
    await s.folders(["/Clients/Floor Trader", "/Clients/Floor Trader/Backrooms"]);
    const fileId = await s.t.run((ctx) => ctx.db.insert("dropFiles", { pathLower: path.toLowerCase(), pathDisplay: path, rev: "r1", size: 10, status: "flagged", reason: "Not a register name.", firstSeenAt: 1, lastChangeAt: Date.now(), checks: 0 }));
    return { ...s, fileId };
  }

  test("the Register page knows which project it sits in and suggests a title", async () => {
    const { me, t } = await flaggedIn("/Clients/Floor Trader/Backrooms/backrooms_teaser-cut.mp4");
    const rows = await me.query(api.dropbox.flagged, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ project: { name: "Backrooms", client: "Floor Trader" }, suggestedTitle: "backrooms teaser cut" });
    await t.run((ctx) => ctx.db.insert("dropFiles", { pathLower: "/clients/floor trader/backrooms/00002_cgsafetyvideo_v1.mp4", pathDisplay: "/Clients/Floor Trader/Backrooms/00002_CGSafetyVideo_v1.mp4", rev: "r2", size: 10, status: "flagged", firstSeenAt: 1, lastChangeAt: Date.now(), checks: 0 }));
    expect((await me.query(api.dropbox.flagged, {})).find((r) => /CGSafety/.test(r.path))?.suggestedTitle).toBe("CGSafetyVideo");
  });

  test("Register & import: a new video in that project; the file imports as its v1 under the register name", async () => {
    const { t, me, fileId } = await flaggedIn("/Clients/Floor Trader/Backrooms/teaser.mp4");
    const r = await me.mutation(api.dropbox.registerFlagged, { fileId, title: "Backrooms Teaser" });
    expect(r).toMatchObject({ number: "00001", fileName: "00001_BackroomsTeaser_v1.mp4", project: "Backrooms", client: "Floor Trader" });
    const vid = await t.run((ctx) => ctx.db.get(r.videoId as Id<"videos">));
    expect(vid).toMatchObject({ title: "Backrooms Teaser", number: 1, shortTitle: "BackroomsTeaser" });
    const f = await t.run((ctx) => ctx.db.get(fileId));
    expect(f).toMatchObject({ status: "waiting", registerAs: { number: 1, shortTitle: "BackroomsTeaser", version: 1 } });
    // A second press is refused: it's no longer flagged.
    await expect(me.mutation(api.dropbox.registerFlagged, { fileId })).rejects.toThrow(/isn't waiting/);
  });

  test("…or the next version of a video already in the register, wherever the file sits", async () => {
    const { t, me, fileId } = await flaggedIn("/Clients/Floor Trader/Backrooms/teaser (qr code).mp4");
    const videoId = await t.run(async (ctx) => {
      const p = (await ctx.db.query("projects").first())!;
      const id = await ctx.db.insert("videos", { projectId: p._id, title: "Teaser", number: 7, shortTitle: "Teaser", createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("versions", { videoId: id, number: 1, status: "ready", bunnyGuid: "g", fileName: "00007_Teaser_v1.mp4", startTimecode: "01:00:00:00", createdAt: 1 } as never);
      return id;
    });
    const r = await me.mutation(api.dropbox.registerFlagged, { fileId, videoId });
    expect(r).toMatchObject({ number: "00007", fileName: "00007_Teaser_v2.mp4", project: "Backrooms" });
    expect(await t.run((ctx) => ctx.db.get(fileId))).toMatchObject({ status: "waiting", registerAs: { number: 7, shortTitle: "Teaser", version: 2 } });
    expect((await t.run((ctx) => ctx.db.query("videos").collect())).length).toBe(1); // no new video
  });

  test("outside a project folder there is nothing to register into", async () => {
    const { me, fileId } = await flaggedIn("/Clients/Floor Trader/teaser.mp4");
    expect((await me.query(api.dropbox.flagged, {}))[0].project).toBeNull();
    await expect(me.mutation(api.dropbox.registerFlagged, { fileId })).rejects.toThrow(/Move it into a project folder/);
  });

  test("a register-named file in the wrong project folder still imports, with a note (the number wins)", async () => {
    const { t, folders } = await setup();
    await folders(["/Clients/Floor Trader", "/Clients/Floor Trader/Backrooms", "/Projects/Tests"]);
    const tests = await t.run(async (ctx) => (await ctx.db.query("projects").collect()).find((p) => p.name === "Tests")!._id);
    const note = await t.query(internal.dropbox.folderNote, { pathLower: "/clients/floor trader/backrooms/00001_x_v1.mp4", pathDisplay: "/Clients/Floor Trader/Backrooms/00001_x_v1.mp4", projectId: tests });
    expect(note).toBe("Saved under Floor Trader › Backrooms, but video is in Tests (the number wins).");
    const backrooms = await t.run(async (ctx) => (await ctx.db.query("projects").collect()).find((p) => p.name === "Backrooms")!._id);
    expect(await t.query(internal.dropbox.folderNote, { pathLower: "/clients/floor trader/backrooms/00001_x_v1.mp4", pathDisplay: "/Clients/Floor Trader/Backrooms/00001_x_v1.mp4", projectId: backrooms })).toBeNull();
    expect(await t.query(internal.dropbox.folderNote, { pathLower: "/misc/00001_x_v1.mp4", pathDisplay: "/misc/00001_x_v1.mp4", projectId: tests })).toBeNull();
  });
});
