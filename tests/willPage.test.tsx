// @vitest-environment jsdom
// Nov 22 (Heston, approved; then "Each does their own" and "Hidden link, no sign-in"): the will walkthrough page.
//   W1 Next stops on missing answers and shows what's needed; answers are kept in this browser and come back on reload;
//      Start over erases them
//   W4 the hidden address opens before sign-in, and no menu or page links to it
//   W5 nothing leaves the browser: the page renders with no Convex provider at all (so it can't query or change
//      anything), never calls fetch, and its files import nothing that talks to a server
import { readFileSync, readdirSync } from "node:fs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WillWalkthrough, { WILL_KEY, WILL_PATH } from "../src/modules/will/WillPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: ReturnType<typeof createRoot>;
const fetchSpy = vi.fn();
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", fetchSpy);
  Element.prototype.scrollIntoView = () => {};
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const mount = () => act(() => root.render(<WillWalkthrough />));
const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
const click = (label: string) => act(() => { button(label).click(); });
const heading = () => host.querySelector("h1")?.textContent;
const type = (label: string, value: string, nth = 0) => {
  const lab = [...host.querySelectorAll("label")].filter((l) => l.textContent === label)[nth];
  const input = document.getElementById(lab.htmlFor) as HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

describe("the will walkthrough", () => {
  it("W1 Next stops on missing answers, and answers are kept in this browser", () => {
    mount();
    expect(heading()).toBe("Before you start");
    click("Start");
    expect(heading()).toBe("You and your spouse");
    click("Next");
    expect(heading()).toBe("You and your spouse"); // blocked
    expect(host.textContent).toContain("Type the full legal name.");
    expect(host.textContent).toContain("Fill in the fields marked above to go on.");
    type("Full legal name", "Jordan Lee Sample", 0);
    type("Full legal name", "Casey Ann Sample", 1);
    type("City", "Oklahoma City");
    type("County", "Oklahoma");
    click("Next");
    expect(heading()).toBe("Children");
    const saved = JSON.parse(localStorage.getItem(WILL_KEY)!);
    expect(saved.a.name).toBe("Jordan Lee Sample");
    expect(saved.b.name).toBe("Casey Ann Sample");
    // A reload brings the answers back.
    act(() => root.unmount()); root = createRoot(host); mount();
    click("Start");
    expect((document.getElementById([...host.querySelectorAll("label")].find((l) => l.textContent === "City")!.htmlFor) as HTMLInputElement).value).toBe("Oklahoma City");
    // Start over erases them, after asking.
    click("Start over");
    expect(host.textContent).toContain("Erase every answer on this device?");
    click("Erase");
    expect(localStorage.getItem(WILL_KEY) === null || JSON.parse(localStorage.getItem(WILL_KEY)!).a.name === "").toBe(true);
    expect(heading()).toBe("Before you start");
  });

  it("W1 steps after the first unanswered one can't be skipped to", () => {
    mount();
    const review = [...host.querySelectorAll(".will-steps button")].find((b) => b.textContent?.includes("Review and download")) as HTMLButtonElement;
    expect(review.disabled).toBe(true);
  });

  it("W5 nothing leaves the browser", () => {
    mount(); // no ConvexProvider: any query or mutation would throw here
    click("Start"); click("Next");
    expect(fetchSpy).not.toHaveBeenCalled();
    for (const f of readdirSync("src/modules/will")) {
      const src = readFileSync(`src/modules/will/${f}`, "utf8");
      expect(src, f).not.toMatch(/convex\/react|_generated\/api|\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|useQuery|useMutation|useAction/);
    }
  });

  it("W4 the hidden address opens before sign-in, and nothing links to it", () => {
    expect(WILL_PATH.test("/will/r8vq2n5w")).toBe(true);
    expect(WILL_PATH.test("/will")).toBe(false);
    const app = readFileSync("src/App.tsx", "utf8");
    const route = app.indexOf("if (/^\\/will\\/r8vq2n5w\\/?$/.test(path)) return");
    expect(route).toBeGreaterThan(0);
    expect(route).toBeLessThan(app.indexOf("if (!isAuthenticated) return <SignIn")); // before sign-in
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
    const linking = walk("src").filter((f) => /\.(tsx?|css)$/.test(f) && !f.startsWith("src/modules/will/") && f !== "src/App.tsx" && readFileSync(f, "utf8").includes("r8vq2n5w"));
    expect(linking).toEqual([]);
  });
});
