// D177 (Heston Nov 15, "go with your suggestions", approved 13:31): Clients can be selected several at a time; the bar
// offers "Add follow-up", which asks once for a date (and an optional "about") and adds one follow-up per client.
// A client page is only for the owner, so no Share and no Copy link. No new server function (crm.addFollowUp is the
// one the Follow-ups page already uses, owner only, in the access matrix).
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { anyApi } from "convex/server";
import { clientMenu } from "../src/modules/clients/ClientsPage";
import { commonActions, runMany } from "../src/ui/hold";
import { world } from "./payHarness";

const hold = readFileSync("src/ui/hold.tsx", "utf8");
const page = readFileSync("src/modules/clients/ClientsPage.tsx", "utf8");
const access = readFileSync("tests/access.test.ts", "utf8");
const api = anyApi;
beforeAll(() => { process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com"; process.env.SITE_URL = "https://app.wranglerportal.com"; });

type Call = { who: string; about: string; due: string; clientId: string };
const clients = [{ _id: "c1", name: "4M LC" }, { _id: "c2", name: "Floor Trader" }, { _id: "c3", name: "Harbor Coffee" }];

describe("D177 the Clients select bar", () => {
  it("177.1 the bar offers only Add follow-up (plus the count, Select all and Done); no Share or Copy link for a client", () => {
    const specs = clients.map((c) => clientMenu(c, () => null));
    expect(commonActions(specs).map((a) => a.bulk)).toEqual(["Add follow-up"]);
    expect(specs.every((s) => s.noShare)).toBe(true);
    expect(hold).toMatch(/const links = picked\.filter\(\(s\) => s\.href && !s\.noShare\)/);
    expect(hold).toMatch(/if \(href && !spec\.noShare\) entries\.push\(<Entry key="share"/);
    expect(hold).toMatch(/if \(href && !spec\.noShare\) entries\.push\(<Entry key="copy"/);
    const f = specs[0].actions![0].form!;
    expect(f.fields).toEqual([expect.objectContaining({ key: "about", optional: true }), expect.objectContaining({ key: "due", type: "date" })]);
    expect(f.fields[1].optional).toBeFalsy(); // the date must be picked; it starts empty
    expect([f.title(3), f.yes(3), f.yes(1)]).toEqual(["Add a follow-up for 3 clients", "Add 3 follow-ups", "Add follow-up"]);
  });

  it("177.2 three clients and one date make three follow-ups, each named and linked to its client; a blank 'about' is 'Follow up'", async () => {
    const calls: Call[] = [];
    const specs = clients.map((c) => clientMenu(c, (a) => { calls.push(a); }));
    const r = await runMany(specs, specs[0].actions![0], { due: "2026-11-30", about: "  " });
    expect(r).toMatchObject({ ok: 3, failed: [], text: "Added 3 follow-ups." });
    expect(calls).toEqual(clients.map((c) => ({ who: c.name, about: "Follow up", due: "2026-11-30", clientId: c._id })));
  });

  it("177.3 one that fails is reported by name; the others still go through", async () => {
    const calls: Call[] = [];
    const specs = clients.map((c) => clientMenu(c, (a) => { if (c._id === "c2") throw new Error("[CONVEX M] ConvexError: That company isn't here."); calls.push(a); }));
    const r = await runMany(specs, specs[0].actions![0], { due: "2026-11-30" });
    expect(r.ok).toBe(2);
    expect(calls.map((c) => c.clientId)).toEqual(["c1", "c3"]);
    expect(r.text).toBe("Added 2 follow-ups. Not done: 1 (Floor Trader: That company isn't here.)");
  });

  it("177.4 a missing or bad date is refused by the server, and the dialog can't be sent without one", async () => {
    const w = await world();
    await expect(w.heston.mutation(api.crm.addFollowUp, { who: "4M LC", about: "Follow up", due: "" })).rejects.toThrow(/Pick a due date/);
    await expect(w.heston.mutation(api.crm.addFollowUp, { who: "4M LC", about: "Follow up", due: "11/30/2026" })).rejects.toThrow(/Pick a due date/);
    expect(hold).toMatch(/const ready = form\.fields\.every\(\(f\) => f\.optional \|\| \(v\[f\.key\] \?\? ""\)\.trim\(\)\)/);
    expect(hold).toMatch(/disabled=\{!ready\}/);
    expect(access).toMatch(/"crm\.addFollowUp": /); // already classified (owner only); nothing new for the privacy tests
  });

  it("177.5 the Clients list can be selected: wrapped in a SelectList, each row with its options (hold on a phone, right-click on a computer)", () => {
    expect(page).toMatch(/<SelectList name="clients">/);
    expect(page).toMatch(/menu=\{clientMenu\(c, add\)\}/);
  });

  it("177.6 a row's options stay registered while selecting (the cleanup only runs when the row goes away); other lists keep working", () => {
    expect(hold).toMatch(/const register = useCallback\(\(spec: ItemSpec\) => \{ specs\.current\.set\(spec\.id, spec\); \}, \[\]\);/);
    expect(hold).toMatch(/const unregister = useCallback\(\(id: string\) => \{ specs\.current\.delete\(id\); \}, \[\]\);/);
    // the bar's message lives in the list, so it stays after the bar closes on success
    expect(hold).toMatch(/\{note && <Toastish text=\{note\} onGone=\{\(\) => setNote\(null\)\} \/>\}\n    <\/ListContext\.Provider>/);
  });
});
