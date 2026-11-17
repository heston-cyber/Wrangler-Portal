// 5l (D187–D188): the starting pages for creative docs (New creative doc › Templates). Plain builder pages, never
// signed: a treatment, a two-column script (Time · Picture · Sound rows), interview questions, a creative brief, or blank.
import { line, newId, type PNode } from "./wsBuilder";

export type CreativeKind = "treatment" | "script" | "interview" | "brief" | "blank";
export const CREATIVE_KINDS: CreativeKind[] = ["treatment", "script", "interview", "brief", "blank"];
export const CREATIVE_NAME: Record<CreativeKind, string> = { treatment: "Treatment", script: "Two-column script", interview: "Interview questions", brief: "Creative brief", blank: "Blank" };
const h = (t: string) => line(t, { size: "heading" });
const p = (t = "") => line(t);
const row = (time = "", picture = "", sound = "") => ({ id: newId(), time, picture, sound });

export function creativePage(k: CreativeKind, title: string): { type: "doc"; content: PNode[] } {
  const top = line(title, { size: "title" });
  const content: PNode[] = {
    treatment: [top, h("Logline"), p("One or two sentences: what this film is and why it matters."), h("The story"), p(), h("Look and feel"), p("Light, colour, camera movement, references."), h("Music and sound"), p(), h("References"), p()],
    script: [top, p("{project} · {date}"), { type: "script", attrs: { rows: [row("0:00", "", ""), row("0:05", "", ""), row("0:10", "", "")] } }],
    interview: [top, p("Who: "), h("Warm-up"), p("Tell me your name and what you do."), h("The story"), p("1. "), p("2. "), p("3. "), h("Wrap-up"), p("Is there anything we didn't ask that you'd like to say?")],
    brief: [top, h("Objective"), p(), h("Audience"), p(), h("Key message"), p(), h("Deliverables"), p(), h("Tone"), p(), h("Must include"), p()],
    blank: [top, p()],
  }[k];
  return { type: "doc", content };
}

/** The page without its team notes (D191: "Notes for the team stay hidden on the shared page"); for a share or a briefing. */
export function dropNotes<T extends { type: string; content?: PNode[] }>(page: T): T {
  const walk = (ns: PNode[]): PNode[] => ns.filter((n) => !(n.type === "section" && (n.attrs as { look?: string } | undefined)?.look === "note")).map((n) => (n.content ? { ...n, content: walk(n.content) } : n));
  return { ...page, content: walk(page.content ?? []) };
}
