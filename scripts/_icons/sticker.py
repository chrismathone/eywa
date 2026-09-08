# -*- coding: utf-8 -*-
"""40장을 **같은 규격의 스티커**로 맞춘다 — 내용 크기 통일 + 굵은 흰 테두리 + 옅은 그림자.

🔴 흰 테두리는 장식이 아니라 **읽히게 하는 장치**다: 활성 탭 배경이 남색이라, 테두리가 없으면
   보라 면이 배경에 묻힌다(생성물마다 테두리 유무가 갈려서 여기서 한 번에 두른다).
같은 이유로 내용 크기도 여기서 맞춘다 — 생성물은 여백이 제각각이라 나란히 놓으면 크기가 튄다.
"""
import sys, os
from PIL import Image, ImageFilter

S = 512          # 최종 정사각
CONTENT = 0.72   # 내용이 차지할 비율
RING = 0.075     # 흰 테두리 두께(캔버스 대비) — 남색 위에서 형태를 떼어 놓는 장치라 얇으면 의미가 없다

def make(path, dst):
    im = Image.open(path).convert("RGBA")
    bb = im.getchannel("A").point(lambda v: 255 if v > 24 else 0).getbbox()
    if not bb:
        return False
    im = im.crop(bb)
    w, h = im.size
    target = int(S * CONTENT)
    k = float(target) / max(w, h)
    im = im.resize((max(1, int(round(w * k))), max(1, int(round(h * k)))), Image.LANCZOS)
    canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    canvas.paste(im, ((S - im.size[0]) // 2, (S - im.size[1]) // 2), im)

    a = canvas.getchannel("A")
    r = S * RING
    # 블러 + 급한 램프 = 둥글게 부푼 마스크(모서리가 뾰족해지지 않는다).
    ring = a.filter(ImageFilter.GaussianBlur(r * 0.62)).point(
        lambda v: 0 if v <= 26 else min(255, int((v - 26) * 10))
    )
    white = Image.new("RGBA", (S, S), (255, 255, 255, 255))
    white.putalpha(ring)
    # 그림자 — 테두리 바깥으로 아주 옅게.
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sh = ring.filter(ImageFilter.GaussianBlur(r * 0.5)).point(lambda v: int(v * 0.22))
    shadow.putalpha(sh)
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    out = Image.alpha_composite(out, Image.new("RGBA", (S, S), (0, 0, 0, 0)))
    out.paste(shadow, (0, int(S * 0.012)), shadow)
    out = Image.alpha_composite(out, white)
    out = Image.alpha_composite(out, canvas)
    out.save(dst)
    return True

src = os.environ.get("ICON_SRC", "raw")
dst = os.environ.get("ICON_OUT", "final")
if not os.path.isdir(dst):
    os.makedirs(dst)
n = 0
for f in sorted(os.listdir(src)):
    if f.endswith(".png") and make(os.path.join(src, f), os.path.join(dst, f)):
        n += 1
print("%d장 처리" % n)
