"""Render the editable SVG into web icons and separate future Icon Composer layers.

Install design/icon/requirements.txt in a separate design environment, then run this file.
No app/runtime dependency is added. The SVG is the authoritative editable artwork.
"""
from copy import deepcopy
from pathlib import Path
import xml.etree.ElementTree as ET
import subprocess
import cairosvg

HERE = Path(__file__).resolve().parent
OUT = HERE.parents[1] / "app/public/icons"
OUT.mkdir(parents=True, exist_ok=True)
ET.register_namespace("", "http://www.w3.org/2000/svg")
ET.register_namespace("xlink", "http://www.w3.org/1999/xlink")
SOURCE = ET.parse(HERE / "cyberjudah-layers.svg").getroot()
NS = {"s": "http://www.w3.org/2000/svg"}


def source(dark=False, clear=False, maskable=False, monochrome=False, layer=None):
    root = deepcopy(SOURCE)
    background = root.find("s:g[@id='background']", NS)
    background[0].set("fill", "#081725" if dark else "#f4f0e5")
    if clear or monochrome:
        root.remove(background)
    for group in root.findall("s:g", NS):
        if layer and group.get("id") != layer:
            root.remove(group)
        elif maskable and group.get("id") != "background":
            # The complete mark fits inside the central circle of radius 40%.
            group.set("transform", f"translate(152 152) scale({720 / 1254:.8f})")
    if monochrome:
        # One ink with negative spaces preserves the split face and circuit detail.
        art = root.find("s:defs/s:g[@id='lion-art']", NS)
        for path in art:
            color = path.get("fill", "#000000")
            rgb = [int(color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
            lum = sum(v * weight for v, weight in zip(rgb, (.2126, .7152, .0722)))
            path.set("fill", "white" if lum > .31 else "black")
        # Luminance masking removes the dark drawing areas, leaving one opaque ink.
        mask = ET.SubElement(root.find("s:defs", NS), "mask", {"id": "mono", "maskUnits": "userSpaceOnUse", "x": "0", "y": "0", "width": "1024", "height": "1024"})
        for group in list(root.findall("s:g", NS)):
            root.remove(group)
            mask.append(group)
        ET.SubElement(root, "rect", {"width": "1024", "height": "1024", "fill": "#000000", "mask": "url(#mono)"})
    # Generated variants are compact; the editable master keeps one path per line.
    for element in root.iter():
        element.tail = None
        if element.text and not element.text.strip():
            element.text = None
    return ET.tostring(root)


def png(svg, name, size, directory=OUT):
    cairosvg.svg2png(bytestring=svg, write_to=str(directory / name), output_width=size, output_height=size)


for dark in (False, True):
    variant = "dark" if dark else "light"
    svg = source(dark=dark)
    for size in (32, 64, 180, 192, 512, 1024):
        png(svg, f"{variant}-{size}.png", size)
for size in (192, 512):
    png(source(dark=True, maskable=True), f"maskable-{size}.png", size)
mono = source(monochrome=True, maskable=True)
(OUT / "monochrome.svg").write_bytes(mono)
subprocess.run(["node", str(HERE / "render-monochrome.mjs")], check=True)
(HERE / "clear.svg").write_bytes(source(clear=True))
layers = HERE / "layers"
layers.mkdir(exist_ok=True)
for layer in ("background", "middle", "foreground"):
    png(source(layer=layer), f"{layer}.png", 1024, layers)
print(f"Exported icons to {OUT} and three separate layers to {layers}")
