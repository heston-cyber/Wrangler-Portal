# Icons

The 49 icons in `src/assets/icons/` come from the Figma file "Wrangler Portal — Design", page `02 · Components`, frame
`Components · Icons` (node 6:2). `src/ui/Icon.tsx` loads them, and the red in them is `currentColor`, so every icon
takes the business accent. The glow is CSS (`--glow-icon` in `src/portal.css`), not part of the file.

## Refreshing them after the designer changes an icon

1. In the build chat: `get_design_context` on node 6:2 (file key `IoaSMMdMLiwsHD5qLpVx1i`). It lists one SVG
   download per icon and each icon's inset (the `inset-[…]` value on its wrapper).
2. Download each SVG into an empty folder, named after the icon (`chevron-right.svg`, …). The names are the
   `IconName` list in `src/ui/Icon.tsx`. Retry any that come back empty: a few usually fail on the first try.
3. If an inset changed, update the table at the top of `scripts/icons/convert.py`.
4. In that folder: `python3 -I <repo>/scripts/icons/convert.py out`, then `python3 -I <repo>/scripts/icons/inline.py out`.
   - `convert.py` removes the Figma glow filters, turns the red into `currentColor` and the ink into
     `var(--icon-ground)`, and crops each file to its 24 × 24 grid.
   - `inline.py` writes the shared shapes in place, so the same icon can appear many times on a page.
5. Copy `out/*.svg` over `src/assets/icons/`, check `/__kit` in the dev server, and commit.

Oct 29: the designer re-anchored the corner squares in every icon so they scale with the icon in Figma. The SVG
files didn't change: an SVG already scales as one piece, so the app's icons were right at every size.
