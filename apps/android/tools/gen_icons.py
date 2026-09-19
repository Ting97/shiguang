"""生成 API 24/25 所需的 legacy launcher PNG 图标（API 26+ 走 mipmap-anydpi-v26 自适应矢量图标）。

零依赖：手写 PNG 编码（zlib+struct），几何绘制用极坐标太阳星芒（与 ic_launcher_foreground.xml 同款），
4x 超采样抗锯齿。运行：python tools/gen_icons.py
"""
import math
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, "..", "app", "src", "main", "res")

BG = (0x0B, 0x15, 0x26)
RAY = (0xF1, 0xC6, 0x6B)
MID = (0xF5, 0xD0, 0x8A)
INNER = (0xE8, 0xB4, 0x53)

SIZES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
SS = 4  # 每轴超采样倍数


def in_rounded_rect(x, y, size, radius):
    """覆盖概率：圆角矩形覆盖（x,y) 的软判断，输入为像素内相对坐标 [0,1)"""
    # 圆角矩形 SDF
    px, py = x - 0.5, y - 0.5
    qx = abs(px) - (0.5 - radius)
    qy = abs(py) - (0.5 - radius)
    dx = max(qx, 0.0)
    dy = max(qy, 0.0)
    d = math.hypot(dx, dy) + min(max(qx, qy), 0.0) - radius
    return d  # <=0 内部


def sun_color(u, v):
    """太阳星芒覆盖：(u,v) 相对中心、以画布短边归一。返回 (ray, mid, inner) 三个 0/1 覆盖。"""
    dx, dy = u, v
    r = math.hypot(dx, dy)
    if r <= 13.0:
        return 0, 0, 1
    if r <= 19.0:
        return 0, 1, 0
    if r <= 38.0:
        ang = math.atan2(dx, -dy)  # 0 = 正上，与矢量图一致
        half = math.pi / 6
        a = math.fmod(ang + half, half)
        if a < 0:
            a += half
        dist = min(a, half - a)  # 距最近星芒轴的角距
        # 三角星芒：内缘(r=18)半宽4.2 → 外缘(r=38)收拢到 0
        hw = 4.2 * (38.0 - r) / 20.0
        if r >= 18.0 and dist * r <= hw:
            return 1, 0, 0
    return 0, 0, 0


def render(size, round_bg):
    radius = 0.5 if round_bg else 0.18
    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            acc = [0.0, 0.0, 0.0, 0.0]  # RGB + 覆盖率(即 alpha)
            for sy in range(SS):
                for sx in range(SS):
                    x = (px + (sx + 0.5) / SS) / size
                    y = (py + (sy + 0.5) / SS) / size
                    # 背景覆盖（软边缘抗锯齿由超采样平均实现）
                    d = in_rounded_rect(x, y, size, radius)
                    if d < 0.5 / size:  # 边缘 1px 内做概率过渡
                        bgw = 1.0 - max(0.0, min(1.0, (d + 0.5 / size) / (1.0 / size)))
                    else:
                        bgw = 1.0 if d <= 0 else 0.0
                    c = BG
                    # 太阳：矢量图 108 画布中星芒外缘 r=38；legacy 图标放大到直径约 62% 画布
                    u = (x - 0.5) * 122.0
                    v = (y - 0.5) * 122.0
                    ray, mid, inner = sun_color(u, v)
                    if ray:
                        c = RAY
                    elif mid:
                        c = MID
                    elif inner:
                        c = INNER
                    for i in range(3):
                        acc[i] += c[i] / 255.0 * bgw
                    acc[3] += bgw
            n = SS * SS
            row += bytes(int(round(acc[i] / n * 255)) for i in range(3))
            row.append(int(round(acc[3] / n * 255)))
        rows.append(row)
    return rows


def write_png(path, size, rows):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(
            ">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + bytes(r) for r in rows)
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)


if __name__ == "__main__":
    for dpi, size in SIZES.items():
        d = os.path.join(RES, "mipmap-" + dpi)
        os.makedirs(d, exist_ok=True)
        write_png(os.path.join(d, "ic_launcher.png"), size, render(size, round_bg=False))
        write_png(os.path.join(d, "ic_launcher_round.png"), size, render(size, round_bg=True))
        print(dpi, size, "ok")
