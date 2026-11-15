#!/usr/bin/env python3 -I
"""D176 (Heston, Nov 15, option A): the cactus scene smaller (80 %, anchored to the bottom) and darker (the sky and the sun's
glow pulled down with a gamma of 1.5), its edges fading into the page black (#030104), so the red outlines and the horizon line
stay and the glow is less. The sources are the Figma exports (scripts/bg/source). Run from the repo root:
  python3 -I scripts/bg/make-dark.py"""
import os
import numpy as np
from PIL import Image
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
SCALE, GAMMA, FEATHER, BASE = 0.8, 1.5, 0.12, (3, 1, 4)
for name in ("desktop", "phone"):
    src = Image.open(os.path.join(ROOT, "scripts", "bg", "source", f"cactus-{name}.jpg")).convert("RGB")
    W, H = src.size
    w, h = int(W * SCALE), int(H * SCALE)
    a = (np.asarray(src.resize((w, h), Image.LANCZOS)).astype(float) / 255) ** GAMMA
    img = Image.fromarray((a * 255).astype("uint8"))
    f = max(1, int(FEATHER * w))
    xs = np.minimum(1, np.minimum(np.arange(w), np.arange(w)[::-1]) / f)
    ys = np.minimum(1, np.arange(h) / f)  # fades at the top and the sides, never at the bottom
    mask = Image.fromarray((np.outer(ys, xs) * 255).astype("uint8"))
    out = Image.new("RGB", (W, H), BASE)
    out.paste(img, ((W - w) // 2, H - h), mask)
    out.save(os.path.join(ROOT, "public", "bg", f"cactus-{name}-2.jpg"), quality=88, optimize=True)
    out.save(os.path.join(ROOT, "public", "bg", f"cactus-{name}-2.webp"), quality=82, method=6)
    print(name, out.size)
