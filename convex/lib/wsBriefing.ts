// Phase 3c step 3 · briefings (D97): the Shoot brief and Edit brief a briefing starts from (S5 · Phase 3c 731:3904 and
// the Briefings page's templates, 730:4522), and what must be right before one is sent. A briefing is its own kind of
// builder document: no signature boxes, never signed, kept apart from contracts and proposals.
import { line, nodesOf, textOf, missingFields, type BuildDoc, type Fields, type Page, type PNode } from "./wsBuilder";

export type Starter = "shoot" | "edit";
export const STARTERS: Record<Starter, { name: string; sections: Array<[string, string]> }> = {
  shoot: { name: "Shoot brief", sections: [
    ["Call sheet", "Call time and place, parking, and when you wrap."],
    ["Schedule", "The day, hour by hour."],
    ["Shot list", "What to get, and anything to avoid."],
    ["Gear", "What they bring and what you bring."],
    ["Contacts", "Who's on set and how to reach them."],
    ["Deliverables", "How and when to hand over the footage, and how to label it."],
    ["Notes", "Anything else: brand colours, references, releases."],
  ] },
  edit: { name: "Edit brief", sections: [
    ["Story", "What the film is about and who it's for."],
    ["Cuts and lengths", "Each cut, its length and its aspect ratio."],
    ["Music", "Licensed tracks, or where to find them."],
    ["References", "Links to films it should feel like."],
    ["Files", "Where the footage, project files and assets are."],
    ["Deadlines", "First cut, revisions and final delivery."],
  ] },
};
/** "Shoot brief" for shooters, drone pilots and sound; "Edit brief" for editors and colourists. */
export const starterFor = (role: string): Starter => (/edit|colou?r|motion|graphic|post/i.test(role) ? "edit" : "shoot");
export const starterSummary = (s: Starter) => STARTERS[s].sections.map(([h]) => h.toLowerCase()).join(" · ").replace(/^./, (c) => c.toUpperCase());

/** A new briefing's page: the title, who it's for (filled from the booking), then each section with a line saying what
 *  goes there. {vendor} and {dates} are the briefing's own fill-in fields, set from the booking it's sent to. */
export function briefingStarterPage(s: Starter, withProject = true): Page {
  // D147: a briefing with no project has no {project} in its title (the project is optional).
  const content: PNode[] = [line(withProject ? `${STARTERS[s].name} · {project}` : STARTERS[s].name, { size: "title" }), line("For {vendor} · {dates}", { size: "subtitle" })];
  for (const [h, say] of STARTERS[s].sections) { content.push(line(h, { size: "heading" })); content.push(line(say)); }
  return { type: "doc", content };
}

/** The fill-in fields a briefing carries: the project, and who it's for ({vendor}, {dates}), before any others. */
export function briefingFields(custom: Fields["custom"] | undefined, d: { project: string; vendor: string; dates: string }): Pick<Fields, "project" | "custom"> {
  const rest = (custom ?? []).filter((c) => c.key !== "vendor" && c.key !== "dates");
  return { project: d.project, custom: [{ key: "vendor", label: "Vendor", value: d.vendor }, { key: "dates", label: "Dates", value: d.dates }, ...rest] };
}

/** The section headings, for the email ("Call sheet, schedule, shot list and gear are in the brief."). */
export function briefingHeadings(page: Page): string[] {
  return (page.content ?? []).filter((n) => n.type === "paragraph" && n.attrs?.size === "heading").map((n) => textOf(n).trim()).filter(Boolean);
}

export function briefingProblems(d: BuildDoc): string[] {
  const out: string[] = [];
  if (!d.title.trim()) out.push("Give the briefing a title (Details).");
  if (!textOf(d.page as PNode).trim()) out.push("Add some content.");
  if (nodesOf(d.page, "signatures").length || nodesOf(d.page, "parties").length) out.push("Briefings aren't signed: remove the signature block. The vendor presses “I’ve read it” instead.");
  const miss = missingFields(d.page, d.fields);
  if (miss.length) out.push(`Fill in: ${miss.map((m) => `{${m}}`).join(", ")}.`);
  return out;
}
