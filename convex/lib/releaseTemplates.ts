// 5i (D193): the starter release templates (Contracts › Templates, chipped Release). Plain-language starting points the
// business edits in the builder like any contract template; Wrangler's wording should be checked by its lawyer before
// it's relied on (the design left the text as grey lines for this reason). {placeholders} are the builder's fields:
// {client.name} is whoever signs (the guardian, for a minor), {minor.name} and {location} are filled per release.
import { line, type PNode } from "./wsBuilder";

export type ReleaseKind = "talent" | "location" | "minor";
const sig = (): PNode => ({ type: "signatures", attrs: { signers: ["client"], showTitle: false, showDate: true } });
const h = (t: string) => line(t, { size: "heading" });
const p = (t: string) => line(t);

const PAGES: Record<ReleaseKind, { name: string; description: string; blocks: PNode[] }> = {
  talent: {
    name: "Talent release", description: "Release · Someone on camera, 18 or older",
    blocks: [
      line("Talent release", { size: "title" }),
      p("This release is between {client.name} (\"you\") and {business.legal} (\"we\"), for {project}, filmed on {date} at {location}."),
      h("What you agree to"),
      p("You let us film and photograph you and record your voice, and use your name, likeness, voice and appearance (the \"recordings\") in the project, and in anything that promotes the project or us, in any media, worldwide, without a time limit."),
      p("We, and the client we made the project for, own the recordings. We may edit them, and we don't have to use them."),
      p("Nothing is paid for this beyond what was agreed in writing. You give up any claim about using the recordings as this release allows, including claims about privacy or publicity."),
      p("You confirm you are 18 or older and have read this release before signing it."),
      h("Signature"), sig(),
    ],
  },
  location: {
    name: "Location release", description: "Release · A place we film",
    blocks: [
      line("Location release", { size: "title" }),
      p("This release is between {client.name} (\"you\") and {business.legal} (\"we\"), for filming {project} at {location} on {date}."),
      h("What you agree to"),
      p("You let us come onto the property with our crew and equipment to film and photograph it, and use what we record (including the property's look, and its name and address if they show) in the project and in anything that promotes the project or us, in any media, worldwide, without a time limit."),
      p("We will leave the property as we found it and repair, or pay to repair, any damage we cause."),
      p("You confirm you own the property or have the right to grant this, and that nothing is paid for it beyond what was agreed in writing."),
      h("Signature"), sig(),
    ],
  },
  minor: {
    name: "Minor release", description: "Release · Someone on camera under 18, signed by a parent or guardian",
    blocks: [
      line("Minor release", { size: "title" }),
      p("This release is between {client.name}, parent or legal guardian of {minor.name} (\"the minor\"), and {business.legal} (\"we\"), for {project}, filmed on {date} at {location}."),
      h("What you agree to"),
      p("On the minor's behalf you let us film and photograph the minor and record their voice, and use their name, likeness, voice and appearance in the project, and in anything that promotes the project or us, in any media, worldwide, without a time limit."),
      p("We, and the client we made the project for, own the recordings. We may edit them, and we don't have to use them. Nothing is paid for this beyond what was agreed in writing."),
      p("You confirm you are the minor's parent or legal guardian, have the right to sign for them, and have read this release before signing it."),
      h("Signature of parent or guardian"), sig(),
    ],
  },
};

export const releaseTemplate = (k: ReleaseKind) => ({ ...PAGES[k], page: { type: "doc" as const, content: PAGES[k].blocks } });
export const RELEASE_KINDS: ReleaseKind[] = ["talent", "location", "minor"];
export const kindOfTemplate = (name: string): ReleaseKind => (/minor/i.test(name) ? "minor" : /location/i.test(name) ? "location" : "talent");
