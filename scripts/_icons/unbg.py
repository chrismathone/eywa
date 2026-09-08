# -*- coding: utf-8 -*-
"""배경만 지운다 — 테두리에서 시작한 flood fill이 스티커의 '그림자 링'에서 멈추는 성질을 쓴다.

🔴 흰 배경과 스티커의 **흰 테두리**는 같은 색이라 색만으로는 못 가른다. 대신 둘 사이에 있는
   옅은 그림자가 경계가 된다 — 그래서 허용오차를 아주 좁게 잡고(<=TOL) 4-이웃으로만 번진다.
   샌 경우(지운 넓이가 비정상)엔 저장하지 않고 실패를 보고한다(반쪽짜리 결과를 남기지 않는다).
"""
import os, sys
from collections import deque
from PIL import Image

SRC = os.environ.get("ICON_SRC", "raw")

TOL = 12          # 배경으로 볼 색차(채널 최대 절대차)
SOFT = 30         # 경계 부드럽게 — 이 안이면 알파를 깎는다
MIN_CUT, MAX_CUT = 0.12, 0.90   # 지운 넓이 안전 범위

def near(a, b, tol):
    return abs(a[0]-b[0]) <= tol and abs(a[1]-b[1]) <= tol and abs(a[2]-b[2]) <= tol

def run(path):
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    px = im.load()
    # 테두리 색 표본 — 체크무늬면 두 색이 섞이므로 자주 나온 것 두 개를 쓴다.
    counts = {}
    for x in range(w):
        for y in (0, h-1):
            counts[px[x, y][:3]] = counts.get(px[x, y][:3], 0) + 1
    for y in range(h):
        for x in (0, w-1):
            counts[px[x, y][:3]] = counts.get(px[x, y][:3], 0) + 1
    bases = [c for c, _ in sorted(counts.items(), key=lambda kv: -kv[1])[:2]]

    seen = bytearray(w*h)
    q = deque()
    def push(x, y):
        i = y*w + x
        if seen[i]:
            return
        c = px[x, y]
        if c[3] < 16 or any(near(c, b, TOL) for b in bases):
            seen[i] = 1
            q.append((x, y))
    for x in range(w):
        push(x, 0); push(x, h-1)
    for y in range(h):
        push(0, y); push(w-1, y)
    while q:
        x, y = q.popleft()
        if x > 0: push(x-1, y)
        if x < w-1: push(x+1, y)
        if y > 0: push(x, y-1)
        if y < h-1: push(x, y+1)

    cut = sum(seen)
    frac = cut / float(w*h)
    if not (MIN_CUT <= frac <= MAX_CUT):
        return None, frac

    out = im.copy()
    op = out.load()
    for i in range(w*h):
        if seen[i]:
            x, y = i % w, i // w
            op[x, y] = (0, 0, 0, 0)
    # 경계 한 겹 — 배경에 닿은 픽셀 중 배경색에 가까운 것은 알파를 비례로 깎아 계단을 줄인다.
    for y in range(h):
        for x in range(w):
            if seen[y*w + x]:
                continue
            touch = ((x > 0 and seen[y*w+x-1]) or (x < w-1 and seen[y*w+x+1])
                     or (y > 0 and seen[(y-1)*w+x]) or (y < h-1 and seen[(y+1)*w+x]))
            if not touch:
                continue
            c = op[x, y]
            d = min(max(abs(c[0]-b[0]), abs(c[1]-b[1]), abs(c[2]-b[2])) for b in bases)
            if d < SOFT:
                op[x, y] = (c[0], c[1], c[2], int(c[3] * d / float(SOFT)))
    return out, frac

for name in sys.argv[1:]:
    p = os.path.join(SRC, "%s.png" % name)
    img, frac = run(p)
    if img is None:
        print("%-16s FAIL  (지운 넓이 %.1f%% — 안전범위 밖, 저장 안 함)" % (name, frac*100))
    else:
        img.save(p)
        print("%-16s OK    (배경 %.1f%% 제거)" % (name, frac*100))
