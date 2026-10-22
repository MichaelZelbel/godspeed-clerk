#!/usr/bin/env python3
"""Render the made-up kit documents as scanned-looking PDFs.

    python3 test/kit/render.py <output folder>

One PDF per document in documents.json, named <slug>.pdf, pages split at "=== page ===". Each page
is a greyish A4 image at 200 dpi with the text in a plain font, turned by a fraction of a degree,
with a little dust; documents.json can make one blurry, crooked and pale (the "blurry scan").
Everything is drawn from a fixed seed, so every run makes the same files. Needs Pillow only.
"""
import json
import os
import random
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
DPI = 200
W, H = int(8.27 * DPI), int(11.69 * DPI)
FONTS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "C:/Windows/Fonts/arial.ttf",
]


def font(size):
    for f in FONTS:
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    for root, _dirs, files in os.walk("/usr/share/fonts"):
        for n in files:
            if n.lower().endswith(".ttf"):
                return ImageFont.truetype(os.path.join(root, n), size)
    return ImageFont.load_default(size=size)


def page(lines, style, rnd):
    paper = Image.new("L", (W, H), 246)
    draw = ImageDraw.Draw(paper)
    body, head = font(34), font(40)
    y = 170
    for i, line in enumerate(lines):
        f = head if i == 0 else body
        draw.text((160, y), line, fill=28, font=f)
        y += int((40 if i == 0 else 34) * 1.6)
    for _ in range(900):  # dust
        x, yy = rnd.randrange(W), rnd.randrange(H)
        draw.point((x, yy), fill=rnd.randrange(120, 200))
    angle = style.get("rotate", rnd.uniform(-0.6, 0.6))
    paper = paper.rotate(angle, resample=Image.BICUBIC, fillcolor=238)
    if style.get("blur"):
        paper = paper.filter(ImageFilter.GaussianBlur(style["blur"]))
    if style.get("contrast"):
        grey = Image.new("L", paper.size, 200)
        paper = Image.blend(grey, paper, style["contrast"])
    return paper.convert("RGB")


def main(out):
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(HERE, "documents.json"), encoding="utf-8") as fh:
        docs = json.load(fh)["documents"]
    for n, d in enumerate(docs):
        with open(os.path.join(HERE, "documents", d["slug"] + ".txt"), encoding="utf-8") as fh:
            pages = fh.read().split("=== page ===\n")
        rnd = random.Random(1000 + n)
        imgs = [page(p.rstrip("\n").split("\n"), d.get("style", {}), rnd) for p in pages]
        target = os.path.join(out, d["slug"] + ".pdf")
        imgs[0].save(target, "PDF", resolution=DPI, save_all=True, append_images=imgs[1:], quality=80)
        print("%s: %d page(s), %d bytes" % (target, len(imgs), os.path.getsize(target)))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
