// Builder drag and drop (Oct 27): blocks dragged by their grip to move, and Insert / clause-library items dragged from
// the panel onto the page to add. Pure, so it's tested on its own (tests/builderDnd.test.ts).
import type { Block } from "../../convex/lib/wsBuilder";

/** What's being dragged: a block already on the page, or a new one from the panel (made on drop). */
export type Drag = { kind: "move"; id: string } | { kind: "new"; make: () => Block; label: string };
/** Where it would land: before or after a block, or at the end of the page. */
export type Spot = { id: string; after: boolean } | { id: "end"; after: true };

export const sameSpot = (a: Spot | null, b: Spot | null) => a?.id === b?.id && a?.after === b?.after;

/** The spot under the pointer: the top half of a block means before it, the bottom half after. */
export function spotFor(id: string, rect: { top: number; height: number }, clientY: number): Spot {
  return { id, after: clientY > rect.top + rect.height / 2 };
}

/** True when dropping here would leave a moved block where it already is (no line is shown for those). */
export function isNoop(blocks: Block[], drag: Drag, spot: Spot): boolean {
  if (drag.kind !== "move") return false;
  const from = blocks.findIndex((b) => b.id === drag.id);
  if (from < 0) return true;
  if (spot.id === drag.id) return true;
  const to = spot.id === "end" ? blocks.length : blocks.findIndex((b) => b.id === spot.id) + (spot.after ? 1 : 0);
  return to === from || to === from + 1;
}

/** The blocks after the drop, and the id of the block that landed (to select it). */
export function place(blocks: Block[], drag: Drag, spot: Spot): { blocks: Block[]; id: string } | null {
  if (isNoop(blocks, drag, spot)) return null;
  const moving = drag.kind === "move" ? blocks.find((b) => b.id === drag.id)! : drag.make();
  const rest = drag.kind === "move" ? blocks.filter((b) => b.id !== drag.id) : [...blocks];
  let at = spot.id === "end" ? rest.length : rest.findIndex((b) => b.id === spot.id);
  if (at < 0) at = rest.length;
  else if (spot.id !== "end" && spot.after) at += 1;
  rest.splice(at, 0, moving);
  return { blocks: rest, id: moving.id };
}
