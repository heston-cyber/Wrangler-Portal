// @vitest-environment jsdom
// Nov 25 (Heston, approved): the player's controls in a glass box on the picture.
//   V1 play, settings, sound and full screen are in the box on the picture (not in the bar under it) with a mouse, and
//      stay in the bar on phones, iPads and narrow windows; the box isn't there while drawing
//   V2 it shows while the mouse moves over the video and goes when it leaves; while playing it also fades after 2.5 s of
//      no movement (not while the mouse rests on the box) and comes back on the next move; paused, it stays; touch never
//      shows it; the settings menu open or keyboard focus keeps it up; Reduce Motion only fades
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDLE_MS, useOverlayControls } from "../src/modules/review/player/useOverlayControls";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: ReturnType<typeof createRoot>;
let ov: ReturnType<typeof useOverlayControls>;
function Probe({ playing }: { playing: boolean }) { ov = useOverlayControls(playing); return null; }
const render = (playing: boolean) => act(() => root.render(<Probe playing={playing} />));
const move = (pointerType = "mouse") => act(() => ov.stage.onPointerMove({ pointerType } as React.PointerEvent));
beforeEach(() => { vi.useFakeTimers(); host = document.createElement("div"); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); vi.useRealTimers(); });

describe("the control box's show and hide", () => {
  it("V2 shows on hover and goes when the mouse leaves", () => {
    render(false);
    expect(ov.shown).toBe(false);
    move();
    expect(ov.shown).toBe(true);
    act(() => { vi.advanceTimersByTime(IDLE_MS * 3); });
    expect(ov.shown).toBe(true); // paused: stays while hovering
    act(() => ov.stage.onPointerLeave());
    expect(ov.shown).toBe(false);
  });

  it("V2 while playing it fades after 2.5 s without movement, and comes back on the next move", () => {
    render(true);
    move();
    act(() => { vi.advanceTimersByTime(IDLE_MS - 50); });
    expect(ov.shown).toBe(true);
    act(() => { vi.advanceTimersByTime(100); });
    expect(ov.shown).toBe(false);
    expect(ov.idle).toBe(true); // the pointer hides too
    move();
    expect(ov.shown).toBe(true);
  });

  it("V2 not while the mouse rests on the box; pausing brings it back", () => {
    render(true);
    move();
    act(() => ov.box.onPointerEnter());
    act(() => { vi.advanceTimersByTime(IDLE_MS * 2); });
    expect(ov.shown).toBe(true);
    act(() => ov.box.onPointerLeave());
    act(() => { vi.advanceTimersByTime(IDLE_MS + 10); });
    expect(ov.shown).toBe(false);
    render(false); // paused (Space, or a click on the picture)
    expect(ov.shown).toBe(true);
  });

  it("V2 a touch never shows it", () => {
    render(false);
    move("touch");
    expect(ov.shown).toBe(false);
  });
});

describe("where the controls are", () => {
  const page = readFileSync("src/modules/review/VideoPage.tsx", "utf8");
  it("V1 in the glass box on the picture with a mouse, in the bar otherwise, never while drawing", () => {
    expect(page).toContain("const overlay = canHover && !narrow;");
    expect(page).toContain("const controlBox = overlay && ready && !drawing ? (");
    expect(page).toMatch(/<div className="vctl" role="toolbar" aria-label="Playback controls" \{\.\.\.ov\.box\}>\s*\{playButton\}\{settingsMenu\}\{muteButton\}\{fsButton\}/);
    expect(page).toContain("{!overlay && <>{playButton}{settingsMenu}{muteButton}{fsButton}</>}");
    const stage = page.slice(page.indexOf('<div className={`stage'), page.indexOf("{!version && ("));
    expect(stage).toContain("{controlBox}");
    expect(stage).toContain("{...(overlay ? ov.stage : {})}");
  });
  it("V2 the styles: hidden until shown; kept up by the open menu or keyboard focus; fade only with Reduce Motion", () => {
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toMatch(/\.vctl \{[^}]*opacity: 0;[^}]*pointer-events: none;/);
    expect(css).toMatch(/\.vctl \{[^}]*backdrop-filter: var\(--blur-glass\)/);
    expect(css).toContain('.stage.ctl-on .vctl, .vctl:has(:focus-visible), .vctl:has([aria-expanded="true"]) { opacity: 1; transform: translate(-50%, 0); pointer-events: auto; }');
    expect(css).toContain("@media (prefers-reduced-motion: reduce) { .vctl { transition: opacity 80ms linear;");
    expect(readFileSync("src/modules/review/player/useOverlayControls.ts", "utf8")).toContain('"(hover: hover) and (pointer: fine)"');
  });
});
