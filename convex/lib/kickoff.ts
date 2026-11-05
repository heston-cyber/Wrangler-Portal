// Phase 4 (Nov 2) · the kickoff brief, option B (Heston): a short set of client-friendly questions the client answers
// before a project starts (frames 740:1671 a step, 740:2074 submitted; email 33 742:2668). Each business edits its own
// set in Settings › Kickoff brief, starting from this one. No file questions: files come through file requests.
import type { Question, QType, Questionnaire } from "./questionnaire";

const q = (id: string, label: string, type: QType, more: Partial<Question> = {}): Question => ({ id, label, type, ...more });
const SUB = "About 10 minutes. Save and come back any time.";

export const KICKOFF_BRIEF: Questionnaire = { steps: [
  { id: "project", title: "Project", heading: "Tell us about the project.", sub: SUB, questions: [
    q("goal", "What's the film for?", "long", { required: true }),
    q("audience", "Who should it speak to?", "short"),
    q("where", "Where will it run?", "multi", { options: ["Instagram", "TikTok", "YouTube", "Website", "In-store screens", "Ads", "TV"], other: true }),
    q("must", "Anything it must show?", "long"),
  ] },
  { id: "brand", title: "Brand", heading: "Tell us about your brand.", sub: SUB, questions: [
    q("feel", "How should it feel?", "multi", { bind: "brand.tone", help: "Pick a few, or add your own.", options: ["Warm", "Bold", "Calm", "Playful", "Premium", "Energetic", "Honest", "Funny"], other: true }),
    q("colors", "Brand colours", "colors", { help: "From your brand guide, if you have one." }),
    q("refs", "Films you like", "link", { multiple: true, help: "Links to videos with a look or feel you'd like." }),
    q("avoid", "Anything to stay away from?", "long"),
  ] },
  { id: "dates", title: "Dates", heading: "When does it need to happen?", sub: SUB, questions: [
    q("ready", "When does it need to be ready?", "date", { required: true, half: true }),
    q("launch", "A launch or event date?", "date", { half: true }),
    q("filming", "Days that work for filming", "long", { help: "Days and times, and anything to plan around: opening hours, busy times." }),
    q("contact", "Who's our contact on the day?", "short", { help: "Name and phone." }),
  ] },
] };
