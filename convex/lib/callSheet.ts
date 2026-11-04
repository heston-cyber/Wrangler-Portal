// Phase 5b step 3 (Nov 3) · call sheets (D126; S5 · Phase 5b 765:2852 … 769:7589). A call sheet is its own kind of
// builder document (wsBuilds / wsTemplates kind "callsheet"): made in the Docs builder, never signed, kept out of Docs'
// lists. Its four special blocks hold their data as attributes, so the page, the reader's view, the PDF preview and the
// "what changed" line of email 42 all read the same thing:
//   location   call times (crew, talent, wrap), the place, its address, parking and load-in, "add the weather"
//   schedule   rows of time · what happens · who · notes
//   crew       everyone on the shoot: name · role · their call · phone
//   contacts   who to call on the day: label · name · phone
//   weather    D148 (Nov 4): one line, "Sunny · 62°/48° · 10% rain · wind 8 mph", from the US National Weather Service's
//              forecast (lib/weather.ts), or typed over by the owner. The block holds only the owner's part ({ typed, line }:
//              what they typed); the forecast itself lives on the call sheet (callSheets.weather), so a refresh never
//              writes to a page someone has open. Sending bakes the line into the copy everyone reads (bakeWeather).
// Times are the business's wall clock, "HH:MM" (24-hour), shown as "7:30 AM". Shared with the pages (no server imports).
import { fill, line, missingFields, newId, nodesOf, section, textOf, type BuildDoc, type Fields, type Page, type PNode } from "./wsBuilder";

export type LocationAttrs = { crewCall: string; talentCall: string; wrap: string; name: string; address: string; parking: string; weather: boolean };
export type ScheduleRow = { id: string; time: string; what: string; who: string; notes: string };
export type CrewRow = { id: string; name: string; role: string; call: string; phone: string };
export type ContactRow = { id: string; label: string; name: string; phone: string };
/** `weather` on LocationAttrs is the old "Add the weather the day before" tick box: migrateWeather turns it into a block. */
export type WeatherAttrs = { typed: boolean; line: string };

export const CALL_ATOMS = ["location", "schedule", "crew", "contacts", "weather"] as const;
export type CallAtom = (typeof CALL_ATOMS)[number];
export const isCallAtom = (t: string): t is CallAtom => (CALL_ATOMS as readonly string[]).includes(t);

export const emptyLocation = (): LocationAttrs => ({ crewCall: "", talentCall: "", wrap: "", name: "", address: "", parking: "", weather: false });
export const CALL_DEFAULTS: Record<CallAtom, Record<string, unknown>> = {
  location: emptyLocation(),
  schedule: { rows: [] },
  crew: { rows: [] },
  contacts: { rows: [] },
  weather: { typed: false, line: "" },
};

const isTime = (s: unknown): s is string => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
/** "07:30" → "7:30 AM" (anything else is shown as written). */
export const clockOf = (hhmm: string) => {
  if (!isTime(hhmm)) return hhmm ?? "";
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
/** "Tue Nov 3" */
export const sheetDay = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).replace(",", "");
/** "Tuesday, Nov 3" (the emails). */
export const sheetDayLong = (ymd: string) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  return `${d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long" })}, ${d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" })}`;
};

export const locationOf = (n: PNode | undefined): LocationAttrs => ({ ...emptyLocation(), ...((n?.attrs ?? {}) as Partial<LocationAttrs>) });
export const rowsOf = <T>(n: PNode | undefined): T[] => ((n?.attrs?.rows as T[] | undefined) ?? []);
export const weatherOf = (n: PNode | undefined): WeatherAttrs => ({ typed: n?.attrs?.typed === true, line: typeof n?.attrs?.line === "string" ? (n.attrs.line as string) : "" });

// ---------- what a new sheet starts from ----------

export type Answers = {
  templateId?: string | null;          // a saved call-sheet template, or null for "Blank"
  crewCall: string; talentCall: string; wrap: string;
  locationName: string; address: string; parking: string; weather: boolean;
  schedule: Array<{ id: string; time: string; what: string; who: string }>;
  notes: string;
};
export function defaultAnswers(s: { call: string; wrap?: string | null; location: string; parking?: string | null }, templateId: string | null): Answers {
  return {
    templateId, crewCall: s.call, talentCall: "", wrap: s.wrap ?? "", locationName: s.location, address: "", parking: s.parking ?? "", weather: false,
    schedule: [{ id: newId(), time: s.call, what: "Crew call and load-in", who: "Crew" }], notes: "",
  };
}

/** The fill-in fields a call sheet carries: {shoot.title}, {shoot.date}, {shoot.client}, {shoot.project}. */
export function sheetFields(custom: Fields["custom"] | undefined, d: { title: string; date: string; client: string; project: string }): Pick<Fields, "project" | "custom"> {
  const own = [
    { key: "shoot.title", label: "Shoot", value: d.title }, { key: "shoot.date", label: "Date", value: sheetDay(d.date) },
    { key: "shoot.client", label: "Client", value: d.client }, { key: "shoot.project", label: "Project", value: d.project },
  ];
  const keys = new Set(own.map((c) => c.key));
  return { project: d.project, custom: [...own, ...(custom ?? []).filter((c) => !keys.has(c.key))] };
}

const head = (): PNode[] => [
  line("{business.name}", { size: "caption", color: "accent" }),
  line("Call sheet", { size: "title" }),
  line("{shoot.client} · {shoot.project} · {shoot.date}", { size: "caption" }),
];
const atomNode = (type: CallAtom, attrs: Record<string, unknown> = {}): PNode => ({ type, attrs: { ...CALL_DEFAULTS[type], ...attrs } });
const h = (t: string) => line(t, { size: "heading" });

/** The starter templates every business gets once (Templates 765:3564). */
export const STARTER_TEMPLATES: Array<{ name: string; description: string; page: () => Page }> = [
  { name: "Standard shoot day", description: "Call times, schedule, crew list, location and parking", page: () => ({ type: "doc", content: [
    ...head(), atomNode("location"),
    h("Day at a glance"), line("Please arrive at your call time and check in with the producer."),
    section([line("Parking and load-in", { size: "strong" }), line("Where to park, and how gear comes in.")], { look: "card" }),
    h("Schedule"), atomNode("schedule"), h("Crew and talent"), atomNode("crew"), h("Contacts"), atomNode("contacts"),
  ] }) },
  { name: "Interview day", description: "One location, a list of people to film, a slot for each", page: () => ({ type: "doc", content: [
    ...head(), atomNode("location"),
    h("Interviews"), line("Each person's slot. Please be ready ten minutes before yours."), atomNode("schedule"),
    h("Crew and talent"), atomNode("crew"), h("Contacts"), atomNode("contacts"),
  ] }) },
  { name: "Event coverage", description: "Arrival, key moments, shot list and contacts", page: () => ({ type: "doc", content: [
    ...head(), atomNode("location"),
    h("Arrival"), line("Where to check in, and what to wear."),
    h("Key moments"), atomNode("schedule"),
    h("Shot list"), { type: "bulletList", content: [{ type: "listItem", content: [line("")] }] },
    h("Crew"), atomNode("crew"), h("Contacts"), atomNode("contacts"),
  ] }) },
  { name: "Multi-location day", description: "Several stops with travel times between them", page: () => ({ type: "doc", content: [
    ...head(), atomNode("location"),
    h("Stops"), line("Each stop, with the travel time to the next."), atomNode("schedule"),
    h("Crew and talent"), atomNode("crew"), h("Contacts"), atomNode("contacts"),
  ] }) },
];

/** The block library (765:2056's "Block library"): ready-made cards for a call sheet. */
export const CALL_BLOCKS: Array<{ title: string; text: string }> = [
  { title: "Parking and load-in", text: "Park behind the building. Load-in is through the side door." },
  { title: "Safety and set rules", text: "Closed-toe shoes on set. Phones on silent once we roll. Ask before moving any gear." },
  { title: "Meals and water", text: "Lunch is provided. Bring a water bottle; there's a refill station on set." },
  { title: "Wardrobe", text: "Solid colours, no small patterns or logos. Bring a second option." },
  { title: "Weather plan", text: "If it rains, we move inside and keep the same call times." },
];
export const blockCard = (b: { title: string; text: string }): PNode => section([line(b.title, { size: "strong" }), line(b.text)], { look: "card" });

/** A sheet's page from a starting page and what's known: each call-sheet block takes its data; blocks the starting page
 *  doesn't have are added at the end (so an empty page still gets the essentials), then "Notes for everyone". */
/** D148: `weather` is the questions' "Fill in the weather from the forecast": true gives the sheet one Weather block
 *  (right after the location block), false takes any out; left out (a template or a blank page), the page keeps what it has. */
export function fillSheet(base: Page | null, d: { location: LocationAttrs; schedule: ScheduleRow[]; crew: CrewRow[]; contacts: ContactRow[]; notes?: string; weather?: boolean }): Page {
  const start: Page = base && base.content?.length ? migrateWeather(base).page : { type: "doc", content: head() };
  const data: Record<CallAtom, Record<string, unknown>> = { location: { ...d.location, weather: false }, schedule: { rows: d.schedule }, crew: { rows: d.crew }, contacts: { rows: d.contacts }, weather: {} };
  const seen = new Set<string>();
  const fix = (n: PNode): PNode => {
    if (isCallAtom(n.type)) { seen.add(n.type); return { type: n.type, attrs: { ...CALL_DEFAULTS[n.type], ...data[n.type] } }; }
    return n.content ? { ...n, content: n.content.map(fix) } : n;
  };
  const drop = (ns: PNode[]): PNode[] => ns.filter((n) => n.type !== "weather").map((n) => (n.content ? { ...n, content: drop(n.content) } : n));
  let content = (start.content ?? []).map(fix);
  if (d.weather === false) { content = drop(content); seen.delete("weather"); }
  const titles: Record<CallAtom, string> = { location: "", schedule: "Schedule", crew: "Crew and talent", contacts: "Contacts", weather: "" };
  for (const t of CALL_ATOMS) if (!seen.has(t) && t !== "weather") content.push(...(titles[t] ? [h(titles[t])] : []), atomNode(t, data[t]));
  let out: Page = { type: "doc", content };
  if (d.weather === true && !seen.has("weather")) out = withWeatherBlock(out);
  if (d.notes?.trim()) out.content.push(h("Notes"), line(d.notes.trim()));
  return out;
}

// ---------- the Weather block (D148) ----------

/** A Weather block right after the first location block (at the top level when there isn't one, after the heading lines). */
function withWeatherBlock(page: Page): Page {
  const block = atomNode("weather");
  let done = false;
  const put = (ns: PNode[]): PNode[] => {
    const out: PNode[] = [];
    for (const n of ns) {
      const m = n.content && !done ? { ...n, content: put(n.content) } : n;
      out.push(m);
      if (!done && n.type === "location") { out.push(block); done = true; }
    }
    return out;
  };
  const content = put(page.content ?? []);
  if (!done) { const at = content.findIndex((n) => n.type !== "paragraph"); content.splice(at < 0 ? content.length : at, 0, block); }
  return { type: "doc", content };
}

/** The old tick box ("Add the weather the day before", location.weather = true) becomes a Weather block, once: the tick
 *  is cleared, and a block is added only when the page has none. Safe to run again (nothing left to change). */
export function migrateWeather(page: Page): { page: Page; changed: boolean } {
  let ticked = false;
  const clear = (n: PNode): PNode => {
    if (n.type === "location" && n.attrs?.weather === true) { ticked = true; return { ...n, attrs: { ...n.attrs, weather: false } }; }
    return n.content ? { ...n, content: n.content.map(clear) } : n;
  };
  const cleared = clear(page as PNode) as Page;
  if (!ticked) return { page, changed: false };
  return { page: nodesOf(cleared, "weather").length ? cleared : withWeatherBlock(cleared), changed: true };
}

/** What the forecast is looked up for: the location block's address, else its place name, else the shoot's location. */
export function weatherAddress(page: Page, fallback: string): { address: string; place: string } {
  const loc = locationOf(nodesOf(page, "location")[0]);
  const address = (loc.address.trim() || loc.name.trim() || fallback.trim()).replace(/\s+/g, " ").slice(0, 300);
  return { address, place: loc.name.trim() || address };
}

/** The forecast as the call sheet keeps it (callSheets.weather): for one address and one shoot day. */
export type SheetWeather = { address: string; date: string; state: "forecast" | "early" | "none"; line: string; at: number; dayBefore?: boolean };
export type WeatherState = "forecast" | "typed" | "early" | "none";
export type WeatherView = { state: WeatherState; line: string; forecast: string; at: number | null; place: string; date: string; fillsOn: string; due: boolean };

/** Days from `a` to `b` (YYYY-MM-DD). */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
export const addDay = (ymd: string, n: number) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** The forecast reaches about a week ahead: it fills from 7 days before the shoot. */
export const WEATHER_DAYS = 7;

/** What a Weather block shows (the four states, 865:11728). A typed line wins; else the forecast kept for this address
 *  and day; else "too early" (more than a week away, or not looked up yet) or "no forecast". */
export function weatherView(block: WeatherAttrs, w: SheetWeather | null | undefined, at: { date: string; address: string; place: string; today: string }): WeatherView {
  const fresh = !!w && w.date === at.date && w.address === at.address;
  const forecast = fresh && w!.state === "forecast" ? w!.line : "";
  const base = { forecast, at: fresh ? w!.at : null, place: at.place, date: at.date, fillsOn: addDay(at.date, -WEATHER_DAYS), due: daysBetween(at.today, at.date) <= WEATHER_DAYS };
  const own: WeatherView = forecast ? { ...base, state: "forecast", line: forecast } : fresh && w!.state === "none" && base.due ? { ...base, state: "none", line: "" } : { ...base, state: "early", line: "" };
  return shownWeather(block, own);
}
/** A block's own line over the forecast's view (the editor: the block as it is now, unsaved edits included). */
export const shownWeather = (block: WeatherAttrs, w: WeatherView): WeatherView => (block.typed ? { ...w, state: "typed", line: block.line } : w);

/** The page with each Weather block's line as shown (`line`) and marked typed or not: what readers get when it's sent. */
export function bakeWeather(page: Page, view: { line: string; state: WeatherState } | null): Page {
  if (!view || !nodesOf(page, "weather").length) return page;
  const fix = (n: PNode): PNode => n.type === "weather" ? { type: "weather", attrs: { typed: view.state === "typed", line: view.line } } : n.content ? { ...n, content: n.content.map(fix) } : n;
  return fix(page as PNode) as Page;
}
/** The line a page shows (the first Weather block's), or null when it has none. */
export const weatherLine = (page: Page): string | null => { const n = nodesOf(page, "weather")[0]; return n ? weatherOf(n).line : null; };

/** What stops "Send call sheet". */
export function callSheetProblems(d: BuildDoc): string[] {
  const out: string[] = [];
  if (!d.title.trim()) out.push("Give the call sheet a title (Details).");
  if (!textOf(d.page as PNode).trim() && !(d.page.content ?? []).some((n) => isCallAtom(n.type))) out.push("Add some content.");
  if (nodesOf(d.page, "signatures").length || nodesOf(d.page, "parties").length) out.push("Call sheets aren't signed: remove the signature block.");
  const miss = missingFields(d.page, d.fields);
  if (miss.length) out.push(`Fill in: ${miss.map((m) => `{${m}}`).join(", ")}.`);
  return out;
}

/** One person's call: their row in the crew list (by name), else the crew call (talent call for guests). */
export function callFor(page: Page, who: { name: string; kind: "crew" | "client" | "guest" }): string {
  const name = who.name.trim().toLowerCase();
  const row = nodesOf(page, "crew").flatMap((n) => rowsOf<CrewRow>(n)).find((r) => r.name.trim().toLowerCase() === name && r.call);
  if (row) return row.call;
  const loc = locationOf(nodesOf(page, "location")[0]);
  return (who.kind === "guest" ? loc.talentCall || loc.crewCall : loc.crewCall || loc.talentCall) || "";
}

/** The first things that changed between two versions of a sheet, as short lines ("Talent call moved to 9:00 AM"). */
export function whatChanged(before: Page, after: Page, values: Record<string, string> = {}): string[] {
  const out: string[] = [];
  const a = locationOf(nodesOf(before, "location")[0]), b = locationOf(nodesOf(after, "location")[0]);
  const moved = (label: string, x: string, y: string) => { if (x !== y) out.push(y ? `${label} moved to ${clockOf(y)}` : `${label} removed`); };
  moved("Crew call", a.crewCall, b.crewCall);
  moved("Talent call", a.talentCall, b.talentCall);
  moved("Wrap", a.wrap, b.wrap);
  if (a.name !== b.name || a.address !== b.address) out.push(`Location is now ${[b.name, b.address].filter(Boolean).join(", ") || "to be confirmed"}`);
  if (a.parking !== b.parking) out.push("Parking changed");
  const sched = (p: Page) => JSON.stringify(nodesOf(p, "schedule").flatMap((n) => rowsOf<ScheduleRow>(n)).map((r) => [r.time, r.what, r.who, r.notes]));
  if (sched(before) !== sched(after)) out.push("The schedule changed");
  const crew = (p: Page) => JSON.stringify(nodesOf(p, "crew").flatMap((n) => rowsOf<CrewRow>(n)).map((r) => [r.name, r.role, r.call]));
  if (crew(before) !== crew(after)) out.push("The crew list changed");
  const contacts = (p: Page) => JSON.stringify(nodesOf(p, "contacts").flatMap((n) => rowsOf<ContactRow>(n)).map((r) => [r.label, r.name, r.phone]));
  if (contacts(before) !== contacts(after)) out.push("Contacts changed");
  const wa = weatherLine(before), wb = weatherLine(after);
  if ((wa ?? "") !== (wb ?? "")) out.push(wb ? `Weather: ${wb}` : "The weather was taken off");
  const text = (p: Page) => fill(textOf(p as PNode), values, "");
  if (!out.length && text(before) !== text(after)) out.push("The details changed");
  return out;
}

/** A template keeps the layout, not the people: the crew and contacts lists and the place are emptied. */
export function withoutPeople(page: Page): Page {
  const fix = (n: PNode): PNode => isCallAtom(n.type) && n.type !== "schedule" ? { type: n.type, attrs: { ...CALL_DEFAULTS[n.type] } } : n.content ? { ...n, content: n.content.map(fix) } : n;
  return fix(page as PNode) as Page;
}

/** Same page? (The Detail page's "You changed the sheet after sending it".) */
// D148: key order doesn't count (a stored copy comes back with its keys sorted; a page baked just now may not).
const canon = (x: unknown): unknown => Array.isArray(x) ? x.map(canon) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, canon((x as Record<string, unknown>)[k])])) : x;
export const samePage = (a: unknown, b: unknown) => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));
