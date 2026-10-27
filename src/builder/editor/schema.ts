// The page editor's pieces (E1–E3, Oct 27): every line is a paragraph with a text style (Ctrl+1–6 sets it); sections
// are containers of lines (a clause, or a card); the special blocks are atoms drawn by React (nodes.tsx). Fill-in
// fields like {client.name} are highlighted as you type.
import { Extension, Node, mergeAttributes } from "@tiptap/core";
import Paragraph from "@tiptap/extension-paragraph";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { ATOMS, TEXT_SIZES, type AtomType, type TextSize } from "../../../convex/lib/wsBuilder";
import { AtomView, SectionView } from "./nodes";
import { blockSelectionPlugin } from "./blockSelection";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    wsLine: { setLineSize: (size: TextSize) => ReturnType };
  }
}

const attr = (name: string, def: unknown, toHTML: (v: unknown) => Record<string, string> | null) => ({
  [name]: {
    default: def,
    parseHTML: (el: HTMLElement) => { const v = el.getAttribute(`data-${name}`); return v === null ? def : v; },
    renderHTML: (a: Record<string, unknown>) => (a[name] == null || a[name] === def ? {} : toHTML(a[name]) ?? {}),
  },
});
const colourCss = (c: unknown) => (c === "accent" ? "var(--wsb-accent)" : String(c));

/** A line: a paragraph with a text style and its own alignment, colour, decoration and font. */
export const Line = Paragraph.extend({
  addAttributes() {
    return {
      size: { default: "body", parseHTML: (el: HTMLElement) => el.getAttribute("data-size") ?? "body", renderHTML: (a: Record<string, unknown>) => ({ "data-size": String(a.size ?? "body") }) },
      ...attr("align", null, (v) => ({ "data-align": String(v), style: `text-align:${String(v)}` })),
      ...attr("color", null, (v) => ({ "data-color": String(v), style: `color:${colourCss(v)}` })),
      ...attr("deco", null, (v) => ({ "data-deco": String(v) })),
      ...attr("font", null, (v) => ({ "data-font": String(v) })),
    };
  },
  addCommands() {
    return {
      setLineSize: (size: TextSize) => ({ commands }) => commands.updateAttributes("paragraph", { size }),
    };
  },
  addKeyboardShortcuts() {
    // Ctrl+1 … Ctrl+6: Title, Subtitle, Heading, Strong, Body, Caption (Heston, Oct 27). ⌘1–6 stays Chrome's tabs.
    const keys: Record<string, () => boolean> = {};
    TEXT_SIZES.forEach((z, i) => { keys[`Ctrl-${i + 1}`] = () => this.editor.commands.setLineSize(z.key); });
    return keys;
  },
});

/** A container of lines: a clause (optionally initialled by the client), or a card. */
const SectionBase = Node.create({
  name: "section",
  group: "block",
  content: "(paragraph|bulletList|orderedList|wsAtom)+",
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      look: { default: "plain", parseHTML: (el) => el.getAttribute("data-look") ?? "plain", renderHTML: (a) => ({ "data-look": a.look }) },
      initials: { default: false, parseHTML: (el) => el.getAttribute("data-initials") === "true", renderHTML: (a) => ({ "data-initials": String(!!a.initials) }) },
      clauseId: { default: null, parseHTML: (el) => el.getAttribute("data-clause"), renderHTML: (a) => (a.clauseId ? { "data-clause": a.clauseId } : {}) },
    };
  },
  parseHTML() { return [{ tag: "section[data-ws-section]" }]; },
  renderHTML({ HTMLAttributes }) { return ["section", mergeAttributes(HTMLAttributes, { "data-ws-section": "" }), 0]; },
  addKeyboardShortcuts() {
    return {
      // Enter on an empty last line of a container steps out of it (like ending a list).
      Enter: () => {
        const { state } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty || $from.parent.type.name !== "paragraph" || $from.parent.content.size) return false;
        const d = $from.depth - 1;
        if (d < 1 || $from.node(d).type.name !== "section") return false;
        const sec = $from.node(d);
        if ($from.index(d) !== sec.childCount - 1 || sec.childCount < 2) return false;
        const after = $from.after(d);
        return this.editor.chain().command(({ tr }) => {
          tr.delete($from.before(), $from.after());
          const at = tr.mapping.map(after);
          tr.insert(at, state.schema.nodes.paragraph.create({ size: "body" }));
          tr.setSelection(TextSelection.create(tr.doc, at + 1));
          return true;
        }).run();
      },
    };
  },
});

export const Section = SectionBase.extend({ addNodeView() { return ReactNodeViewRenderer(SectionView); } });

/** The special blocks: atoms with settings, drawn by React (plain HTML in tests, views = false). */
function atomNode(name: AtomType, attrs: Record<string, unknown>, views = true) {
  return Node.create({
    name,
    group: "block wsAtom",
    atom: true,
    selectable: true,
    draggable: false, // moved with the block handle
    addAttributes() {
      const out: Record<string, { default: unknown; parseHTML: (el: HTMLElement) => unknown; renderHTML: (a: Record<string, unknown>) => Record<string, string> }> = {};
      for (const [k, def] of Object.entries(attrs)) {
        out[k] = {
          default: def,
          parseHTML: (el) => { const v = el.getAttribute(`data-${k}`); try { return v === null ? def : JSON.parse(v); } catch { return def; } },
          renderHTML: (a) => ({ [`data-${k}`]: JSON.stringify(a[k]) }),
        };
      }
      return out;
    },
    parseHTML() { return [{ tag: `div[data-ws="${name}"]` }]; },
    renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-ws": name })]; },
    ...(views ? { addNodeView() { return ReactNodeViewRenderer(AtomView); } } : {}),
  });
}
const ATOM_DEFAULTS: Record<AtomType, Record<string, unknown>> = {
  parties: {},
  items: { rows: [] },
  payment: { depositPct: 25, invoiceDeposit: true, initials: false },
  signatures: { signers: ["heston", "client"], showTitle: true, showDate: true },
  divider: {},
  pagebreak: {},
  spacer: { size: 18 },
};
export const Atoms = ATOMS.map((n) => atomNode(n, ATOM_DEFAULTS[n]));
/** The page's nodes without React views, for tests and anything headless. */
export const headlessNodes = () => [Line, SectionBase, ...ATOMS.map((n) => atomNode(n, ATOM_DEFAULTS[n], false))];

/** {client.name}, {total} … get a highlight; ones with no value yet are marked as missing. */
export const fieldsKey = new PluginKey<{ missing: Set<string> }>("wsFields");
export const FieldHighlight = Extension.create<{ missing: () => Set<string> }>({
  name: "wsFields",
  addOptions() { return { missing: () => new Set<string>() }; },
  addProseMirrorPlugins() {
    const missing = () => this.options.missing();
    const build = (doc: PMNode) => {
      const decos: Decoration[] = [];
      const m = missing();
      doc.descendants((n, pos) => {
        if (!n.isText) return;
        for (const x of (n.text ?? "").matchAll(/(?<!\{)\{([a-z][a-z0-9_.]{0,40})\}(?!\})/gi)) {
          const from = pos + (x.index ?? 0);
          decos.push(Decoration.inline(from, from + x[0].length, { class: m.has(x[1]) ? "wsb-field missing" : "wsb-field" }));
        }
      });
      return DecorationSet.create(doc, decos);
    };
    return [new Plugin({
      key: fieldsKey,
      state: {
        init: (_, s) => build(s.doc),
        apply: (tr, old, _o, s) => (tr.docChanged || tr.getMeta("wsFieldsRefresh") ? build(s.doc) : old),
      },
      props: { decorations(state) { return this.getState(state) as DecorationSet; } },
    })];
  },
});

export const BlockSelect = Extension.create({
  name: "wsBlockSelect",
  addProseMirrorPlugins() { return [blockSelectionPlugin()]; },
});
