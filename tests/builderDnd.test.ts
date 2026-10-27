// Builder drag and drop (Oct 27): T-B2.5 blocks move to where the line shows; panel items land where they're dropped.
import { describe, expect, test } from "vitest";
import { isNoop, place, spotFor, type Drag } from "../src/builder/dnd";
import type { Block } from "../convex/lib/wsBuilder";

const b = (id: string): Block => ({ id, type: "divider" } as Block);
const page = () => ["a", "b", "c", "d"].map(b);
const ids = (r: { blocks: Block[] } | null) => r?.blocks.map((x) => x.id);
const mv = (id: string): Drag => ({ kind: "move", id });

describe("T-B2.5 builder drag and drop", () => {
  test("top half of a block is before it, bottom half after", () => {
    expect(spotFor("b", { top: 100, height: 40 }, 110)).toEqual({ id: "b", after: false });
    expect(spotFor("b", { top: 100, height: 40 }, 130)).toEqual({ id: "b", after: true });
  });
  test("moving a block down, up, to the end and to the top", () => {
    expect(ids(place(page(), mv("a"), { id: "c", after: true }))).toEqual(["b", "c", "a", "d"]);
    expect(ids(place(page(), mv("d"), { id: "b", after: false }))).toEqual(["a", "d", "b", "c"]);
    expect(ids(place(page(), mv("a"), { id: "end", after: true }))).toEqual(["b", "c", "d", "a"]);
    expect(ids(place(page(), mv("d"), { id: "a", after: false }))).toEqual(["d", "a", "b", "c"]);
    expect(ids(place(page(), mv("b"), { id: "d", after: true }))).toEqual(["a", "c", "d", "b"]);
  });
  test("dropping a block where it already is does nothing (and shows no line)", () => {
    for (const s of [{ id: "b", after: false }, { id: "b", after: true }, { id: "a", after: true }, { id: "c", after: false }] as const) {
      expect(isNoop(page(), mv("b"), s)).toBe(true);
      expect(place(page(), mv("b"), s)).toBeNull();
    }
    expect(isNoop(page(), mv("d"), { id: "end", after: true })).toBe(true);
  });
  test("a new block from the panel lands at the line, and is the one selected", () => {
    const n: Drag = { kind: "new", make: () => b("new"), label: "Divider" };
    expect(place(page(), n, { id: "a", after: false })).toEqual({ blocks: ["new", "a", "b", "c", "d"].map(b), id: "new" });
    expect(ids(place(page(), n, { id: "b", after: true }))).toEqual(["a", "b", "new", "c", "d"]);
    expect(ids(place(page(), n, { id: "end", after: true }))).toEqual(["a", "b", "c", "d", "new"]);
    expect(ids(place([], n, { id: "end", after: true }))).toEqual(["new"]);
    expect(isNoop(page(), n, { id: "b", after: false })).toBe(false);
  });
  test("a target that vanished mid-drag falls back to the end", () => {
    const n: Drag = { kind: "new", make: () => b("new"), label: "Divider" };
    expect(ids(place(page(), n, { id: "zzz", after: false }))).toEqual(["a", "b", "c", "d", "new"]);
  });
});
