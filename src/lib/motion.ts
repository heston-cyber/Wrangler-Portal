// D175 (Heston, Nov 12: "animate the changing of the tabs and menus on desktop version to quickly slide").
// Everything here moves transform only: an opacity change on a panel (or on a parent of glass) makes the browser blur
// nothing until it ends, which is what made the page behind the phone sheet blur late (D174).
/** Desktop and motion allowed: the slides run only here; phones and "reduce motion" keep the current behaviour. */
export const DESK_MOTION = "(min-width: 821px) and (prefers-reduced-motion: no-preference)";
export const deskMotion = () => typeof matchMedia === "function" && matchMedia(DESK_MOTION).matches;

/** Which way a slide goes: "f" from the right (going on / down the menu), "b" from the left. */
export type Dir = "f" | "b";

/** The retrigger trick: the same slide plays again only if the animation's name changes, so the attribute alternates f0 / f1. */
export function nextSlide(prev: string | undefined, dir: Dir): string {
  return dir + (prev && prev.endsWith("0") ? "1" : "0");
}

/** Run a slide on a parent's later children for a moment: sets `attr` now and removes it after `ms`. */
const timers = new WeakMap<Element, number>();
export function pulse(el: HTMLElement, attr: string, value: string, ms = 900, after?: () => void) {
  el.setAttribute(attr, value);
  window.clearTimeout(timers.get(el));
  timers.set(el, window.setTimeout(() => { el.removeAttribute(attr); after?.(); }, ms));
}

/** Where a path sits in the menu (section, then item in its layer); -1 when it isn't in the menu. */
export type RankItem = { match: (p: string) => boolean; tab?: (p: string) => boolean; layer?: { match: (p: string) => boolean }[] };
export function navRank(items: RankItem[], path: string): number {
  const i = items.findIndex((it) => (it.tab ?? it.match)(path));
  if (i < 0) return -1;
  const sub = items[i].layer?.findIndex((s) => s.match(path)) ?? -1;
  return (i + 1) * 100 + (sub + 1);
}
/** Going to a later item in the menu slides in from the right; an earlier one from the left. Within one item, going
 *  deeper is forward and coming back is back; moving between two pages of the same depth doesn't slide. */
export function slideDir(items: RankItem[], from: string, to: string): Dir | null {
  const a = navRank(items, from), b = navRank(items, to);
  if (a >= 0 && b >= 0 && a !== b) return b > a ? "f" : "b";
  const depth = (p: string) => p.split("/").filter(Boolean).length;
  const da = depth(from), db = depth(to);
  return da !== db ? (db > da ? "f" : "b") : null;
}
