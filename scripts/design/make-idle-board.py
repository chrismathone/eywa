"""Make a small chalkboard texture from Gaegu outlines, with no runtime font download.

python scripts/design/make-idle-board.py
Then render idle-board.svg to PNG with the project's sharp package.
Typeface: https://github.com/google/fonts/tree/main/ofl/gaegu (SIL OFL 1.1).
"""
from pathlib import Path
from urllib.request import urlopen
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

root = Path(__file__).resolve().parents[2]
out = root / "public/previews/classroom"
cache = root / "logs/design-audit/Gaegu-Bold.ttf"
url = "https://raw.githubusercontent.com/google/fonts/main/ofl/gaegu/"
if not cache.exists():
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_bytes(urlopen(url + "Gaegu-Bold.ttf", timeout=30).read())
license_text = urlopen(url + "OFL.txt", timeout=30).read().decode("utf-8")
(out / "Gaegu-OFL.txt").write_text("\n".join(line.rstrip() for line in license_text.splitlines()) + "\n", encoding="utf-8")
font = TTFont(cache)
glyphs, cmap = font.getGlyphSet(), font.getBestCmap()
text = "수업 없음"
advances = [glyphs[cmap[ord(char)]].width for char in text]
scale = 820 / sum(advances)
x = 102
parts = []
for i, char in enumerate(text):
    pen = SVGPathPen(glyphs)
    glyphs[cmap[ord(char)]].draw(pen)
    # Slightly uneven chalk lettering, one readable line with a short underline.
    y = [259, 249, 255, 251, 259][i]
    angle = [-3, 2, 0, -2, 3][i]
    parts.append(f'<g transform="translate({x:.2f} {y}) rotate({angle}) scale({scale:.5f} {-scale:.5f})"><path d="{pen.getCommands()}"/></g>')
    x += advances[i] * scale
svg = '''<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="364" viewBox="0 0 1024 364">
<title>수업 없음</title>
<rect width="1024" height="364" fill="#204f4c"/>
<g fill="#f5eedb">''' + "".join(parts) + '''</g>
<path d="M328 295 Q490 306 663 294 M343 303 Q480 312 583 303" fill="none" stroke="#e7cd85" stroke-width="5" stroke-linecap="round" opacity=".85"/>
<g fill="#eceddb" opacity=".16"><circle cx="79" cy="68" r="2"/><circle cx="934" cy="287" r="2"/><circle cx="148" cy="306" r="1.5"/><circle cx="870" cy="72" r="1.5"/></g>
</svg>'''
(out / "idle-board.svg").write_text(svg, encoding="utf-8")
print("idle-board.svg ready")
