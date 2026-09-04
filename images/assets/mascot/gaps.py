from PIL import Image
import os
d = r'E:\Projects\website-group\nathanpenny.fun\images\assets\mascot'

def find_gaps(path):
    im = Image.open(os.path.join(d, path)).convert('RGB')
    w, h = im.size
    print('====', path, im.size)
    # 列方向：每列采样，统计米白占比(>90%为空格)
    col_runs = []
    in_run = False
    start = 0
    for x in range(w):
        white = 0; n = 0
        for y in range(0, h, 10):
            r, g, b = im.getpixel((x, y))
            if r > 238 and g > 238 and b > 228:
                white += 1
            n += 1
        ratio = white / n
        if ratio > 0.85 and not in_run:
            in_run = True; start = x
        elif ratio <= 0.85 and in_run:
            if x - start > 15:
                col_runs.append((start, x - 1))
            in_run = False
    if in_run: col_runs.append((start, w - 1))
    print('列向空格段:', col_runs)
    # 行方向
    row_runs = []
    in_run = False; start = 0
    for y in range(h):
        white = 0; n = 0
        for x in range(0, w, 10):
            r, g, b = im.getpixel((x, y))
            if r > 238 and g > 238 and b > 228:
                white += 1
            n += 1
        ratio = white / n
        if ratio > 0.85 and not in_run:
            in_run = True; start = y
        elif ratio <= 0.85 and in_run:
            if y - start > 15:
                row_runs.append((start, y - 1))
            in_run = False
    if in_run: row_runs.append((start, h - 1))
    print('行向空格段:', row_runs)

find_gaps('expressions.png')
find_gaps('actions.png')
