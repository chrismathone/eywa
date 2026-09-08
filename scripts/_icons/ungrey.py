# -*- coding: utf-8 -*-
"""배경 체크무늬를 '무채색 회색 띠'로 보고 지운다.

체크무늬는 밝기 ~135와 ~200을 오가고 경계는 안티에일리어싱으로 그 사이 값이 깔린다 —
그래서 색 하나에 붙이지 않고 **무채색이면서 밝기가 회색 구간**이면 배경으로 본다.
스티커의 흰 테두리(250↑)와 색면(채도 있음)은 이 구간 밖이라 살아남는다.
번짐은 테두리에서 시작하는 4-이웃 flood fill이라, 안쪽에 갇힌 회색은 건드리지 않는다.
"""
import os, sys
from collections import deque
from PIL import Image

SRC = os.environ.get("ICON_SRC", "raw")

LO, HI, SAT = 100, 232, 16

def bg(c):
    r, g, b = c[0], c[1], c[2]
    return (max(r, g, b) - min(r, g, b) <= SAT) and LO <= (r + g + b) / 3 <= HI

def run(path):
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    px = im.load()
    seen = bytearray(w * h)
    q = deque()
    def push(x, y):
        i = y * w + x
        if seen[i]:
            return
        c = px[x, y]
        if c[3] < 16 or bg(c):
            seen[i] = 1
            q.append((x, y))
    for x in range(w):
        push(x, 0); push(x, h - 1)
    for y in range(h):
        push(0, y); push(w - 1, y)
    while q:
        x, y = q.popleft()
        if x > 0: push(x - 1, y)
        if x < w - 1: push(x + 1, y)
        if y > 0: push(x, y - 1)
        if y < h - 1: push(x, y + 1)
    frac = sum(seen) / float(w * h)
    if not (0.15 <= frac <= 0.92):
        return None, frac
    out = im.copy(); op = out.load()
    for i in range(w * h):
        if seen[i]:
            op[i % w, i // w] = (0, 0, 0, 0)
    return out, frac

for name in sys.argv[1:]:
    p = os.path.join(SRC, "%s.png" % name)
    img, frac = run(p)
    if img is None:
        print("%-12s FAIL  %.1f%%" % (name, frac * 100))
    else:
        img.save(p)
        print("%-12s OK    %.1f%% 제거" % (name, frac * 100))
