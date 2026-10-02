"""把 v0.2 的富途面板截图裁成 README 用的图。

原图 2561x1368（视口 1707x912 × dpr 1.5）。右侧栏在 CSS 里从 x≈1140 起，
设备像素 x≈1710。这张图专门裁右侧栏特写 —— 因为 v0.2 的新东西（风险读数、
异动置顶、时区、中文说明、资讯栏、问一句）全在面板里。

    python docs/make-screenshots-v2.py
"""
from PIL import Image
import os

SRC = r"E:\development\shot-fin-v2.png"
OUT_DIR = os.path.dirname(os.path.abspath(__file__))
# 实测（2026-10-03）：视口 1440x852、devicePixelRatio=1、右侧栏 CSS rect = (708, 40, 732, 812)。
# 别写死 2561 —— 那是 dpr=1.5 时的老尺寸，写死了就会裁出一块空白（踩过）。
PANEL_BOX = (708, 40, 1440, 852)


def save(image, name, width):
    ratio = width / image.width
    resized = image.resize((width, round(image.height * ratio)), Image.LANCZOS)
    path = os.path.join(OUT_DIR, name)
    resized.save(path, optimize=True)
    print(f"{name}  {resized.size[0]}x{resized.size[1]}  {os.path.getsize(path) // 1024} KB")


full = Image.open(SRC)
save(full.crop(PANEL_BOX), "screenshot-panel-v2.png", 820)
save(full, "screenshot-full-v2.png", 1600)
