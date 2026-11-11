// Wrangler Portal Phase 1 (Oct 29): each business's look. The approved tokens (styles.css, from the Figma
// Foundations) are the Wrangler theme; another business's accent and background from Business settings override
// the accent family at runtime. Button text on the accent is picked to reach 4.5:1 (lib/color.ts). Wrangler's own
// red keeps the approved exception, so its look doesn't change.
import { useEffect } from "react";
import { shade, textOn } from "../../convex/lib/color";

export type Brand = { name: string; accent: string | null; background: string | null; logoUrl: string | null };

const VARS = ["--accent", "--accent-hover", "--accent-tint", "--accent-ring", "--text-accent", "--on-accent", "--surface-base", "--glass-solid"] as const;

function alpha(hex: string, a: number) {
  const h = hex.replace("#", "");
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return `rgba(${n(0)}, ${n(2)}, ${n(4)}, ${a})`;
}

/** The CSS variables a brand sets; empty for Wrangler's own theme (no overrides). */
export function brandVars(b: Brand | null): Record<string, string> {
  if (!b) return {};
  const out: Record<string, string> = {};
  if (b.accent) {
    out["--accent"] = b.accent;
    out["--accent-hover"] = shade(b.accent, 0.12);
    out["--accent-tint"] = alpha(b.accent, 0.12);
    out["--accent-ring"] = alpha(b.accent, 0.65);
    out["--text-accent"] = b.accent;
    out["--on-accent"] = textOn(b.accent).text;
  }
  if (b.background) {
    out["--surface-base"] = b.background;
    // Phase 5f: the solid look (Reduce transparency) is the background lifted a little, as Wrangler's #0b0b0d is its ink
    // lifted (Glass/solid-fill; Juniper & Ash's juniper-charcoal is matched this way until its value is confirmed)
    if ((b.accent ?? "").trim().toLowerCase() !== "#ff0000") out["--glass-solid"] = `color-mix(in srgb, ${b.background}, rgb(244, 241, 233) 3%)`;
  }
  return out;
}

/** Applies a business's look to the whole page while mounted. */
export function useBrand(b: Brand | null) {
  useEffect(() => {
    const root = document.documentElement;
    const vars = brandVars(b);
    for (const [k, val] of Object.entries(vars)) root.style.setProperty(k, val);
    // another business's colours keep the old page light; the red cactus scene is Wrangler's own (Heston, Nov 5). Wrangler's
    // settings save its own red (and a black background), so only an accent other than that red counts as another brand.
    if (b?.accent && b.accent.trim().toLowerCase() !== "#ff0000") root.setAttribute("data-brand", "custom");
    else root.removeAttribute("data-brand");
    return () => { for (const k of VARS) root.style.removeProperty(k); root.removeAttribute("data-brand"); };
  }, [b?.accent, b?.background]);
}
