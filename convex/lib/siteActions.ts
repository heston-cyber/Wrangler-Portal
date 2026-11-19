// Phase 8b (Heston, Nov 18, D208): what the connector can do on the site, one line per site function it may run as the
// business owner. Each is one of:
//   read    answers, changes nothing
//   change  done directly (Activity says "Claude"); if the run would send anything to anyone it's undone, and Claude
//           is told to ask (siteGuard.ts)
//   ask     always a request Heston confirms on the site: it reaches someone even when no email goes (a shoot on the
//           client's portal, a link opened to anyone, a booking offered)
//   delete  always a request Heston confirms
// Not here on purpose: signing (releases are signed in person, contracts through Sign's own tools), money (8c), W-9s and
// tax details, moving work to another client (Heston does that on the site), and the client's, vendor's and guest's own
// pages. 8c and 8d add the rest of the site to this same list.
import * as library from "../library";
import * as projects from "../projects";
import * as homes from "../homes";
import * as production from "../production";
import * as shoots from "../shoots";
import * as shootPage from "../shootPage";
import * as callSheets from "../callSheets";
import * as shotLists from "../shotLists";
import * as releases from "../releases";
import * as gear from "../gear";
import * as packing from "../packing";
import * as places from "../places";
import * as vendors from "../vendors";
import * as bookings from "../bookings";
import * as briefings from "../briefings";
import * as work from "../work";
import * as creative from "../creative";
import * as canvas from "../canvas";
import * as delivery from "../delivery";
import type { QueryCtx } from "../_generated/server";

export type Mode = "read" | "change" | "ask" | "delete";
export type Area = "projects" | "production" | "crew" | "work" | "creative" | "delivery";
/** A registered Convex function, as the runtime keeps it. */
export type SiteFn = { _handler: (ctx: unknown, args: unknown) => Promise<unknown>; exportArgs: () => string; isQuery?: boolean; isMutation?: boolean };
type Args = Record<string, unknown>;
export type Entry = {
  mode: Mode; area: Area; does: string; fn: SiteFn;
  /** For a change: when these arguments make it reach someone, it's an ask (the reason, shown to Claude). */
  askWhen?: (a: Args) => string | null;
  /** For a change: when the record as it is now makes it reach someone (a shared board, a client's task), it's an ask. */
  outside?: (ctx: QueryCtx, a: Args) => Promise<string | null>;
  /** Fields of the answer that never leave (beyond the W-9, tax, bank and secret ones every answer drops). */
  hide?: string[];
  /** Never through the connector with these arguments (the reason). */
  refuse?: (a: Args) => string | null;
  /** Shown on the Confirm page: what this does beyond what's listed as sent. */
  note?: string;
  /** More lines for the Confirm page, read live (which files a delivery releases, which tasks a template makes). */
  shows?: (ctx: QueryCtx, a: Args) => Promise<Array<{ label: string; value: string }>>;
};

const get = async (ctx: QueryCtx, table: string, id: unknown) => {
  if (typeof id !== "string") return null;
  const nid = ctx.db.normalizeId(table as never, id);
  return nid ? ((await ctx.db.get(nid)) as Record<string, any> | null) : null;
};
/** Review H3: a board with people on it or its view link on is seen outside the business. */
const sharedBoard = async (ctx: QueryCtx, a: Args) => {
  const c = await get(ctx, "canvases", a.canvasId);
  if (!c) return null;
  const people = (await ctx.db.query("canvasPeople").collect()).filter((x) => x.canvasId === c._id);
  return people.length || c.link?.on ? "This board is shared: what's saved on it shows to the people it's shared with at once." : null;
};
/** Review M4 (built as the build suggests, Heston to confirm): a task the client or a vendor sees is a message to them. */
const theirTask = async (ctx: QueryCtx, a: Args) => {
  const t = await get(ctx, "tasks", a.taskId);
  return t && (t.audience === "client" || t.audience === "vendor" || t.vendorId) ? "This task shows in the client's or a vendor's portal, so changing it reaches them." : null;
};

const fn = (x: unknown) => x as SiteFn;
const r = (area: Area, f: unknown, does: string): Entry => ({ mode: "read", area, does, fn: fn(f) });
const c = (area: Area, f: unknown, does: string, more: Partial<Entry> = {}): Entry => ({ mode: "change", area, does, fn: fn(f), ...more });
const ask = (area: Area, f: unknown, does: string, note: string, more: Partial<Entry> = {}): Entry => ({ mode: "ask", area, does, fn: fn(f), note, ...more });
const del = (area: Area, f: unknown, does: string, note?: string): Entry => ({ mode: "delete", area, does, fn: fn(f), ...(note ? { note } : {}) });

const reaches = (a: Args) => a.audience === "client" || a.audience === "vendor" || (typeof a.vendorId === "string" && !!a.vendorId)
  ? "A task for the client or a vendor shows in their portal." : null;
const MOVE_CLIENT = "Moving a project to another client is done by Heston on the site.";

export const ACTIONS: Record<string, Entry> = {
  // ---- projects ----
  "library.projectNames": r("projects", library.projectNames, "Every project's name and client (for picking one)"),
  "library.overview": r("projects", library.overview, "Review's library: clients, projects and their videos"),
  "homes.projectsBoard": r("projects", homes.projectsBoard, "Projects grouped by client, and the ones on their own"),
  "homes.clientChoices": r("projects", homes.clientChoices, "The clients a project can be filed under"),
  "homes.loose": r("projects", homes.loose, "Things not attached to a client, project or shoot day"),
  "projects.page": r("projects", projects.page, "One project's page: stage, next step, key dates, rounds, delivery"),
  "projects.nextRound": r("projects", projects.nextRound, "The revision round the next version would be"),
  "library.createProject": c("projects", library.createProject, "Make a project (with no client: filing one under a client is an ask)", {
    askWhen: (a) => (typeof a.client === "string" && a.client.trim() ? "Filing a new project under a client lets that client's people see its cuts." : null),
  }),
  "library.renameProject": c("projects", library.renameProject, "Rename a project or change its job number", {
    refuse: (a) => (a.client !== undefined ? MOVE_CLIENT : null),
  }),
  "projects.setStage": c("projects", projects.setStage, "Move a project to a stage (posting it to the client's Inbox is an ask)", {
    // Review M3: a project out of Delivery is open again, so its call-sheet guests can sign in again.
    outside: async (ctx, a) => ((await get(ctx, "projects", a.projectId))?.stage === "delivery" && a.stage !== "delivery" ? "Moving a project out of Delivery opens it again: its call-sheet guests can sign in again." : null),
  }),
  "projects.setNextStep": c("projects", projects.setNextStep, "Set a project's next step"),
  "projects.setKeyDates": c("projects", projects.setKeyDates, "Set a project's key dates"),
  "projects.setRounds": c("projects", projects.setRounds, "Set how many revision rounds a project includes"),
  "projects.addDeliveryFile": ask("projects", projects.addDeliveryFile, "Add a final file to a project's delivery", "If the project's final files are unlocked, the client's people can download it at once."),
  "projects.setDelivery": ask("projects", projects.setDelivery, "Unlock (or lock) a project's final files for the client", "Unlocking lets the client's people download the final files.", {
    shows: async (ctx, a) => {
      const p = await get(ctx, "projects", a.projectId);
      if (!p) return [];
      const files = (await ctx.db.query("deliveryFiles").collect()).filter((f) => f.projectId === p._id);
      return [{ label: "Final files", value: files.length ? files.map((f) => String(f.name ?? "a file")).join("\n").slice(0, 3000) : "None yet" }];
    },
  }),
  "projects.removeDeliveryFile": del("projects", projects.removeDeliveryFile, "Take a file off a project's delivery"),
  "library.deleteProject": del("projects", library.deleteProject, "Delete a project with its videos and every version from Review", "Its videos and versions leave Review for good. Files in Dropbox stay."),

  // ---- production ----
  "production.overview": r("production", production.overview, "The Production page: each stage's live line and today's tiles"),
  "production.shoots": r("production", production.shoots, "Every shoot (Production › Shoots)"),
  "production.projectsForShoot": r("production", production.projectsForShoot, "Projects a new shoot can go under"),
  "shoots.forProject": r("production", shoots.forProject, "A project's shoots"),
  "shoots.page": r("production", shoots.page, "One shoot's details"),
  "shootPage.get": r("production", shootPage.get, "A shoot day's hub: overview, call sheet, shot list, gear, releases, places"),
  "shoots.schedule": ask("production", shoots.schedule, "Schedule a shoot", "The client's people are told and it goes on their portal; the calendar invite goes from Google."),
  "shoots.update": ask("production", shoots.update, "Change a shoot's details", "A new date, call time or place asks the client to confirm again; the calendar event updates."),
  "shoots.cancel": ask("production", shoots.cancel, "Cancel a shoot", "The client's people and the calendar are told."),
  "shoots.askClientConfirm": ask("production", shoots.askClientConfirm, "Ask the client to confirm a shoot", "The client's people are asked to confirm."),
  "callSheets.list": r("production", callSheets.list, "Every call sheet"),
  "callSheets.newOptions": r("production", callSheets.newOptions, "What a new call sheet can be made from"),
  "callSheets.get": r("production", callSheets.get, "One call sheet: its questions, people and state"),
  "callSheets.create": c("production", callSheets.create, "Start a call sheet for a shoot day"),
  "callSheets.saveAnswers": c("production", callSheets.saveAnswers, "Save a call sheet's answers"),
  "callSheets.make": c("production", callSheets.make, "Build the call sheet's page from its answers"),
  "callSheets.toggle": c("production", callSheets.toggle, "Turn a person on or off a call sheet's list", { askWhen: (a) => (a.on === true ? "Turning someone back on a call sheet can give them its page again." : null) }),
  "callSheets.addGuest": c("production", callSheets.addGuest, "Add a guest (talent) to a call sheet (nothing is sent until the sheet is)"),
  "callSheets.removeGuest": c("production", callSheets.removeGuest, "Take a guest off a call sheet"),
  "callSheets.endGuest": c("production", callSheets.endGuest, "End a guest's access to a call sheet"),
  "callSheets.restoreGuest": c("production", callSheets.restoreGuest, "Give a guest their access back"),
  "callSheets.refreshWeather": c("production", callSheets.refreshWeather, "Refresh a call sheet's forecast"),
  "callSheets.send": ask("production", callSheets.send, "Send a call sheet", "The people ticked get the call sheet.", {
    // Review M5: what goes out is the sheet as built now; its last change is shown, so an edit after the ask is caught.
    shows: async (ctx, a) => {
      const cs = await get(ctx, "callSheets", a.callSheetId);
      const b = cs?.buildId ? await get(ctx, "wsBuilds", cs.buildId) : null;
      return b ? [{ label: "The call sheet", value: `${String(b.title ?? "Call sheet")}, last changed ${new Date(Number(b.updatedAt ?? 0)).toISOString()} (open it to read it)` }] : [];
    },
  }),
  "callSheets.sendUpdate": ask("production", callSheets.sendUpdate, "Send a call sheet update", "Everyone it went to gets the update.", {
    // Review M5: what goes out is the sheet as built now; its last change is shown, so an edit after the ask is caught.
    shows: async (ctx, a) => {
      const cs = await get(ctx, "callSheets", a.callSheetId);
      const b = cs?.buildId ? await get(ctx, "wsBuilds", cs.buildId) : null;
      return b ? [{ label: "The call sheet", value: `${String(b.title ?? "Call sheet")}, last changed ${new Date(Number(b.updatedAt ?? 0)).toISOString()} (open it to read it)` }] : [];
    },
  }),
  "callSheets.remind": ask("production", callSheets.remind, "Remind people to open a call sheet", "Those who haven't opened it are reminded."),
  "callSheets.deleteDraft": del("production", callSheets.deleteDraft, "Delete a call sheet that hasn't been sent"),
  "shotLists.all": r("production", shotLists.all, "Every shot list"),
  "shotLists.newOptions": r("production", shotLists.newOptions, "What a new shot list can be attached to"),
  "shotLists.forProject": r("production", shotLists.forProject, "A project's shot lists"),
  "shotLists.get": r("production", shotLists.get, "One shot list with its setups and shots"),
  "shotLists.forShoot": r("production", shotLists.forShoot, "A shoot day's shot list"),
  "shotLists.create": c("production", shotLists.create, "Make a shot list"),
  "shotLists.update": c("production", shotLists.update, "Rename a shot list or link it to a shoot day"),
  "shotLists.addSetup": c("production", shotLists.addSetup, "Add a setup"),
  "shotLists.editSetup": c("production", shotLists.editSetup, "Edit a setup"),
  "shotLists.moveSetup": c("production", shotLists.moveSetup, "Move a setup"),
  "shotLists.addShots": c("production", shotLists.addShots, "Add shots (one per line)"),
  "shotLists.editShot": c("production", shotLists.editShot, "Edit a shot"),
  "shotLists.moveShot": c("production", shotLists.moveShot, "Move a shot"),
  "shotLists.tick": c("production", shotLists.tick, "Tick or untick a shot"),
  "shotLists.reset": del("production", shotLists.reset, "Clear every tick on a shot list"),
  "shotLists.removeSetup": del("production", shotLists.removeSetup, "Delete a setup and its shots"),
  "shotLists.removeShot": del("production", shotLists.removeShot, "Delete a shot"),
  "shotLists.remove": del("production", shotLists.remove, "Delete a shot list"),
  "releases.forShoot": r("production", releases.forShoot, "A shoot day's releases (who signed what)"),
  "releases.get": r("production", releases.get, "One release and its trail"),
  "releases.create": c("production", releases.create, "Prepare a release for someone to sign in person (it's signed on Heston's phone, never through Claude)"),
  "releases.markShot": c("production", releases.markShot, "Mark whether a shot needs a release"),
  "releases.remove": del("production", releases.remove, "Delete a release that hasn't been signed"),
  "gear.list": r("production", gear.list, "The gear inventory"),
  "gear.get": r("production", gear.get, "One gear item with its maintenance"),
  "gear.exportCsv": r("production", gear.exportCsv, "The insurance list as CSV"),
  "gear.forShoot": r("production", gear.forShoot, "A shoot's gear"),
  "gear.add": c("production", gear.add, "Add a gear item"),
  "gear.update": c("production", gear.update, "Edit a gear item"),
  "gear.setStatus": c("production", gear.setStatus, "Set a gear item in service, in repair or retired"),
  "gear.logMaintenance": c("production", gear.logMaintenance, "Log maintenance on a gear item"),
  "gear.addToShoot": c("production", gear.addToShoot, "Book a gear item to a shoot"),
  "gear.removeFromShoot": c("production", gear.removeFromShoot, "Take a gear item off a shoot"),
  "packing.lists": r("production", packing.lists, "Saved packing lists"),
  "packing.get": r("production", packing.get, "One packing list"),
  "packing.gearChoices": r("production", packing.gearChoices, "Gear that can go on a packing list"),
  "packing.forShoot": r("production", packing.forShoot, "A shoot's packing list"),
  "packing.create": c("production", packing.create, "Make a packing list"),
  "packing.rename": c("production", packing.rename, "Rename a packing list"),
  "packing.duplicate": c("production", packing.duplicate, "Duplicate a packing list"),
  "packing.addGear": c("production", packing.addGear, "Add gear to a packing list"),
  "packing.addLine": c("production", packing.addLine, "Add a line to a packing list"),
  "packing.editLine": c("production", packing.editLine, "Edit a packing line"),
  "packing.moveLine": c("production", packing.moveLine, "Move a packing line"),
  "packing.useOnShoot": c("production", packing.useOnShoot, "Use a packing list on a shoot (the shoot gets its own copy)"),
  "packing.tick": c("production", packing.tick, "Tick a packing line at load-in or wrap"),
  "packing.flag": c("production", packing.flag, "Mark an item lost or in repair at wrap"),
  "packing.removeLine": del("production", packing.removeLine, "Delete a packing line"),
  "packing.remove": del("production", packing.remove, "Delete a packing list"),
  "places.list": r("production", places.list, "Saved locations"),
  "places.get": r("production", places.get, "One location"),
  "places.forShoot": r("production", places.forShoot, "A shoot's locations"),
  "places.create": c("production", places.create, "Add a location"),
  "places.update": c("production", places.update, "Edit a location"),
  "places.coverPhoto": c("production", places.coverPhoto, "Pick a location's cover photo"),
  "places.useForShoot": c("production", places.useForShoot, "Use a location for a shoot"),
  "places.unlink": c("production", places.unlink, "Take a location off a shoot"),
  "places.removePhoto": del("production", places.removePhoto, "Delete a location's photo"),
  "places.remove": del("production", places.remove, "Delete a location"),

  // ---- crew (vendors, bookings, briefings) ----
  "vendors.list": { ...r("crew", vendors.list, "Saved vendors (crew)"), hide: ["address"] },
  "vendors.get": { ...r("crew", vendors.get, "One vendor: roles, rates, gear, bookings (whether a W-9 is on file; never the W-9, the 1099 address or how they're paid)"), hide: ["address"] },
  "vendors.add": c("crew", vendors.add, "Add a vendor (inviting them is an ask)", { askWhen: (a) => (a.invite === true ? "Inviting a vendor emails them." : null) }),
  "vendors.update": c("crew", vendors.update, "Edit a vendor's details"),
  "vendors.archive": c("crew", vendors.archive, "Archive or restore a vendor", { askWhen: (a) => (a.archived === false ? "Restoring a vendor gives them their portal back." : null) }),
  "vendors.invite": ask("crew", vendors.invite, "Invite a vendor to their portal", "The vendor gets an invite to their portal."),
  "bookings.form": r("crew", bookings.form, "What a new booking can use: vendors, roles, rates, projects"),
  "bookings.list": r("crew", bookings.list, "Every booking"),
  "bookings.forProject": r("crew", bookings.forProject, "A project's crew"),
  "bookings.forVendor": r("crew", bookings.forVendor, "A vendor's bookings"),
  "bookings.get": r("crew", bookings.get, "One booking"),
  "bookings.create": ask("crew", bookings.create, "Book a vendor", "The vendor is offered the booking."),
  "bookings.cancel": ask("crew", bookings.cancel, "Cancel a booking", "The vendor is told."),
  "briefings.templates": r("crew", briefings.templates, "Briefing templates"),
  "briefings.list": r("crew", briefings.list, "Every briefing"),
  "briefings.forVendor": r("crew", briefings.forVendor, "A vendor's briefings"),
  "briefings.get": r("crew", briefings.get, "One briefing: who it went to, opens, read"),
  "briefings.create": c("crew", briefings.create, "Start a briefing (its text is written on the site for now)"),
  "briefings.setDetails": c("crew", briefings.setDetails, "Set a briefing's project or details"),
  "briefings.copy": c("crew", briefings.copy, "Copy a briefing"),
  "briefings.setLinkOff": c("crew", briefings.setLinkOff, "Turn a briefing's links off or on (on is an ask)", { askWhen: (a) => (a.off === false ? "Turning the links back on lets everyone who has one read it again." : null) }),
  // Review M2: a later (or no) expiry can open links that had stopped working.
  "briefings.setLinkExpiry": ask("crew", briefings.setLinkExpiry, "Change when a briefing's links stop working", "A later date, or none, lets everyone who has a link read it again."),
  "briefings.deleteDraft": del("crew", briefings.deleteDraft, "Delete a briefing that hasn't been sent"),

  // ---- work (tasks) ----
  "work.mine": r("work", work.mine, "Heston's own tasks"),
  "work.all": r("work", work.all, "Every task"),
  "work.forProject": r("work", work.forProject, "A project's tasks"),
  "work.get": r("work", work.get, "One task with its subtasks"),
  "work.people": r("work", work.people, "Who a task can be given to"),
  "work.lists": r("work", work.lists, "To-do lists"),
  "work.templates": r("work", work.templates, "Task templates"),
  "work.create": c("work", work.create, "Make a task (one for the client or a vendor is an ask)", { askWhen: reaches }),
  "work.update": c("work", work.update, "Edit a task (one the client or a vendor sees is an ask)", { askWhen: reaches, outside: theirTask }),
  "work.done": c("work", work.done, "Mark a task done or not", { outside: theirTask }),
  "work.place": c("work", work.place, "Move a task on the board", { outside: theirTask }),
  "work.createList": c("work", work.createList, "Make a to-do list"),
  "work.saveList": c("work", work.saveList, "Save a to-do list"),
  "work.duplicateList": c("work", work.duplicateList, "Duplicate a to-do list"),
  "work.itemToTask": c("work", work.itemToTask, "Turn a to-do item into a task"),
  "work.saveTemplate": c("work", work.saveTemplate, "Save a task template"),
  "work.useTemplate": ask("work", work.useTemplate, "Make a project's tasks from a template", "A template's tasks for the client or a vendor show in their portal.", {
    shows: async (ctx, a) => {
      const t = await get(ctx, "taskTemplates", a.templateId);
      const items = Array.isArray(t?.items) ? (t!.items as Array<{ title?: string; audience?: string }>) : [];
      return [{ label: "Tasks", value: items.length ? items.map((x) => `${x.title ?? "A task"}${x.audience && x.audience !== "team" ? ` (for the ${x.audience})` : ""}`).join("\n").slice(0, 3000) : "None" }];
    },
  }),
  "work.remove": del("work", work.remove, "Delete a task"),
  "work.removeList": del("work", work.removeList, "Delete a to-do list"),
  "work.removeTemplate": del("work", work.removeTemplate, "Delete a task template"),

  // ---- creative planning ----
  "creative.overview": r("creative", creative.overview, "Creative planning overview: recent work and where it's attached"),
  "creative.docs": r("creative", creative.docs, "Creative docs (treatments, scripts, interview questions, briefs)"),
  "creative.doc": r("creative", creative.doc, "One creative doc (its text is read and written on the site for now)"),
  "creative.kits": r("creative", creative.kits, "Brand kits"),
  "creative.kit": r("creative", creative.kit, "One brand kit"),
  "creative.newDoc": c("creative", creative.newDoc, "Make a creative doc (its text is written on the site for now)"),
  "creative.startBriefing": c("creative", creative.startBriefing, "Start a briefing from a creative doc"),
  "creative.newKit": c("creative", creative.newKit, "Make a brand kit"),
  "creative.renameKit": c("creative", creative.renameKit, "Rename a brand kit"),
  "creative.shareOn": c("creative", creative.shareOn, "Turn a creative doc's view link off or on (on is an ask)", { askWhen: (a) => (a.on === true ? "Turning the link on lets anyone with it read the doc." : null) }),
  "creative.shareKit": c("creative", creative.shareKit, "Turn a brand kit's view link off or on (on is an ask)", { askWhen: (a) => (a.on === true ? "Turning the link on lets anyone with it see the kit." : null) }),
  "creative.removeDoc": del("creative", creative.removeDoc, "Delete a creative doc"),
  "creative.removeKit": del("creative", creative.removeKit, "Delete a brand kit"),
  "canvas.list": r("creative", canvas.list, "Canvases and mood boards"),
  "canvas.get": r("creative", canvas.get, "One canvas with everything on it"),
  "canvas.shareChoices": r("creative", canvas.shareChoices, "Who a canvas can be shared with"),
  "canvas.create": c("creative", canvas.create, "Make a canvas or mood board"),
  "canvas.save": c("creative", canvas.save, "Save a canvas's board (a shared board is an ask)", { outside: sharedBoard }),
  "canvas.rename": c("creative", canvas.rename, "Rename a canvas"),
  "canvas.duplicate": c("creative", canvas.duplicate, "Duplicate a canvas"),
  "canvas.setRole": c("creative", canvas.setRole, "Change what a person a canvas is shared with can do (letting them edit is an ask)", { askWhen: (a) => (a.role === "edit" ? "Letting someone outside the business edit the board." : null) }),
  "canvas.removePerson": c("creative", canvas.removePerson, "Stop sharing a canvas with a person"),
  "canvas.stopSharing": c("creative", canvas.stopSharing, "Stop sharing a canvas with everyone"),
  "canvas.addPerson": ask("creative", canvas.addPerson, "Share a canvas with a person", "They get their own link to the canvas (Heston copies it to them)."),
  "canvas.setLink": c("creative", canvas.setLink, "Turn a canvas's view link off or on (on is an ask)", { askWhen: (a) => (a.on === true ? "Turning the link on lets anyone with it see the canvas." : null) }),
  "canvas.remove": del("creative", canvas.remove, "Delete a canvas"),

  // ---- delivery ----
  "delivery.list": r("delivery", delivery.list, "Deliveries"),
  "delivery.get": r("delivery", delivery.get, "One delivery: folders, albums, files, links"),
  "delivery.ensure": c("delivery", delivery.ensure, "Start a project's delivery"),
  "delivery.addAlbum": c("delivery", delivery.addAlbum, "Add a video folder or photo album"),
  "delivery.editItem": c("delivery", delivery.editItem, "Edit a folder or album"),
  "delivery.addFiles": c("delivery", delivery.addFiles, "Add files to a folder or album (not published yet)"),
  "delivery.editAsset": c("delivery", delivery.editAsset, "Edit a delivered file's details"),
  "delivery.publish": ask("delivery", delivery.publish, "Publish a delivery's changes", "The project's people see the new delivery; with tell: true they're emailed too.", {
    shows: async (ctx, a) => {
      const d = await get(ctx, "deliveries", a.deliveryId);
      if (!d) return [];
      const items = (await ctx.db.query("deliveryItems").collect()).filter((x) => x.deliveryId === d._id);
      const assets = (await ctx.db.query("deliveryAssets").collect()).filter((x) => items.some((i) => i._id === x.itemId));
      return [{ label: "What's in it", value: items.map((i) => `${String(i.title ?? "A folder")} (${assets.filter((x) => x.itemId === i._id).length} files)`).join("\n").slice(0, 3000) || "Nothing yet" }];
    },
  }),
  "delivery.removeItem": del("delivery", delivery.removeItem, "Delete a folder or album from a delivery", "It leaves the delivery. Files in Dropbox stay."),
  "delivery.removeAsset": del("delivery", delivery.removeAsset, "Delete a file from a delivery", "It leaves the delivery. The file in Dropbox stays."),
};

export const AREAS: Record<Area, string> = {
  projects: "Projects: the list, a project's page, stage, next step, dates, rounds, final files",
  production: "Production: shoots, call sheets, shot lists, releases (prepared; signed in person), gear, packing lists, locations",
  crew: "Crew: vendors, bookings, briefings",
  work: "Work: tasks, to-do lists, templates",
  creative: "Creative planning: creative docs (their text on the site for now), canvases and mood boards, brand kits",
  delivery: "Delivery: folders, albums, files, publishing",
};

const argsJson = new Map<string, unknown>();
/** The function's argument validator, as Convex exports it. */
export function argsOf(name: string) {
  if (!argsJson.has(name)) argsJson.set(name, JSON.parse(ACTIONS[name].fn.exportArgs()));
  return argsJson.get(name) as Parameters<typeof import("./siteGuard").argsProblem>[0];
}
