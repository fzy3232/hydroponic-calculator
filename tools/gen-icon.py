# -*- coding: utf-8 -*-
"""
生成应用图标源图（1024x1024 PNG）。

生成后交给 Tauri CLI 切成全套尺寸：
    npx tauri icon scripts/app-icon.png

图标语义：深蓝圆角底（沿用界面品牌色）+ 白色水滴 + 嫩芽 —— 一眼能看出是"水培/营养液"。
"""
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
SIZE = 1024
BRAND = (47, 111, 208)      # --brand #2f6fd0
BRAND_DARK = (30, 78, 158)  # 底部加深，做出轻微的纵向渐变
WHITE = (255, 255, 255)
LEAF = (140, 200, 120)


def vertical_gradient(size, top, bottom):
    """生成纵向渐变底图。"""
    image = Image.new('RGB', (size, size), top)
    draw = ImageDraw.Draw(image)
    for y in range(size):
        ratio = y / max(size - 1, 1)
        color = tuple(
            round(top[channel] + (bottom[channel] - top[channel]) * ratio)
            for channel in range(3)
        )
        draw.line([(0, y), (size, y)], fill=color)
    return image


def rounded_mask(size, radius):
    """圆角方形遮罩。"""
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def droplet(draw, center_x, top_y, width, height, fill):
    """画一个水滴：上方尖角 + 下方圆。"""
    radius = width / 2
    bottom_center_y = top_y + height - radius
    # 圆身
    draw.ellipse(
        [center_x - radius, bottom_center_y - radius, center_x + radius, bottom_center_y + radius],
        fill=fill,
    )
    # 上方尖角（用三角形拼出尖端）
    draw.polygon(
        [
            (center_x, top_y),
            (center_x - radius * 0.92, bottom_center_y - radius * 0.16),
            (center_x + radius * 0.92, bottom_center_y - radius * 0.16),
        ],
        fill=fill,
    )


def main():
    base = vertical_gradient(SIZE, BRAND, BRAND_DARK)
    mask = rounded_mask(SIZE, radius=int(SIZE * 0.22))
    canvas = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    canvas.paste(base, (0, 0), mask)

    draw = ImageDraw.Draw(canvas)

    # 水滴：居中偏下，占画布约一半宽
    droplet(
        draw,
        center_x=SIZE / 2,
        top_y=SIZE * 0.20,
        width=SIZE * 0.46,
        height=SIZE * 0.60,
        fill=WHITE,
    )

    # 水滴里长出一片嫩芽（表示"种"）
    leaf_center_x = SIZE * 0.50
    leaf_center_y = SIZE * 0.60
    draw.ellipse(
        [leaf_center_x - SIZE * 0.085, leaf_center_y - SIZE * 0.085,
         leaf_center_x + SIZE * 0.085, leaf_center_y + SIZE * 0.085],
        fill=LEAF,
    )
    # 叶柄
    draw.line(
        [(leaf_center_x, leaf_center_y + SIZE * 0.06), (leaf_center_x, SIZE * 0.78)],
        fill=LEAF,
        width=int(SIZE * 0.022),
    )

    output = os.path.join(HERE, 'app-icon.png')
    canvas.save(output, 'PNG')
    print(f'图标源图已生成：{output}（{SIZE}x{SIZE}）')


if __name__ == '__main__':
    main()
