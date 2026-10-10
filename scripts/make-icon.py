#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
生成应用图标：assets/icon.png（512）+ assets/icon.ico（多尺寸）
设计：深紫底 + 水墨月牙 + 暖金月光点（对应「夜织」），纯几何绘制，不依赖字体。

用法：python scripts/make-icon.py
"""

import os
import sys

try:
    from PIL import Image, ImageDraw, ImageFilter
except ImportError:
    print("[X] 需要 Pillow：pip install Pillow")
    sys.exit(1)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets")
os.makedirs(OUT, exist_ok=True)

S = 1024  # 先画大图再缩，边缘更干净
SS = 4    # 超采样倍数用于抗锯齿（Pillow 的圆是硬边，靠缩放平滑）

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def make_base(size):
    """深紫径向渐变底 + 圆角"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = img.load()
    cx, cy = size * 0.42, size * 0.38
    maxd = size * 1.05
    top = (44, 34, 66)
    bottom = (14, 13, 20)
    for y in range(size):
        for x in range(size):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 / maxd
            t = min(1.0, d)
            r, g, b = lerp(top, bottom, t)
            # 右下角一点冷色反光
            d2 = ((x - size * 0.88) ** 2 + (y - size * 0.92) ** 2) ** 0.5 / (size * 0.7)
            if d2 < 1:
                k = (1 - d2) * 0.22
                r = int(r + (60 - r) * k)
                g = int(g + (40 - g) * k)
                b = int(b + (90 - b) * k)
            px[x, y] = (r, g, b, 255)

    # 圆角遮罩
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=int(size * 0.22), fill=255
    )
    img.putalpha(mask)
    return img

def draw_moon(img, size):
    """满月挖出月牙：外圆填暖白，内圆（偏移）挖掉"""
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx, cy = size * 0.46, size * 0.48
    R = size * 0.30

    # 月牙本体：先画外圆
    d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=(246, 238, 255, 255))
    # 挖掉内圆（先画到遮罩上再合成，保证边缘干净）
    hole = Image.new("L", (size, size), 0)
    dh = ImageDraw.Draw(hole)
    hx, hy = cx + R * 0.52, cy - R * 0.30
    hR = R * 1.02
    dh.ellipse([hx - hR, hy - hR, hx + hR, hy + hR], fill=255)
    layer.putalpha(Image.composite(Image.new("L", (size, size), 0), layer.getchannel("A"), hole))

    # 月牙外发光
    glow = layer.filter(ImageFilter.GaussianBlur(size * 0.02))
    img.alpha_composite(glow)
    img.alpha_composite(layer)

    # 几颗星（暖金）
    stars = [(0.72, 0.26, 0.018), (0.78, 0.40, 0.011), (0.66, 0.16, 0.009),
             (0.26, 0.24, 0.010), (0.20, 0.68, 0.012), (0.82, 0.66, 0.008)]
    sl = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ds = ImageDraw.Draw(sl)
    for (fx, fy, fr) in stars:
        x, y, r = fx * size, fy * size, fr * size
        ds.ellipse([x - r, y - r, x + r, y + r], fill=(255, 214, 140, 235))
    img.alpha_composite(sl.filter(ImageFilter.GaussianBlur(size * 0.004)))
    img.alpha_composite(sl)

    # 底部一条细紫光带，增加"织"的意象
    band = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    db = ImageDraw.Draw(band)
    y0 = size * 0.80
    db.rounded_rectangle(
        [size * 0.22, y0, size * 0.78, y0 + size * 0.035],
        radius=size * 0.02, fill=(201, 166, 255, 190),
    )
    img.alpha_composite(band.filter(ImageFilter.GaussianBlur(size * 0.012)))
    img.alpha_composite(band)

    return img

def main():
    print("[i] 绘制中（先用 4 倍超采样再缩小，边缘更干净）…")
    big = make_base(S * 1)          # 渐变底逐像素画，尺寸别太大以免慢
    big = big.resize((S * 2, S * 2), Image.LANCZOS)
    big = draw_moon(big, S * 2)

    png512 = big.resize((512, 512), Image.LANCZOS)
    png512_path = os.path.join(OUT, "icon.png")
    png512.save(png512_path, "PNG")
    print(f"[OK] {png512_path}  (512x512)")

    png256 = big.resize((256, 256), Image.LANCZOS)
    png256_path = os.path.join(OUT, "icon-256.png")
    png256.save(png256_path, "PNG")
    print(f"[OK] {png256_path}  (256x256)")

    ico_path = os.path.join(OUT, "icon.ico")
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    png256.save(ico_path, format="ICO", sizes=sizes)
    print(f"[OK] {ico_path}  ({len(sizes)} 个尺寸: {', '.join(str(s[0]) for s in sizes)})")

if __name__ == "__main__":
    main()
