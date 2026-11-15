#!/usr/bin/env python3 -I
"""D176 (Nov 15): stand-in icons for the side menu's submenu items, drawn in the portal's icon style (24 px grid, 1.5 px
round strokes in currentColor, two square anchor points). The design chat redraws them in Figma (02 · Components › Icons);
until then these are the files. Run from the repo root: python3 -I scripts/icons/make-submenu.py"""
import os
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "src", "assets", "icons")

def anchor(x, y):
    a, b = x - 0.875, y - 0.875
    sq = f"M{a} {b}H{a+1.75}V{b+1.75}H{a}V{b}Z"
    inner = f"M{x-0.5} {y-0.5}H{x+0.5}V{y+0.5}H{x-0.5}V{y-0.5}Z"
    return (f'<g><path d="{sq}" style="fill:var(--icon-ground,#030104)"/><path d="{sq}" fill="currentColor" fill-opacity="0.65098"/>'
            f'<path d="{inner}" stroke-width="0.75" stroke="currentColor"/></g>')

ICONS = {
  "overview": (["M4 4H10.5V10.5H4Z", "M13.5 4H20V10.5H13.5Z", "M4 13.5H10.5V20H4Z", "M13.5 13.5H20V20H13.5Z"], [(4, 4), (20, 20)]),
  "clipboard": (["M5 5.5H19V20.5H5Z", "M9 3.5H15V7H9Z", "M8.5 11H15.5", "M8.5 14.5H15.5", "M8.5 18H12.5"], [(5, 5.5), (19, 20.5)]),
  "booking": (["M7 3.5H17V20.5L12 16.5L7 20.5Z", "M9.5 9L11.5 11L14.5 7"], [(7, 3.5), (17, 3.5)]),
  "briefing": (["M6 3.5H14.5L18 7V20.5H6Z", "M14.5 3.5V7H18", "M9.5 18V10", "M9.5 10H15L13.5 12L15 14H9.5"], [(6, 3.5), (18, 20.5)]),
  "call-sheet": (["M5 3.5H19V20.5H5Z", "M5 8H19", "M8 11.5H10", "M12.5 11.5H16", "M8 15H10", "M12.5 15H16", "M8 18.5H10", "M12.5 18.5H16"], [(5, 3.5), (19, 20.5)]),
  "camera": (["M3.5 8H8L9.5 5.5H14.5L16 8H20.5V19H3.5Z", "M15.5 13.5A3.5 3.5 0 1 1 8.5 13.5A3.5 3.5 0 0 1 15.5 13.5Z"], [(3.5, 8), (20.5, 19)]),
  "clapper": (["M4 10H20V20H4Z", "M4 10V6.5L20 4.5V10", "M8.5 10L11 5.9", "M13.5 10L16 5.3"], [(4, 20), (20, 20)]),
  "case": (["M3.5 7H20.5V19H3.5Z", "M9.5 7V4.5H14.5V7", "M8 7V19", "M16 7V19"], [(3.5, 7), (20.5, 19)]),
  "scissors": (["M9.5 6.5A2.5 2.5 0 1 1 4.5 6.5A2.5 2.5 0 0 1 9.5 6.5Z", "M9.5 17.5A2.5 2.5 0 1 1 4.5 17.5A2.5 2.5 0 0 1 9.5 17.5Z", "M8.8 8.3L20.5 16.5", "M8.8 15.7L20.5 7.5"], [(20.5, 16.5), (20.5, 7.5)]),
  "package": (["M4 8L12 4L20 8L12 12Z", "M4 8V16L12 20V12", "M20 8V16L12 20", "M8 6L16 10"], [(4, 8), (20, 8)]),
  "building": (["M5 20.5V4.5H14V20.5", "M14 9.5H19V20.5", "M3.5 20.5H20.5", "M8 8H11", "M8 11.5H11", "M8 15H11"], [(5, 4.5), (14, 4.5)]),
  "funnel": (["M3.5 5H20.5L14 12.5V19L10 21V12.5Z"], [(3.5, 5), (20.5, 5)]),
  "flag": (["M6 21V3.5", "M6 4.5H19L16 8.5L19 12.5H6"], [(6, 3.5), (19, 4.5)]),
  "star": (["M12 3.5L14.6 9.2L20.8 9.8L16.1 13.9L17.5 20L12 16.8L6.5 20L7.9 13.9L3.2 9.8L9.4 9.2Z"], [(12, 3.5), (17.5, 20)]),
  "briefcase": (["M3.5 8H20.5V20H3.5Z", "M9 8V5H15V8", "M3.5 13H20.5", "M10.5 11.5H13.5V14.5H10.5Z"], [(3.5, 8), (20.5, 20)]),
  "wallet": (["M3.5 6.5H19.5V20.5H3.5Z", "M3.5 6.5L16 3.5V6.5", "M14 13H20.5V17H14Z"], [(3.5, 6.5), (19.5, 20.5)]),
  "presentation": (["M3.5 4.5H20.5V15H3.5Z", "M7 12L10 9L13 11L17 7", "M12 15V18.5", "M8.5 20.5L12 18.5L15.5 20.5"], [(3.5, 4.5), (20.5, 4.5)]),
  "contract": (["M6 3.5H18V20.5H6Z", "M9 7.5H15", "M9 10.5H15", "M8.5 17.5C9.8 14.5 11 18.5 12.5 16C14 13.8 14.5 17 16 16"], [(6, 3.5), (18, 20.5)]),
  "template": (["M4 4.5H20V19.5H4Z", "M4 9H20", "M10 9V19.5"], [(4, 4.5), (20, 19.5)]),
  "questionnaire": (["M4 4.5H20V19.5H4Z", "M9.7 10C9.7 7.2 14.3 7.2 14.3 10C14.3 12 12 12 12 14", "M12 16.3V16.8"], [(4, 4.5), (20, 19.5)]),
  "repeat": (["M4.5 11V9.5A3 3 0 0 1 7.5 6.5H19.5", "M16.5 3.5L19.5 6.5L16.5 9.5", "M19.5 13V14.5A3 3 0 0 1 16.5 17.5H4.5", "M7.5 14.5L4.5 17.5L7.5 20.5"], [(4.5, 11), (19.5, 13)]),
  "layers": (["M12 3.5L21 8L12 12.5L3 8Z", "M3 12L12 16.5L21 12", "M3 16L12 20.5L21 16"], [(3, 8), (21, 8)]),
  "chart": (["M4 3.5V20.5H20.5", "M8 17V12", "M12 17V8", "M16 17V11"], [(4, 3.5), (20.5, 20.5)]),
}
for name, (paths, anchors) in ICONS.items():
    body = "".join(f'<path d="{d}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>' for d in paths)
    body += "".join(anchor(x, y) for x, y in anchors)
    svg = f'<svg viewBox="0 0 24 24" width="24" height="24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g>{body}</g></svg>\n'
    with open(os.path.join(OUT, name + ".svg"), "w") as f: f.write(svg)
print(len(ICONS), "icons")
